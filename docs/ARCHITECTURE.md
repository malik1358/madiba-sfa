# Architecture

## Backup Automation

Standalone Node scripts under `scripts/backup/` run in a gated, main-only GitHub Actions workflow, separate from Next.js and its local Supabase guard. They use read-only PostgreSQL exports, read-only Supabase Storage/Management and Vercel reads, verified Git bundles, age public-key encryption, and rclone uploads to a private personal Google Drive folder. Only the dedicated cloud backup environment receives production credentials. A separate health workflow detects failed/missed exports; offline verification never writes a database. Database and Storage snapshots are not atomic. Activation and selective Supabase recovery requirements are documented in `docs/BACKUP_RECOVERY.md`; implemented tooling alone does not mean backups are active or restore-tested.

## Stack

- Next.js 15 App Router (`app/`), React 19, JavaScript only.
- Node `>=22` (`.nvmrc` is `22`).
- Supabase JS (`@supabase/supabase-js`). `@supabase/ssr` is listed in `package.json` but app code does not import it. The browser client in `app/lib/supabase.js` uses `createClient` from `@supabase/supabase-js`.
- No global `middleware.js`. No ORM. SQL is written by hand.
- PDF: `jspdf`, `pdf-parse`, `pdfjs-dist`. Excel: `xlsx`. Images: `sharp`. Optional OCR: `tesseract.js`.
- Email: `nodemailer`. Push: `firebase-admin`.
- Android: Capacitor 8 (`android/`, `capacitor.config.js`).

`next.config.mjs` marks `tesseract.js`, `pdfjs-dist`, `@napi-rs/canvas`, and `sharp` as server external packages and raises the server-action body limit to 20mb. It also injects `NEXT_PUBLIC_BUILD_TIME` so the shell can show which deploy is running.

## Layers

```text
Browser (app/page.js, app/management/*, app/components/*)
  -> getSupabaseClient() for login and a few direct reads
  -> fetch /api/* with the user access token
API route (app/api/**/route.js)
  -> verify JWT with the service-role client, or verify CRON_SECRET
  -> enforce sales scope in application code
  -> read/write Postgres and Storage
Postgres
  -> RLS still exists, but service-role calls bypass it
  -> active_sales view + system_settings JSON for datasets
```

The service role is server-only. Losing the scope checks in an API route would expose other salesmen’s customers even though RLS exists, because the service role bypasses RLS.

## App shell

`app/layout.js` wraps every page with:

- Non-production banner when `NEXT_PUBLIC_APP_ENV` is `local`, `development`, `dev`, or legacy `staging` (`app/lib/appEnvironment.js`).
- `BuildUpdateWatcher`, PWA shell, native field tracking, morning-attendance redirect, workday time bar, main nav, back button, logout.
- `AppLanguageProvider` and `AppPopupProvider`.

The global and dashboard logout controls share `useLogoutWithDaySummary` (`app/hooks/useLogoutWithDaySummary.js`). Its dialog lets users stay logged in; a missing session token must not trigger sign-out without an explicit logout choice.

Navigation groups are Home, Field Sales, Collections, Reports, Warehouse, and Setup & Admin (`NAV_GROUPS` in `app/lib/moduleAccess.js`).

Product Catalogue (`/management/product-catalogue`, module `productCatalogue` in Field Sales) wraps the existing New Order page. Catalogue mode adds `ProductCatalogue.jsx` cards, 24-per-page filtering, carousels and cart controls without copying the order hooks. Customer scope, region/payment selection, draft restoration, offline order persistence, submission, PDF and WhatsApp remain in the original workspace. The page checks module access; GET `/api/product-catalogue` independently verifies the JWT, active profile and collection-only exclusions, and reads only existing unit/packing sources. There are no image write endpoints, photo tables, buckets, signed URLs or migration. Image storage is deferred to the separate receipt/image-storage project. Admin/manager can select temporary JPEG/PNG/WebP previews (up to 3 MB), held only in React state with blob URLs revoked on removal/unmount. Reloading/leaving loses previews, which are explicitly labelled not uploaded/saved/shared. All products initially use no-photo placeholders.

