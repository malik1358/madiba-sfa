# Business rules

> AI agent handover — roles, workday, KPIs, dashboard alerts, settlement, GPS, and collections.

Rules below are implemented in code. If a screen disagrees with this file, trust the code and update this file. Amounts and dates are KSA (`Asia/Riyadh`) unless a job comment says the window is India time.

## Roles and gates

- `buildModuleAccess` in `app/lib/moduleAccess.js` decides every management screen. Do not hide a page only with CSS.
- Collector access is true when role is `collector`, or `user_metadata.collection_only` is set, or salesman code matches `/^CL\d+$/i`.
- Morning attendance is required for every role except `admin` and invoice makers (`isMorningAttendanceRequiredForRole`). Until today’s `MORNING_ATTENDANCE` exists, routes other than `/`, My Day, Visit Without Order, and the payment-collection paths redirect. Collections are exempt so collectors do not loop.
- GPS for transactions is required for every role except invoice makers. The access gate skips admin and manager. Background GPS is off for admin and invoice makers.
- Stock take is admin or `profiles.stock_take_access === true`.
- Salesman visit plan is on for field roles unless `NEXT_PUBLIC_SALESMAN_VISIT_PLAN_SALESMAN_ACCESS` is `0`, `false`, or `no`.
- `is_management()` SQL does not include invoice makers, collectors, or product promoters.

## Workday and attendance

Engine: `app/lib/workdayActivity.js`. Do not change thresholds in a page without updating this module and `tests/workdayActivity.test.mjs`.

Constants:

- Timezone `Asia/Riyadh`. Working-hours helper is 06:00 inclusive through 22:00 exclusive (`WORKDAY_START_HOUR` / `WORKDAY_END_HOUR`).
- Inactivity warning: 45 minutes (`INACTIVITY_MS`) with no transaction entry. Prompt snooze is 5 minutes after show and 15 minutes after dismiss.
- Inactivity email: 70 minutes (`INACTIVITY_EMAIL_MS`), then another slot every 70 minutes (`inactivityEmailReminderSlot`). Not 40.
- Inactivity alert repeat: 15 minutes (`INACTIVITY_ALERT_REPEAT_MS`).
- Login reminder: 11:00 KSA, then every 30 minutes until morning attendance exists.
- Lunch punch reminder hour: 12:00 KSA (`LUNCH_PUNCH_REMINDER_HOUR`).
- Open lunch longer than 3 hours triggers `shouldSendLunchBreakReminder`.
- Background GPS idle threshold: 15 minutes (`BACKGROUND_GPS_IDLE_MS`).

Sessions (`isWithinActiveWorkSession`):

- No session without morning attendance (`loginAt`) or after `END_OF_DAY` (`logoutAt`).
- Morning session runs from login until `LUNCH_BREAK_OUT` (or all day if lunch was not punched).
- Lunch is not an active session (`isOnLunchBreak`).
- Afternoon session starts at `LUNCH_BREAK_IN` and runs until end of day.
- Status labels from `deriveActivityStatus`: `not_logged_in`, `ended`, `on_lunch`, `logged_in`, `active`, `idle`. Idle means an open session with no visit/order/collection (or login) inside 45 minutes. Past dates are not marked idle.

Transaction types that count as activity: `VISIT_REPORT`, `ORDER_DRAFT`, `ORDER_EDITED`, `ORDER_SUBMITTED`, `PROSPECT_FOLLOW_UP`, `NOTE`. GPS-only punches do not clear inactivity. Idle GPS also treats morning attendance, lunch punches, and end of day as activity timestamps (`IDLE_GPS_ACTIVITY_ENTRY_TYPES`).

Auto-close (`collectWorkdaysNeedingAutoClose`, `buildAutoCloseEndOfDayPayload`):

- A KSA day with `MORNING_ATTENDANCE` and no `END_OF_DAY` is closed once that day is in the past, or today at 23:59 KSA.
- The inserted row is `END_OF_DAY` with `autoClosed: true` and timestamp at 23:59:59.999 KSA (`ksaMidnightEndIso`).
- Client helper looks back 14 days. Server cron uses the same 14-day lookback in `autoCloseWorkdaysServer.js`.
- `activity_reminders_enabled` on the profile can suppress reminders. Default is true.

## KPI calculations

Pure rules: `app/lib/performanceKpis.js`. Database reads: `app/lib/performanceKpisServer.js`. Change both together. Tests: `tests/performanceKpis.test.mjs`.

