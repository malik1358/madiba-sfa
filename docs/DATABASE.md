# Database

Schema source of truth in git is `supabase/migrations/`, applied in filename order. `sql/` contains setup and repair scripts. Some of those scripts are **not** copied into `supabase/migrations/`. A fresh database built only from the migrations folder will not match production if those scripts were run by hand.

This file lists objects found in the repo. It is not a live dump of production. Do not add columns that are not listed here unless you add a migration.

## Auth and profile

`public.profiles.id` references `auth.users.id` and is the primary key.

| Column | Notes |
| --- | --- |
| `salesman_code` | Unique. Collector codes look like `CL` + digits in app code. |
| `salesman_name` | Required. Also used when matching hierarchy metadata. |
| `email` | Profile email. Report mail may use `report_email` instead. |
| `role` | Default `salesman`. Check constraint in the baseline migration allows `admin`, `manager`, `salesman`, `invoice-maker`, `invoice_maker`, `product-promoter`, `product_promoter`. |
| `preferred_language` | `en` or `ar`. |
| `is_active` | |
| `report_email` | Added in `20260904180000_profile_report_email.sql`. |
| `activity_reminders_enabled` | Boolean, default true. `20260907120000_profile_activity_reminders.sql`. |
| `stock_take_access` | Boolean, default false. `20260908140000_stock_take.sql`. |
| `home_latitude`, `home_longitude` | Optional saved salesperson home point. Added by `20260929120000_salesman_home_locations.sql`; both coordinates must be set or null. |

**Not in migrations:** `sql/fix_profiles_role_check_collector.sql` adds `collector` to `profiles_role_check`. The baseline migration does not include `collector`. Assigning that role fails until the script is applied.

Helper functions in the baseline migration:

- `current_salesman_code()`, `current_user_role()`
- `is_admin()` — role `admin` only
- `is_management()` — role `admin` or `manager` only
- `activate_sales_batch(p_batch_id)`, `delete_import_batch(p_batch_id)`
- `set_updated_at()` trigger function
- `rls_auto_enable()` event trigger (enables RLS on new public tables)

## Sales ledger

| Object | Purpose |
| --- | --- |
| `import_batches` | One upload. Status `UPLOADING`, `VALIDATING`, `PROCESSING`, `ACTIVE`, `FAILED`, `ARCHIVED`. |
| `sales_raw` | Every imported line, keyed by `import_batch_id`. |
| `system_settings.active_sales_batch_id` | Which batch is live. |
| `active_sales` | View: `sales_raw` joined to that setting. |

`sales_raw` columns in the baseline: `reference`, `voucher_number`, `voucher_type`, `transaction_date`, `customer_code`, `customer_name`, `salesman_code`, `salesman_name`, `item_code`, `item_name`, `category`, `local_import`, `quantity`, `rate`, `sales_amount`, `first_purchase_date`, `abc_class`, `source_data` jsonb.

**Not in migrations:** `sql/add_sales_profit_amount.sql` adds `profit_amount numeric not null default 0` and recreates `active_sales` to expose it. BI profit depends on this script. Cost and margin percent are intentionally not stored.

`sales_transactions` is a separate normalized table (`transaction_key` unique, `is_credit_note`). Check the caller before using it; most BI reads `active_sales`.

`sql/merge_sales_batch_by_dates.sql` and migration `20260819000000_merge_sales_batch_by_dates.sql` merge batches by date. Do not activate or delete the active batch from a feature change.

## Customers, prospects, GPS

`customers` (unique `customer_code`):

- Names: `customer_name`, `customer_name_ar`
- Assignment: `current_salesman_code`, `previous_salesman_code`
- `customer_type` check: `SPECIALIST`, `GENERAL`, `DISCOUNT`, `OTHER`
- `city`, `area`, `latitude`, `longitude`
- `contact_person`, `mobile`, `vat_number`, `cr_number`
- `is_active`, `latest_transaction_date`
- GPS audit: `gps_updated_at`, `gps_updated_by`, `gps_updated_by_name`, `gps_update_source`

