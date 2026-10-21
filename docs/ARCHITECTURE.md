# Architecture

## Backup Automation

Standalone Node scripts under `scripts/backup/` run in a gated, main-only GitHub Actions workflow, separate from Next.js and its local Supabase guard. They use read-only PostgreSQL exports, read-only Supabase Storage/Management and Vercel reads, verified Git bundles, age public-key encryption, and rclone uploads to a private personal Google Drive folder. Only the dedicated cloud backup environment receives production credentials. A separate health workflow detects failed/missed exports; offline verification never writes a database. Database and Storage snapshots are not atomic. Activation and selective Supabase recovery requirements are documented in `docs/BACKUP_RECOVERY.md`; implemented tooling alone does not mean backups are active or restore-tested.

## Stack

- Next.js 15 App Router (`app/`), React 19, JavaScript only.
- Node `>=22` (`.nvmrc` is `22`).
- Supabase JS (`@supabase/supabase-js`). `@supabase/ssr` is listed in `package.json` but app code does not import it. The browser client in `app/lib/supabase.js` uses `createClient` from `@supabase/supabase-js`.
- No global `middleware.js`. No ORM. SQL is written by hand.
- PDF: `jspdf`, `pdf-parse`, `pdfjs-dist`. Excel: `xlsx`. Images: `sharp`. Optional OCR: `tesseract.js`.
- Email: `nodemailer` (SMTP) or Resend via `app/lib/mailer.js`, including optional PDF attachments. Team and team-leader mail is limited to 08:30–22:00 Asia/Riyadh, Saturday–Thursday (`isWithinTeamEmailWindow`). Held invoice, KPI, supplier-order, matched-receipt, and visit-plan messages sit in `system_settings.deferred_team_emails_v1` and leave on the inactivity cron. Push: `firebase-admin`.
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

Missing Catalogue Photos (`/management/missing-catalogue-photos`, module `missingCataloguePhotos` in Reports) is a read-only management report. `GET /api/missing-catalogue-photos` checks the caller JWT and management-report access, then compares `items_master`, `price_catalog_cache` (`cache_key=default`), and `attachments.category = product_catalogue_photo`. Only items with a positive price in that cache and a one-letter-plus-digits product code are listed. The same report is emailed by `POST /api/cron/missing-catalogue-photos-email` at 08:30 KSA, Saturday–Thursday. No migration.

Product Catalogue (`/management/product-catalogue`, module `productCatalogue` in Field Sales) wraps the existing New Order page. Catalogue mode adds `ProductCatalogue.jsx` cards, 24-per-page filtering, carousels, a bulk WhatsApp export of one front photo per product that already has a catalogue image (the oldest upload, shown first on the card; with or without the on-screen ex-VAT price, with no zip download and no blank “No photo” cards), and cart controls without copying the order hooks. Customer scope, region/payment selection, draft restoration, offline order persistence, submission, PDF and WhatsApp remain in the original workspace. The page checks module access. A missing session is sent to login and returned to the catalogue; it is not shown as access denied. `/api/product-catalogue` independently verifies the JWT, active profile and collection-only exclusions. GET loads packing plus photo ids from `attachments` (`product_catalogue_photo`) and does not sign a Storage URL per photo. The same GET with `photoId` returns that JPEG so the browser can save it on the device and draw price and packing onto a WhatsApp share image. POST/DELETE (admin/manager only) write through the same attachment facade as receipts (`writeAttachmentObject` / R2 when configured). The screen opens packing and saved photos from that device copy, including while offline. It does not wait for photo downloads. After sign-in the app saves and updates photo files in the background, and the catalogue shows each photo as it is saved. Catalogue cards auto-advance the photo carousel and share the composed JPEG, with English and Arabic details on the image and no separate WhatsApp caption, through the existing file helper. Arabic wording for the name, packing, and selling unit comes from `/api/translate` (English to Arabic), and known unit abbreviations are translated even when that call leaves them in English. Migration `20261015084023_product_catalogue_photos_attachments.sql` is already applied on production (ledger `20261015084804`). Admin and manager can press **Update from Drive** (`POST /api/product-catalogue/drive-sync`) to import new or changed images from the public Product Photo Gallery folder. `POST /api/cron/catalogue-drive-photos` does the same check every 8 hours with `x-cron-secret`. The Drive file id is stored on `attachments.original_file_name` so a later check can skip unchanged files. No migration.

