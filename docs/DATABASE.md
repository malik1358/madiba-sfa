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
| `role` | Default `salesman`. Baseline check allows `admin`, `manager`, `salesman`, `invoice-maker`, `invoice_maker`, `product-promoter`, `product_promoter`. Later scripts/migrations also allow `collector`, `report-user`, and `report_user`. |
| `preferred_language` | `en` or `ar`. |
| `is_active` | |
| `report_email` | Added in `20260904180000_profile_report_email.sql`. |
| `activity_reminders_enabled` | Boolean, default true. `20260907120000_profile_activity_reminders.sql`. |
| `stock_take_access` | Boolean, default false. `20260908140000_stock_take.sql`. |
| `home_latitude`, `home_longitude` | Optional saved salesperson home point. Added by `20260929120000_salesman_home_locations.sql`; both coordinates must be set or null. |

**Not in migrations:** `sql/fix_profiles_role_check_collector.sql` adds `collector` to `profiles_role_check`. The baseline migration does not include `collector`. Assigning that role fails until the script is applied.

Helper functions in the baseline migration:

- `current_salesman_code()`, `current_user_role()`, `request_uid()` — `request_uid` is SECURITY DEFINER `auth.uid()` for RLS when the table owner cannot reference schema `auth` (`20261028083914_rls_auth_initplan_remaining.sql`)
- `is_admin()` — role `admin`, `report-user`, or `report_user`
- `enforce_single_platform_session(p_session_id, p_platform)` — `20261016120000_single_platform_session.sql`. Service role only. Deletes other `auth.sessions` for that user on the same platform (`android` WebView or `web`). Role `admin` is unchanged. Refresh tokens and MFA claims cascade with the session. Production ledger version is `20261016080833` (`single_platform_session`); do not insert a second ledger row or replay the SQL.
- `is_management()` — role `admin`, `report-user` / `report_user`, or `manager`
- `activate_sales_batch(p_batch_id)`, `delete_import_batch(p_batch_id)`
- `set_updated_at()` trigger function
- `rls_auto_enable()` event trigger (enables RLS on new public tables)

## Sales ledger

| Object | Purpose |
| --- | --- |
| `import_batches` | One upload. Status `UPLOADING`, `VALIDATING`, `PROCESSING`, `ACTIVE`, `FAILED`, `ARCHIVED`. |
| `sales_raw` | Every imported line, keyed by `import_batch_id`. |
| `system_settings.active_sales_batch_id` | Which batch is live. |
| `active_sales` | View: `sales_raw` for the live batch. `import_batch_id` equals `active_sales_batch_id` only when that setting is all digits. A blank or non-numeric setting returns no rows. |
| `active_sales_history_page(after_customer, after_date, after_id, page_limit)` | Keyset page of `active_sales` for Outstanding Compare rebuild. `20261023120000_active_sales_batch_bigint_join.sql` created it; `20261028120000_active_sales_history_page_import_batch_id.sql` adds `import_batch_id` to the return set. `service_role` only. |

