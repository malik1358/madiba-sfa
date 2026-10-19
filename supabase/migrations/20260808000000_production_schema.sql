


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."activate_sales_batch"("p_batch_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$

begin

    -- Confirm that the batch exists
    if not exists (
        select 1
        from public.import_batches
        where id = p_batch_id
    ) then
        raise exception 'Import batch does not exist';
    end if;


    -- Do not activate a failed batch
    if exists (
        select 1
        from public.import_batches
        where id = p_batch_id
          and status = 'FAILED'
    ) then
        raise exception 'Cannot activate failed import batch';
    end if;


    -- Archive previous active snapshot
    update public.import_batches
    set status = 'ARCHIVED'
    where status = 'ACTIVE'
      and id <> p_batch_id;


    -- Activate the new snapshot
    update public.import_batches
    set
        status = 'ACTIVE',
        completed_at = now()
    where id = p_batch_id;


    -- Point the whole SFA to this snapshot
    update public.system_settings
    set
        setting_value = p_batch_id::text,
        updated_at = now()
    where setting_key = 'active_sales_batch_id';

end;
$$;


ALTER FUNCTION "public"."activate_sales_batch"("p_batch_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_salesman_code"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    select salesman_code
    from public.profiles
    where id = auth.uid()
    limit 1;
$$;


ALTER FUNCTION "public"."current_salesman_code"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_role"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    select role
    from public.profiles
    where id = auth.uid()
    limit 1;
$$;


ALTER FUNCTION "public"."current_user_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_import_batch"("p_batch_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$

begin

    if not public.is_management() then
        raise exception 'Not authorised';
    end if;

    if exists (
        select 1
        from public.import_batches
        where id = p_batch_id
          and status = 'ACTIVE'
    ) then

        raise exception 'Cannot delete active dataset';

    end if;

    delete from public.import_batches
    where id = p_batch_id;

end;

$$;


ALTER FUNCTION "public"."delete_import_batch"("p_batch_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and lower(coalesce(role, '')) = 'admin'
  );
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_management"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    select coalesce(
        public.current_user_role() in ('admin','manager'),
        false
    );
$$;


ALTER FUNCTION "public"."is_management"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
    new.updated_at = now();
    return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."sales_raw" (
    "id" bigint NOT NULL,
    "import_batch_id" bigint NOT NULL,
    "source_row_number" integer,
    "reference" "text",
    "voucher_number" "text",
    "voucher_type" "text",
    "transaction_date" "date",
    "customer_code" "text",
    "customer_name" "text",
    "salesman_code" "text",
    "salesman_name" "text",
    "item_code" "text",
    "item_name" "text",
    "category" "text",
    "local_import" "text",
    "quantity" numeric(18,4),
    "rate" numeric(18,4),
    "sales_amount" numeric(18,4),
    "first_purchase_date" "date",
    "abc_class" "text",
    "source_data" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sales_raw" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_settings" (
    "setting_key" "text" NOT NULL,
    "setting_value" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."system_settings" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."active_sales" AS
 SELECT "sr"."id",
    "sr"."import_batch_id",
    "sr"."source_row_number",
    "sr"."reference",
    "sr"."voucher_number",
    "sr"."voucher_type",
    "sr"."transaction_date",
    "sr"."customer_code",
    "sr"."customer_name",
    "sr"."salesman_code",
    "sr"."salesman_name",
    "sr"."item_code",
    "sr"."item_name",
    "sr"."category",
    "sr"."local_import",
    "sr"."quantity",
    "sr"."rate",
    "sr"."sales_amount",
    "sr"."first_purchase_date",
    "sr"."abc_class",
    "sr"."source_data",
    "sr"."created_at"
   FROM ("public"."sales_raw" "sr"
     JOIN "public"."system_settings" "ss" ON ((("ss"."setting_key" = 'active_sales_batch_id'::"text") AND ("ss"."setting_value" = ("sr"."import_batch_id")::"text"))));


ALTER VIEW "public"."active_sales" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customer_documents" (
    "id" bigint NOT NULL,
    "customer_code" "text",
    "prospect_id" bigint,
    "document_type" "text" NOT NULL,
    "file_path" "text" NOT NULL,
    "expiry_date" "date",
    "uploaded_by_salesman_code" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."customer_documents" OWNER TO "postgres";


ALTER TABLE "public"."customer_documents" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."customer_documents_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."customers" (
    "id" bigint NOT NULL,
    "customer_code" "text" NOT NULL,
    "customer_name" "text" NOT NULL,
    "customer_name_ar" "text",
    "current_salesman_code" "text",
    "customer_type" "text",
    "city" "text",
    "area" "text",
    "latitude" numeric(10,7),
    "longitude" numeric(10,7),
    "contact_person" "text",
    "mobile" "text",
    "vat_number" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "latest_transaction_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "customers_customer_type_check" CHECK (("customer_type" = ANY (ARRAY['SPECIALIST'::"text", 'GENERAL'::"text", 'DISCOUNT'::"text", 'OTHER'::"text"])))
);


ALTER TABLE "public"."customers" OWNER TO "postgres";


ALTER TABLE "public"."customers" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."customers_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."daily_activity_logs" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "entry_type" "text" NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."daily_activity_logs" OWNER TO "postgres";


ALTER TABLE "public"."daily_activity_logs" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."daily_activity_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."follow_ups" (
    "id" bigint NOT NULL,
    "salesman_code" "text" NOT NULL,
    "customer_code" "text",
    "prospect_id" bigint,
    "follow_up_date" "date" NOT NULL,
    "reason" "text",
    "notes" "text",
    "status" "text" DEFAULT 'OPEN'::"text" NOT NULL,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "follow_ups_status_check" CHECK (("status" = ANY (ARRAY['OPEN'::"text", 'COMPLETED'::"text", 'CANCELLED'::"text"])))
);


ALTER TABLE "public"."follow_ups" OWNER TO "postgres";


ALTER TABLE "public"."follow_ups" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."follow_ups_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."import_batches" (
    "id" bigint NOT NULL,
    "file_name" "text" NOT NULL,
    "uploaded_by" "uuid",
    "status" "text" DEFAULT 'UPLOADING'::"text" NOT NULL,
    "total_rows" integer DEFAULT 0,
    "customer_count" integer DEFAULT 0,
    "item_count" integer DEFAULT 0,
    "salesman_count" integer DEFAULT 0,
    "min_transaction_date" "date",
    "max_transaction_date" "date",
    "error_message" "text",
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    CONSTRAINT "import_batches_status_check" CHECK (("status" = ANY (ARRAY['UPLOADING'::"text", 'VALIDATING'::"text", 'PROCESSING'::"text", 'ACTIVE'::"text", 'FAILED'::"text", 'ARCHIVED'::"text"])))
);


ALTER TABLE "public"."import_batches" OWNER TO "postgres";


ALTER TABLE "public"."import_batches" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."import_batches_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."items_master" (
    "id" bigint NOT NULL,
    "item_code" "text" NOT NULL,
    "item_name" "text",
    "category" "text",
    "rate" numeric,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sub_category" "text",
    "brand" "text",
    "display_order" integer DEFAULT 999,
    "search_keywords" "text",
    "category_id" bigint,
    "subcategory_id" bigint
);


