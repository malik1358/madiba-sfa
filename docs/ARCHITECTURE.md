# Architecture

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

Navigation groups are Home, Field Sales, Collections, Reports, Warehouse, and Setup & Admin (`NAV_GROUPS` in `app/lib/moduleAccess.js`).

## Role system and `moduleAccess.js`

Source of truth: `app/lib/moduleAccess.js` (covered by `tests/moduleAccess.test.mjs`).

- `normalizeAccessRole` lowercases and turns `_` into `-` (`invoice_maker` → `invoice-maker`).
- `isCollectionOnlyAccess`: role `collector`, or `collection_only` metadata, or salesman code matching `/^CL\d+$/i`.
- `isFieldSales` for module flags: salesman, manager, admin, invoice-maker, or product-promoter (collectors are then excluded from field modules).
- GPS helpers: `shouldRequireTransactionGps` (false for invoice makers), `shouldRequireGpsAccessGate` (false for admin/manager), `shouldEnableBackgroundGps` (false for admin and invoice makers).
- Invoice management: `canManageOrderInvoice` for invoice-maker, admin, manager.
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
| collectionReport, receiptsNotInTally, userActivity | Y | Y | | Y | | |
| dailyVisitReport | Y | Y | Y | Y | | |
| businessDashboard, customerMaster, outstandingNoGps, customerBookShares, kpiTargets, schemes, orderQuantityControls | Y | Y | | | | |
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

**Admin / imports / BI**

- `/api/import-sales`, `/api/upload-files`, `/api/pricing/cache`, `/api/admin/price-sync`
- `/api/business-dashboard`, `/api/business-dashboard/category-growth`
- `/api/admin/customers`, `.../export`, `.../locations`, `.../gps-history`
- `/api/admin/salesmen-hierarchy`, `/api/admin/customer-book-shares`, `/api/admin/kpi-targets`
- `/api/admin/schemes`, `/api/admin/order-quantity-controls`, `/api/admin/item-price-history`
- `/api/admin/salesman-visit-plan`, `/api/admin/outstanding-no-gps`, `/api/admin/clean-dirty-customers`
- `/api/admin/push-notifications`, `/api/tally-item-units`, `/api/stock-take`

**Mobile / config / activity**

- `/api/mobile-snapshot`, `/api/offline-data-version`, `/api/push-tokens`
- `/api/app-config`, `/api/build-info`, `/api/user-activity`
- `/api/daily-visit-report`, `/api/daily-visit-report/email`, `/api/inactivity-email-log`

**Cron** (`app/api/cron/*`, auth via `CRON_SECRET`)

- `inactivity-push`, `auto-close-workdays`, `daily-visit-report-email`, `daily-salesman-resume-email`
- `daily-supplier-order-email`, `outstanding-no-gps-email`, `missing-invoice-email`
- `salesman-visit-plan-email`, `mobile-snapshot`

## Authentication

1. Home page signs in with `supabase.auth.signInWithPassword`.
2. Profile row is `public.profiles` where `id` is `auth.users.id`.
3. `app/lib/authSession.js` caches the session for a few seconds and times out slow `getSession` calls.
4. API routes expect `Authorization: Bearer <access token>`, then `auth.getUser`.
5. Cron routes use `app/lib/cronAuth.js`: `Authorization: Bearer <CRON_SECRET>` or header `x-cron-secret`. If `CRON_SECRET` is empty, cron calls are rejected.
6. Android login can be blocked by a minimum APK version (`app/lib/androidAppVersionPolicy.js`, setting `android_apk_min_version_v1`, env `MIN_ANDROID_APK_VERSION_CODE`).
7. Android also gates login/morning attendance on unrestricted battery (`app/lib/androidBatteryOptimization.js`, details in `ANDROID_APK.md`).

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

New field orders go to `sales_orders`. Invoice status is not a column on that table. It is `system_settings.setting_key = order_invoice_meta:<id>`.

## Imports and the active batch

`/api/import-sales` loads an Excel sales file into `sales_raw` under a new `import_batches` row, then activates it. `activate_sales_batch` archives the previous `ACTIVE` batch and sets `system_settings.active_sales_batch_id`. The view `public.active_sales` is that batch only.

