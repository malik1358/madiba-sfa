# Project overview

MADIBA SFA is an internal sales-force application for a KSA distribution business. Field users record attendance, visits, orders, collections, and GPS. Office users approve orders, upload Tally/Excel datasets, and read management reports. The live UI is a Next.js app on Vercel. The Android app is a Capacitor shell around that site (`capacitor.config.js` loads `https://madiba-sfa.vercel.app` unless `CAPACITOR_SERVER_URL` is set).

This document was written from the repository (handover branch including docs through 2026-09-21). It does not describe a database that was queried live. Schema details come from `supabase/migrations/` and `sql/`. See `docs/CHANGELOG_AI.md` → “Incomplete repository evidence” for known gaps.

## Users and roles

Roles are stored on `public.profiles.role` and normalized in `app/lib/moduleAccess.js`.

| Role | What they are for |
| --- | --- |
| `admin` | Full setup, imports, BI, all customers. No morning-attendance or background-GPS gate. |
| `manager` | Same management modules as admin for most screens. Not `is_admin()` in SQL. |
| `salesman` | Own book: My Day, customers, orders, collections, performance. |
| `invoice-maker` or `invoice_maker` | Office invoicing. Can manage invoice status and view all management reports. GPS is not required, but morning attendance is. Setup/configuration and report email sending remain separately gated. |
| `product-promoter` or `product_promoter` | Field selling plus GPS map. |
| `collector` | Collections-focused. Also inferred when `user_metadata.collection_only` is set or `salesman_code` matches `CL` plus digits. |

`is_management()` in SQL is `admin`, `report-user`, and `manager` after the report-user migration. Invoice makers are not management in row-level security even though the app gives them several admin screens.

Screen access is `buildModuleAccess`, optionally overridden by the admin **Role Access** matrix (`/management/role-access`, `system_settings.role_module_access_v1`). Pinned home shortcuts are `PINNED_MODULE_KEYS`. Collectors punch morning attendance through a blocking overlay on collection routes instead of being redirected to My Day (`app/lib/morningAttendance.js`, `app/components/MorningAttendanceRedirect.jsx`).

## Main screens

Routes live under `app/management/`. Labels are in `MODULES` inside `app/lib/moduleAccess.js`.

- **My Day** (`/management/my-day`): attendance punches, visit list, priorities.
- **Customers Audit** (`/management/customer-audit`): customer history, orders, settlement, visits.
- **New Order** and **Visit Without Order**: field transactions.
- **Product Catalogue** (`/management/product-catalogue`): ecommerce-style cards with code/name, wholesale/retail city prices, AM-sheet packing, and a photo carousel. Only positively priced items appear. Search scoped customers or select from the nearest three; up to three never-bought New Items appear first after history loads. Top Cash/Credit controls preview cash and qualifying volume discounts beside struck-through base prices. Field users prepare/save/submit through the same New Order workspace; pricing mode stays consistent in drafts/PDFs/WhatsApp. Admin/manager photo previews are temporary and unsaved; permanent storage remains deferred to the receipt/image-storage setup.
- **Old Pending Orders**: invoice workflow for submitted orders.
- **Payment Collections** and **Collection Report**: outstanding queues and visit capture. `/management/my-collections` still resolves for users who can open Payment Collections, but `myCollections` is not a separate enabled module.
- **Payment Settlement** and **Outstanding Compare**: FIFO cash application versus the Tally outstanding file.
- **Business Intelligence**: category growth, salesman month-over-month, period filters.
- **Promoter Coverage** (`/management/promoter-coverage`): all authenticated roles can select a product promoter and review that promoter's head-team customer book, 12-month visit coverage, repeat visits, and six completed months of customer sales.
- **Salesman Incentive**: monthly incentive from collection speed (35/60-day buckets for office supplies, electronics and other categories, 3-day window for cash deals) plus 0.5% on the sales increase over last month.
- **Customer Master**, **Salesman Hierarchy**, **Customer Book Shares**, **KPI Targets**, **Schemes**, **Sales Qty Limits**, **Role Access**, **Imports**.
- **Stock Take**: only when `profiles.stock_take_access` is true, or the user is admin.
- **GPS Map**, **Outstanding Without GPS**, **Daily Visit Report**, **User Activity**, **Working Hours**, **Item Price History**, **Receipts Not in Tally**.
- **Customer GPS History** (`/management/customer-gps-history`, module `customerGpsHistory`): admin/manager only. Date-filtered, paginated history shows old/new coordinates and maps, displacement in meters, save actor/time in KSA, and explicitly recorded approval. Excel export covers the displayed page only. A daily digest of salesman-accepted changes goes to `malik@pinasz.com` by default at 00:40 KSA, including Friday and zero-change days.
- **Potential Sales Targets** (`/management/potential-sales-targets`): independent, exportable report of active customers with qualifying outstanding. Filter by visible salesman; rows show last visit by that salesman, latest order/invoice, monthly net sales for the three latest completed KSA months and current month-to-date.