ALTER TABLE "public"."items_master" OWNER TO "postgres";


ALTER TABLE "public"."items_master" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."items_master_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."kpi_targets" (
    "id" bigint NOT NULL,
    "salesman_code" "text" NOT NULL,
    "target_month" "date" NOT NULL,
    "sales_target" numeric(16,2) DEFAULT 0 NOT NULL,
    "new_buying_customers_target" integer DEFAULT 0 NOT NULL,
    "new_customer_visits_target" integer DEFAULT 0 NOT NULL,
    "existing_customers_buying_target" integer DEFAULT 0 NOT NULL,
    "customers_buying_new_items_target" integer DEFAULT 0 NOT NULL,
    "bills_target" integer DEFAULT 0 NOT NULL,
    "is_approved" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."kpi_targets" OWNER TO "postgres";


ALTER TABLE "public"."kpi_targets" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."kpi_targets_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."order_lines" (
    "id" bigint NOT NULL,
    "order_id" bigint NOT NULL,
    "item_code" "text" NOT NULL,
    "item_name_snapshot" "text" NOT NULL,
    "quantity" numeric(14,3) NOT NULL,
    "unit" "text",
    "unit_price" numeric(14,4) NOT NULL,
    "vat_percent" numeric(6,3) DEFAULT 15 NOT NULL,
    "line_subtotal" numeric(16,4) NOT NULL,
    "line_vat" numeric(16,4) NOT NULL,
    "line_total" numeric(16,4) NOT NULL,
    "recommendation_type" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "order_lines_recommendation_type_check" CHECK (("recommendation_type" = ANY (ARRAY['NEW'::"text", 'BUY_MORE'::"text", 'REORDER'::"text"])))
);


ALTER TABLE "public"."order_lines" OWNER TO "postgres";


ALTER TABLE "public"."order_lines" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."order_lines_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" bigint NOT NULL,
    "order_number" "text",
    "customer_code" "text" NOT NULL,
    "salesman_code" "text" NOT NULL,
    "visit_id" bigint,
    "order_date" timestamp with time zone DEFAULT "now"() NOT NULL,
    "subtotal" numeric(16,4) DEFAULT 0 NOT NULL,
    "vat_amount" numeric(16,4) DEFAULT 0 NOT NULL,
    "grand_total" numeric(16,4) DEFAULT 0 NOT NULL,
    "order_latitude" numeric(10,7),
    "order_longitude" numeric(10,7),
    "customer_po_number" "text",
    "delivery_remarks" "text",
    "status" "text" DEFAULT 'SUBMITTED'::"text" NOT NULL,
    "pdf_path" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "orders_status_check" CHECK (("status" = ANY (ARRAY['DRAFT'::"text", 'SUBMITTED'::"text", 'ACCEPTED'::"text", 'PROCESSING'::"text", 'DELIVERED'::"text", 'CANCELLED'::"text"])))
);


ALTER TABLE "public"."orders" OWNER TO "postgres";


ALTER TABLE "public"."orders" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."orders_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."price_catalog_cache" (
    "cache_key" "text" NOT NULL,
    "price_map" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "sheet_items" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "source_synced_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."price_catalog_cache" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."price_catalog_snapshots" (
    "id" bigint NOT NULL,
    "source_url" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "price_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."price_catalog_snapshots" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."price_catalog_snapshots_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."price_catalog_snapshots_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."price_catalog_snapshots_id_seq" OWNED BY "public"."price_catalog_snapshots"."id";