Catalogue enhancements reuse scoped customer search, `NearestCustomerSuggestions` (three results) and `useQuickOrder` rather than creating alternative scope/GPS/history pipelines. History requests are cancelled when the selected account changes; a successful matching-customer marker gates New Items, Not Bought Since Long, and Buying Less. Cards and orders share discount math. `orderPriceMapFor` selects the exact retail city map without wholesale fallback; mode is preserved through parsing/cache/offline payloads, API authoritative pricing, draft restoration and PDF/WhatsApp. The private costing workbook remains private: the existing owner-run Apps Script publishes selected retail prices. `productCatalogueServer` independently reads public packing-sheet CSV with a timeout, explicit warnings and stock-take fallback.

## Role system and `moduleAccess.js`

Source of truth: `app/lib/moduleAccess.js` (covered by `tests/moduleAccess.test.mjs`).

- `normalizeAccessRole` lowercases and turns `_` into `-` (`invoice_maker` → `invoice-maker`).
- `isCollectionOnlyAccess`: role `collector`, or `collection_only` metadata, or salesman code matching `/^CL\d+$/i`.
- `isFieldSales` for module flags: salesman, manager, admin, invoice-maker, or product-promoter (collectors are then excluded from field modules).
- GPS helpers: `shouldRequireTransactionGps` (false for invoice makers), `shouldRequireGpsAccessGate` (false for admin/manager), `shouldEnableBackgroundGps` (false for admin and invoice makers). Visit-report save uses `captureOptionalGpsLocation` and still saves and shares when that read fails.
- Invoice management: `canManageOrderInvoice` for invoice-maker, admin, manager.
- Management report viewing: invoice makers can view the Reports group and collection reports, including cross-user data where the report API grants that scope. Report email sending and setup/configuration remain separately gated.
- Stock take: admin or `profiles.stock_take_access`.
- Salesman visit plan for field roles depends on `NEXT_PUBLIC_SALESMAN_VISIT_PLAN_SALESMAN_ACCESS` (default enabled).
- `myCollections` module flag is always `false`; `/management/my-collections` remains reachable via `canAccessPath` when payment collections are allowed.
- SQL `is_management()` is only admin/manager. App UI can still show invoice makers more screens via service-role APIs.
- Optional override matrix: `system_settings.role_module_access_v1`, edited on `/management/role-access`. `useModuleAccess` loads it and passes `roleModuleMatrix` into `buildModuleAccess`. Defaults below apply until an admin saves.

Module access summary from `buildModuleAccess` (Y = true for that role group; collectors use the collection-only path):

| Module | admin | manager | salesman | collector | invoice-maker | product-promoter |
| --- | --- | --- | --- | --- | --- | --- |
| dashboard | Y | Y | Y | Y | Y | Y |
| management | Y | Y | | Y | Y | |
| myDay, customerAudit, newOrder, visitWithoutOrder, pendingOrders, newCustomer, myPerformance, mySalesInvoices, paymentSettlement, outstandingCompare | Y | Y | Y | | Y | Y |
| paymentCollections | Y | Y | Y | Y | Y | |
| collectionReport, receiptsNotInTally, userActivity, workingHours | Y | Y | | Y | Y | |
| dailyVisitReport | Y | Y | Y | Y | Y | |
| businessDashboard, outstandingNoGps, potentialBadDebts, legalTransfers | Y | Y | | | Y | |
| customerGpsHistory | Y | Y | | | | |
| customerMaster, customerBookShares, kpiTargets, schemes, orderQuantityControls | Y | Y | | | | |
| roleAccess | Y | | | | | |
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
  - Settlement/`fullHistory` responses skip peer sales rows unless `includePeers=1` (peers are Quick Order only). Receipt register rows are filtered from an in-process 60s memory cache of `receipt_register_dataset_v1`. Server `customer_history_cache:*` writes are fire-and-forget so the HTTP response is not blocked on upserting large JSON into `system_settings`. Customer Audit opens cache-first with a 45s client timeout.