## Role system and `moduleAccess.js`

Source of truth: `app/lib/moduleAccess.js` (covered by `tests/moduleAccess.test.mjs`).

- `normalizeAccessRole` lowercases and turns `_` into `-` (`invoice_maker` → `invoice-maker`).
- `isCollectionOnlyAccess`: role `collector`, or `collection_only` metadata, or salesman code matching `/^CL\d+$/i`.
- `isFieldSales` for module flags: salesman, manager, admin, invoice-maker, or product-promoter (collectors are then excluded from field modules).
- GPS helpers: `shouldRequireTransactionGps` (false for invoice makers), `shouldRequireGpsAccessGate` (false for admin/manager), `shouldEnableBackgroundGps` (false for admin and invoice makers).
- Invoice management: `canManageOrderInvoice` for invoice-maker, admin, manager.
- Management report viewing: invoice makers can view the Reports group and collection reports, including cross-user data where the report API grants that scope. Report email sending and setup/configuration remain separately gated.
- Stock take: admin or `profiles.stock_take_access`.
- Salesman visit plan for field roles depends on `NEXT_PUBLIC_SALESMAN_VISIT_PLAN_SALESMAN_ACCESS` (default enabled).
- `myCollections` module flag is always `false`; `/management/my-collections` remains reachable via `canAccessPath` when payment collections are allowed.
- SQL `is_management()` is only admin/manager. App UI can still show invoice makers more screens via service-role APIs.

Module access summary from `buildModuleAccess` (Y = true for that role group; collectors use the collection-only path):

| Module | admin | manager | salesman | collector | invoice-maker | product-promoter |
| --- | --- | --- | --- | --- | --- | --- |
| dashboard | Y | Y | Y | Y | Y | Y |
| management | Y | Y | | Y | Y | |
| myDay, customerAudit, newOrder, visitWithoutOrder, pendingOrders, newCustomer, myPerformance, mySalesInvoices, paymentSettlement, outstandingCompare | Y | Y | Y | | Y | Y |
| paymentCollections | Y | Y | Y | Y | Y | |
| collectionReport, receiptsNotInTally, userActivity, workingHours | Y | Y | | Y | Y | |
| dailyVisitReport | Y | Y | Y | Y | Y | |
| businessDashboard, outstandingNoGps | Y | Y | | | Y | |
| customerGpsHistory | Y | Y | | | | |
| customerMaster, customerBookShares, kpiTargets, schemes, orderQuantityControls | Y | Y | | | | |
| salesmanHierarchy, upload | Y | Y | | | Y | |
| salesmanVisitPlan | Y | Y* | Y* | | Y* | Y* |
| itemPriceHistory | Y | Y | Y | | Y | Y |
| gpsMap | Y | | | | Y | Y |
| stockTake | Y / flag | flag | flag | flag | flag | flag |

\*Visit plan for non-admin field roles requires the env flag above. “flag” means `stock_take_access` on the profile.

Pinned home shortcuts: `PINNED_MODULE_KEYS` in the same file.

## Major API routes

Handlers live under `app/api/**/route.js`. Most create a service-role client, verify the user JWT (or `CRON_SECRET`), then enforce sales scope in application code.

**Field / customers**

- `/api/user/sales-scope` — visible salesman codes
- `/api/customers/visible`, `/api/customers/lookup`, `/api/customers/contact`, `/api/customers/location`
- `/api/customer-history`, `/api/customer-meta`, `/api/customer-documents`, `/api/customer-visits`
- `/api/customer-order-block` (Avg-days order block status + admin override)
- `/api/prospects`, `/api/visit-reports`, `/api/gps-ping`
- `/api/sales-orders`, `/api/order-history`, `/api/order-invoice`
- `/api/sales-invoices`, `/api/outstanding`, `/api/performance`
- `/api/transaction-alert`, `/api/translate`

**Collections**