RLS `customers_select` allows management, the current salesman, or the previous salesman (`20260831120000_customer_salesman_transfer.sql`). Writes in baseline RLS are management-only. The app updates GPS through the service role.

`customer_gps_history`: `customer_code`, lat/long, previous lat/long, `source`, `updated_by`, `updated_by_name`, `created_at`.

Confirmed field prompt overwrites additionally use text sources `salesman_accepted` and `visit_accepted`; no column change is required. `created_at` is server persistence time (including offline sync), not a separately recorded device acceptance time. Existing `20260831153000_customer_gps_history.sql` / `sql/setup_customer_gps_history.sql` must already be applied in Supabase for audit recording and digest delivery; deployment alone cannot create the table.

`system_settings` keys `customer_gps_change_email:<YYYY-MM-DD>` atomically claim each GPS digest day using the unique `setting_key`. JSON values have `status: sending`, a claim token and `claimedAt`, then `status: sent`, `sentAt` and `changeCount`. Failed pre-delivery attempts release their own claim; post-delivery marker failures retain it to avoid duplicate mail. An interrupted `sending` claim requires operator review of provider delivery before clearing it; never delete a delivered day's claim just to rerun cron.

`customer_documents`: `customer_code` or `prospect_id`, `document_type`, `file_path`, `expiry_date`, `uploaded_by_salesman_code`, plus compliance columns `extracted_json`, `parsed_cr_number`, `parsed_vat_number`, `issue_date`, `link_status`, `link_message`, `original_file_name`. Nullable `attachment_id` → `attachments.id` for documents uploaded after `20261002130000_attachments.sql`; `file_path` stays populated (NOT NULL).

`attachments` (migration `20261002130000_attachments.sql`): uuid `id`, `category` `receipt_copy|payment_copy|order_invoice|customer_document`, `storage_provider` `supabase|r2` (the provider holding the primary usable copy; `r2` only when R2 accepted the object), `object_key` = `<bucket>/<path>` (unique per provider), `content_type`, `size_bytes`, `sha256`, `md5`, `original_file_name`, `customer_code`, `entity_type` (`collection_visit|sales_order|customer_document`), `entity_id`, `uploaded_by`, `legacy_bucket`, `legacy_path`, `verified_at`, `created_at`. RLS on with no policies: service role only. Signed URLs are never stored.

`prospects`: `prospect_code` unique, `salesman_code`, company and contact fields, lat/long, `potential` `SMALL|MEDIUM|LARGE`, `status` `PROSPECT|FOLLOW_UP|PENDING_APPROVAL|APPROVED|CONVERTED|REJECTED`, `converted_customer_code`, `created_by`.

`follow_ups`: `salesman_code`, `customer_code` or `prospect_id`, `follow_up_date`, `status` `OPEN|COMPLETED|CANCELLED`.

`customer_book_shares`: `source_salesman_id`, `viewer_salesman_id` (both `profiles.id`), `is_active`, unique pair, source and viewer must differ. One-way share.

## Visits and attendance

`visits`: `customer_code` or `prospect_id`, `salesman_code`, `visit_date`, check-in/out timestamps and GPS, `gps_accuracy_meters`, `outcome` (`ORDER`, `NO_ORDER`, `FOLLOW_UP`, `CUSTOMER_CLOSED`, `CUSTOMER_UNAVAILABLE`, `NEW_PROSPECT`, `OTHER`), `no_order_reason`, `remarks`, `follow_up_date`.

Field visit reports used by the current UI are also stored in `system_settings`:

- `visit_report_latest:<customer code>`
- `visit_report_history:<customer code>:<timestamp>`

`daily_activity_logs`: `user_id`, `entry_type`, `note` (often JSON text), `created_at`. There is no separate attendance table. Known `entry_type` values in `app/lib/workdayActivity.js`:

- Transactions: `VISIT_REPORT`, `ORDER_DRAFT`, `ORDER_EDITED`, `ORDER_SUBMITTED`, `PROSPECT_FOLLOW_UP`, `NOTE`
- Workday and GPS: `GPS_PING`, `MORNING_ATTENDANCE`, `LUNCH_BREAK_OUT`, `LUNCH_BREAK_IN`, `END_OF_DAY`