CREATE TABLE IF NOT EXISTS "public"."product_categories" (
    "id" bigint NOT NULL,
    "category_name" "text" NOT NULL,
    "display_order" integer DEFAULT 999,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."product_categories" OWNER TO "postgres";


ALTER TABLE "public"."product_categories" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."product_categories_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."product_subcategories" (
    "id" bigint NOT NULL,
    "category_id" bigint,
    "subcategory_name" "text" NOT NULL,
    "display_order" integer DEFAULT 999,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."product_subcategories" OWNER TO "postgres";


ALTER TABLE "public"."product_subcategories" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."product_subcategories_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."products" (
    "id" bigint NOT NULL,
    "item_code" "text" NOT NULL,
    "item_name_en" "text" NOT NULL,
    "item_name_ar" "text",
    "category" "text",
    "behaviour_group" "text",
    "unit" "text" DEFAULT 'CTN'::"text",
    "price" numeric(14,4) DEFAULT 0 NOT NULL,
    "vat_percent" numeric(6,3) DEFAULT 15 NOT NULL,
    "stock_status" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "do_not_use" boolean DEFAULT false NOT NULL,
    "source_updated_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."products" OWNER TO "postgres";


ALTER TABLE "public"."products" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."products_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "salesman_code" "text",
    "salesman_name" "text" NOT NULL,
    "email" "text",
    "role" "text" DEFAULT 'salesman'::"text" NOT NULL,
    "preferred_language" "text" DEFAULT 'en'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "profiles_preferred_language_check" CHECK (("preferred_language" = ANY (ARRAY['en'::"text", 'ar'::"text"]))),
    CONSTRAINT "profiles_role_check" CHECK ((("role" IS NULL) OR ("lower"("role") = ANY (ARRAY['admin'::"text", 'manager'::"text", 'salesman'::"text", 'invoice-maker'::"text", 'invoice_maker'::"text", 'product-promoter'::"text", 'product_promoter'::"text"]))))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prospects" (
    "id" bigint NOT NULL,
    "prospect_code" "text",
    "salesman_code" "text" NOT NULL,
    "company_name" "text" NOT NULL,
    "company_name_ar" "text",
    "contact_person" "text",
    "mobile" "text",
    "city" "text",
    "area" "text",
    "latitude" numeric(10,7),
    "longitude" numeric(10,7),
    "potential" "text",
    "status" "text" DEFAULT 'PROSPECT'::"text" NOT NULL,
    "follow_up_date" "date",
    "remarks" "text",
    "converted_customer_code" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "prospects_potential_check" CHECK (("potential" = ANY (ARRAY['SMALL'::"text", 'MEDIUM'::"text", 'LARGE'::"text"]))),
    CONSTRAINT "prospects_status_check" CHECK (("status" = ANY (ARRAY['PROSPECT'::"text", 'FOLLOW_UP'::"text", 'PENDING_APPROVAL'::"text", 'APPROVED'::"text", 'CONVERTED'::"text", 'REJECTED'::"text"])))
);


ALTER TABLE "public"."prospects" OWNER TO "postgres";


ALTER TABLE "public"."prospects" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."prospects_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."recommendation_results" (
    "id" bigint NOT NULL,
    "recommendation_id" bigint,
    "salesman_code" "text" NOT NULL,
    "customer_code" "text" NOT NULL,
    "result" "text" NOT NULL,
    "reason" "text",
    "order_id" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "recommendation_results_result_check" CHECK (("result" = ANY (ARRAY['SOLD'::"text", 'NOT_INTERESTED'::"text", 'FOLLOW_UP'::"text", 'NOT_OFFERED'::"text"])))
);


ALTER TABLE "public"."recommendation_results" OWNER TO "postgres";


ALTER TABLE "public"."recommendation_results" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."recommendation_results_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."recommendations" (
    "id" bigint NOT NULL,
    "customer_code" "text" NOT NULL,
    "item_code" "text" NOT NULL,
    "recommendation_type" "text" NOT NULL,
    "rank_no" integer NOT NULL,
    "reason_en" "text",
    "reason_ar" "text",
    "normal_monthly_qty" numeric(14,3),
    "current_month_qty" numeric(14,3),
    "suggested_qty" numeric(14,3),
    "last_purchase_date" "date",
    "normal_reorder_days" numeric(10,2),
    "days_since_last_purchase" integer,
    "score" numeric(14,6),
    "recommendation_month" "date" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "recommendations_recommendation_type_check" CHECK (("recommendation_type" = ANY (ARRAY['NEW'::"text", 'BUY_MORE'::"text", 'REORDER'::"text"])))
);


ALTER TABLE "public"."recommendations" OWNER TO "postgres";


ALTER TABLE "public"."recommendations" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."recommendations_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."sales_order_items" (
    "id" bigint NOT NULL,
    "order_id" bigint NOT NULL,
    "item_code" "text" NOT NULL,
    "item_name" "text",
    "category" "text",
    "quantity" numeric DEFAULT 0 NOT NULL,
    "rate" numeric DEFAULT 0 NOT NULL,
    "line_value" numeric DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sales_order_items" OWNER TO "postgres";