- `/api/customer-order-block` (Avg-days order block status + admin override)
- `/api/prospects`, `/api/visit-reports`, `/api/gps-ping`
- `/api/sales-orders`, `/api/order-history`, `/api/order-invoice`
- `/api/sales-invoices`, `/api/outstanding`, `/api/performance`
- `/api/transaction-alert`, `/api/translate`

**Collections**

- `/api/payment-collections`, `/api/payment-collections/report`, `/api/payment-collections/day-summary`
- `/api/receipts`, `/api/receipts-not-in-tally`
- `/api/cron/matched-receipt-email` — matches saved app receipts against the uploaded receipt register and sends one-time salesman notifications plus boss digests. Daily runs reconcile month-to-date once (`maxDuration` 300s), then filter salesman mail to yesterday while bosses see late Tally matches for the month.

**Admin / imports / BI**

- `/api/import-sales`, `/api/upload-files`, `/api/pricing/cache`, `/api/admin/price-sync`
- `/api/business-dashboard`, `/api/business-dashboard/category-growth`
- `/api/salesman-incentive` — monthly salesman incentive (collection speed + sales growth); scope uses management roles company-wide or `resolveSalesScopeForUserId` for team heads
- `/api/promoter-coverage` — promoter-only team customer coverage, own visit history, and monthly customer sales trend
- `/api/admin/customers`, `.../export`, `.../locations`, `.../gps-history`
- `/management/customer-gps-history` uses `.../gps-history?from=...&to=...` for paginated cross-customer audit reporting; the legacy `customerCode`-only API remains unchanged. `customerGpsReport.js` supplies KSA bounds, coordinate validation, displacement and explicit approval classification.
- `/api/admin/salesmen-hierarchy`, `/api/admin/customer-book-shares`, `/api/admin/kpi-targets`
- `/api/admin/kpi-targets/details` — role- and sales-scope-protected transaction detail rows behind KPI actual links.
- `/api/admin/schemes`, `/api/admin/order-quantity-controls`, `/api/admin/item-price-history`
- `/api/admin/salesman-visit-plan`, `/api/admin/outstanding-no-gps`, `/api/admin/clean-dirty-customers`
- `/api/bad-debt-reports` — Potential Bad Debts and Customers Transferred to Legal. Management-report roles only. Outstanding comes from the collection book; Funds Received is read from `collection_visits` for the last 10 KSA days. Last visit is the later of that customer's latest collection visit and `visit_report_latest`. Oldest invoice days uses the open invoice age. No migration.
- `/api/admin/push-notifications`, `/api/tally-item-units`, `/api/stock-take`

**Mobile / config / activity**

- `/api/mobile-snapshot`, `/api/offline-data-version`, `/api/push-tokens`
- `/api/app-config`, `/api/build-info`, `/api/user-activity`
- `/api/working-hours` — attendance columns plus daily salesman working hours from near-visit lunch segments; the daily salesman resume reuses this report calculation
- `/api/daily-visit-report`, `/api/daily-visit-report/email`, `/api/inactivity-email-log`

**Cron** (`app/api/cron/*`, auth via `CRON_SECRET`)

- `inactivity-push`, `auto-close-workdays`, `daily-visit-report-email`, `daily-salesman-resume-email`, `matched-receipt-email`
- `daily-supplier-order-email`, `outstanding-no-gps-email`, `missing-invoice-email`
- `customer-gps-change-email` uses `customerGpsChangeEmailServer.js` to send one previous-calendar-day salesman-accepted location digest, with atomic per-day claims in `system_settings`. Digests include per-customer **Times today** / **Total times** counts. Authorized `force` / test-`to` query params resend without claiming the daily marker.
- `bad-debt-report-email` sends Potential Bad Debts at 08:30 KSA, Saturday–Thursday, to Malik, Fazlur, and Soyeb. Salesman tables omit legal transfers. Those customers are one separate table. New rows are highlighted from `bad_debt_report_email_snapshot_v1`. A forced or test send does not claim `bad_debt_report_email:<date>`.
- `salesman-visit-plan-email`, `mobile-snapshot`
- `app-performance` measures the public build endpoint, Auth health, a keyed settings read (`active_sales_batch_id`), a customer count, and a two-day order count at 09:00, 12:00, 15:00 and 18:00 KSA. The cron prefers Vercel region `syd1` (near production Supabase). It records the fastest of two Auth health attempts, warms one DB round-trip, then records the fastest of two attempts for each DB probe so a single cold connection does not mark the hour slower. Each KSA hour is stored separately in `system_settings.app_performance_daily_v1` and 90 days are kept. A run is `slower` only when a timing is both 50% above and at least 200 ms above the median of earlier samples, after three samples exist. Slower and failed runs email `malik@pinasz.com` once per hour.