- Pace prefers the historical day-share curve (`averageCumulativeDayShares` / `expectedPacePercent`). Positive sales by calendar day are turned into a cumulative share of that month, then averaged across months. If no historical share exists, pace falls back to KSA workday progress (`ksaWorkdayProgressRatio`).
- `isKsaWorkday` treats weekday 5 and 6 (Friday and Saturday on the UTC calendar date of the ISO string) as non-workdays.
- A personal salesman curve wins over the company curve when `pickSalesmanPaceShares` finds one (`loadSalesPaceShares`).
- Achievement is actual / target. No target means status `no_target`. At or above 100% is `achieved` (green). Gap of at least +1 point versus expected pace is `ahead`. Gap greater than -1 and less than +1 is `on_pace`. Worse than that is `behind` (red).
- New vs repeat (`classifyBuyingCustomers`): a customer code with sales this month is repeat if that code also appears in the prior-customer set; otherwise it is new. Counts are distinct codes, not invoice counts.
- Team view (`consolidatePerformanceSnapshots`, `TEAM_PERFORMANCE_VIEW = "TEAM"`) sums member actuals. Targets are the explicit team target row when any display KPI target is greater than zero; otherwise member targets are summed. `memberCount` is the number of snapshots passed in.

## Business dashboard severity

`app/lib/businessDashboard.js` (`buildBusinessKpis`, `buildBusinessAlerts`). Tests: `tests/businessDashboard.test.mjs`.

KPI tile colors:

- Sales today, collected today, visit reports: green if greater than zero, otherwise orange.
- Draft orders: red at 20 or more, orange at 5 or more, else green.
- Field attendance: red below 60%, orange below 80%, else green.
- Idle now: red if any idle user, else green.
- Pending orders older than 7 days or 30 days: red at 1 or more.
- Outstanding above 90 days: red at 500,000 or more, orange at 250,000 or more.
- Sales MTD, collected MTD, total outstanding, route distance, and working hours stay neutral.

Alerts (`buildBusinessAlerts`), red before orange:

- Today, any field user without morning attendance: red `NOT_LOGGED_IN`.
- Today, any idle user (45+ minutes): red `IDLE_USERS`.
- Pending orders older than 30 days: red `PENDING_30D`. If none, pending older than 7 days: orange `PENDING_7D`.
- Outstanding upload older than 3 days: orange; older than 7 days: red (`OUTSTANDING_STALE`).
- Sales import older than 7 days: orange `SALES_IMPORT_STALE`.
- Collectors active today but zero collection visits: orange `NO_COLLECTION_VISITS`.
- Collection visits today but zero amount received: orange `ZERO_COLLECTION`.
- Attendance below 80% today: orange, or red if below 60% (`LOW_ATTENDANCE`).
- 10 or more draft orders: orange `DRAFT_BACKLOG`.
- Outstanding above 90 days of at least 500,000: red `HIGH_OVERDUE`.

## Customer identity and who can see them

- Compare customer and salesman codes with the same normalizer the caller already uses (trim, uppercase, collapse spaces). Leading-code extraction exists because some sheets store `CODE Name` in one cell (`extractLeadingCustomerCodeAndName`).
- A customer can remain visible to the previous salesman after transfer (`previous_salesman_code`).
- Mutual visibility is hardcoded in `MUTUAL_SALESMAN_GROUPS`: `JUNAID`, `PARVEZ`, `SOYEB` see each other’s books.
- One-way book shares are hardcoded in `SHARED_CUSTOMER_BOOKS` and can also be rows in `customer_book_shares`. Examples in code: Ahmed Nabil’s book is shared to Abdalla; Mohammed Mubeen’s book is shared to Moinudin Khaja and Junaid. Do not “clean up” these names as unused data.
- “Do not use” customers (name matches `/do\s*not\s*use/i`) are excluded from visit status.
- Building-material customers and items are filtered out of new-order item mixes (`app/lib/buildingMaterialCustomerFilter.js` and `customerEligibility.js`). Customer codes `1020C` and `1020` are excluded from that new-order path.
- Inactive customers who still have an outstanding balance are blocked from some visit flows (`CUSTOMER_INACTIVE_WITH_OUTSTANDING_ERROR` in `app/lib/outstanding.js`).

## Visits

- Visit outcomes on `visits.outcome` are constrained. Field reports in `system_settings` are the source Customer Audit and My Day read for the latest report (`visit_report_latest:<code>`).
- Visit plan (`app/lib/salesmanVisitPlan.js`): default 12 visits per salesman. System suggestions need at least 7 days since the last visit (`MIN_SYSTEM_VISIT_GAP_DAYS`). Appointments due today bypass that gap. Score mixes sales opportunity and collection opportunity. The page reads the stored snapshot `salesman_visit_plan_snapshot_v1`. The midnight KSA cron builds it. Email is off unless `SALESMAN_VISIT_PLAN_EMAIL_ENABLED` is true.
- WhatsApp visit text includes average days to pay (`app/lib/avgDaysWhatsapp.js`). That figure comes from the settlement rules below, not from a single stored column.

