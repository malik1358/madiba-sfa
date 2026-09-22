# Changelog for AI agents

Decisions and hazards recorded from the repository (code, SQL, and git history through merge `e3e9150` on `main`, PR #313). This is not a full commit log.

**Living doc for Cursor and Copilot.** Both tools develop this app. At the start of a task, read this file with the other `docs/` files. When a later change alters a rule in `docs/BUSINESS_RULES.md`, architecture in `docs/ARCHITECTURE.md`, schema in `docs/DATABASE.md`, or deploy in `docs/DEPLOYMENT.md`, add a short dated note at the top of the “Recent agent notes” section below and update the matching doc in the same change.

## Recent agent notes

- **2026-09-22** — Day-route / daily visit Working hours now use only non-far customer transactions at or after 08:00 KSA (`resolveDayRouteWorkingHours`). Midnight and early-morning near stops no longer inflate the total; far visit reports stay excluded.
- **2026-09-22** — Payment Collections attachment saves: online path no longer serializes files into IndexedDB before upload; camera photo compression has load/canvas timeouts with original-file fallback; storage bucket `updateBucket` is best-effort; Saving clears before queue reload; selected attachment names show in the form. Server sniffs PDF magic bytes and accepts Android `image/jpg`.
- **2026-09-21** — Sales-order submit now auto-blocks customers when Avg Days to Pay is 120+ (salesmen see the customer but submit is rejected). Customer Audit shows the block status, and admin can apply/remove a per-customer unblock override via `customer_order_block_override:<code>`.
- **2026-09-21** — Gloves VAT is 0% on sales orders (New Order, PDF, WhatsApp), not only on settlement. `getPricedOrderLine` / `summarizePricedLines` honor `vatRateForProduct` (GLOVE/VINYL/قفاز). Labels switch to `VAT 0%` for gloves-only carts; do not treat `vatAmount === 0` as missing and fall back to 15%.
- **2026-09-21** — Avg days to pay now shows both lifetime and last-6-month figures wherever lifetime was shown (Customer Audit, Payment Settlement, New Order, Order PDF, WhatsApp). 6m uses sales+receipts from the BI performance from-month; open invoices still only blend when older than that window’s paid avg.
- **2026-09-21** — Customer Audit and New Order now include “receipt amount in last 10 days” sourced from customer-history receipts, using receipt-date windowing.
- **2026-09-21** — Avg days to pay on Order PDF and New Order was using the default ~6-month customer-history window while receipts stayed full-ledger, so a small collection looked like a huge avg-days swing vs Customer Audit. Both now request `fullHistory=1&scope=settlement` like settlement screens.
- **2026-09-21** — Hard local guard blocks the production Supabase project ref (`ynmtlzyqvmurpmfretji`) outside Vercel (`app/lib/supabaseGuard.js`, `instrumentation.js`, browser client, local scripts). Preview and production Vercel deploys are allowed. No secrets logged.
- **2026-09-21** — Env semantics: `NEXT_PUBLIC_APP_ENV` local/development (and legacy staging) → LOCAL banner; removed hardcoded `madiba-sfa-staging.vercel.app` origin fallback in favor of explicit `APP_ORIGIN` / localhost. Production origin resolution unchanged when env is production or unset.
- **2026-09-21** — Canonical deploy model is now local/dev → feature/AI branch → PR/CI → `main` → Vercel production. No permanent cloud staging. Docs updated (`README`, `AGENTS.md`, Copilot instructions, `docs/DEPLOYMENT.md`, related handover files, `ANDROID_APK.md`).
- **2026-09-21** — Pending Orders now shows both current outstanding and `Outstanding >60 days` from the uploaded outstanding dataset, with the >60 figure summed from `61-90`, `91-120`, and `>120`.
- **2026-09-21** — Expanded handover: mandatory agent rules list, `moduleAccess` matrix, major API inventory, and Android/Capacitor sections. Docs refreshed for dual Cursor + Copilot use; no application code changes.
- **2026-09-21** — Mandatory rule in `AGENTS.md`: after any important change to business logic, database structure, reports, authentication, GPS/attendance logic, or architecture, update the relevant documentation before finishing the task.
- **2026-09-21** — Dual-agent rule: Cursor and Copilot must both read the handover files at task start and update them when behavior, schema, roles, reporting, or deployment changes. Stale docs are treated as a defect for the next agent.

## How the system was shaped

- **Active sales snapshot.** Imports do not overwrite a single sales table in place. Each file is a batch. One batch is `ACTIVE`. `active_sales` points at it. Failed batches cannot be activated. The active batch cannot be deleted.
- **Large datasets in `system_settings`.** Outstanding, receipts, BI cube, visit reports, order invoice meta, schemes, and quantity caps are JSON (or text) settings. This avoids a migration for every upload shape. It also means a bad key rename silently empties a screen.
- **Service role on the server, scope checks in routes.** RLS is real but not sufficient for API behavior.
- **Two order tables.** Field entry uses `sales_orders`. `orders` / `order_lines` remain for the older recommendation flow.
- **Invoice status outside the order row.** Status, PDF metadata, and the time-to-make clock live in `order_invoice_meta:<id>` so the order row stays `DRAFT|SUBMITTED|CANCELLED`.
- **FIFO is not the Tally balance.** Payment Settlement and Customer Audit show Machine Open (computed) and Tally Open (upload) on purpose. Average days to pay follows the paid-receipt rules in `paymentBehavior.js`.
- **KSA calendar.** Reports, attendance, and “today” use `Asia/Riyadh`. Missing-invoice chase uses India office hours because that desk works those hours. Friday is the KSA field holiday for several emails. Friday is the India holiday for the missing-invoice window (that job runs Saturday–Thursday).
- **Collector role was added in app code and a manual SQL script**, not in the baseline `profiles_role_check`.
- **Profit is a single amount column** for BI, added by `sql/add_sales_profit_amount.sql`, not by a migration in `supabase/migrations/`.
- **Visit plan email is intentionally off** (`SALESMAN_VISIT_PLAN_EMAIL_ENABLED` defaults false) while scoring is still being finalized. The midnight job still stores the snapshot.
- **Hardcoded salesman groups and excluded collectors** are production behavior (`mutualSalesmanGroups.js`, `COLLECTION_QUEUE_EXCLUDED_SALESMEN`).

## Recent behavior that later edits must keep

From merged pull requests on `main` (newest first):

- Payment Collections must not reload the open form when a background queue refresh runs (PR #313).
- Uploading an invoice PDF sets status to `Invoice made` (PR #312).
- Pending-order PDFs show the cash-discount breakdown (PR #310).
- Pending Orders must stay usable when the outstanding dataset is large (PR #311). Do not load or filter that sheet on the main thread in a way that freezes the page.
- Order PDFs always show an `Order No.` label (PR #298).
- Inactivity hierarchy email waits 70 minutes, not 40 (PR #299).
- WhatsApp visit and order summaries include average days to pay (PRs #297 and #307).
- Customer Audit settlement uses day-1 history, FIFO open versus Tally open, and does not treat next-day reissues as reversals. Orphan credit notes apply to open (PRs #306, #302, #296, #295).
- Receipts Not in Tally exists and allows a date window up to 30 days (PRs #301 and #305).
- Pending Order Queue has a current outstanding column (PR #303).
- Tally order Excel export and item-master unit import exist. Large unit imports must not time out without a clear error (PRs #300 and #304).
- Live time-to-make is shown for `Pending for invoice creation` (PR #308).
- Saving a Funds Received collection must not hang on PDF or camera attachments (PR #309; follow-up 2026-09-22 bounded compression / online upload path).
- Sheet names for exports should come from the snapshot the user is looking at (PR #289).

## Known drift (docs or SQL versus code)

These are real mismatches. Do not “fix” them as drive-by cleanups.

1. **`collector` is missing from the migration constraint.** `supabase/migrations/20260808000000_production_schema.sql` allows admin, manager, salesman, invoice-maker, invoice_maker, product-promoter, product_promoter. `sql/fix_profiles_role_check_collector.sql` adds `collector` and is not a migration. The app already treats the role as valid.
2. **`profit_amount` and `sales_bi_monthly` are SQL scripts only.** BI profit and the optional monthly table are not created by `supabase/migrations/`. Code falls back when profit or the table is missing (`salesBiCubeNeedsRebuild`, missing-relation checks).
3. **`COLLECTOR_SCREEN_SETUP.md` is stale.** It says invoice and collection ids are UUIDs. Migrations use bigint identity. It says salesmen use a separate “My Customer Collections” module as the primary path. In `moduleAccess.js`, `myCollections` is `false` and salesmen get `paymentCollections`. The old URL still works when payment collections are allowed. It also omits later columns (`summary_text`, GPS, queue priority).
4. **Collection tables are created twice.** `20260816000002_create_collection_tables_simple.sql` uses `CREATE TABLE` without `IF NOT EXISTS`. Do not re-run it on a database that already applied `20260816000000_add_collection_tables.sql`.
5. **`invoices` is not the live outstanding file.** Collection setup notes describe `invoices.pending_amount` as the queue. `readOutstandingDataset` uses `outstanding_customerwise_dataset_v1` whenever that JSON has invoices or rows, and reads `public.invoices` only as a fallback when the workbook is empty. The table still exists and is referenced by foreign keys.
6. **Price catalog setup is duplicated.** Baseline migration already creates `price_catalog_cache` and `price_catalog_snapshots`. `README.md` still tells operators to run `sql/setup_price_catalog_cache.sql` once. Running it should be idempotent; do not assume the cache tables are absent.
7. **`is_management()` is narrower than the UI.** Invoice makers can open Imports and hierarchy in the app but SQL policies that call `is_management()` will deny them on direct browser queries. APIs bypass that with the service role.
8. **Customer GPS audit columns are optional at runtime.** `customerGpsHistory.js` retries without them if Postgres says the column does not exist. A database that skipped `20260831153000_customer_gps_history.sql` still loads Customer Master, but without audit history.
9. **Non-production banner versus shell label.** Yellow banner and `LOCAL` shell label require a non-production `NEXT_PUBLIC_APP_ENV` (`local`, `development`, `dev`, or legacy `staging`). Unset or `production` still looks like production in the shell.
10. **No automated test script in `package.json`.** Agents and CI can miss tests. CI only runs `npm run build`. Rule changes need an explicit `node --test` run.
11. **Personal share script.** `sql/share_ahmed_nabil_customers_with_abdalla.sql` is a one-off data change. The durable rule is `SHARED_CUSTOMER_BOOKS` plus `customer_book_shares`. Do not run that script on local/dev unless the same people exist there.

## Do not modify without checking dependents

| Area | Why | Start here |
| --- | --- | --- |
| `activate_sales_batch`, `active_sales`, batch statuses | Every sales figure, BI cube, and customer history | `import-sales/route.js`, `salesBiCube.js` |
| `system_settings` key strings | Renames orphan uploaded data | `docs/DATABASE.md` key table |
| `paymentBehavior.js` FIFO, reversal window, 0.02 tolerance | Settlement, avg days, WhatsApp, Customer Audit | `tests/paymentBehavior.test.mjs` |
| Invoice status string constants | Pending Orders, email chase, PDF, time-to-make | `orderApproval.js`, `order-invoice/route.js` |
| `buildModuleAccess` and morning-attendance exemptions | Can lock every field user out, or loop collectors | `moduleAccess.js`, `morningAttendance.js`, `tests/moduleAccess.test.mjs` |
| Sales scope, mutual groups, book shares, previous salesman | Users lose or gain customer books | `customerAccess.js`, `mutualSalesmanGroups.js`, `salesHierarchy.js` |
| Outstanding column detection and bucket labels | Wrong aging and wrong balances | `outstanding.js`, `tests/outstanding.test.mjs` |
| `COLLECTION_QUEUE_EXCLUDED_SALESMEN` | Those books reappear on the queue | `paymentCollections.js` |
| KSA date helpers | Emails and attendance shift by a day | `workdayActivity.js` |
| Collection visit save and background refresh | Data loss or a reload loop | `payment-collections/route.js`, `PaymentCollectionsView.jsx` |
| Pending Orders outstanding loading | Page freeze | `pendingOrdersQuery.js`, `tests/pendingOrdersFilterPerf.test.mjs` |
| Order PDF number and cash discount | Office rejects the PDF | `salesOrderNumber.js`, order PDF tests |
| Color table classes | Reports become unreadable white grids | `.cursor/rules/colorful-tabular-reports.mdc` |
| Cron paths and `isCronAuthorized` | Scheduled mail and GPS reminders stop, or become public | `app/api/cron/*`, `cronAuth.js` |
| `SUPABASE_SERVICE_ROLE_KEY` usage | Bypasses RLS. Never import it from a client component | `app/api/**` |

## Safe extension pattern

When a task needs a new fact:

1. Search the setting keys and tables in `docs/DATABASE.md` first.
2. If a column is required, add a migration and a missing-column fallback if the app might deploy first.
3. Put the rule in `app/lib/` and a `node:test` file.
4. Wire the API, then the page.
5. Update `docs/BUSINESS_RULES.md` or `docs/ARCHITECTURE.md` (and any other matching doc), and add a short dated entry under “Recent agent notes” at the top of this file. Cursor and Copilot both rely on that step.

## Documentation-only handover

The files `.github/copilot-instructions.md`, `AGENTS.md`, and `docs/*.md` were added so Cursor and Copilot can continue without a verbal briefing. They do not change runtime behavior. They must stay aligned with the code as both tools keep shipping features.

## Incomplete repository evidence

Areas where the git checkout alone is incomplete. Do not invent missing details:

1. **No live Supabase dump.** Tables and columns come from migrations and `sql/`. Production may have one-off scripts applied that are not in `supabase/migrations/` (for example `collector` on `profiles_role_check`, `profit_amount`, storage buckets, `sales_bi_monthly`).
2. **`@supabase/ssr` is unused in app source** even though it is in `package.json`. Do not document SSR cookie helpers as existing until code imports them.
3. **Exact production env values and cron URL secrets** are not in the repo (correctly). Only names are in `.env.example`.
4. **Price upstream URL fallback** inside price-sync code was not re-audited for this doc pass; `PRICE_SOURCE_URL` is optional and the README says a fallback exists.
5. **Full RLS policy matrix** for every table after every migration is large; treat policies as a backstop and rely on API scope checks for service-role routes.
6. **Which local/dev SQL scripts have been applied** on a developer’s Supabase project is not knowable from git alone.
7. **`COLLECTOR_SCREEN_SETUP.md` and parts of older READMEs** can disagree with `moduleAccess.js` and migrations; prefer code + `docs/`.
8. **Capacitor plugin behavior on specific Android OEM skins** (battery killing timers) is described in `ANDROID_APK.md` as operational guidance, not guaranteed OS behavior.