## Authentication

1. Home page signs in with `supabase.auth.signInWithPassword`.
  Network/auth-host failures show a connection error rather than claiming the password is wrong. A reachable PC-local Supabase backend is required for local sign-in; neither the legacy cloud staging project nor production belongs in local config.
2. Profile row is `public.profiles` where `id` is `auth.users.id`.
3. `app/lib/authSession.js` caches the session for a few seconds and times out slow `getSession` calls.
4. API routes expect `Authorization: Bearer <access token>`, then `auth.getUser`.
5. Cron routes use `app/lib/cronAuth.js`: `Authorization: Bearer <CRON_SECRET>` or header `x-cron-secret`. If `CRON_SECRET` is empty, cron calls are rejected.
6. Android login can be blocked by a minimum APK version (`app/lib/androidAppVersionPolicy.js`, setting `android_apk_min_version_v1`, env `MIN_ANDROID_APK_VERSION_CODE`).
7. Android also gates login/morning attendance on unrestricted battery (`app/lib/androidBatteryOptimization.js`, details in `ANDROID_APK.md`).
8. Browser GPS capture lives in `app/lib/geo.js`. Collectors punch morning attendance from `MorningAttendanceRedirect` on Payment Collections; that path uses progressive `probeGpsLocationWithRetries` and `formatGpsFailureMessage` so Safari site-permission failures are not mislabeled as “phone GPS off.”
9. After a successful password sign-in, non-admin users keep one Auth session per platform (`POST /api/auth/session-limit`, `enforce_single_platform_session`). The Android app is the WebView platform; browsers share one web session. Admin is exempt. Production already has the function at ledger version `20261016080833`, aliased to repo file `20261016120000_single_platform_session.sql`. Do not apply that file again.
10. Active admins can use the global **Login as** control. `/api/admin/login-as` revalidates the admin profile and target profile, then uses Supabase Admin `generateLink` plus browser `verifyOtp` to create a real target-user session without handling passwords. The admin access/refresh tokens are kept in tab `sessionStorage` for the **Return to admin** control. App APIs and audit fields see the selected user; there is no separate impersonation audit record. No schema migration is required.

Hierarchy is not a table. Each auth user’s `user_metadata` / `app_metadata` may contain `head_salesman_code` and `head_salesman_name`. `app/lib/salesHierarchy.js` walks that chain. Customer book shares are a real table (`customer_book_shares`) plus hardcoded pairs in `app/lib/mutualSalesmanGroups.js`. Selective per-customer shares use `customer_shares` (viewer profile + customer code) without changing ownership.

`collection_only` in user metadata forces the collector module set even if `profiles.role` is something else.

## Sales scope

`GET /api/user/sales-scope` (and `app/lib/salesScope.js`) builds the list of salesman codes a user may see, plus `sharedCustomerCodes` from `customer_shares` for the caller. Downstream routes call helpers such as `ensureCustomerVisibleToScope` (`app/lib/customerAccess.js`). A customer is visible when any of these is true:

- The caller has all-access (admin/manager paths inside the scope builder).
- `current_salesman_code` or `previous_salesman_code` matches the scope (assignment helpers).
- The customer code is in the caller’s selective `customer_shares` list (`sharedCustomerCodes`).
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

Outstanding customer sheets and the receipt register are parsed and stored as JSON settings (`outstanding_customerwise_dataset_v1`, `receipt_register_dataset_v1`). When that outstanding workbook has invoice or row data, Payment Collections uses it and does **not** merge `public.invoices` (that merge reloaded every open invoice on each queue fetch). `readOutstandingInvoicesFromTable` in `app/api/payment-collections/route.js` runs only when no workbook has been uploaded. Receipt uploads accept an optional `includePaymentVouchers` flag so Payment Register rows (Dr) for dual customer/supplier parties merge as **negative** receipt amounts into the same dataset used by FIFO settlement.