The home page (`app/page.js`) is email/password login, then a dashboard with nearest customers when GPS is available.

## Languages

UI strings are English and Arabic through `app/lib/appLanguage.js`. `profiles.preferred_language` allows `en` or `ar`. The HTML root sets `translate="no"` so browser translation does not rewrite the app.

## External systems

- **Supabase**: Auth, Postgres, Storage.
- **Tally / Excel**: sales, outstanding, receipts, item units, and customer locations are uploaded or imported. The app does not post back into Tally except by Excel export (`tallyItemUnits.js`, order Excel export).
- **Price catalog**: a scheduled sync writes `price_catalog_cache`. The browser reads `/api/pricing/cache`, not the upstream sheet.
- **Firebase Cloud Messaging**: server push via `FIREBASE_SERVICE_ACCOUNT_JSON` and `app/lib/fcm.js`.
- **Email**: SMTP or Resend (`app/lib/mailer.js`) for visit reports, inactivity, missing invoices, supplier orders, salesman resume, outstanding-without-GPS, and the visit-plan digest.
- **WhatsApp**: the app builds share text and links. It does not call the WhatsApp Business API.

## How a field day works

1. User signs in with Supabase Auth.
2. Every non-admin role must record `MORNING_ATTENDANCE` in `daily_activity_logs` for the current KSA date before using the app. Other routes redirect to My Day; collection routes show a blocking Morning Attendance overlay so collectors punch in there.
3. Visits, orders, prospects, and collections write activity rows. Those rows reset the 45-minute inactivity warning.
4. GPS pings during an open work session are stored as `GPS_PING` notes. Customer coordinates are updated through the location API and `customer_gps_history`.
5. Lunch is `LUNCH_BREAK_OUT` / `LUNCH_BREAK_IN`. End of day is `END_OF_DAY`. A cron auto-closes workdays that were left open.
6. Orders are `sales_orders` plus `sales_order_items`. Invoice progress is JSON under `order_invoice_meta:<order id>` in `system_settings`.

## Reporting in one paragraph

Management BI reads the active sales batch (`active_sales`), optionally a monthly cube (`sales_bi_cube_v1` and, if created, `sales_bi_monthly`). When an outstanding workbook has been uploaded, collection queues read that JSON in `system_settings` and do not merge the `invoices` table. Settlement recomputes open balances with FIFO from sales and receipts (`app/lib/paymentBehavior.js`) and shows that next to Tally’s open amount. Do not collapse those two numbers into one.

## Docs in this handover

These files are the shared memory for **Cursor and GitHub Copilot**. Read them at the start of every task. Update them when you change behavior, schema, roles, reporting, or deployment. Do not leave the next agent on either tool with stale rules.

- `docs/ARCHITECTURE.md` — runtime structure
- `docs/DATABASE.md` — tables, views, settings, storage
- `docs/BUSINESS_RULES.md` — rules that change user-visible results
- `docs/DEPLOYMENT.md` — Vercel, GitHub Actions, Android, env names
- `docs/CHANGELOG_AI.md` — decisions, known drift, do-not-touch areas, dated agent notes

Older notes `README.md`, `ANDROID_APK.md`, and `COLLECTOR_SCREEN_SETUP.md` are still in the repo. `COLLECTOR_SCREEN_SETUP.md` is partly stale. See `docs/CHANGELOG_AI.md`.

## Suggested first prompt for a new agent

Read `.github/copilot-instructions.md`, `AGENTS.md`, and all files under `/docs`. Then inspect the repository structure and relevant source code.

Do not make any changes yet.

Tell me your understanding of:

1. application purpose
2. architecture
3. Supabase/database structure
4. main business rules
5. reporting logic
6. deployment setup
7. any inconsistencies between the documentation and actual code.

After that session, keep reading and updating these files as Cursor and Copilot continue development.