- `/api/payment-collections`, `/api/payment-collections/report`, `/api/payment-collections/day-summary`
- `/api/receipts`, `/api/receipts-not-in-tally`
- `/api/cron/matched-receipt-email` — matches saved app receipts against the uploaded receipt register and sends one-time salesman notifications.

**Admin / imports / BI**

- `/api/import-sales`, `/api/upload-files`, `/api/pricing/cache`, `/api/admin/price-sync`
- `/api/business-dashboard`, `/api/business-dashboard/category-growth`
- `/api/salesman-incentive` — monthly salesman incentive (collection speed + sales growth)
- `/api/promoter-coverage` — promoter-only team customer coverage, own visit history, and monthly customer sales trend
- `/api/admin/customers`, `.../export`, `.../locations`, `.../gps-history`
- `/management/customer-gps-history` uses `.../gps-history?from=...&to=...` for paginated cross-customer audit reporting; the legacy `customerCode`-only API remains unchanged. `customerGpsReport.js` supplies KSA bounds, coordinate validation, displacement and explicit approval classification.
- `/api/admin/salesmen-hierarchy`, `/api/admin/customer-book-shares`, `/api/admin/kpi-targets`
- `/api/admin/kpi-targets/details` — role- and sales-scope-protected transaction detail rows behind KPI actual links.
- `/api/admin/schemes`, `/api/admin/order-quantity-controls`, `/api/admin/item-price-history`
- `/api/admin/salesman-visit-plan`, `/api/admin/outstanding-no-gps`, `/api/admin/clean-dirty-customers`
- `/api/admin/push-notifications`, `/api/tally-item-units`, `/api/stock-take`

**Mobile / config / activity**

- `/api/mobile-snapshot`, `/api/offline-data-version`, `/api/push-tokens`
- `/api/app-config`, `/api/build-info`, `/api/user-activity`
- `/api/working-hours` — attendance columns plus daily salesman working hours from near-visit lunch segments; the daily salesman resume reuses this report calculation
- `/api/daily-visit-report`, `/api/daily-visit-report/email`, `/api/inactivity-email-log`

**Cron** (`app/api/cron/*`, auth via `CRON_SECRET`)

- `inactivity-push`, `auto-close-workdays`, `daily-visit-report-email`, `daily-salesman-resume-email`, `matched-receipt-email`
- `daily-supplier-order-email`, `outstanding-no-gps-email`, `missing-invoice-email`
- `customer-gps-change-email` uses `customerGpsChangeEmailServer.js` to send one previous-calendar-day salesman-accepted location digest, with atomic per-day claims in `system_settings`.
- `salesman-visit-plan-email`, `mobile-snapshot`

## Authentication

1. Home page signs in with `supabase.auth.signInWithPassword`.
  Network/auth-host failures show a connection error rather than claiming the password is wrong. A reachable PC-local Supabase backend is required for local sign-in; neither the legacy cloud staging project nor production belongs in local config.
2. Profile row is `public.profiles` where `id` is `auth.users.id`.
3. `app/lib/authSession.js` caches the session for a few seconds and times out slow `getSession` calls.
4. API routes expect `Authorization: Bearer <access token>`, then `auth.getUser`.
5. Cron routes use `app/lib/cronAuth.js`: `Authorization: Bearer <CRON_SECRET>` or header `x-cron-secret`. If `CRON_SECRET` is empty, cron calls are rejected.
6. Android login can be blocked by a minimum APK version (`app/lib/androidAppVersionPolicy.js`, setting `android_apk_min_version_v1`, env `MIN_ANDROID_APK_VERSION_CODE`).
7. Android also gates login/morning attendance on unrestricted battery (`app/lib/androidBatteryOptimization.js`, details in `ANDROID_APK.md`).
8. Active admins can use the global **Login as** control. `/api/admin/login-as` revalidates the admin profile and target profile, then uses Supabase Admin `generateLink` plus browser `verifyOtp` to create a real target-user session without handling passwords. The admin access/refresh tokens are kept in tab `sessionStorage` for the **Return to admin** control. App APIs and audit fields see the selected user; there is no separate impersonation audit record. No schema migration is required.