After a sales import, the BI cube and the daily supplier-order email can rebuild or send. Those side effects live in `app/api/import-sales/route.js`.

## Offline and mobile cache

Field phones cache scope, prices, and customer payloads (`app/lib/mobileDataCache.js`, `offlineDataRefresh.js`, `localDataStore.js`). `/api/mobile-snapshot` and `/api/cron/mobile-snapshot` rebuild snapshots. `/api/offline-data-version` exposes a version key so clients know when to refresh. Queued field writes use `app/lib/offlineSyncQueue.js` via `postJsonResilient` / `postFormDataResilient` / `sendJsonResilient`, which **default to `queueFirst: true`** so collections, visits, orders, stock take, and prospects save on-device first and sync in the background. Sales order numbers are allotted offline per salesman (`app/lib/offlineOrderNumber.js`) and persist unchanged through sync. Collection visit saves carry a `clientSubmissionId` form field generated before queueing (`app/lib/collectionSubmission.js`); it is stored with the queued fields in IndexedDB, so every retry and post-restart sync replays the same id. `POST /api/payment-collections` looks it up (scoped to `created_by`) before validation and uploads and returns the existing visit (`duplicate: true`) instead of inserting again; a concurrent unique violation is resolved the same way. Requests without the field (older queued items) and databases without the column keep the old insert path.

Do not assume a page always has a live network read. Several screens render from cache and then refresh. Payment Collections reloads the queue on the browser `online` event when the last load left an error, an offline banner, or an empty device queue — reconnect must not wait for pending sync to drain, or a brief offline miss can leave “No saved collection queue” up under an Online status bar.

## GPS

- Background and idle pings: `app/lib/nativeFieldTracking.js` and `POST /api/gps-ping`. Pings are `daily_activity_logs` rows with `entry_type = GPS_PING` and a JSON note. They are allowed only inside an open KSA work session (after morning attendance, before end of day).
- Salesman home points are stored on `profiles` and shown in the Daily Visit Report and its email. A database trigger rejects login/logout attendance within 500 m of the user's home, and another prevents customer pins within 25 m of any saved home point. Shared customer GPS writes also check the actor's 500 m home radius, including automatic visit promotion and imports. Saving a home from Salesman Hierarchy clears pins within 25 m through the audited GPS-history helper.
- Customer coordinates: `PATCH /api/customers/location` updates `customers.latitude/longitude` and the GPS audit columns, and inserts `customer_gps_history`. Field visits auto-promote GPS onto the customer when none is saved yet — server-side in `/api/visit-reports` and collection saves (`promoteEntryGpsToCustomerIfMissing`), and client-side in `customerLocation.js`. Outstanding Without GPS also backfills from `visit_report_latest` / collection visit GPS when the master pin is still empty. Far-from-saved still prompts. Pins within 50 m of the fixed MADIBA store or 25 m of any saved home are rejected (`customerGpsWriteGuard.js`, `/api/customers/location-write-check`); the field UI warns that GPS is for the report only and does not save the customer pin. Store-side activity GPS is labeled and marked FAR on Daily Visit Report.
- Collection visits store their own lat/long on `collection_visits` when those columns exist.
- Daily Visit Report associates accepted GPS-update prompts with the visit: My Day stores the acceptance in its activity-note JSON, collection saves link a GPS activity note by visit id, and older accepted overwrites are recognized from matching `customer_gps_history` rows. These visits show an accepted-update label and are excluded from Far status/counts; no new database column is required.
- Invoice makers and admins do not run the background GPS tracker (`shouldEnableBackgroundGps`).

## Reporting pipeline

- Customer cohort aggregation accepts `period: "month"` for the monthly matrix. The protected customer-growth payload includes `customerCohorts` and `customerMonthlyCohorts`, derived from the same full-history rows. Quarter/Month switching is client-side and exports the selected grid. Dates choose whole column periods; purchase sets are not trimmed by partial dates or year/month filters. No new endpoint, dataset key, or migration.