ALTER TABLE "public"."sales_order_items" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."sales_order_items_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."sales_orders" (
    "id" bigint NOT NULL,
    "order_number" "text",
    "customer_code" "text" NOT NULL,
    "customer_name" "text",
    "salesman_code" "text",
    "salesman_name" "text",
    "status" "text" DEFAULT 'DRAFT'::"text" NOT NULL,
    "total_items" integer DEFAULT 0 NOT NULL,
    "total_quantity" numeric DEFAULT 0 NOT NULL,
    "total_value" numeric DEFAULT 0 NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "submitted_at" timestamp with time zone,
    CONSTRAINT "sales_orders_status_check" CHECK (("status" = ANY (ARRAY['DRAFT'::"text", 'SUBMITTED'::"text", 'CANCELLED'::"text"])))
);


ALTER TABLE "public"."sales_orders" OWNER TO "postgres";


ALTER TABLE "public"."sales_orders" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."sales_orders_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE "public"."sales_raw" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."sales_raw_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."sales_transactions" (
    "id" bigint NOT NULL,
    "transaction_key" "text",
    "voucher_number" "text",
    "voucher_type" "text",
    "transaction_date" "date" NOT NULL,
    "customer_code" "text" NOT NULL,
    "salesman_code" "text",
    "item_code" "text" NOT NULL,
    "item_name" "text",
    "item_category" "text",
    "quantity" numeric(14,3) DEFAULT 0 NOT NULL,
    "rate" numeric(14,4) DEFAULT 0 NOT NULL,
    "sales_amount" numeric(16,4) DEFAULT 0 NOT NULL,
    "is_credit_note" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sales_transactions" OWNER TO "postgres";


ALTER TABLE "public"."sales_transactions" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."sales_transactions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."visits" (
    "id" bigint NOT NULL,
    "customer_code" "text",
    "prospect_id" bigint,
    "salesman_code" "text" NOT NULL,
    "visit_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "check_in_at" timestamp with time zone,
    "check_out_at" timestamp with time zone,
    "check_in_latitude" numeric(10,7),
    "check_in_longitude" numeric(10,7),
    "gps_accuracy_meters" numeric(10,2),
    "outcome" "text",
    "no_order_reason" "text",
    "remarks" "text",
    "follow_up_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "visits_outcome_check" CHECK (("outcome" = ANY (ARRAY['ORDER'::"text", 'NO_ORDER'::"text", 'FOLLOW_UP'::"text", 'CUSTOMER_CLOSED'::"text", 'CUSTOMER_UNAVAILABLE'::"text", 'NEW_PROSPECT'::"text", 'OTHER'::"text"])))
);


ALTER TABLE "public"."visits" OWNER TO "postgres";


ALTER TABLE "public"."visits" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."visits_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE ONLY "public"."price_catalog_snapshots" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."price_catalog_snapshots_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."customer_documents"
    ADD CONSTRAINT "customer_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_customer_code_key" UNIQUE ("customer_code");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_activity_logs"
    ADD CONSTRAINT "daily_activity_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."follow_ups"
    ADD CONSTRAINT "follow_ups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."import_batches"
    ADD CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."items_master"
    ADD CONSTRAINT "items_master_item_code_key" UNIQUE ("item_code");



ALTER TABLE ONLY "public"."items_master"
    ADD CONSTRAINT "items_master_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kpi_targets"
    ADD CONSTRAINT "kpi_targets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kpi_targets"
    ADD CONSTRAINT "kpi_targets_salesman_code_target_month_key" UNIQUE ("salesman_code", "target_month");



ALTER TABLE ONLY "public"."order_lines"
    ADD CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_order_number_key" UNIQUE ("order_number");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."price_catalog_cache"
    ADD CONSTRAINT "price_catalog_cache_pkey" PRIMARY KEY ("cache_key");



ALTER TABLE ONLY "public"."price_catalog_snapshots"
    ADD CONSTRAINT "price_catalog_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_categories"
    ADD CONSTRAINT "product_categories_category_name_key" UNIQUE ("category_name");



ALTER TABLE ONLY "public"."product_categories"
    ADD CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_subcategories"
    ADD CONSTRAINT "product_subcategories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_item_code_key" UNIQUE ("item_code");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_salesman_code_key" UNIQUE ("salesman_code");



ALTER TABLE ONLY "public"."prospects"
    ADD CONSTRAINT "prospects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."prospects"
    ADD CONSTRAINT "prospects_prospect_code_key" UNIQUE ("prospect_code");



ALTER TABLE ONLY "public"."recommendation_results"
    ADD CONSTRAINT "recommendation_results_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recommendations"
    ADD CONSTRAINT "recommendations_customer_code_item_code_recommendation_type_key" UNIQUE ("customer_code", "item_code", "recommendation_type", "recommendation_month");



ALTER TABLE ONLY "public"."recommendations"
    ADD CONSTRAINT "recommendations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_order_items"
    ADD CONSTRAINT "sales_order_items_order_id_item_code_key" UNIQUE ("order_id", "item_code");



ALTER TABLE ONLY "public"."sales_order_items"
    ADD CONSTRAINT "sales_order_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_orders"
    ADD CONSTRAINT "sales_orders_order_number_key" UNIQUE ("order_number");



ALTER TABLE ONLY "public"."sales_orders"
    ADD CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_raw"
    ADD CONSTRAINT "sales_raw_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_transactions"
    ADD CONSTRAINT "sales_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_transactions"
    ADD CONSTRAINT "sales_transactions_transaction_key_key" UNIQUE ("transaction_key");