Hierarchy is not a table. Each auth user’s `user_metadata` / `app_metadata` may contain `head_salesman_code` and `head_salesman_name`. `app/lib/salesHierarchy.js` walks that chain. Customer book shares are a real table (`customer_book_shares`) plus hardcoded pairs in `app/lib/mutualSalesmanGroups.js`.

`collection_only` in user metadata forces the collector module set even if `profiles.role` is something else.

## Sales scope

`GET /api/user/sales-scope` (and `app/lib/salesScope.js`) builds the list of salesman codes a user may see. Downstream routes call helpers such as `ensureCustomerVisibleToScope` (`app/lib/customerAccess.js`). A customer is visible when any of these is true:

- The caller has all-access (admin/manager paths inside the scope builder).
- `current_salesman_code` or `previous_salesman_code` matches the scope (assignment helpers).
- The customer appears on `active_sales` for a visible salesman.
- The customer appears on the outstanding dataset for a visible salesman.
- The code is a prospect owned by a visible salesman.

Do not replace this with a single `.eq("current_salesman_code", code)` filter.

## Two order models

Both exist in the production schema:

- `orders` / `order_lines` — older recommendation-style orders tied to `visits`.
- `sales_orders` / `sales_order_items` — the live order entry path (`/api/sales-orders`).

New field orders go to `sales_orders`. Invoice status is not a column on that table. It is `system_settings.setting_key = order_invoice_meta:<id>`. Order `salesman_code` / `salesman_name` are set from the authenticated maker’s profile in `/api/sales-orders` (not from customer master assignment).

## Imports and the active batch

`/api/import-sales` loads an Excel sales file into `sales_raw` under a new `import_batches` row, then activates it. `activate_sales_batch` archives the previous `ACTIVE` batch and sets `system_settings.active_sales_batch_id`. The view `public.active_sales` is that batch only.

Outstanding customer sheets and the receipt register are parsed and stored as JSON settings (`outstanding_customerwise_dataset_v1`, `receipt_register_dataset_v1`). When that outstanding workbook has invoice or row data, Payment Collections uses it and does **not** merge `public.invoices` (that merge reloaded every open invoice on each queue fetch). `readOutstandingInvoicesFromTable` in `app/api/payment-collections/route.js` runs only when no workbook has been uploaded.

After a sales import, the BI cube and the daily supplier-order email can rebuild or send. Those side effects live in `app/api/import-sales/route.js`.

## Offline and mobile cache

Field phones cache scope, prices, and customer payloads (`app/lib/mobileDataCache.js`, `offlineDataRefresh.js`, `localDataStore.js`). `/api/mobile-snapshot` and `/api/cron/mobile-snapshot` rebuild snapshots. `/api/offline-data-version` exposes a version key so clients know when to refresh. Queued field writes use `app/lib/offlineSyncQueue.js` via `postJsonResilient` / `postFormDataResilient` / `sendJsonResilient`, which **default to `queueFirst: true`** so collections, visits, orders, stock take, and prospects save on-device first and sync in the background. Sales order numbers are allotted offline per salesman (`app/lib/offlineOrderNumber.js`) and persist unchanged through sync. Collection visit saves carry a `clientSubmissionId` form field generated before queueing (`app/lib/collectionSubmission.js`); it is stored with the queued fields in IndexedDB, so every retry and post-restart sync replays the same id. `POST /api/payment-collections` looks it up (scoped to `created_by`) before validation and uploads and returns the existing visit (`duplicate: true`) instead of inserting again; a concurrent unique violation is resolved the same way. Requests without the field (older queued items) and databases without the column keep the old insert path.

Do not assume a page always has a live network read. Several screens render from cache and then refresh.

## GPS