BI pages call `/api/business-dashboard`, `/api/business-dashboard/overview`, `/api/business-dashboard/category-growth`, and `/api/business-dashboard/receivable-days`.

- Opening the BI Dashboard tab uses one `/api/business-dashboard/overview` request (`loadBiOverviewBundle`) that loads the prepared cube once and builds category, customer, item, and salesman slices together. Overview skips customer cohort matrices and per-slice catalogs except on the category pass (sales mix is included there). Individual report tabs load `/api/business-dashboard/category-growth` on demand and reuse overview payloads when the filter cache key still matches; Customer Growth still refetches so cohort matrices are attached. Cube freshness checks that find the model current are remembered in-process for about 60 seconds to avoid repeating import/profit probes on every tab open.
- Customer retention is a bilingual quarterly cohort matrix at the top of BI Customer Growth. `app/lib/customerCohorts.js` fixes first-invoice quarters from full active-upload history before applying filters; the protected category-growth loader attaches `customerCohorts` from prepared cube rows or paginated `active_sales`. The matrix follows customer-applied field filters and the global BI period; client search/signal filters apply only to the existing growth report. `CustomerCohortReport.jsx` uses colored BI tables and Excel export with count-only or count-plus-retention-% cells such as `70 (70.0%)`. No additional scan, endpoint, settings key, or database migration.

- Facts come from `active_sales` (including `profit_amount` when the column exists).
- `/api/performance` reuses per-month actuals and each salesperson's three-month pace curve stored at `system_settings.performance_kpi_actuals_v2:<month-start>` (cache version 4, including the latest current-month sales date used for sales pace). Sales-upload completion and collection-visit saves rebuild the current month's cache in post-response work. Each request still performs authentication/scope checks and reads current KPI targets; a missing, version-mismatched, or batch-mismatched cache is rebuilt on demand. Cache values contain calculated actuals/pace, not transaction-detail rows; details remain loaded by the separate scoped KPI details API.
- The Business Intelligence Sales mix tab compares monthly cash/credit and local/import invoice sales from additional measures in `sales_bi_cube_v1`; it uses the current BI date filters, excludes credit notes/returns, and has no new endpoint or database schema requirement. The cube version is bumped so an older prepared model rebuilds with the new measures.
- The Business Intelligence **Receivable days** tab loads `/api/business-dashboard/receivable-days` (`loadReceivableDaysReport`). Each month uses the last Tally outstanding workbook imported in that KSA month. The live dataset `outstanding_customerwise_dataset_v1` supplies the current month; earlier months are parsed from stored files under `upload-files/outstanding/`. Monthly credit sales come from the prepared cube. Results are cached in `receivable_days_monthly_v1` keyed to the outstanding file list, sales batch, and KSA as-of date. No migration.
- The Business Intelligence MADIBA tab uses the existing category-growth API with an item-name filter on the monthly cube (or its live-sales fallback). It presents category and matching item trends using the shared period and sales/profit controls; no new table or endpoint is required.
- MADIBA category GP % grids pair the prepared sales and profit measure groups by category in `app/lib/madibaBrandGp.js`; they keep the existing quarterly/monthly windows and table filters without another API request.
- `app/lib/salesBiCube.js` aggregates monthly facts. The compact cube is stored at `sales_bi_cube_v1`. Version constant is `SALES_BI_CUBE_VERSION` (currently 6). A rebuild is required when profit data appears or the import time changes.
- Optional table `sales_bi_monthly` is created only by `sql/setup_sales_bi_monthly.sql`. The app is written to keep working from the settings blob if the table is absent.
- Period presets are `app/lib/biReportPeriod.js` (`mtd`, `qtd`, `ytd`, last month, last 3/6/12 months, custom).
- Month-over-month coloring is `app/lib/salesmanMom.js` and `categoryGrowth.js`. Current incomplete month is not treated as a closed comparison month.
- Tables must keep the colored header, zebra rows, up/down/current cell classes, and a total column or footer.

## Attachment storage

Business routes never call Supabase Storage for attachment files. Server-only modules in `app/lib/storage/`:

- `attachmentKeys.js` — object keys `<bucket>/<path>` (existing Supabase layouts kept), legacy URL/path parsing.
- `attachmentStorage.js` — facade `putObject` (no overwrite, returns size/sha256/md5), `writeAttachmentObject` (primary/fallback/dual-write), `getObject`, `headObject`, `getSignedReadUrl` (default 300 s, max 900 s); `deleteObject` throws. Providers: `providers/supabaseProvider.js` (default) and `providers/r2Provider.js` (Cloudflare R2 via `aws4fetch` SigV4, private S3 API endpoint, `If-None-Match: *`, `x-amz-content-sha256`, metadata limited to `sha256`/`category`/`entity-type`). `r2Guard.js` validates R2 config and blocks the production bucket outside Vercel production + production Supabase.
- Write provider comes from `ATTACHMENT_WRITE_PROVIDER` (only an explicit `r2` selects R2; default Supabase with legacy key layout). In R2 mode keys are immutable (`…/{yyyy}/{mm}/{CUSTOMER}/{yyyymmdd}-{uuid}.{ext}`, `…/{timestamp}-{uuid}-{name}`); if R2 fails the same key is written to Supabase and the `attachments` row records `supabase`; with `ATTACHMENT_DUAL_WRITE=1` a best-effort Supabase copy is written at the same key after R2 succeeds (failures logged, save continues). If the attachments table is missing, R2 mode writes Supabase. Reads always use the row's `storage_provider`; `verified_at` does not choose the provider. The manual verify-collection-uploads cron stamps `verified_at` on a dated receipt or payment row only after the R2 object matches that row's checksum, size, content type, and key. `ATTACHMENT_FORCE_SUPABASE_READS=1` remains the rollback switch for invoices and customer documents. Receipt and payment copies ignore that switch, are not written to Supabase when R2 fails, and return a not-available error when the R2 object is missing. Historical receipt and payment copies keep their flat Supabase paths (`receipt-copies/<filename>`, `payment-copies/<filename>`) and the same key in R2. After the byte check, only those flat verified rows change `storage_provider` from `supabase` to `r2`. Visits that have only `receipt_copy_url` or `payment_copy_url` open from R2 when the copy manifest stored the same checksum for that flat filename in both `verified` and `reconciled`. The database URL is not rewritten. A missing R2 object falls back to the Supabase original after authorization. Invoices, customer documents, and catalogue photos are unchanged.
- `attachmentRecords.js` — `storeAttachment` (upload + `attachments` row), owner linking, queue-safe visit summaries, `readOrderInvoiceFile` (prefers `invoiceAttachmentId`, falls back to `invoiceFilePath`) used by invoice comparison, prospect linking and the supplier email.
- `attachmentAccess.js` — resolves the owner and authorizes reads (collection scope / `canSeeOrder` / sales customer scope).

`GET /api/attachments/<uuid>/url` and `GET /api/attachments/legacy/url?kind=receipt_copy|payment_copy|order_invoice|customer_document&ref=<owner id>` authenticate the bearer token, authorize, then return a short-lived signed URL (`Cache-Control: private, no-store`). Clients use `app/lib/openAttachment.js`, which opens a placeholder tab synchronously (iOS popup rules) or an anchor in the Capacitor shell. Bucket provisioning is `ensureAttachmentBucket` → `supabaseProvider.ensureBucket`: a missing bucket is created **private**; an existing bucket is never updated, so no upload can change its privacy. No app code builds `/storage/v1/object/public/...` URLs; historical public URLs are only parsed into bucket/path and signed.

## Collections architecture

`/api/payment-collections` builds queues from the outstanding dataset, customer master, and `collection_visits`. Priority scoring is `buildCollectionPriority` in `app/lib/paymentCollections.js`. Legal escalation is `legal_transfers`. `GET ?customer_code=` can inject a zero-outstanding **advance** queue row for a sales-scope customer missing from the outstanding file so Funds Received can still be uploaded; `POST` uses the same sales-scope fallback via `resolveCollectionSaveCustomerCode`. Files go to the `payment-collections` storage bucket. Visit saves (including Funds Received attachments) are offline-first (`queueFirst`): files serialize into IndexedDB only for the local queue, then sync uploads multipart with MIME re-resolved for Android. Client photo prep (`prepareUploadFile`) is time-bounded so Android camera HEIC/JPEG cannot leave Saving stuck. Client save enrichment uses cached queue `avg_days_to_pay` and skips the activity timeline (`skipTimeline`); the API recomputes visit-distance lines with the service role on sync.