ALTER TABLE ONLY "public"."system_settings"
    ADD CONSTRAINT "system_settings_pkey" PRIMARY KEY ("setting_key");



ALTER TABLE ONLY "public"."visits"
    ADD CONSTRAINT "visits_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_customers_active_name" ON "public"."customers" USING "btree" ("is_active", "customer_name");



CREATE INDEX "idx_customers_code" ON "public"."customers" USING "btree" ("customer_code");



CREATE INDEX "idx_customers_salesman" ON "public"."customers" USING "btree" ("current_salesman_code");



CREATE INDEX "idx_daily_activity_logs_entry_created" ON "public"."daily_activity_logs" USING "btree" ("entry_type", "created_at" DESC);



CREATE INDEX "idx_daily_activity_logs_user_created" ON "public"."daily_activity_logs" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_items_master_active" ON "public"."items_master" USING "btree" ("is_active");



CREATE INDEX "idx_items_master_category" ON "public"."items_master" USING "btree" ("category");



CREATE INDEX "idx_items_master_display" ON "public"."items_master" USING "btree" ("display_order");



CREATE INDEX "idx_items_master_item_code" ON "public"."items_master" USING "btree" ("item_code");



CREATE INDEX "idx_items_master_subcategory" ON "public"."items_master" USING "btree" ("sub_category");



CREATE INDEX "idx_order_lines_order" ON "public"."order_lines" USING "btree" ("order_id");



CREATE INDEX "idx_orders_customer" ON "public"."orders" USING "btree" ("customer_code");



CREATE INDEX "idx_orders_salesman" ON "public"."orders" USING "btree" ("salesman_code");



CREATE INDEX "idx_price_catalog_snapshots_created_at" ON "public"."price_catalog_snapshots" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_products_category" ON "public"."products" USING "btree" ("category");



CREATE INDEX "idx_prospects_salesman" ON "public"."prospects" USING "btree" ("salesman_code");



CREATE INDEX "idx_recommendations_customer" ON "public"."recommendations" USING "btree" ("customer_code");



CREATE INDEX "idx_recommendations_month" ON "public"."recommendations" USING "btree" ("recommendation_month");



CREATE INDEX "idx_sales_customer" ON "public"."sales_transactions" USING "btree" ("customer_code");



CREATE INDEX "idx_sales_customer_date" ON "public"."sales_transactions" USING "btree" ("customer_code", "transaction_date" DESC);



CREATE INDEX "idx_sales_customer_item" ON "public"."sales_transactions" USING "btree" ("customer_code", "item_code");



CREATE INDEX "idx_sales_order_items_order" ON "public"."sales_order_items" USING "btree" ("order_id");



CREATE INDEX "idx_sales_orders_customer" ON "public"."sales_orders" USING "btree" ("customer_code");



CREATE INDEX "idx_sales_orders_salesman" ON "public"."sales_orders" USING "btree" ("salesman_code");



CREATE INDEX "idx_sales_orders_status" ON "public"."sales_orders" USING "btree" ("status");



CREATE INDEX "idx_sales_raw_batch" ON "public"."sales_raw" USING "btree" ("import_batch_id");



CREATE INDEX "idx_sales_raw_customer" ON "public"."sales_raw" USING "btree" ("customer_code");



CREATE INDEX "idx_sales_raw_customer_date" ON "public"."sales_raw" USING "btree" ("customer_code", "transaction_date" DESC);



CREATE INDEX "idx_sales_raw_date" ON "public"."sales_raw" USING "btree" ("transaction_date");



CREATE INDEX "idx_sales_raw_item" ON "public"."sales_raw" USING "btree" ("item_code");



CREATE INDEX "idx_sales_raw_salesman" ON "public"."sales_raw" USING "btree" ("salesman_code");



CREATE INDEX "idx_sales_salesman" ON "public"."sales_transactions" USING "btree" ("salesman_code");



CREATE INDEX "idx_visits_customer" ON "public"."visits" USING "btree" ("customer_code");



CREATE INDEX "idx_visits_salesman_date" ON "public"."visits" USING "btree" ("salesman_code", "visit_date" DESC);



CREATE OR REPLACE TRIGGER "trg_customers_updated_at" BEFORE UPDATE ON "public"."customers" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_kpi_targets_updated_at" BEFORE UPDATE ON "public"."kpi_targets" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_products_updated_at" BEFORE UPDATE ON "public"."products" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_prospects_updated_at" BEFORE UPDATE ON "public"."prospects" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."import_batches"
    ADD CONSTRAINT "import_batches_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."order_lines"
    ADD CONSTRAINT "order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id");



ALTER TABLE ONLY "public"."product_subcategories"
    ADD CONSTRAINT "product_subcategories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."product_categories"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recommendation_results"
    ADD CONSTRAINT "recommendation_results_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id");



ALTER TABLE ONLY "public"."recommendation_results"
    ADD CONSTRAINT "recommendation_results_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales_order_items"
    ADD CONSTRAINT "sales_order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales_orders"
    ADD CONSTRAINT "sales_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."sales_raw"
    ADD CONSTRAINT "sales_raw_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE CASCADE;