- Background and idle pings: `app/lib/nativeFieldTracking.js` and `POST /api/gps-ping`. Pings are `daily_activity_logs` rows with `entry_type = GPS_PING` and a JSON note. They are allowed only inside an open KSA work session (after morning attendance, before end of day).
- Salesman home points are stored on `profiles` and shown in the Daily Visit Report and its email. A database trigger rejects login/logout attendance within 500 m of the user's home, and another prevents customer pins within 25 m of any saved home point. Shared customer GPS writes also check the actor's 500 m home radius, including automatic visit promotion and imports. Saving a home from Salesman Hierarchy clears pins within 25 m through the audited GPS-history helper.
- Customer coordinates: `PATCH /api/customers/location` updates `customers.latitude/longitude` and the GPS audit columns, and inserts `customer_gps_history`. Field visits auto-promote GPS onto the customer when none is saved yet — server-side in `/api/visit-reports` and collection saves (`promoteEntryGpsToCustomerIfMissing`), and client-side in `customerLocation.js`. Outstanding Without GPS also backfills from `visit_report_latest` / collection visit GPS when the master pin is still empty. Far-from-saved still prompts.
- Collection visits store their own lat/long on `collection_visits` when those columns exist.
- Daily Visit Report associates accepted GPS-update prompts with the visit: My Day stores the acceptance in its activity-note JSON, collection saves link a GPS activity note by visit id, and older accepted overwrites are recognized from matching `customer_gps_history` rows. These visits show an accepted-update label and are excluded from Far status/counts; no new database column is required.
- Invoice makers and admins do not run the background GPS tracker (`shouldEnableBackgroundGps`).

## Reporting pipeline

- Customer cohort aggregation accepts `period: "month"` for the monthly matrix. The protected customer-growth payload includes `customerCohorts` and `customerMonthlyCohorts`, derived from the same full-history rows. Quarter/Month switching is client-side and exports the selected grid. Dates choose whole column periods; purchase sets are not trimmed by partial dates or year/month filters. No new endpoint, dataset key, or migration.

BI pages call `/api/business-dashboard` and `/api/business-dashboard/category-growth`.

- Customer retention is a bilingual quarterly cohort matrix at the top of BI Customer Growth. `app/lib/customerCohorts.js` fixes first-invoice quarters from full active-upload history before applying filters; the protected category-growth loader attaches `customerCohorts` from prepared cube rows or paginated `active_sales`. The matrix follows customer-applied field filters and the global BI period; client search/signal filters apply only to the existing growth report. `CustomerCohortReport.jsx` uses colored BI tables and Excel export with count-only or count-plus-retention-% cells such as `70 (70.0%)`. No additional scan, endpoint, settings key, or database migration.

- Facts come from `active_sales` (including `profit_amount` when the column exists).
- `/api/performance` reuses per-month actuals and six-month salesperson pace curves stored at `system_settings.performance_kpi_actuals_v1:<month-start>`. Sales-upload completion and collection-visit saves rebuild the current month's cache in post-response work. Each request still performs authentication/scope checks and reads current KPI targets; a missing or batch-mismatched cache is rebuilt on demand. Cache values contain calculated actuals/pace, not transaction-detail rows; details remain loaded by the separate scoped KPI details API.
- The Business Intelligence Sales mix tab compares monthly cash/credit and local/import invoice sales from additional measures in `sales_bi_cube_v1`; it uses the current BI date filters, excludes credit notes/returns, and has no new endpoint or database schema requirement. The cube version is bumped so an older prepared model rebuilds with the new measures.
- The Business Intelligence MADIBA tab uses the existing category-growth API with an item-name filter on the monthly cube (or its live-sales fallback). It presents category and matching item trends using the shared period and sales/profit controls; no new table or endpoint is required.
- MADIBA category GP % grids pair the prepared sales and profit measure groups by category in `app/lib/madibaBrandGp.js`; they keep the existing quarterly/monthly windows and table filters without another API request.
- `app/lib/salesBiCube.js` aggregates monthly facts. The compact cube is stored at `sales_bi_cube_v1`. Version constant is `SALES_BI_CUBE_VERSION` (currently 4). A rebuild is required when profit data appears or the import time changes.
- Optional table `sales_bi_monthly` is created only by `sql/setup_sales_bi_monthly.sql`. The app is written to keep working from the settings blob if the table is absent.
- Period presets are `app/lib/biReportPeriod.js` (`mtd`, `qtd`, `ytd`, last month, last 3/6/12 months, custom).
- Month-over-month coloring is `app/lib/salesmanMom.js` and `categoryGrowth.js`. Current incomplete month is not treated as a closed comparison month.
- Tables must keep the colored header, zebra rows, up/down/current cell classes, and a total column or footer.