RLS lets a user insert and read their own rows. `logs_select_own_or_admin` also lets `is_admin()` read them. Managers reading other users’ activity go through API routes with the service role.

## Orders

`sales_orders`: `order_number` unique, `customer_code`, `customer_name`, `salesman_code`, `salesman_name`, `status` `DRAFT|SUBMITTED|CANCELLED`, totals, `created_by`, `submitted_at`.

`salesman_code` / `salesman_name` are the order maker (authenticated profile at save/submit), not a copy of `customers.current_salesman_code`. `/api/sales-orders` overwrites both from the caller’s profile; the client still sends `customerSalesmanCode` only for pricing-region fallback.

Field order numbers are allotted offline per salesman as a short letter prefix + sequence (e.g. `P01`; `PA01` when first letters collide — see `app/lib/salesmanOrderNumber.js` / `offlineOrderNumber.js`). The client sends `orderNumber` with the save payload; `/api/sales-orders` persists it when available or allots the next series number if the device's number is stale or taken. Queued order PDFs mark the number as pending sync until the server confirms it. The API must not replace it with the bigint `id`. Legacy rows may still use the numeric id string or older `NAME-0001` values as `order_number`. Blank or id-equal accidental numbers are repaired to the salesman series via `repair_order_numbers` / `ensureStoredOrderNumber` (never write the bigint id as a new `order_number`). When re-saving such a legacy row, the client must keep that stored number (not allot a new short series value).

`sales_order_items`: `order_id`, `item_code` unique per order, `item_name`, `category`, `quantity`, `rate`, `line_value`.

`orders` / `order_lines`: legacy. `orders.status` includes `DRAFT`, `SUBMITTED`, `ACCEPTED`, `PROCESSING`, `DELIVERED`, `CANCELLED`. `order_lines.recommendation_type` is `NEW`, `BUY_MORE`, or `REORDER`.

Invoice workflow is **not** a column. Keys:

- `order_invoice_meta:<order id>`
- `order_history_latest:<order id>`
- `order_history:<order id>:<changed at>`
- `order_pricing_meta:<order id>`

## Collections

Created in `20260816000000_add_collection_tables.sql`. A second migration `20260816000002_create_collection_tables_simple.sql` creates the same three tables **without** `IF NOT EXISTS`. Do not replay that file on a database that already has the tables.

`invoices`: bigint identity `id` (not uuid), unique `invoice_number`, `customer_code` FK, `salesman_code`, `due_date`, `pending_amount`, `ref_no`.

`collection_visits`: bigint identity `id`, `customer_code`, `visit_outcome`, `payment_status`, `amount_received`, `receipt_mode`, `next_visit_at`, `remark_arabic`, `remark_english`, `non_payment_reason`, `payment_copy_url`, `receipt_copy_url`, `created_by`, `saved_at`. Later columns: `latitude`, `longitude`, `gps_accuracy_meters`, `summary_text`, `queue_priority`, `probability_score`, `probability_label`, `visit_number_for_day`, nullable unique `client_submission_id` (UUID; offline replay key, partial unique index `collection_visits_client_submission_id_key`, migration `20261002120000_collection_visit_client_submission_id.sql`), nullable `receipt_attachment_id` / `payment_attachment_id` → `attachments.id`.

`legal_transfers`: PK `customer_code`, `is_transferred`, `transferred_at`, `transferred_by`, `note`.

RLS on `collection_visits` (`20260912180000_collection_visits_rls.sql`): select own rows or management; insert only when `created_by = auth.uid()`. The API uses the service role and does its own scope checks. The comment in that migration says RLS was previously enabled with no policies, so client selects returned nothing.

When `outstanding_customerwise_dataset_v1` contains invoices or rows, that JSON is the collection queue. `public.invoices` is only the fallback in `readOutstandingDataset` when the workbook is missing or empty. Receipts upload is `receipt_register_dataset_v1`.