CREATE POLICY "Authenticated users can create order items" ON "public"."sales_order_items" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."sales_orders"
  WHERE (("sales_orders"."id" = "sales_order_items"."order_id") AND ("sales_orders"."created_by" = "auth"."uid"())))));



CREATE POLICY "Authenticated users can create orders" ON "public"."sales_orders" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "created_by"));



CREATE POLICY "Authenticated users can delete order items" ON "public"."sales_order_items" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."sales_orders"
  WHERE (("sales_orders"."id" = "sales_order_items"."order_id") AND ("sales_orders"."created_by" = "auth"."uid"())))));



CREATE POLICY "Authenticated users can read items master" ON "public"."items_master" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can read order items" ON "public"."sales_order_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."sales_orders"
  WHERE ("sales_orders"."id" = "sales_order_items"."order_id"))));



CREATE POLICY "Authenticated users can read orders" ON "public"."sales_orders" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can update order items" ON "public"."sales_order_items" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."sales_orders"
  WHERE (("sales_orders"."id" = "sales_order_items"."order_id") AND ("sales_orders"."created_by" = "auth"."uid"())))));



CREATE POLICY "Authenticated users can update orders" ON "public"."sales_orders" FOR UPDATE TO "authenticated" USING (("created_by" = "auth"."uid"())) WITH CHECK (("created_by" = "auth"."uid"()));



ALTER TABLE "public"."customer_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "customers_management_write" ON "public"."customers" TO "authenticated" USING ("public"."is_management"()) WITH CHECK ("public"."is_management"());



CREATE POLICY "customers_select" ON "public"."customers" FOR SELECT TO "authenticated" USING (("public"."is_management"() OR ("current_salesman_code" = "public"."current_salesman_code"())));



ALTER TABLE "public"."daily_activity_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "daily_logs_insert_own" ON "public"."daily_activity_logs" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "daily_logs_select_own" ON "public"."daily_activity_logs" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "documents_insert" ON "public"."customer_documents" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_management"() OR ("uploaded_by_salesman_code" = "public"."current_salesman_code"())));



CREATE POLICY "documents_select" ON "public"."customer_documents" FOR SELECT TO "authenticated" USING (("public"."is_management"() OR ("uploaded_by_salesman_code" = "public"."current_salesman_code"()) OR (("customer_code" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."customers" "c"
  WHERE (("c"."customer_code" = "customer_documents"."customer_code") AND ("c"."current_salesman_code" = "public"."current_salesman_code"())))))));



ALTER TABLE "public"."follow_ups" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "followups_insert" ON "public"."follow_ups" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_management"() OR ("salesman_code" = "public"."current_salesman_code"())));



CREATE POLICY "followups_select" ON "public"."follow_ups" FOR SELECT TO "authenticated" USING (("public"."is_management"() OR ("salesman_code" = "public"."current_salesman_code"())));



CREATE POLICY "followups_update" ON "public"."follow_ups" FOR UPDATE TO "authenticated" USING (("public"."is_management"() OR ("salesman_code" = "public"."current_salesman_code"()))) WITH CHECK (("public"."is_management"() OR ("salesman_code" = "public"."current_salesman_code"())));



ALTER TABLE "public"."import_batches" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "import_batches_admin_delete" ON "public"."import_batches" FOR DELETE TO "authenticated" USING ("public"."is_management"());



CREATE POLICY "import_batches_admin_insert" ON "public"."import_batches" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_management"());



CREATE POLICY "import_batches_admin_select" ON "public"."import_batches" FOR SELECT TO "authenticated" USING ("public"."is_management"());



CREATE POLICY "import_batches_admin_update" ON "public"."import_batches" FOR UPDATE TO "authenticated" USING ("public"."is_management"()) WITH CHECK ("public"."is_management"());



ALTER TABLE "public"."items_master" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kpi_targets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "kpi_targets_management_write" ON "public"."kpi_targets" TO "authenticated" USING ("public"."is_management"()) WITH CHECK ("public"."is_management"());



CREATE POLICY "kpi_targets_select" ON "public"."kpi_targets" FOR SELECT TO "authenticated" USING (("public"."is_management"() OR ("salesman_code" = "public"."current_salesman_code"())));



CREATE POLICY "logs_select_own_or_admin" ON "public"."daily_activity_logs" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_admin"()));



ALTER TABLE "public"."order_lines" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "order_lines_insert" ON "public"."order_lines" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."orders" "o"
  WHERE (("o"."id" = "order_lines"."order_id") AND ("public"."is_management"() OR ("o"."salesman_code" = "public"."current_salesman_code"()))))));



CREATE POLICY "order_lines_select" ON "public"."order_lines" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."orders" "o"
  WHERE (("o"."id" = "order_lines"."order_id") AND ("public"."is_management"() OR ("o"."salesman_code" = "public"."current_salesman_code"()))))));



ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "orders_insert" ON "public"."orders" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_management"() OR ("salesman_code" = "public"."current_salesman_code"())));



CREATE POLICY "orders_select" ON "public"."orders" FOR SELECT TO "authenticated" USING (("public"."is_management"() OR ("salesman_code" = "public"."current_salesman_code"())));



CREATE POLICY "orders_update" ON "public"."orders" FOR UPDATE TO "authenticated" USING (("public"."is_management"() OR ("salesman_code" = "public"."current_salesman_code"()))) WITH CHECK (("public"."is_management"() OR ("salesman_code" = "public"."current_salesman_code"())));