## Attachment storage

Business routes never call Supabase Storage for attachment files. Server-only modules in `app/lib/storage/`:

- `attachmentKeys.js` — object keys `<bucket>/<path>` (existing Supabase layouts kept), legacy URL/path parsing.
- `attachmentStorage.js` — facade `putObject` (no overwrite, returns size/sha256/md5), `writeAttachmentObject` (primary/fallback/dual-write), `getObject`, `headObject`, `getSignedReadUrl` (default 300 s, max 900 s); `deleteObject` throws. Providers: `providers/supabaseProvider.js` (default) and `providers/r2Provider.js` (Cloudflare R2 via `aws4fetch` SigV4, private S3 API endpoint, `If-None-Match: *`, `x-amz-content-sha256`, metadata limited to `sha256`/`category`/`entity-type`). `r2Guard.js` validates R2 config and blocks the production bucket outside Vercel production + production Supabase.
- Write provider comes from `ATTACHMENT_WRITE_PROVIDER` (only an explicit `r2` selects R2; default Supabase with legacy key layout). In R2 mode keys are immutable (`…/{yyyy}/{mm}/{CUSTOMER}/{yyyymmdd}-{uuid}.{ext}`, `…/{timestamp}-{uuid}-{name}`); if R2 fails the same key is written to Supabase and the `attachments` row records `supabase`; with `ATTACHMENT_DUAL_WRITE=1` a best-effort Supabase copy is written at the same key after R2 succeeds (failures logged, save continues). If the attachments table is missing, R2 mode writes Supabase. Reads always use the row's `storage_provider`; `ATTACHMENT_FORCE_SUPABASE_READS=1` is the rollback switch for objects that also exist in Supabase.
- `attachmentRecords.js` — `storeAttachment` (upload + `attachments` row), owner linking, queue-safe visit summaries, `readOrderInvoiceFile` (prefers `invoiceAttachmentId`, falls back to `invoiceFilePath`) used by invoice comparison, prospect linking and the supplier email.
- `attachmentAccess.js` — resolves the owner and authorizes reads (collection scope / `canSeeOrder` / sales customer scope).

`GET /api/attachments/<uuid>/url` and `GET /api/attachments/legacy/url?kind=receipt_copy|payment_copy|order_invoice|customer_document&ref=<owner id>` authenticate the bearer token, authorize, then return a short-lived signed URL (`Cache-Control: private, no-store`). Clients use `app/lib/openAttachment.js`, which opens a placeholder tab synchronously (iOS popup rules) or an anchor in the Capacitor shell. Bucket provisioning is `ensureAttachmentBucket` → `supabaseProvider.ensureBucket`: a missing bucket is created **private**; an existing bucket is never updated, so no upload can change its privacy. No app code builds `/storage/v1/object/public/...` URLs; historical public URLs are only parsed into bucket/path and signed.

## Collections architecture

`/api/payment-collections` builds queues from the outstanding dataset, customer master, and `collection_visits`. Priority scoring is `buildCollectionPriority` in `app/lib/paymentCollections.js`. Legal escalation is `legal_transfers`. Files go to the `payment-collections` storage bucket. Visit saves (including Funds Received attachments) are offline-first (`queueFirst`): files serialize into IndexedDB only for the local queue, then sync uploads multipart with MIME re-resolved for Android. Client photo prep (`prepareUploadFile`) is time-bounded so Android camera HEIC/JPEG cannot leave Saving stuck. Client save enrichment uses cached queue `avg_days_to_pay` and skips the activity timeline (`skipTimeline`); the API recomputes visit-distance lines with the service role on sync.