One-off production delete (2026-11-25, Ahmedabad office follow-up #9): customer `1431` (Blocks Creative Group) invoices `NFD796` / `NFD797` dated 2026-05-16 — removed sales `NFD/796` (1 line, 300.00 ex-VAT, id 564417) and `NFD/797` (6 lines, 1,292.50 ex-VAT) plus same-day reverse CNs `233` (ref `NFD796`, −300.00) and `234` (ref `NFD797`, −1,292.50) so Settlement would not re-synthesize phantoms from the slash-less refs. Not in outstanding. `customer_history_cache:1431%` cleared.

One-off production delete (2026-11-25, Ahmedabad office follow-up #8): customer `1441` (Jazeerat Al-Tawfeer) credit note `197` removed for requested `2026-05-08` (2 lines, −1,680.00 ex-VAT, ref `NFD/622`, ids 434377, 434379) and identical twin `2026-05-03` (ids 575328, 575656). `customer_history_cache:1441%` cleared.

One-off production delete (2026-11-25, Ahmedabad office follow-up #7): customer `1438` (ADHWAN MOHAMMED AL-AHMARI TRADING ESTABLISHMENT) invoice `767` dated 2026-05-14 — removed sales `NFD/767` (item `A004075`, 1,860.00 ex-VAT, id 560810) and same-day reverse CN `225` (ref bare `767`, −1,860.00, id 575751) so Settlement would not re-synthesize phantom `767`. Not in outstanding. `customer_history_cache:1438%` cleared.

One-off production fix (2026-11-25, Ahmedabad office follow-up #6):

- Customer `1455` (Zawya Jawharat Al Asaar): office asked to delete invoice `NED/1893` dated 2026-10-08. Sale is `NFD/1893` (2026-10-01, 5,130.00 ex-VAT); CN `618` (2026-10-08, −2,092.50) had typo Ref `NED/1893`, which synthesized a phantom. Updated CN `618` reference to `NFD/1893` (5 lines). Outstanding `NFD/1893` left in place.
- Customer `1231` (ROBOU ALALAM) credit note `178` removed for requested `2026-04-28` (13 lines, −2,036.20, ref `1804`) and identical twin `2026-04-25`.

`customer_history_cache` cleared for `1455%` and `1231%`.

One-off production fix (2026-11-25, Ahmedabad office follow-up #5): customer `1541` — office asked to delete invoice `1541` dated 2026-08-25. No sales voucher `1541` on that customer; same-day CN `496` (14 lines, −2,153.15 ex-VAT) exact-mirrors sale `RNFD/313` but Ref. No. was bare `1541`, so Payment Settlement synthesized phantom invoice `1541`. Updated CN `496` reference to `RNFD/313` (ids 573974–575013). Left untouched: `NFD/1541` on customer `1431` (different party). `customer_history_cache:1541%` cleared.

One-off production delete (2026-11-25, Ahmedabad office follow-up #4): customer `1498` (Sajida Ali Saad Foundation) sales voucher `RNFD/524` (requested `RNFD-524`; 2026-10-04, RIYADH W/S CREDIT, item `A004232`, 2,180.00 ex-VAT / ~2,507.00 incl-VAT, `sales_raw` id 560629) removed from active batch 10. Not in outstanding. `customer_history_cache:1498%` cleared.

One-off production delete (2026-11-25, Ahmedabad office follow-up #3):

- Customer `1126C` (Five Trend; office said `1126`) credit note `69` removed for both `2026-02-22` (requested; 24 lines, −8,220.40 ex-VAT, ref `2637`) and identical twin `2026-02-16` (same lines/amounts/ref — duplicate import).
- Customer `1171C` (Larsen & Toubro; office said `1171`) sales `NFD/1533` and `NFD/1534` (2026-08-25, 2 lines each, 1,820.00 ex-VAT) removed from active batch 10.
- Customer `1114C` credit note requested as `37` dated 2025-10-11: voucher was `25` with Ref. No. `37` (−2,347.50 ex-VAT); that CN row removed. Same-day sale `1371` (2,347.50) left in place.
- Credit note `560` dated 2026-09-14 for customer `1126`/**`1126C` was not present** (a CN `560` that day exists only on customer `1571`).

`customer_history_cache` cleared for `1126C%`, `1171C%`, `1114C%`.

One-off production delete (2026-11-25, Ahmedabad office follow-up #2): customer `1159` sales voucher `BR2/NFD/425` (requested as `BR/2/NFD/425`; 2026-04-13, 2 lines, 870.00 ex-VAT / ~1,000.50 incl-VAT, ids 562983, 563930) removed from active batch 10. Same items reissued as `BR2/NFD/431` (still open in outstanding); CN `155` refs `BR/2/NFD/425` (slash variant) so it did not exact-match the sale. Also removed credit note `664` (2026-10-22, −800.00, ref `#MEK05-864`) — invoice `#MEK05-864` was never in `sales_raw`/outstanding; Settlement synthesized it from this CN. `customer_history_cache:1159%` cleared.

One-off production delete (2026-11-25, Ahmedabad office follow-up): customer `1159` (JV MAG-MAN Al Majal Al Arabi Grp and MAN Entpr KSA) sales vouchers `BR1/2728` (2026-01-22, item `LP00192`, 522.00 ex-VAT / ~600.30 incl-VAT, `sales_raw` id 562952) and `BR1/2729` (2026-01-22, item `LP00190`, 1,250.00 ex-VAT / ~1,437.50 incl-VAT, `sales_raw` id 561341) removed from active batch 10. Not in outstanding, `sales_transactions`, or `invoices`. `customer_history_cache:1159%` cleared. Re-importing that date from a file that still has these vouchers will restore them.

One-off production delete (2026-11-25, Ahmedabad office): three invoices removed and one not found.

- Customer `1708` (King Perfumes Trading Establishment) sales voucher `JNFD/021` (2026-11-18, JEDDAH W/S CREDIT, 53 lines, 27,060.47 ex-VAT / ~31,119.54 incl-VAT) removed from active batch 10 (`sales_raw` ids 507823–508065). Not in outstanding (open bill remains `JNFD/022`), `sales_transactions`, `invoices`, or receipt register.
- Customer `1035C` (AL GIHAZ CONTRACTING; office said `1035`) sales voucher `NFD/1862` / requested as `INV/NFD1862` (2026-08-22, SALES-NON FOOD DIVISION, item `PVC`, 13,520.00 ex-VAT / ~15,548.00 incl-VAT) removed from active batch 10 (`sales_raw` id 559352). Not in outstanding (other NFD bills remain), `sales_transactions`, `invoices`, or receipt register.
- Customer `1140` (Hamsat Khayal Trading Company) outstanding invoice `RNFD/0696` (2026-11-24, pending 7,576.78) removed from `outstanding_customerwise_dataset_v1`. No matching sales voucher (live same-day sale is `RNFD/774`); customer was sole open bill so the customer row was dropped. Re-uploading an outstanding file that still lists `RNFD/0696` will restore it.
- Customer `1261` / `1261C` (Skyfront Trading Company) invoice `3128` was **not** in `sales_raw`, outstanding, `invoices`, receipt register, or `sales_transactions`. Credit note `192` (2026-05-05) still references `3128` and was left in place.

`customer_history_cache` cleared for `1708%`, `1035C%`, `1140%`, and `1261C%`. Re-importing a sales date that still has `JNFD/021` or `NFD/1862` will restore those vouchers.

One-off production delete (2026-11-08): customer `1573` (Lamsat Durat Wajid Electric Est) sales voucher `RNFD/651` (2026-11-01, RIYADH W/S CREDIT, item `A005355`, 2 × 1040 = 2,080.00 ex-VAT / 2,392.00 incl-VAT) was removed from active batch 10 (`sales_raw` id 468431). It was not in `sales_transactions`, `invoices`, outstanding, or `receipt_register_dataset_v1`. `customer_history_cache:1573%` was cleared. Re-importing that date from a file that still has the voucher will restore it.

One-off production delete (2026-11-06): customer `1231` credit notes `739` (−67.60 ex-VAT) and `740` (−64.90 ex-VAT), both 2026-10-31, were removed from active batch 10 (`sales_raw` ids 465597, 465599, 465598, 465600). They are not in `sales_transactions`, `invoices`, or `receipt_register_dataset_v1`. `customer_history_cache:1231%` was cleared. Re-importing that date from a file that still has them will restore them.

One-off production delete (2026-11-08): customer `1367` (Wubl Al Khaleej Trading Company) outstanding invoice `RNFD/0642` (2026-11-04, pending 506) was removed from `outstanding_customerwise_dataset_v1`. It had no matching sales voucher (live sale for that day/amount is `RNFD/676`), so Payment Settlement showed a tally-only Open row with Sales 0 / Open 506. Customer row totals were recomputed to the remaining bill `RNFD/470` (1,487.8; one open invoice). `customer_history_cache:1367%` was cleared. Re-uploading an outstanding file that still lists `RNFD/0642` will restore it.

One-off production delete (2026-11-16): removed 9 receipt-register rows from `receipt_register_dataset_v1` — `1594` Receipt **2235** (2026-11-09, 10,000); `1042` Journal+Receipt **JV/Coll/2026/1247** (2026-11-12, 4,000 each); `1084C` Receipts **2225** (2026-11-08, 112.27), **2234** (2026-11-09, 135), **2238** (2026-11-09, 533.6), **2239** (2026-11-09, 1,036.4); `1477` Receipt **2236** (2026-11-09, 1,000); `1529` Receipt **2230** (2026-11-09, 800). Cleared `customer_history_cache` for those codes. Requested `1576` / **2226** was not present (only older receipt **1784** for that customer). Re-uploading a receipt file that still lists these vouchers will restore them.

`sales_raw` columns in the baseline: `reference`, `voucher_number`, `voucher_type`, `transaction_date`, `customer_code`, `customer_name`, `salesman_code`, `salesman_name`, `item_code`, `item_name`, `category`, `local_import`, `quantity`, `rate`, `sales_amount`, `first_purchase_date`, `abc_class`, `source_data` jsonb.

**Not in migrations:** `sql/add_sales_profit_amount.sql` adds `profit_amount numeric not null default 0` and recreates `active_sales` to expose it. BI profit depends on this script. Cost and margin percent are intentionally not stored.

`sales_transactions` is a separate normalized table (`transaction_key` unique, `is_credit_note`). Check the caller before using it; most BI reads `active_sales`.

`sql/merge_sales_batch_by_dates.sql` and migration `20260819000000_merge_sales_batch_by_dates.sql` merge batches by date. Migration `20261028075101_merge_sales_preserve_unmatched_vouchers.sql` changes the date merge so only overlapping vouchers (same date + customer + voucher number) are replaced; other active vouchers on those dates are kept. Do not activate or delete the active batch from a feature change.

**SECURITY (production):** `public.merge_sales_batch_by_dates(bigint, date[])` and `public.refresh_import_batch_stats(bigint)` are `SECURITY DEFINER` and must allow `EXECUTE` for `service_role` only. Production previously granted `EXECUTE` to `PUBLIC` / `anon` / `authenticated` (HIGH for merge); authorized apply of `sql/security_revoke_sales_batch_rpc_execute.sql` locked EXECUTE to `service_role`. That SQL remains manual-only (not a migration, not auto-applied) — do not re-run unless privileges drift again. App caller: `/api/import-sales` via `SUPABASE_SERVICE_ROLE_KEY` only.

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

`system_settings` keys `expected_stocked_sales_email:<YYYY-MM-DD>` claim each Expected Stocked Sales weekly email by the Monday of the KSA week (`sending` then `sent` with cohort sales and up/down directions). `expected_stocked_sales_email_snapshot_v1` stores the last successful cohort totals (`gp10` / `gp0` expected sales, profit, margin, item counts, season months, as-of date) so the next weekly email can show up/down. `inter_city_stock_email:<YYYY-MM-DD>` claims each daily Dammam↔Riyadh / Riyadh→Store stock-gap email (`sending` then `sent` with item counts and EOD stock date). `daily_warehouse_invoice_resume_email:<YYYY-MM-DD>` claims each daily warehouse invoice resume (`sending` then `sent` with send/invoice counts). `eod_stock_citywise_v1` row `cities` may include `store` beside `riyadh` / `dammam` / `jeddah`; `cityUploads.store` points at the latest Store/Dukan Excel when uploaded. `bad_debt_report_email:<YYYY-MM-DD>` claim each potential-bad-debt email day. `bad_debt_report_email_snapshot_v1` stores the customer codes from the last successful send so the next email can highlight customers added since then. `items_sold_at_loss_email:<YYYY-MM-DD>` claims each items-sold-at-loss digest day (`sending` then `sent` with `lineCount` / `profitAmount`). A day with zero loss lines still finishes as `sent` with `lineCount: 0` and does not send mail. `missing_catalogue_photos_email:<YYYY-MM-DD>` atomically claims each missing-catalogue-photo email day using the unique `setting_key`. JSON values have `status: sending`, a claim token and `claimedAt`, then `status: sent`, `sentAt` and `missing`. A failed send releases its own claim. Photo storage that is not ready also releases the claim and sends nothing. `customer_gps_change_email:<YYYY-MM-DD>` atomically claims each GPS digest day using the unique `setting_key`. JSON values have `status: sending`, a claim token and `claimedAt`, then `status: sent`, `sentAt` and `changeCount`. Failed pre-delivery attempts release their own claim; post-delivery marker failures retain it to avoid duplicate mail. An interrupted `sending` claim requires operator review of provider delivery before clearing it; never delete a delivered day's claim just to rerun cron.

`customer_documents`: `customer_code` or `prospect_id`, `document_type`, `file_path`, `expiry_date`, `uploaded_by_salesman_code`, plus compliance columns `extracted_json`, `parsed_cr_number`, `parsed_vat_number`, `issue_date`, `link_status`, `link_message`, `original_file_name`. Nullable `attachment_id` → `attachments.id` for documents uploaded after `20261002130000_attachments.sql`; `file_path` stays populated (NOT NULL).

`attachments` (migration `20261002130000_attachments.sql`): uuid `id`, `category` `receipt_copy|payment_copy|order_invoice|customer_document|product_catalogue_photo`, `storage_provider` `supabase|r2` (the provider holding the primary usable copy; `r2` only when R2 accepted the object), `object_key` = `<bucket>/<path>` (unique per provider), `content_type`, `size_bytes`, `sha256`, `md5`, `original_file_name`, `customer_code`, `entity_type` (`collection_visit|sales_order|customer_document|product_item`), `entity_id`, `uploaded_by`, `legacy_bucket`, `legacy_path`, `verified_at`, `created_at`. `verified_at` means the stored bytes were checksum-checked. It does not change which provider a read uses. RLS on with no policies: service role only. Signed URLs are never stored. Historical copy progress is `system_settings.receipt_r2_copy_progress_v1` and `payment_r2_copy_progress_v1`. A legacy visit URL is eligible for R2 only when the same flat filename has the same checksum in that row's `verified` and `reconciled` maps. The read switch records its checked ids in `historical_r2_read_check_v1` and the switched ids in `historical_r2_read_switch_v1`. Dated receipt and payment uploads are checked by the manual `verify-collection-uploads` cron. It sets `verified_at` only when the R2 download matches that row. Permanent failures are recorded in `collection_r2_upload_verify_v1` and are not stamped.

`prospects`: `prospect_code` unique, `salesman_code`, company and contact fields, lat/long, `potential` `SMALL|MEDIUM|LARGE`, `status` `PROSPECT|FOLLOW_UP|PENDING_APPROVAL|APPROVED|CONVERTED|REJECTED`, `converted_customer_code`, `created_by`.

`follow_ups`: `salesman_code`, `customer_code` or `prospect_id`, `follow_up_date`, `status` `OPEN|COMPLETED|CANCELLED`.

`customer_book_shares`: `source_salesman_id`, `viewer_salesman_id` (both `profiles.id`), `is_active`, unique pair, source and viewer must differ. One-way full-book share.

`customer_shares` (migration `20261015120000_customer_shares.sql`): `customer_code`, `viewer_salesman_id` (`profiles.id`), `is_active`, unique (`customer_code`, `viewer_salesman_id`). One-way selective visibility; does not change `customers.current_salesman_code`.

## Visits and attendance

`visits`: `customer_code` or `prospect_id`, `salesman_code`, `visit_date`, check-in/out timestamps and GPS, `gps_accuracy_meters`, `outcome` (`ORDER`, `NO_ORDER`, `FOLLOW_UP`, `CUSTOMER_CLOSED`, `CUSTOMER_UNAVAILABLE`, `NEW_PROSPECT`, `OTHER`), `no_order_reason`, `remarks`, `follow_up_date`.

Field visit reports used by the current UI are also stored in `system_settings`:

- `visit_report_latest:<customer code>`
- `visit_report_history:<customer code>:<timestamp>`

`daily_activity_logs`: `user_id`, `entry_type`, `note` (often JSON text), `created_at`. There is no separate attendance table. Known `entry_type` values in `app/lib/workdayActivity.js`:

- Transactions: `VISIT_REPORT`, `ORDER_DRAFT`, `ORDER_EDITED`, `ORDER_SUBMITTED`, `PROSPECT_FOLLOW_UP`, `NOTE`
- Workday and GPS: `GPS_PING`, `MORNING_ATTENDANCE`, `LUNCH_BREAK_OUT`, `LUNCH_BREAK_IN`, `END_OF_DAY`

Unique index `daily_activity_logs_one_morning_per_ksa_day` (migration `20261014120000_one_morning_attendance_per_ksa_day.sql`) allows at most one `MORNING_ATTENDANCE` row per `user_id` per Asia/Riyadh calendar day. Apply that migration in Supabase before relying on the DB hard stop; the app also refuses duplicate punches via `insertMorningAttendanceOnce`.

RLS lets a user insert and read their own rows. `logs_select_own_or_admin` also lets `is_admin()` read them. Managers reading other users’ activity go through API routes with the service role.

## Orders

`sales_orders`: `order_number` unique, `customer_code`, `customer_name`, `salesman_code`, `salesman_name`, `status` `DRAFT|SUBMITTED|CANCELLED`, totals, `created_by`, `submitted_at`. Indexes include `created_at DESC` and `updated_at DESC` (`20261018180000_sales_orders_created_updated_indexes.sql`) for recent-order lists and the app-performance two-day count. Apply that migration in Supabase before relying on it.

`customer_order_links` (`20261118120000_customer_order_links.sql`): opaque passwordless catalogue tokens for one customer or prospect. Columns: `token` (unique), `customer_code`, `customer_name`, `is_prospect`, optional `prospect_id`, `created_by` → `profiles`, issuer `salesman_code` / `salesman_name`, `pricing_region`, `payment_type`, `pricing_type`, `expires_at` (create + 36h), optional `submitted_order_id` → `sales_orders`, `submitted_at`. RLS on with **no** anon/authenticated policies — `service_role` only via API. Apply in Supabase before Generate order link / `/order/<token>` work.

Orphan `mobile_field_snapshot_v1:*` rows in `system_settings` are removed after a completed mobile-snapshot rebuild (`pruneOrphanMobileFieldSnapshots`). Stale snapshots inflate toast storage and slow settings traffic; keep only keys listed in `mobile_field_snapshot_meta_v1`.

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

Product Catalogue reads existing `items_master`, `products.unit` and stock-take packing metadata, with read-only packing descriptions from AM of the public KSA Price Tag Format sheet (product code B). Product photos use `attachments` (`category = product_catalogue_photo`, `entity_id` = item code) and the same R2/Supabase attachment facade as receipt copies (migration `20261015084023_product_catalogue_photos_attachments.sql`, production ledger `20261015084804`). Stored objects are resized metadata-free JPEGs. Catalogue GET returns photo ids, not signed URLs. `GET` with `photoId` returns that JPEG so the device can keep it for the carousel and the WhatsApp share image. The app saves and updates those files in the background; the catalogue does not wait for the download. Uploads and deletes are admin/manager-only.

Wholesale/retail needs no schema migration. `price_catalog_cache.pricing_rules` JSON now also contains `retailRegionPriceMaps`, keyed by `riyadh`, `dammam` and `jeddah`; existing wholesale `regionPriceMaps` remain unchanged. `valueDiscountMap` values are slab objects keyed `"2000"`, `"5000"`, and `"10000"` (rates as decimals). A plain number in an older cache is still the 5,000 slab only. Retail prices are published by the existing Apps Script feed, not a new table or public copy of the private costing workbook. The offline pricing content hash includes retail maps. `order_pricing_meta:<id>` and the existing order-history JSON retain `pricingType` (`wholesale` or `retail`); legacy orders default to wholesale. `item_price_history` continues recording wholesale regional history only.

| Table | Role |
| --- | --- |
| `items_master` | Item master. Unique `item_code`. Extra Tally columns: `tally_unit`, `tally_item_name`, `tally_unit_source`, `tally_unit_updated_at`. |
| `item_master_analysis` | Power BI Item Master Analysis mirror (Tally `mst_stock_item` + Swamiji Google Sheet). Unique `row_key`. Synced every 8 hours. Migration `20261113140000_item_master_analysis.sql`. Does not replace `items_master`. |
| `products` | Selling catalog: names, `category`, `unit` default `CTN`, `price`, `vat_percent` default 15, `stock_status`, `is_active`, `do_not_use`. |
| `product_categories`, `product_subcategories` | Category tree. |
| `price_catalog_cache` | What `/api/pricing/cache` reads (`default`, `pricing_rules`, `order_schemes`, `order_quantity_controls`). `default.price_map` holds only positive Google Sheet / Apps Script rates after sync (no sales-history backfill, no `PRICE_CODE_ALIASES` sibling copy for unpriced codes). Quantity controls are returned as `quantityControls` for offline New Order checks. |
| `price_catalog_snapshots` | Dump written by price sync. `price_map` jsonb. |
| `item_price_history` | `item_code`, `region` default `riyadh`, `price`, `recorded_at`, `source` default `price_sync`. |
| `kpi_targets` | Unique (`salesman_code`, `target_month`). Later columns: `collection_target`, `office_supplies_sales_target`, `other_sales_target`, `local_item_sales_target`, `new_skus_to_repeat_customers_target`, `updated_by`. |
| `recommendations`, `recommendation_results` | Suggestion engine tables from the baseline schema. |

`system_settings.item_master_analysis_sync_v1` stores the last Power BI sync stamp (`ok`, `source` = `executeQueries` or `export`, `rowCount`, `syncedAt`, optional `error`).

Schemes and quantity limits are settings, not tables:

- `order_schemes`
- `order_quantity_controls`

## Stock take

`stock_take_items` (PK `item_code`, pack sizes and barcodes), `stock_take_sessions`, `stock_take_lines` (plus `updated_at`, `updated_by`, `updated_by_name`), `stock_take_line_changes`, `stock_take_system_inventory` (PK `warehouse_key`, `item_code`), `stock_take_session_shares`.

## Push and email logs

- `device_push_tokens`: `user_id`, `token`, `platform` default `android`, unique (`user_id`, `token`).
- `push_notification_log`: counts plus `reference_key`.
- `inactivity_email_cycle_log`: one row per cron cycle (`report_date`, `checked`, `sent`, `login_reminders_sent`, `skipped`, `details` jsonb).

## HR Management

Migration `20261120120000_hr_management.sql` (**apply in Supabase before the HR screens are used**; until then `/api/hr/*` returns 503 with `migrationRequired`). Follow-up `20261123140000_hr_employee_iqama_holidays.sql` adds `hr_employees.iqama_expiry`, `hr_employees.holidays_per_year`, and `hr_monthly_records.half_days`. All three tables have RLS on, `SELECT` for `authenticated` only when `(select public.is_management())`, and `ALL` for `service_role`. Writes always go through `/api/hr/*` (admin|manager only, checked in the route).

- `hr_employees`: uuid PK, unique `employee_code` (uppercased), `full_name`, `full_name_ar`, optional `profile_id` → `profiles(id)` (`ON DELETE SET NULL`, unique when set), `designation`, `department`, `nationality`, `iqama_no`, `iqama_expiry`, `phone`, `join_date`, `status` (`ACTIVE`/`INACTIVE`), master `basic_salary`, `housing_allowance`, `transport_allowance`, `other_allowance`, `holidays_per_year`, `notes`. UI uses basic + transport only; housing/other remain for legacy rows.
- `hr_monthly_records`: uuid PK, unique (`employee_id`, `month` `YYYY-MM` = payroll label for the 26→25 cycle), `status` (`DRAFT`/`FINAL`), `source` (`MANUAL`/`IMPORT`/`PREFILL`), earnings (`basic_salary`, `housing_allowance`, `transport_allowance`, `other_allowance`, `overtime_amount`, `bonus_amount`, `commission_amount`), deductions (`absence_deduction`, `loan_deduction`, `advance_deduction`, `penalty_deduction`, `other_deduction`), attendance (`working_days`, `present_days`, `absent_days`, `half_days`, `leave_days`, `holiday_days`, `overtime_hours`), stored `gross_earnings`, `total_deductions`, `net_pay`, `finalized_at/by`. Totals are recomputed by `computeMonthlyTotals` on every write; there is no GOSI/statutory engine.
- `hr_leave_entries`: uuid PK, `employee_id`, `leave_type` (`ANNUAL`/`SICK`/`UNPAID`/`EMERGENCY`/`HAJJ`/`OTHER`), `start_date`, `end_date`, `days` (non-Friday days, computed by the API), `status` (`PENDING`/`APPROVED`/`REJECTED`), `notes`.
- Cron claim keys: `hr_iqama_expiry_email:YYYY-MM-DD` in `system_settings`.

## Optional table not in migrations

`sales_bi_monthly` (`sql/setup_sales_bi_monthly.sql`): monthly cube columns `month`, `category`, salesman, customer, item, `voucher_type`, `local_import`, `abc_class`, `sales_amount`, `quantity`, `line_count`. RLS is enabled and the script does not add a read policy. The app’s primary cube is `system_settings.sales_bi_cube_v1`.

## `system_settings` keys used by the app

| Key | Used for |
| --- | --- |
| `active_sales_batch_id` | Live sales snapshot |
| `item_master_analysis_sync_v1` | Last Power BI Item Master Analysis sync stamp (`ok`, `source`, `rowCount`, `syncedAt`, `error`). Mirror rows live in `item_master_analysis`. |
| `app_performance_daily_v1` | Workday app speed samples (`checks[]` with timings, counts, and `baseline` / `collecting` / `steady` / `slower` / `error`). One row per KSA hour, last 90 days. No migration. |
| `outstanding_customerwise_dataset_v1` | Outstanding upload |
| `eod_stock_citywise_v1` | End-of-day stock upload by city (Riyadh, Dammam, Jeddah). Latest snapshot plus the previous stock date used for the comparison. Also stores `cityUploads` (last Excel path/name per city) so Imports can download Riyadh after a later Dammam file. No migration. |
| `receipt_register_dataset_v1` | Receipt register upload (every collection row with a date and a positive Dr/Cr amount is kept — Receipt, JV-Collection, NSTC JV reclass entries, etc. — so uploads never silently drop a collection). Dual-party day books may also retain **Purchase** rows (AP bills for settlement; not AR collections). **Payment** vouchers are imported only when the upload sets `includePaymentVouchers` (for dual customer/supplier parties; Payment Register Dr columns are accepted and stored as **negative** receipt amounts; settlement applies them to Purchases first, including a Purchase dated up to 31 days later, then leftover unpays prior Paid on sales invoices dated on or before the payment (it does not prepay a later invoice or inflate open above the bill); a Payment that refunds a CN-reversed sale pairs to that voucher instead). Header aliases accept **VOUCHERNUMBER** or bare **VOUCHER** (exact match first so VOUCHERTYPENAME is not stolen). Uploads **upsert by voucher identity** (`receipt_date` + `vch_type` + `vch_no` + customer); they do **not** wipe other receipts on the same dates. Admin / report-user / Chaina (`IV006`) may also `DELETE /api/receipts` one customer voucher (date + `vch_no`) from Payment Settlement Datewise; that bumps `receipt_register_uploaded_at` and clears that customer’s history cache. A customer line dated after 10 Oct 2026 that was copied onto a neighbouring numeric receipt voucher is dropped when the bank, cash, or charge total matches only the other voucher. From 8 Oct 2026, the same customer and amount on two consecutive receipt numbers is kept on the later number, unless that earlier receipt has its own matching bank and no other customer. Earlier dates are not chosen by the bank line, because those bank lines were overwritten. Credit notes belong in sales history, not this register — settlement ignores Credit Note / Sales Return voucher types here so they are not also counted as cash. A bad import of CN **899** (`1177C`, 2026-10-01, 10,188.54) was removed from production on 2026-10-13. Receipts **1680** (2026-09-10, 174,800) and **1896** (2026-10-05, 116,118.95) for customer `1218` were removed from production on 2026-10-17. |
| `outstanding_reconcile_dataset_v1` | Precomputed Tally vs SFA outstanding differences (only differing customers) |
| `outstanding_reconcile_email_last_sent` | Difference-report email dedupe |
| `sales_bi_cube_v1` | BI monthly cube JSON |
| `receivable_days_monthly_v1` | BI Net receivable days cache: last imported Tally outstanding total for each KSA month, plus monthly credit sales. Rebuilt when the stored outstanding file list, active sales batch, or KSA as-of date changes |
| `performance_kpi_actuals_v2:<YYYY-MM-01>` | Per-salesman KPI actuals and the last **six** complete months of sales pace (Method A median cumulative curve, **KSA workday-indexed**). Inner `version` **10** required — soft-reads reject v8–v9 and **auto-rebuild** via `ensureCurrentPerformanceKpiCache` (no manual upload). Includes `newSkusToRepeatCustomers`, `repeatCustomerSkuCount`, `salesAsOfDate`, and `receiptAsOfDate`. Also rebuilt after sales/receipt uploads (`warmPerformanceKpiCachesAfterUpload`). Collection visits do not rewrite it |
| `kpi_targets_boss_map_v1` | Short-lived (30 min) map of profile id → boss code/name for KPI Targets, so GET avoids Auth `listUsers` on every open |
| `sales_upload_file_v1` | Last sales file pointer |
| `order_schemes` | Promotions |
| `order_quantity_controls` | Per-customer quantity caps |
| `role_module_access_v1` | Admin Role Access matrix JSON (`matrix` of role → moduleKey → boolean). No migration; uses existing `system_settings`. |
| `salesman_visit_plan_snapshot_v1` | Saved visit plan |
| `salesman_visit_plan_rebuild_status_v1` | Plan rebuild status |
| `android_apk_min_version_v1` | Minimum APK |
| `mobile_field_snapshot_meta_v1` | Mobile snapshot metadata |
| `offline_data_version_v1` | Client cache busting |
| `customer_meta:<code>` | Per-customer extra meta |
| `tally_statement_v1:<code>` | Parsed Tally customer ledger lines for Payment Settlement. Shared by every user. The comparison is rebuilt from live SFA data; the PDF is not stored. |
| `table_column_prefs_v1:<userId>` | Per-user hidden columns for management tables. JSON `{ version: 1, tables: { "<tableId>": { hidden: ["Header label", ...] } } }`. Column identity is the header label (`data-column-filter-label`); table identity is `ExportableTable` `tableId` (defaults to `filename`). Read/write only via JWT `/api/user/table-column-prefs` for that user’s key. No migration. |
| `customer_order_block_override:<code>` | Admin same-day override to allow credit draft/submit when Avg Days to Pay auto-block is triggered. JSON includes `is_unblocked`, `unblocked_on_ksa_date` (KSA `YYYY-MM-DD`), `updated_at`, `updated_by`, optional `note`. Active only while `unblocked_on_ksa_date` equals today in Asia/Riyadh; next KSA day it is ignored. |
| `customer_inactive_meta:<code>` | Inactive-with-outstanding flags |
| `visit_report_latest:<code>` / `visit_report_history:<code>:` | Field visit reports |
| `order_invoice_meta:<id>` | Invoice status and PDF metadata. Quotation fields (`quotationValidUntil` KSA `YYYY-MM-DD`, `quotationWorkingDays` 2 or 3, `quotationIssueDate`, `quotationCreatedAt`, `quotationCreatedBy`) are set by Make Quotation without requiring status `Quotation submitted waiting for the payment`. Status changes also append `statusHistory` (max 50): `{ at, by, from, to, mode? }` via `applyInvoiceStatusHistory` so chase-queue escapes can be audited later |
| `order_history_latest:<id>` / `order_history:<id>:` | Order edit history |
| `order_pricing_meta:<id>` | Pricing snapshot on the order (`paymentType`, `pricingRegion`, `pricingType`; refresh adds `refreshedAt` / `refreshedBy`) |
| `missing_invoice_email_last_sent_at` | Email dedupe JSON: `lastSentAt`, `lastMidnightKsaDate`, `lastDailySummaryIndiaDate` (India calendar date for Soyeb/Fazlur end-of-day summary) |
| `daily_supplier_order_email_last_sent` | Email dedupe |
| `outstanding_no_gps_email_last_sent` | Email dedupe |
| `daily_receipt_email_last_sent:<YYYY-MM-DD>` | Daily app-entered receipt email dedupe, one marker per Riyadh report date |
| `matched_receipt_email_claim:<collection_visit_id>:<audience>` | Insert-only one-time claim per matched app receipt and recipient audience (`salesman:<profile_id>` or `boss:<profile_id>`); value transitions from `sending` to `sent` |
| `deferred_team_emails_v1` | Queue of team and team-leader emails held until 08:30–22:00 KSA, Saturday–Thursday. JSON `{ items: [...] }` for invoice upload, KPI target changes, supplier-order uploads, matched-receipt uploads, and visit-plan email. No migration. The inactivity cron flushes it. |
| `kpi_upload_summary_email_pending_v1` | Debounced KPI Targets footer summary after sales/receipt uploads. JSON `{ pending, lastUploadAt, sendAfter, triggers }`. Each upload resets `sendAfter` (+18 minutes). The inactivity cron sends when due. No migration. |
| `kpi_upload_summary_email_last_sent` | Last KPI upload summary fingerprint (`signature`, `lastSentAt`, …) so unchanged totals are not re-emailed. No migration. |

Do not create a new table for a small flag if the surrounding feature already uses one of these keys. Do not rename a key; clients and cron jobs compare the string exactly.

## Storage buckets

Scripts in `sql/`:

- `payment-collections` — payment and receipt photos (`sql/setup_payment_collections_storage.sql`), **private**. The approved historical originals are removed only by Actions **Delete historical collection copies**, which uses the Storage API on the exact manifest keys. R2 objects and the encrypted Drive archive stay.
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

`profiles` (`20261028081800_profiles_rls_auth_initplan.sql`, applied on production): `profiles_select` is own-row only (`id = (select auth.uid())`); `profiles_management_all` uses `(select is_management())`; redundant `profiles_select_own_or_admin` is dropped.

Hot-path RLS initplan (`20261028083914_rls_auth_initplan_remaining.sql`, applied on production): activity logs, push tokens, prospects, sales orders/items, collection visits use `(select public.request_uid())` / `(select is_management())`; redundant `daily_logs_select_own` is dropped.

Treat RLS as a backstop for browser queries with the publishable key. API authorization is in the route. Changing a policy does not by itself change what `/api/*` returns.

## Applying a change

1. Add `supabase/migrations/<timestamp>_<name>.sql`.
2. Prefer `ADD COLUMN IF NOT EXISTS` and `CREATE TABLE IF NOT EXISTS`.
3. If the app can deploy before the SQL runs, read the column with a fallback, matching existing `isMissingColumnError` handling.
4. Say in the change summary that someone must run the migration on **local/dev** (while developing) and **production** Supabase before the app depends on it. Git push does not migrate the database.
5. Do not put production data fixes that target named people into a migration that runs on every environment. One-off data scripts such as `sql/share_ahmed_nabil_customers_with_abdalla.sql` are manual.

`20260929120000_salesman_home_locations.sql` adds the home-coordinate columns and database guards: attendance punches cannot be recorded within 500 m of that user's saved home, and customer GPS cannot be set within 25 m of any saved home point. Run the migration on local/dev first and production only through the normal approved release process; saving a home point in Salesman Hierarchy also clears matching customer pins through the GPS-audited API.

`20261010170000_madiba_store_customer_gps_guard.sql` blocks customer latitude/longitude within 50 m of the fixed MADIBA store (`24.56825, 46.74082`) via trigger `customers_madiba_store_location_guard`, and clears any existing pins inside that radius with `customer_gps_history` source `madiba_store_cleanup`. Apply in Supabase before relying on the DB-side block; the app also enforces the same rule in `applyCustomerGpsUpdate`.