ALTER TABLE "public"."price_catalog_cache" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."price_catalog_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."product_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."product_subcategories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "products_management_write" ON "public"."products" TO "authenticated" USING ("public"."is_management"()) WITH CHECK ("public"."is_management"());



CREATE POLICY "products_select" ON "public"."products" FOR SELECT TO "authenticated" USING ((("is_active" = true) OR "public"."is_management"()));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_management_all" ON "public"."profiles" TO "authenticated" USING ("public"."is_management"()) WITH CHECK ("public"."is_management"());



CREATE POLICY "profiles_select" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("id" = "auth"."uid"()) OR "public"."is_management"()));



CREATE POLICY "profiles_select_own_or_admin" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("id" = "auth"."uid"()) OR "public"."is_admin"()));



ALTER TABLE "public"."prospects" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "prospects_insert" ON "public"."prospects" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_management"() OR ("salesman_code" = "public"."current_salesman_code"())));



CREATE POLICY "prospects_select" ON "public"."prospects" FOR SELECT TO "authenticated" USING (("public"."is_management"() OR ("salesman_code" = "public"."current_salesman_code"())));



CREATE POLICY "prospects_update" ON "public"."prospects" FOR UPDATE TO "authenticated" USING (("public"."is_management"() OR ("salesman_code" = "public"."current_salesman_code"()))) WITH CHECK (("public"."is_management"() OR ("salesman_code" = "public"."current_salesman_code"())));



ALTER TABLE "public"."recommendation_results" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "recommendation_results_insert" ON "public"."recommendation_results" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_management"() OR ("salesman_code" = "public"."current_salesman_code"())));



CREATE POLICY "recommendation_results_select" ON "public"."recommendation_results" FOR SELECT TO "authenticated" USING (("public"."is_management"() OR ("salesman_code" = "public"."current_salesman_code"())));



ALTER TABLE "public"."recommendations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "recommendations_management_write" ON "public"."recommendations" TO "authenticated" USING ("public"."is_management"()) WITH CHECK ("public"."is_management"());



CREATE POLICY "recommendations_select" ON "public"."recommendations" FOR SELECT TO "authenticated" USING (("public"."is_management"() OR (EXISTS ( SELECT 1
   FROM "public"."customers" "c"
  WHERE (("c"."customer_code" = "recommendations"."customer_code") AND ("c"."current_salesman_code" = "public"."current_salesman_code"()))))));



CREATE POLICY "sales_management_write" ON "public"."sales_transactions" TO "authenticated" USING ("public"."is_management"()) WITH CHECK ("public"."is_management"());



ALTER TABLE "public"."sales_order_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sales_orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sales_raw" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sales_raw_management_all" ON "public"."sales_raw" TO "authenticated" USING ("public"."is_management"()) WITH CHECK ("public"."is_management"());



CREATE POLICY "sales_raw_salesman_read" ON "public"."sales_raw" FOR SELECT TO "authenticated" USING (("public"."is_management"() OR (EXISTS ( SELECT 1
   FROM "public"."customers" "c"
  WHERE (("c"."customer_code" = "sales_raw"."customer_code") AND ("c"."current_salesman_code" = "public"."current_salesman_code"()))))));



CREATE POLICY "sales_select" ON "public"."sales_transactions" FOR SELECT TO "authenticated" USING (("public"."is_management"() OR (EXISTS ( SELECT 1
   FROM "public"."customers" "c"
  WHERE (("c"."customer_code" = "sales_transactions"."customer_code") AND ("c"."current_salesman_code" = "public"."current_salesman_code"()))))));



ALTER TABLE "public"."sales_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."system_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "system_settings_management" ON "public"."system_settings" TO "authenticated" USING ("public"."is_management"()) WITH CHECK ("public"."is_management"());



ALTER TABLE "public"."visits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "visits_insert" ON "public"."visits" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_management"() OR ("salesman_code" = "public"."current_salesman_code"())));



CREATE POLICY "visits_select" ON "public"."visits" FOR SELECT TO "authenticated" USING (("public"."is_management"() OR ("salesman_code" = "public"."current_salesman_code"())));