The collections UI was split so a background queue refresh does not remount the open visit form. Do not tie a full page reload to that refresh (see the fix in PR #313).

## Invoice office flow

`/api/order-invoice` reads and writes `order_invoice_meta:<id>`. Status strings are constants in `app/lib/orderApproval.js` (for example `Pending for invoice creation`, `Invoice made`). Uploading a PDF sets status to `Invoice made` when the upload exists. PDFs over `MAX_ORDER_INVOICE_UPLOAD_BYTES` (4 MB) are rejected so the request stays under Vercel's serverless body limit. After the upload response is returned, `after()` runs `sendInvoiceUploadNotification` (order-copy + invoice PDFs to the uploader, salesman, direct boss, and `iliyas.belliyaru@noorshukran.com`) so SMTP/Resend cannot time out the browser as `Failed to fetch`. `/api/cron/invoice-upload-email-test` resends the latest (or a chosen) upload for manual checks. Mail failures do not roll back the upload. Time-to-make runs only while status is still the pending-invoice queue (`app/lib/pendingOrderTimeToMake.js`).

`/api/cron/missing-invoice-email` checks submitted orders created on or after `2026-09-01` that still have no invoice one hour after creation. It emails every 15 minutes from 08:00–20:00 India time while Pending for approval or Pending for invoice creation orders remain; Soyeb and Fazlur get one end-of-day summary only. Otherwise it sends one operational summary at KSA midnight. The cycle skips Friday in India office time (`Asia/Kolkata`) before syncing cron credentials, loading orders, or sending mail, so both pg_cron and the GitHub Actions backup are covered. Orders created before that KSA cutoff are legacy and can be auto-rejected as `Rejected by management` with reason `Pre-September 2026 — invoice not uploaded`.

## Scheduled work

Vercel deploys production from `main` only (`vercel.json` `git.deploymentEnabled`); Preview deployments are intentionally off. Vercel cron (`vercel.json`) calls `/api/cron/inactivity-push` every 10 minutes. GitHub Actions workflows call the same style of endpoint with `x-cron-secret`. Schedules are listed in `docs/DEPLOYMENT.md`. Handlers live under `app/api/cron/`.

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
- Order PDF / WhatsApp file share on Android use `@capacitor/filesystem` + `@capacitor/share` (`app/lib/orderPdfExport.js`, `app/lib/whatsappShare.js`). Both are listed in `android/capacitor.settings.gradle` / `android/app/capacitor.build.gradle`. `npm run cap:sync` (CI Android APK job) regenerates `capacitor.plugins.json`. Before calling native write/share, the web app checks `Capacitor.isPluginAvailable`; if Filesystem/Share are missing (outdated APK), it falls back to browser download / Web Share instead of showing `"Filesystem" plugin is not implemented on android`. Collection WhatsApp shares send the payment/receipt file with the summary. Android's share plugin types several files as `*/*`, which makes WhatsApp keep only the text, so multiple photos are stacked into one JPEG before the native share. Android Chrome drops files when text is included, so that path shares the files and leaves the summary on the clipboard. If file share still fails, WhatsApp opens with the summary text (`fallback: true`) and the UI asks the user to attach photos manually.
- Tracking: `app/lib/nativeFieldTracking.js` + `app/components/NativeFieldTracking.jsx`. Foreground service notification, idle GPS after 15 minutes without transaction activity, check cycle every 5 minutes while the process runs. Pings pause during lunch and after end of day.
- Push: device tokens in `device_push_tokens`; server FCM via `FIREBASE_SERVICE_ACCOUNT_JSON` and `app/lib/fcm.js`. Without Firebase server config, local inactivity alerts can still work; remote push does not.
- Minimum APK: env + `system_settings.android_apk_min_version_v1`.
- Operator guide: `ANDROID_APK.md` (battery unrestricted required before login, location all-the-time, Play internal testing, GitHub APK workflow).

Do not change Capacitor app id, tracking intervals, or battery/login gates unless the task explicitly asks for it.