## Catalog, prices, KPIs

| Table | Role |
| --- | --- |
| `items_master` | Item master. Unique `item_code`. Extra Tally columns: `tally_unit`, `tally_item_name`, `tally_unit_source`, `tally_unit_updated_at`. |
| `products` | Selling catalog: names, `category`, `unit` default `CTN`, `price`, `vat_percent` default 15, `stock_status`, `is_active`, `do_not_use`. |
| `product_categories`, `product_subcategories` | Category tree. |
| `price_catalog_cache` | What `/api/pricing/cache` reads. |
| `price_catalog_snapshots` | Dump written by price sync. `price_map` jsonb. |
| `item_price_history` | `item_code`, `region` default `riyadh`, `price`, `recorded_at`, `source` default `price_sync`. |
| `kpi_targets` | Unique (`salesman_code`, `target_month`). Later columns: `collection_target`, `office_supplies_sales_target`, `other_sales_target`, `updated_by`. |
| `recommendations`, `recommendation_results` | Suggestion engine tables from the baseline schema. |

Schemes and quantity limits are settings, not tables:

- `order_schemes`
- `order_quantity_controls`

## Stock take

`stock_take_items` (PK `item_code`, pack sizes and barcodes), `stock_take_sessions`, `stock_take_lines` (plus `updated_at`, `updated_by`, `updated_by_name`), `stock_take_line_changes`, `stock_take_system_inventory` (PK `warehouse_key`, `item_code`), `stock_take_session_shares`.

## Push and email logs

- `device_push_tokens`: `user_id`, `token`, `platform` default `android`, unique (`user_id`, `token`).
- `push_notification_log`: counts plus `reference_key`.
- `inactivity_email_cycle_log`: one row per cron cycle (`report_date`, `checked`, `sent`, `login_reminders_sent`, `skipped`, `details` jsonb).

## Optional table not in migrations

`sales_bi_monthly` (`sql/setup_sales_bi_monthly.sql`): monthly cube columns `month`, `category`, salesman, customer, item, `voucher_type`, `local_import`, `abc_class`, `sales_amount`, `quantity`, `line_count`. RLS is enabled and the script does not add a read policy. The app’s primary cube is `system_settings.sales_bi_cube_v1`.

## `system_settings` keys used by the app

| Key | Used for |
| --- | --- |
| `active_sales_batch_id` | Live sales snapshot |
| `outstanding_customerwise_dataset_v1` | Outstanding upload |
| `receipt_register_dataset_v1` | Receipt register upload (every row with a date and a positive Dr/Cr amount is kept regardless of voucher type — Receipt, JV-Collection, NSTC JV reclass entries, etc. — so uploads never silently drop a collection) |
| `outstanding_reconcile_dataset_v1` | Precomputed Tally vs SFA outstanding differences (only differing customers) |
| `outstanding_reconcile_email_last_sent` | Difference-report email dedupe |
| `sales_bi_cube_v1` | BI monthly cube JSON |
| `performance_kpi_actuals_v1:<YYYY-MM-01>` | Per-salesman KPI actuals and historical pace for the month, rebuilt after sales uploads and saved collection visits; read by `/api/performance` to avoid rescanning source transactions on each screen load |
| `sales_upload_file_v1` | Last sales file pointer |
| `order_schemes` | Promotions |
| `order_quantity_controls` | Per-customer quantity caps |
| `salesman_visit_plan_snapshot_v1` | Saved visit plan |
| `salesman_visit_plan_rebuild_status_v1` | Plan rebuild status |
| `android_apk_min_version_v1` | Minimum APK |
| `mobile_field_snapshot_meta_v1` | Mobile snapshot metadata |
| `offline_data_version_v1` | Client cache busting |
| `customer_meta:<code>` | Per-customer extra meta |
| `customer_order_block_override:<code>` | Admin override to allow orders when Avg Days to Pay auto-block is triggered |
| `customer_inactive_meta:<code>` | Inactive-with-outstanding flags |
| `visit_report_latest:<code>` / `visit_report_history:<code>:` | Field visit reports |
| `order_invoice_meta:<id>` | Invoice status and PDF metadata |
| `order_history_latest:<id>` / `order_history:<id>:` | Order edit history |
| `order_pricing_meta:<id>` | Pricing snapshot on the order |
| `missing_invoice_email_last_sent_at` | Email dedupe |
| `daily_supplier_order_email_last_sent` | Email dedupe |
| `outstanding_no_gps_email_last_sent` | Email dedupe |
| `daily_receipt_email_last_sent:<YYYY-MM-DD>` | Daily app-entered receipt email dedupe, one marker per Riyadh report date |
| `matched_receipt_email_claim:<collection_visit_id>` | Insert-only one-time claim for a matched app receipt notification; value transitions from `sending` to `sent` |