CREATE POLICY "visits_update" ON "public"."visits" FOR UPDATE TO "authenticated" USING (("public"."is_management"() OR ("salesman_code" = "public"."current_salesman_code"()))) WITH CHECK (("public"."is_management"() OR ("salesman_code" = "public"."current_salesman_code"())));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."activate_sales_batch"("p_batch_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."activate_sales_batch"("p_batch_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."current_salesman_code"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_salesman_code"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_salesman_code"() TO "service_role";



GRANT ALL ON FUNCTION "public"."current_user_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_user_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_import_batch"("p_batch_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."delete_import_batch"("p_batch_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_import_batch"("p_batch_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_management"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_management"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_management"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON TABLE "public"."sales_raw" TO "anon";
GRANT ALL ON TABLE "public"."sales_raw" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_raw" TO "service_role";



GRANT ALL ON TABLE "public"."system_settings" TO "anon";
GRANT ALL ON TABLE "public"."system_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."system_settings" TO "service_role";



GRANT ALL ON TABLE "public"."active_sales" TO "anon";
GRANT ALL ON TABLE "public"."active_sales" TO "authenticated";
GRANT ALL ON TABLE "public"."active_sales" TO "service_role";



GRANT ALL ON TABLE "public"."customer_documents" TO "anon";
GRANT ALL ON TABLE "public"."customer_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_documents" TO "service_role";



GRANT ALL ON SEQUENCE "public"."customer_documents_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."customer_documents_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."customer_documents_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."customers" TO "anon";
GRANT ALL ON TABLE "public"."customers" TO "authenticated";
GRANT ALL ON TABLE "public"."customers" TO "service_role";



GRANT ALL ON SEQUENCE "public"."customers_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."customers_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."customers_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."daily_activity_logs" TO "anon";
GRANT ALL ON TABLE "public"."daily_activity_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_activity_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."daily_activity_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."daily_activity_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."daily_activity_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."follow_ups" TO "anon";
GRANT ALL ON TABLE "public"."follow_ups" TO "authenticated";
GRANT ALL ON TABLE "public"."follow_ups" TO "service_role";



GRANT ALL ON SEQUENCE "public"."follow_ups_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."follow_ups_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."follow_ups_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."import_batches" TO "anon";
GRANT ALL ON TABLE "public"."import_batches" TO "authenticated";
GRANT ALL ON TABLE "public"."import_batches" TO "service_role";



GRANT ALL ON SEQUENCE "public"."import_batches_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."import_batches_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."import_batches_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."items_master" TO "anon";
GRANT ALL ON TABLE "public"."items_master" TO "authenticated";
GRANT ALL ON TABLE "public"."items_master" TO "service_role";



GRANT ALL ON SEQUENCE "public"."items_master_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."items_master_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."items_master_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."kpi_targets" TO "anon";
GRANT ALL ON TABLE "public"."kpi_targets" TO "authenticated";
GRANT ALL ON TABLE "public"."kpi_targets" TO "service_role";



GRANT ALL ON SEQUENCE "public"."kpi_targets_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."kpi_targets_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."kpi_targets_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."order_lines" TO "anon";
GRANT ALL ON TABLE "public"."order_lines" TO "authenticated";
GRANT ALL ON TABLE "public"."order_lines" TO "service_role";



GRANT ALL ON SEQUENCE "public"."order_lines_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."order_lines_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."order_lines_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."orders" TO "anon";
GRANT ALL ON TABLE "public"."orders" TO "authenticated";
GRANT ALL ON TABLE "public"."orders" TO "service_role";



GRANT ALL ON SEQUENCE "public"."orders_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."orders_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."orders_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."price_catalog_cache" TO "anon";
GRANT ALL ON TABLE "public"."price_catalog_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."price_catalog_cache" TO "service_role";



GRANT ALL ON TABLE "public"."price_catalog_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."price_catalog_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."price_catalog_snapshots" TO "service_role";



GRANT ALL ON SEQUENCE "public"."price_catalog_snapshots_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."price_catalog_snapshots_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."price_catalog_snapshots_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."product_categories" TO "anon";
GRANT ALL ON TABLE "public"."product_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."product_categories" TO "service_role";



GRANT ALL ON SEQUENCE "public"."product_categories_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."product_categories_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."product_categories_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."product_subcategories" TO "anon";
GRANT ALL ON TABLE "public"."product_subcategories" TO "authenticated";
GRANT ALL ON TABLE "public"."product_subcategories" TO "service_role";



GRANT ALL ON SEQUENCE "public"."product_subcategories_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."product_subcategories_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."product_subcategories_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."products" TO "anon";
GRANT ALL ON TABLE "public"."products" TO "authenticated";
GRANT ALL ON TABLE "public"."products" TO "service_role";



GRANT ALL ON SEQUENCE "public"."products_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."products_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."products_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."prospects" TO "anon";
GRANT ALL ON TABLE "public"."prospects" TO "authenticated";
GRANT ALL ON TABLE "public"."prospects" TO "service_role";



GRANT ALL ON SEQUENCE "public"."prospects_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."prospects_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."prospects_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."recommendation_results" TO "anon";
GRANT ALL ON TABLE "public"."recommendation_results" TO "authenticated";
GRANT ALL ON TABLE "public"."recommendation_results" TO "service_role";



GRANT ALL ON SEQUENCE "public"."recommendation_results_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."recommendation_results_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."recommendation_results_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."recommendations" TO "anon";
GRANT ALL ON TABLE "public"."recommendations" TO "authenticated";
GRANT ALL ON TABLE "public"."recommendations" TO "service_role";



GRANT ALL ON SEQUENCE "public"."recommendations_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."recommendations_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."recommendations_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sales_order_items" TO "anon";
GRANT ALL ON TABLE "public"."sales_order_items" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_order_items" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sales_order_items_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sales_order_items_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sales_order_items_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sales_orders" TO "anon";
GRANT ALL ON TABLE "public"."sales_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_orders" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sales_orders_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sales_orders_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sales_orders_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sales_raw_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sales_raw_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sales_raw_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sales_transactions" TO "anon";
GRANT ALL ON TABLE "public"."sales_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_transactions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sales_transactions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sales_transactions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sales_transactions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."visits" TO "anon";
GRANT ALL ON TABLE "public"."visits" TO "authenticated";
GRANT ALL ON TABLE "public"."visits" TO "service_role";



GRANT ALL ON SEQUENCE "public"."visits_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."visits_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."visits_id_seq" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