## Orders

- Live statuses on `sales_orders.status`: `DRAFT`, `SUBMITTED`, `CANCELLED`.
- Invoice statuses (strings, in settings JSON) are listed in `ORDER_INVOICE_STATUSES` in `app/lib/orderApproval.js`. Do not invent a new label in one screen only. Pending Orders, missing-invoice email, and time-to-make all compare these strings.
- `Pending for credit approval` is legacy and is treated like `Pending for approval`.
- Uploading an invoice PDF moves status to `Invoice made` when a file is stored. Setting `Invoice made` without a PDF is rejected.
- Time-to-make clock runs for `Pending for invoice creation` and stops when status leaves that queue. Show the live duration; do not freeze it at submit time.
- Order PDFs must show a mandatory `Order No.` label (`app/lib/salesOrderNumber.js`). Placeholder numbers are not acceptable on the PDF.
- Cash-discount breakdown is printed on pending-order PDFs. Do not drop it when editing the PDF builder.
- Orders created before the KSA day `2026-09-01` with no uploaded invoice are legacy and should be closed as `Rejected by management` / `Pre-September 2026 — invoice not uploaded`. Missing-invoice chase starts at `MISSING_INVOICE_CREATED_FROM = 2026-09-01`, after a 60-minute grace, and not more often than every 12 minutes.
- Credit approval (`app/lib/creditApproval.js`): cash orders skip it. Otherwise approval is required when outstanding over 60 days is greater than zero (buckets `61-90`, `91-120`, `>120`), or when order value plus total outstanding is over 10,000 and the credit application is missing or expired. Expired means expiry date is before today, or issue date plus one year is before today.
- Quantity caps live in `order_quantity_controls` (week window in Riyadh, customer scope). Defaults are in `DEFAULT_ORDER_QUANTITY_CONTROLS`. Enforcement is `assertOrderQuantityControls`.
- Schemes live in the `order_schemes` setting.

## Pricing

- Browser prices come from `price_catalog_cache` via `/api/pricing/cache`.
- Sync (`/api/admin/price-sync`) writes a snapshot and the cache, and appends `item_price_history` when a price changes. History UI shows at least the last five prices.
- VAT default on `products.vat_percent` is 15. Settlement line gross-up uses `regionalPricing.js` (category-aware), not a flat 15 for every line.
- Item master `tally_unit` / `tally_item_name` feed the Tally sales-voucher Excel export. Sources: `excel_import`, `invoice_pdf`, `manual`.

## Outstanding and collections

- Aging buckets: `0-30`, `31-60`, `61-90`, `91-120`, `>120`.
- The uploaded sheet is the operational outstanding book once it has been stored. Column detection is heuristic (`detectOutstandingColumnIndexes` in `app/lib/outstanding.js`). Do not replace it with a fixed column index. Payment Collections ignores `public.invoices` while that workbook has rows.
- Cash versus credit uses `ref_no` / cash markers (`invoiceHasCashRef`, `isInvoiceCashDue`).
- Queue priority uses exposure (amount and age), due state, last outcome, and scheduled revisits (`buildCollectionPriority`). Customers with a future scheduled revisit are not treated the same as overdue cash.
- A collection visit needs an Arabic or English remark for the outcomes/statuses listed in `collectionVisitRequiresRemark`.
- Salesmen named in `COLLECTION_QUEUE_EXCLUDED_SALESMEN` (`Zia`, `Asrar Ahmed`) are removed from the collection queue. This is a business filter, not dead code.
- Scheduled revisit dates are redacted for viewers who should not see another collector’s private schedule (`redactCollectionVisitScheduleForViewer`).
- Legal transfer removes the customer from the normal queue and lists them on `/management/payment-collections/legal`.
- Receipt copies and payment copies go to the `payment-collections` bucket. The save path must not hang when a Funds Received PDF is attached (that bug was fixed; keep the save path bounded).
- Receipts Not in Tally (`app/lib/receiptsNotInTally.js`) matches app collection receipts to the Tally receipt upload. Amount tolerance is 0.02. Default date window is 1 day. The UI allows a window up to 30 days. Do not raise that cap without checking the page and the API together.
- Collection report WhatsApp distance uses the same prior visits as the report. The service role recomputes distance because client RLS cannot see every previous row.

## Settlement and average days to pay

