-- =============================================================================
-- MADIBA production migration access — DBA REVIEW ONLY
-- Project: ynmtlzyqvmurpmfretji
-- Aligned to runner at 3de09d97 (Harden production DB preflight permission checks)
-- STATUS: NOT EXECUTED by the planning/docs agent
--
-- Do not run section B/C until separately authorized. Never commit real passwords.
-- See docs/DEPLOYMENT.md → "Production database access provisioning".
-- =============================================================================

-- ----- A) Read-only discovery (safe SELECT metadata) -----
SHOW server_version;
SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid();

SELECT c.relname AS table_name,
       pg_get_userbyid(c.relowner) AS owner,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS force_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('sales_orders','collection_visits','customer_documents','attachments')
ORDER BY 1;

SELECT a.attname, t.typname, a.attnotnull
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_type t ON t.oid = a.atttypid
WHERE n.nspname = 'supabase_migrations' AND c.relname = 'schema_migrations'
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum;

SELECT conname, contype, condeferrable, convalidated
FROM pg_constraint
WHERE conrelid = 'supabase_migrations.schema_migrations'::regclass;

SELECT tgname FROM pg_trigger
WHERE tgrelid = 'supabase_migrations.schema_migrations'::regclass AND NOT tgisinternal;

SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication, rolcanlogin
FROM pg_roles
WHERE rolname IN ('madiba_mig_readonly', 'madiba_mig_owner')
ORDER BY 1;

-- ----- B) Proposed provisioning (REQUIRES SEPARATE AUTHORIZATION) -----
-- Replace <READONLY_PASSWORD> / <OWNER_PASSWORD> out-of-band; do not log them.

-- CREATE ROLE madiba_mig_readonly LOGIN PASSWORD '<READONLY_PASSWORD>'
--   NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
-- CREATE ROLE madiba_mig_owner LOGIN PASSWORD '<OWNER_PASSWORD>'
--   NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;

-- REVOKE ALL ON DATABASE postgres FROM PUBLIC;
-- GRANT CONNECT ON DATABASE postgres TO madiba_mig_readonly, madiba_mig_owner;
-- REVOKE TEMP, CREATE ON DATABASE postgres FROM madiba_mig_readonly, madiba_mig_owner;

-- GRANT USAGE ON SCHEMA public, supabase_migrations TO madiba_mig_readonly, madiba_mig_owner;
-- REVOKE CREATE ON SCHEMA public FROM madiba_mig_readonly;
-- GRANT CREATE ON SCHEMA public TO madiba_mig_owner;
-- REVOKE CREATE ON SCHEMA supabase_migrations FROM madiba_mig_readonly, madiba_mig_owner;

-- Catalog SELECT (Supabase usually grants these to PUBLIC; verify and grant if missing)
-- GRANT SELECT ON pg_catalog.pg_class, pg_catalog.pg_namespace, pg_catalog.pg_attribute,
--   pg_catalog.pg_type, pg_catalog.pg_constraint, pg_catalog.pg_trigger, pg_catalog.pg_roles,
--   pg_catalog.pg_database, pg_catalog.pg_shdepend, pg_catalog.pg_stat_ssl,
--   pg_catalog.pg_indexes, pg_catalog.pg_policies TO madiba_mig_readonly;

-- GRANT SELECT (version) ON supabase_migrations.schema_migrations TO madiba_mig_readonly;
-- GRANT SELECT, INSERT, UPDATE ON supabase_migrations.schema_migrations TO madiba_mig_owner;

-- Column SELECT for readonly (grant only columns that exist)
-- GRANT SELECT (request_id) ON public.sales_orders TO madiba_mig_readonly;
-- GRANT SELECT (client_submission_id, receipt_attachment_id, payment_attachment_id)
--   ON public.collection_visits TO madiba_mig_readonly;
-- GRANT SELECT (attachment_id) ON public.customer_documents TO madiba_mig_readonly;
-- If attachments exists:
-- GRANT SELECT (id, storage_provider, object_key) ON public.attachments TO madiba_mig_readonly;

-- OWNERSHIP TRANSFER (blocker until authorized). Current owner must execute:
-- ALTER TABLE public.sales_orders OWNER TO madiba_mig_owner;
-- ALTER TABLE public.collection_visits OWNER TO madiba_mig_owner;
-- ALTER TABLE public.customer_documents OWNER TO madiba_mig_owner;
-- ALTER TABLE public.attachments OWNER TO madiba_mig_owner;  -- only if exists

-- Ensure FORCE RLS remains off on targets (runner fails if on):
-- ALTER TABLE ... NO FORCE ROW LEVEL SECURITY;  -- only if unexpectedly forced

-- ----- C) Post-provision checks as each role (NOT EXECUTED here) -----
-- Connect as madiba_mig_readonly (preferred) or SET ROLE after login as a privileged admin.
-- Expect: session_user = current_user; no owns_*; catalog/column SELECT true; writes false
-- Connect as madiba_mig_owner:
-- Expect: owns each existing target; row_security_active false; force_rls false
-- Integrity aggregates must run only inside BEGIN READ ONLY with the allowlisted SELECT count(*) statements
-- from scripts/productionDbMigrations.mjs (INTEGRITY_SCANS).