The collections UI was split so a background queue refresh does not remount the open visit form. Do not tie a full page reload to that refresh (see the fix in PR #313).

## Invoice office flow

`/api/order-invoice` reads and writes `order_invoice_meta:<id>`. Status strings are constants in `app/lib/orderApproval.js` (for example `Pending for invoice creation`, `Invoice made`). Uploading a PDF sets status to `Invoice made` when the upload exists. Time-to-make runs only while status is still the pending-invoice queue (`app/lib/pendingOrderTimeToMake.js`).

`/api/cron/missing-invoice-email` checks submitted orders created on or after `2026-09-01` that still have no invoice one hour after creation. It emails every 15 minutes while Pending for approval or Pending for invoice creation orders remain; otherwise it sends one summary at KSA midnight. The cycle skips Friday in India office time (`Asia/Kolkata`) before syncing cron credentials, loading orders, or sending mail, so both pg_cron and the GitHub Actions backup are covered. Orders created before that KSA cutoff are legacy and can be auto-rejected as `Rejected by management` with reason `Pre-September 2026 — invoice not uploaded`.

## Scheduled work

Vercel cron (`vercel.json`) calls `/api/cron/inactivity-push` every 10 minutes. GitHub Actions workflows call the same style of endpoint with `x-cron-secret`. Schedules are listed in `docs/DEPLOYMENT.md`. Handlers live under `app/api/cron/`.

## Patterns to copy

- Parse JSON from `system_settings` defensively. Bad JSON should not crash the page.
- If a new column might not be migrated, catch Postgres `42703` / schema-cache errors and retry without that column. Do this only when the feature already works without the column.
- Put business math in `app/lib/` and add a `tests/*.test.mjs` file. Pages should format and submit, not reimplement FIFO or visit scores.
- Authorize cron with `isCronAuthorized`. Do not accept a query-string secret.

## Fragile files

These are large or shared. Read them fully enough to see callers before editing:

- `app/api/import-sales/route.js`
- `app/api/payment-collections/route.js`
- `app/api/customers/visible/route.js`
- `app/api/order-invoice/route.js`
- `app/api/sales-orders/route.js`
- `app/lib/paymentBehavior.js`
- `app/lib/outstanding.js`
- `app/lib/workdayActivity.js`
- `app/lib/moduleAccess.js`
- `app/management/customer-audit/page.js`
- `app/management/pending-orders/page.js`
- `app/management/new-order/page.js`
- `app/management/payment-collections/PaymentCollectionsView.jsx`

## Android / Capacitor

- Config: `capacitor.config.js` — `appId` `com.madiba.sfa`, `appName` `MADIBA SFA`, `webDir` `public`, server URL defaults to `https://madiba-sfa.vercel.app` (override with `CAPACITOR_SERVER_URL`).
- Native project: `android/`. Field UI still comes from the hosted Next.js site; rebuild APK only when native code, permissions, or Capacitor plugins change.
- Tracking: `app/lib/nativeFieldTracking.js` + `app/components/NativeFieldTracking.jsx`. Foreground service notification, idle GPS after 15 minutes without transaction activity, check cycle every 5 minutes while the process runs. Pings pause during lunch and after end of day.
- Push: device tokens in `device_push_tokens`; server FCM via `FIREBASE_SERVICE_ACCOUNT_JSON` and `app/lib/fcm.js`. Without Firebase server config, local inactivity alerts can still work; remote push does not.
- Minimum APK: env + `system_settings.android_apk_min_version_v1`.
- Operator guide: `ANDROID_APK.md` (battery unrestricted required before login, location all-the-time, Play internal testing, GitHub APK workflow).

Do not change Capacitor app id, tracking intervals, or battery/login gates unless the task explicitly asks for it.