Do not create a new table for a small flag if the surrounding feature already uses one of these keys. Do not rename a key; clients and cron jobs compare the string exactly.

## Storage buckets

Scripts in `sql/`:

- `payment-collections` — payment and receipt photos (`sql/setup_payment_collections_storage.sql`), **private**
- `customer-documents` — `sql/setup_customer_documents_storage.sql`, **private**
- `order-invoices` — created private by the app, **private**
- Upload-files bucket — `sql/setup_upload_files_storage.sql`, private, unchanged

Attachment buckets have no `storage.objects` policies for `anon`/`authenticated`: the server writes with the service role and serves reads as short-lived signed URLs after an app access check. Existing projects are converted with `sql/attachment_storage_phase2_step1_drop_browser_policies.sql` (safe any time) and then `sql/attachment_storage_phase2_step2_private_buckets.sql` (only after the Phase 2 app is live; older builds re-publicized `payment-collections` on every upload). Neither is a migration.

These inserts are not in `supabase/migrations/`. A new environment needs the SQL scripts or the buckets created in the Supabase dashboard.

Attachment references (Phase 1 of the R2 plan, files still in Supabase Storage):

| Attachment | New uploads | Historical (untouched) |
| --- | --- | --- |
| Receipt / payment copy | `collection_visits.receipt_attachment_id` / `payment_attachment_id`; `*_copy_url` left NULL (before the attachments migration: the object key, never a URL) | `*_copy_url` public URL (parsed, then signed privately) |
| Order invoice | `order_invoice_meta:<id>` JSON `invoiceAttachmentId` **and** `invoiceFilePath` (business logic depends on its presence) | `invoiceFilePath` only |
| Customer document | `customer_documents.attachment_id` **and** `file_path` | `file_path` only |

If the attachments migration is not applied, uploads still succeed and write the legacy fields only. `upload-files` is unchanged.

## Row level security

Baseline migration enables RLS and adds policies for customers, documents, follow-ups, import batches, items, KPIs, both order pairs, profiles, prospects, visits, recommendations, and activity logs. Later migrations replace `customers_select` and add collection-visit policies.

Treat RLS as a backstop for browser queries with the publishable key. API authorization is in the route. Changing a policy does not by itself change what `/api/*` returns.

## Applying a change

1. Add `supabase/migrations/<timestamp>_<name>.sql`.
2. Prefer `ADD COLUMN IF NOT EXISTS` and `CREATE TABLE IF NOT EXISTS`.
3. If the app can deploy before the SQL runs, read the column with a fallback, matching existing `isMissingColumnError` handling.
4. Say in the change summary that someone must run the migration on **local/dev** (while developing) and **production** Supabase before the app depends on it. Git push does not migrate the database.
5. Do not put production data fixes that target named people into a migration that runs on every environment. One-off data scripts such as `sql/share_ahmed_nabil_customers_with_abdalla.sql` are manual.

`20260929120000_salesman_home_locations.sql` adds the home-coordinate columns and database guards: attendance punches cannot be recorded within 500 m of that user's saved home, and customer GPS cannot be set within 25 m of any saved home point. Run the migration on local/dev first and production only through the normal approved release process; saving a home point in Salesman Hierarchy also clears matching customer pins through the GPS-audited API.