Outstanding customer sheets and the receipt register are parsed and stored as JSON settings (`outstanding_customerwise_dataset_v1`, `receipt_register_dataset_v1`). When that outstanding workbook has invoice or row data, Payment Collections uses it and does **not** merge `public.invoices` (that merge reloaded every open invoice on each queue fetch). `readOutstandingInvoicesFromTable` in `app/api/payment-collections/route.js` runs only when no workbook has been uploaded.

After a sales import, the BI cube and the daily supplier-order email can rebuild or send. Those side effects live in `app/api/import-sales/route.js`.

## Offline and mobile cache

Field phones cache scope, prices, and customer payloads (`app/lib/mobileDataCache.js`, `offlineDataRefresh.js`, `localDataStore.js`). `/api/mobile-snapshot` and `/api/cron/mobile-snapshot` rebuild snapshots. `/api/offline-data-version` exposes a version key so clients know when to refresh. Queued orders use `app/lib/offlineSyncQueue.js`.

Do not assume a page always has a live network read. Several screens render from cache and then refresh.

## GPS

- Background and idle pings: `app/lib/nativeFieldTracking.js` and `POST /api/gps-ping`. Pings are `daily_activity_logs` rows with `entry_type = GPS_PING` and a JSON note. They are allowed only inside an open KSA work session (after morning attendance, before end of day).
- Customer coordinates: `POST /api/customers/location` updates `customers.latitude/longitude` and the GPS audit columns, and inserts `customer_gps_history`.
- Collection visits store their own lat/long on `collection_visits` when those columns exist.
- Invoice makers and admins do not run the background GPS tracker (`shouldEnableBackgroundGps`).

## Reporting pipeline

BI pages call `/api/business-dashboard` and `/api/business-dashboard/category-growth`.

- Facts come from `active_sales` (including `profit_amount` when the column exists).
- `app/lib/salesBiCube.js` aggregates monthly facts. The compact cube is stored at `sales_bi_cube_v1`. Version constant is `SALES_BI_CUBE_VERSION` (currently 4). A rebuild is required when profit data appears or the import time changes.
- Optional table `sales_bi_monthly` is created only by `sql/setup_sales_bi_monthly.sql`. The app is written to keep working from the settings blob if the table is absent.
- Period presets are `app/lib/biReportPeriod.js` (`mtd`, `qtd`, `ytd`, last month, last 3/6/12 months, custom).
- Month-over-month coloring is `app/lib/salesmanMom.js` and `categoryGrowth.js`. Current incomplete month is not treated as a closed comparison month.
- Tables must keep the colored header, zebra rows, up/down/current cell classes, and a total column or footer.

## Collections architecture

`/api/payment-collections` builds queues from the outstanding dataset, customer master, and `collection_visits`. Priority scoring is `buildCollectionPriority` in `app/lib/paymentCollections.js`. Legal escalation is `legal_transfers`. Files go to the `payment-collections` storage bucket. Visit saves (including Funds Received attachments) are offline-first (`queueFirst`): files serialize into IndexedDB only for the local queue, then sync uploads multipart with MIME re-resolved for Android. Client photo prep (`prepareUploadFile`) is time-bounded so Android camera HEIC/JPEG cannot leave Saving stuck. Client save enrichment uses cached queue `avg_days_to_pay` and skips the activity timeline (`skipTimeline`); the API recomputes visit-distance lines with the service role on sync.

The collections UI was split so a background queue refresh does not remount the open visit form. Do not tie a full page reload to that refresh (see the fix in PR #313).

## Invoice office flow

`/api/order-invoice` reads and writes `order_invoice_meta:<id>`. Status strings are constants in `app/lib/orderApproval.js` (for example `Pending for invoice creation`, `Invoice made`). Uploading a PDF sets status to `Invoice made` when the upload exists. Time-to-make runs only while status is still the pending-invoice queue (`app/lib/pendingOrderTimeToMake.js`).

`/api/cron/missing-invoice-email` chases submitted orders created on or after `2026-09-01` that still have no invoice one hour after creation. Orders created before that KSA cutoff are legacy and can be auto-rejected as `Rejected by management` with reason `Pre-September 2026 — invoice not uploaded`.

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