Implemented in `app/lib/paymentBehavior.js` and shown on Payment Settlement and Customer Audit.

- Machine Open is FIFO: sales minus cash applied to that invoice, then credit notes allocated to that invoice.
- Tally Open is the pending amount on the outstanding upload for that invoice. They are allowed to differ. Outstanding Compare and the Open delta exist to show the gap.
- Do not force FIFO open or paid to equal the outstanding file. Tests in `tests/paymentBehavior.test.mjs` lock this (including the case “open is FIFO residual, not outstanding 610”).
- Cash is applied oldest invoice first.
- Same-day or next-day credit notes (`IMMEDIATE_REVERSAL_MAX_DAYS = 1`) that match the invoice (amount and line fingerprint) are immediate reversals. They stay inside sales but are excluded from average days. They are not “payments”.
- A next-day **reissue** is not a reversal. Orphan credit notes that do not match an invoice reduce open balance rather than being dropped.
- Average days uses paid receipts first. Open invoices are included only when they are older than that paid average. Younger FIFO residuals are excluded.
- Partial credit notes and sales returns appear in the credit-note table, not as reversed invoices.
- Customer Audit loads history from day 1 through today for this ledger. Do not shorten that window or the FIFO result changes.
- Tolerance for amount matches is 0.02.

## Sales import and BI

- Only the active batch is “the sales file.” Archiving is done by `activate_sales_batch`, which refuses `FAILED` batches and refuses deletion of the active batch.
- `profit_amount` is gross-profit amount for BI only. Do not surface cost or margin percent from the Excel file.
- BI periods: all time, this month, last month, this quarter, last 3/6/12 months, this year, last year, custom (`app/lib/biReportPeriod.js`).
- Month-over-month charts skip the in-progress month when they need a closed month (`resolveMomComparisonMonths`).
- Up/down colors compare to the previous period. The current MTD/QTD/YTD column uses `moduleBiMonthCell--current`.
- Category growth and salesman MoM share `categoryGrowth.js` math. Change the helper, not each grid.
- Building-material and e-com/store splits exist in `salesmanTeamMom.js` (`__ecom_sales__`, `__store_sales__`, `__no_team__`). Do not fold those into a single salesman total without checking the team report.

## GPS rules

- Customer GPS updates record `gps_updated_at`, actor, and source: `customer_master`, `visit`, or `excel_import`.
- History rows go to `customer_gps_history` with the previous coordinates.
- Native Android tracking stores per-user state in Capacitor Preferences (`madiba.nativeTracking.<userId>.*`), including last activity/ping/inactivity-alert timestamps. This persisted state affects idle-ping and alert behavior after app resume/restart.
- Outstanding Without GPS lists customers who have an outstanding balance and no saved coordinates. The daily email goes to each salesman, with hierarchy bosses on CC, at 00:25 KSA, skipping the Friday holiday the same way as other salesman emails.
- GPS pings are rejected when the KSA workday is already ended.

## Email and push rules

- Inactivity and late-login mail go to the user and the reporting chain, on the inactivity cron.
- Daily visit report: 00:10 KSA, one email per user, previous working day. Friday is the KSA holiday, so the workflow skips Thursday 21:10 UTC (which is Friday 00:10 KSA).
- Daily salesman resume: 00:15 KSA. Default recipients are the addresses in `.env.example` (`DAILY_SALESMAN_RESUME_TO`). Do not add new personal addresses in code; use env.
- Daily supplier order email: 00:20 KSA, and also after a sales Excel upload. Each salesman gets their orders (all invoice statuses) with bosses on CC.
- Missing invoice email uses India office hours: 09:00–20:00 IST, Saturday–Thursday, every 15 minutes. Primary scheduler is Supabase `pg_cron` (`20260910120000_missing_invoice_pg_cron.sql`). GitHub Actions is the backup. The first authorized cron run stores `CRON_SECRET` in Vault so Postgres can call the app. Do not log that secret.
- Visit-plan email stays disabled until `SALESMAN_VISIT_PLAN_EMAIL_ENABLED` is turned on. The cron still builds and stores the snapshot at 00:00 KSA.

## What must stay consistent across screens

These strings and numbers are duplicated by design. Change them in the shared module and update every consumer in the same change:

- Invoice status labels (`app/lib/orderApproval.js`)
- Aging bucket labels (`DEFAULT_OUTSTANDING_BUCKET_LABELS`)
- KSA timezone helpers
- FIFO helpers (`paymentBehavior.js`)
- Role matrix (`moduleAccess.js`)
- Customer code matchers (`outstanding.js`, `customerAccess.js`)
- Table color classes for any new or edited report
