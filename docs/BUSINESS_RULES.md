# Business rules

Rules below are implemented in code. If a screen disagrees with this file, trust the code and update this file. Amounts and dates are KSA (`Asia/Riyadh`) unless a job comment says the window is India time.

## Roles and gates

- `buildModuleAccess` in `app/lib/moduleAccess.js` decides every management screen. Do not hide a page only with CSS.
- Collector access is true when role is `collector`, or `user_metadata.collection_only` is set, or salesman code matches `/^CL\d+$/i`.
- Morning attendance is required for every role except `admin` (`isMorningAttendanceRequiredForRole`), including invoice makers and collectors. Until today’s `MORNING_ATTENDANCE` exists, routes other than `/` and My Day redirect to My Day (collection-only users are sent to Payment Collections instead). Payment Collections, `/legal`, and `/management/my-collections` do not redirect; `MorningAttendanceRedirect` shows a blocking Morning Attendance overlay there that saves the punch with GPS. Pages rendering `MorningAttendanceGate requireMorningAttendance={false}` must not cache “attendance complete” for roles that still need it.
- GPS for transactions is required for every role except invoice makers. The access gate skips admin and manager. Background GPS is off for admin and invoice makers.
- Stock take is admin or `profiles.stock_take_access === true`.
- Salesman visit plan is on for field roles unless `NEXT_PUBLIC_SALESMAN_VISIT_PLAN_SALESMAN_ACCESS` is `0`, `false`, or `no`.
- `is_management()` SQL does not include invoice makers, collectors, or product promoters.

## Workday and attendance

Constants in `app/lib/workdayActivity.js`:

- Inactivity warning: 45 minutes without a transaction entry (`INACTIVITY_MS`).
- Inactivity email: 70 minutes (`INACTIVITY_EMAIL_MS`). This was lengthened from 40. Do not set it back without an explicit request.
- Inactivity push repeat: 15 minutes. Login reminder hour: 11:00 KSA, then every 30 minutes until login.
- Lunch reminder: 3 hours after lunch out, and a noon punch reminder at 12:00 KSA.
- Workday window used by helpers: 06:00–22:00 KSA.
- Background GPS idle threshold: 15 minutes.
- Auto-close looks back 14 days and inserts `END_OF_DAY` for sessions that have morning attendance and no end (`app/lib/autoCloseWorkdaysServer.js`). Cron closes the previous KSA day at 00:05 KSA and same-day at 23:59 KSA.
- Day-route / daily visit **Working hours** (`resolveDayRouteWorkingHours` in `app/lib/dayRouteMap.js`): prefer **non-far** customer transactions (`VISIT_REPORT`, `COLLECTION_VISIT`, `ORDER_SUBMITTED`) at or after **08:00 KSA**. With lunch punched: morning = first near → last near **before lunch out**; afternoon = first near **after lunch in** → last near of the day; sum both (gaps to/from lunch punches do not count). Without lunch out: first near → last near of the day. Without lunch in: morning segment only. Pre-8:00 KSA and far rows never set endpoints. When there are no usable near segments (login/logout/GPS only, or only far stops), working hours are **0h** — do not fall back to login→logout. The Day route UI, visit-report email, and **Working Hours** report (`/management/working-hours`) use this formula. The helper also returns the counted `ranges` (from → to per segment); the Day route UI and visit-report email show them next to the total, e.g. `5h 12m (9:41 am - 11:49 am; 4:41 pm - 7:44 pm)`. This is separate from the 06:00–22:00 helper window and from the User Activity report’s own working-hours column (login→lunch→logout only).
- Transaction types that count as activity: `VISIT_REPORT`, `ORDER_DRAFT`, `ORDER_EDITED`, `ORDER_SUBMITTED`, `PROSPECT_FOLLOW_UP`, `NOTE`. GPS-only punches do not clear the inactivity warning.
- `activity_reminders_enabled` on the profile can suppress reminders. Default is true.

## Customer identity and who can see them

- Compare customer and salesman codes with the same normalizer the caller already uses (trim, uppercase, collapse spaces). Leading-code extraction exists because some sheets store `CODE Name` in one cell (`extractLeadingCustomerCodeAndName`). Name-only customer identities such as `Al-muntaj Al-Raqi trading company` must remain intact; do not interpret a hyphenated name prefix as an account code.
- A customer can remain visible to the previous salesman after transfer (`previous_salesman_code`).
- Inactive customers stay visible in report customer pickers (for example Customer Audit, Payment Settlement, Outstanding Compare). Visit suggestions still keep inactive customers out of the active suggestion pool.
- Mutual visibility is hardcoded in `MUTUAL_SALESMAN_GROUPS`: `JUNAID`, `PARVEZ`, `SOYEB` see each other’s books.
- One-way book shares are hardcoded in `SHARED_CUSTOMER_BOOKS` and can also be rows in `customer_book_shares`. Examples in code: Ahmed Nabil’s book is shared to Abdalla; Mohammed Mubeen’s book is shared to Moinudin Khaja and Junaid. Do not “clean up” these names as unused data.
- “Do not use” customers (name matches `/do\s*not\s*use/i`) are excluded from visit status.
- Building-material customers and items are filtered out of new-order item mixes (`app/lib/buildingMaterialCustomerFilter.js` and `customerEligibility.js`). Customer codes `1020C` and `1020` are excluded from that new-order path.
- Inactive customers who still have an outstanding balance are blocked from some visit flows (`CUSTOMER_INACTIVE_WITH_OUTSTANDING_ERROR` in `app/lib/outstanding.js`).

## Visits

- Visit outcomes on `visits.outcome` are constrained. Field reports in `system_settings` are the source Customer Audit and My Day read for the latest report (`visit_report_latest:<code>`).
- Daily Visit Report collapses repeated `VISIT_REPORT` / `COLLECTION_VISIT` activity-log saves for the same user, customer, outcome (and collection amount) within a 2-minute window (`hideDuplicateVisitEntries`), so multi-tap saves show as one row.
- New Customer “Order not received” follow-ups (`PROSPECT_FOLLOW_UP` activity logs) appear in the Daily Visit Report and email as **Prospect visit** rows counted as visit reports (visit without order). New notes carry `customer_code`/`customer_name`/`offline_id`; older offline-prospect logs without a code are matched to the prospect created by the same user with the same `follow_up_date`.
- Daily Visit Report / email Count table: **Collections** counts only `COLLECTION_VISIT` rows with money received (`isSuccessfulCollection`); collection visits with no payment (come later, responsible not available, etc.) are counted on a separate **Collection visits without payment** line (`collectionVisitWithoutPaymentCount` from `buildVisitDaySplit`).
- Daily Visit Report **Distance from previous** on a customer visit/order row sums hop distances since the previous customer stop through idle GPS, lunch, and login/logout bridge rows (`resolveDistanceFromPreviousVisitKm` / `isIdleGpsPingTimelineRow`). Bridge rows still show their own single hop. Route total distance stays hop-by-hop so path is not double-counted.
- My Day / Visit Without Order visit saves, inactive/active toggles, and prospect foreclosure are offline-first (`queueFirst`) via the resilient helpers. Save enrichment skips the activity timeline. Avg days for WhatsApp is prefetched when the visit form opens (`prefetchCustomerAvgDaysForVisit`) and stored on the local visit row (`avg_days_to_pay` / `avg_days_to_pay_6m`); save only reads that local value (with a short race on the in-flight prefetch) and never blocks on a fresh history fetch.
- Visit plan (`app/lib/salesmanVisitPlan.js`): default 12 visits per salesman. System suggestions need at least 7 days since the last visit (`MIN_SYSTEM_VISIT_GAP_DAYS`). Appointments due today bypass that gap. Score mixes sales opportunity and collection opportunity. The page reads the stored snapshot `salesman_visit_plan_snapshot_v1`. The midnight KSA cron builds it. Email is off unless `SALESMAN_VISIT_PLAN_EMAIL_ENABLED` is true.
- WhatsApp visit/collection/order text includes average days to pay and the parallel 6-month avg when available (`app/lib/avgDaysWhatsapp.js`). Figures come from the settlement rules below, not from a single stored column. Collection queue rows carry both via `enrichCollectionRecordsWithAvgDays`.

## Orders

- Live statuses on `sales_orders.status`: `DRAFT`, `SUBMITTED`, `CANCELLED`.
- New Order draft/save and submit are offline-first (`queueFirst` in `useOrder.js`). Queued orders keep a local pending id until sync assigns the server row id.
- Order `salesman_code` / `salesman_name` are the **person making the order** (logged-in profile), not the customer master `current_salesman_code`. Shared-book or manager orders therefore show the maker on PDF, WhatsApp, and Pending Orders. Order-number series follow the maker too. Customer master salesman is still used only for pricing-region fallback (`customerSalesmanCode`).
- Order numbers are salesman-wise and allotted on the device before sync: short prefix + sequence (e.g. `P01` for Parvez). If another salesman shares the same first letter, the prefix grows to 2+ letters (`PA01` vs `PR01`). The client sends `orderNumber` on save/submit; the API preserves it when available, but may allot the next number if it is stale or already taken. Existing saved order numbers are not rewritten by normal edits.
- Never persist the bigint `sales_orders.id` as `order_number` (e.g. `641`). After a rare allotment collision the API must allot the next salesman series number, not the row id. Pending Orders runs `repair_order_numbers` for blank or id-equal numbers so the queue shows `MOI01` instead of `641`.
- Sequence consistency: the local offline sequence cache must only advance from real series numbers (`MOI417`), never from bare numeric ids (`414`). The server rejects preferred client numbers that are not ahead of the current prefix max (so `MOI01` is not accepted when the series is already at `MOI417`) and allots the next free number instead. Existing stored numbers on edit are still kept.
- Re-saving or re-submitting an existing order must keep its stored `order_number`, including legacy numeric values (e.g. `503`). Do not allot a new salesman series number on edit — that makes the PDF show a number the server will never adopt, so the order looks “not synced.” Explicit Pending Orders repair may replace id-equal accidental numbers only.
- Before a new offline order syncs, its locally allotted number is provisional: a collision or stale sequence can make the server allot a different number. Queued PDFs show `(Pending sync)` after the number and include `pending-sync` in the filename. Regenerate the PDF from the synced order for the final number; older downloaded PDFs are unchanged.
- Invoice statuses (strings, in settings JSON) are listed in `ORDER_INVOICE_STATUSES` in `app/lib/orderApproval.js`. Do not invent a new label in one screen only. Pending Orders, missing-invoice email, and time-to-make all compare these strings.
- `Pending for credit approval` is legacy and is treated like `Pending for approval`.
- Uploading an invoice PDF moves status to `Invoice made` when a file is stored. Setting `Invoice made` without a PDF is rejected.
- Time-to-make clock runs for `Pending for invoice creation` and stops when status leaves that queue. Show the live duration; do not freeze it at submit time.
- Order PDFs must show a mandatory `Order No.` label (`app/lib/salesOrderNumber.js`). New offline orders allot a short salesman series (`P01` / `PA01`), but PDFs mark it pending until sync confirms it. Legacy queued rows without a number show `Order No. Pending sync`; never print a raw `pending:` queue id.
- Cash-discount breakdown is printed on pending-order PDFs. Do not drop it when editing the PDF builder.
- Pending Orders shows both `Current outstanding` and `Outstanding >60 days` from the uploaded outstanding dataset for the customer. The >60 value is the sum of buckets `61-90`, `91-120`, and `>120`; duplicate rows are de-duplicated by normalized customer identity so same-customer orders do not inflate the total.
- Orders created before the KSA day `2026-09-01` with no uploaded invoice are legacy and should be closed as `Rejected by management` / `Pre-September 2026 — invoice not uploaded`. Missing-invoice chase starts at `MISSING_INVOICE_CREATED_FROM = 2026-09-01`, after a 60-minute grace, and re-sends every 15 minutes while the queue remains open.
- Credit approval (`app/lib/creditApproval.js`): cash orders skip it. Otherwise approval is required when outstanding over 60 days is greater than zero (buckets `61-90`, `91-120`, `>120`), or when order value plus total outstanding is over 10,000 and the credit application is missing or expired. Expired means expiry date is before today, or issue date plus one year is before today.
- Sales-order submission is blocked when `Avg Days to Pay >= 120` for the selected customer. The server recalculates the average and applies the fixed threshold for every submit, regardless of all-access scope; only an explicit admin per-customer unblock override from Customer Audit permits submission. Removing that override re-enables the automatic block rule.
- Quantity caps live in `order_quantity_controls` (week window in Riyadh, customer scope). Defaults are in `DEFAULT_ORDER_QUANTITY_CONTROLS`. Enforcement is `assertOrderQuantityControls`.
- Schemes live in the `order_schemes` setting.

## Pricing

- Browser prices come from `price_catalog_cache` via `/api/pricing/cache`.
- Sync (`/api/admin/price-sync`) writes a snapshot and the cache, and appends `item_price_history` when a price changes. History UI shows at least the last five prices.
- VAT default on `products.vat_percent` is 15. Settlement line gross-up uses `regionalPricing.js` (category-aware), not a flat 15 for every line.
- When both cash and value discounts are active on a line, each percentage is calculated from the wholesale base rate (not compounded one on top of the other).
- **Gloves are VAT-exempt (0%)** on orders and settlement. `isVatExemptProduct` / `vatRateForProduct` in `regionalPricing.js` match `GLOVE`, `VINYL`, or Arabic `قفاز` in category/name/code. `getPricedOrderLine` and `summarizePricedLines` must use that rate (do not hardcode 15% on New Order / order PDF / WhatsApp). Mixed carts label the VAT column as plain `VAT`; gloves-only as `VAT 0%`; taxable-only as `VAT 15%`.
- Item master `tally_unit` / `tally_item_name` feed the Tally sales-voucher Excel export. Sources: `excel_import`, `invoice_pdf`, `manual`.

## Outstanding and collections

- Aging buckets: `0-30`, `31-60`, `61-90`, `91-120`, `>120`.
- The uploaded sheet is the operational outstanding book once it has been stored. Column detection is heuristic (`detectOutstandingColumnIndexes` in `app/lib/outstanding.js`). Do not replace it with a fixed column index. Payment Collections ignores `public.invoices` while that workbook has rows.
- Collection-queue **Salesman** label: prefer the uploaded Salesman cell (invoice, then aggregate row). When that cell is blank, fill invoice salesman from `active_sales` by matching `ref_no` → `voucher_number`, then resolve the row label with `resolveCollectionQueueSalesman` (prefer customer-master book owner when they appear on any open invoice — shared-book cases — else voucher-derived name, else master alone so filters still have names). Do not show the collector who saved the visit as Salesman.
- Cash versus credit uses `ref_no` / cash markers (`invoiceHasCashRef`, `isInvoiceCashDue`).
- Queue priority uses exposure (amount and age), due state, last outcome, and scheduled revisits (`buildCollectionPriority`). Customers with a future scheduled revisit are not treated the same as overdue cash.
- A collection visit needs an Arabic or English remark for the outcomes/statuses listed in `collectionVisitRequiresRemark`.
- Salesmen named in `COLLECTION_QUEUE_EXCLUDED_SALESMEN` (`Zia`, `Asrar Ahmed`) are removed from the collection queue. This is a business filter, not dead code.
- Scheduled revisit dates are redacted for viewers who should not see another collector’s private schedule (`redactCollectionVisitScheduleForViewer`).
- Legal transfer removes the customer from the normal queue and lists them on `/management/payment-collections/legal`.
- Receipt copies and payment copies go to the `payment-collections` bucket. Collection visits (including Funds Received with PDF/photo) save on-device first (`queueFirst`) and sync in the background so flaky mobile data cannot block collectors. Sync re-resolves Android MIME for queued attachments. Photo compression is time-bounded with a fallback to the original file, bucket MIME refresh is best-effort, and Saving clears before the queue reload. Save enrichment uses the queue row’s `avg_days_to_pay` and skips the client activity-timeline fetch; the API patches previous-visit distance when the visit syncs.
- When collection queue rows have no invoice-level rows but do have outstanding aging buckets, avg paying days is still computed from those open buckets (bucket-weighted synthetic invoice ages) so WhatsApp summaries do not drop Avg days for never-paid customers.
- Collection saves must reuse the existing customer-master account code when the outstanding file uses a variant such as `1608` vs `1608C`. Do not split visits across duplicate customer codes or the saved visit/WhatsApp summary can disappear from the queue after sync.
- Receipts Not in Tally (`app/lib/receiptsNotInTally.js`) matches app collection receipts to the Tally receipt upload. Amount tolerance is 0.02. Default date window is 1 day. The UI allows a window up to 30 days. Do not raise that cap without checking the page and the API together.
- Collection report WhatsApp distance uses the same prior visits as the report. The service role recomputes distance because client RLS cannot see every previous row.

## Settlement and average days to pay

Implemented in `app/lib/paymentBehavior.js` and shown on Payment Settlement and Customer Audit.

- Machine Open (FIFO) is sales minus cash applied to that invoice, then credit notes allocated to that invoice. It can differ from Tally Open (the uploaded outstanding book); Customer Audit shows the difference rather than forcing either total to match.
- Tally Open is the pending amount on the outstanding upload for that invoice. They are allowed to differ. Outstanding Compare and the Open delta exist to show the gap.
- A Tally bill whose `Ref. No.` matches no sales voucher for that customer keeps its own open row (Sales excl VAT 0, amount = pending). That is intended — it is never guessed onto another invoice. Outstanding Compare's **Tally bills not matched to a sales invoice** section classifies why, via `classifyOutstandingBillMismatch`: `ref_other_customer` (the voucher exists in sales under a different customer — usually a Ref. No. column misalignment on the Bills Receivable export), `ref_reversed` (the customer's own voucher was dropped as a credit-note reversal while Tally still shows it pending), `ref_missing` (the reference is nowhere in sales).
- Outstanding Compare “Show differences only” (default on) lists a customer when |computed − Tally| > 0.02 or any invoice has an open gap. Its computed open uses the same per-invoice FIFO residual as Payment Settlement Machine Open; FIFO cash and unpaired credit notes reduce open in event-date/oldest-open order. Credit-note item/reference attachment remains display-only and must not change the compare balance. The customer name opens Payment Settlement → Invoices & Settlement.
- Those customer-level differences are computed once per upload, not per page view. Tally = the customer total on the outstanding upload; SFA = `outstandingCompareTotals.computed_open`. Only differing customers are stored, so a customer missing from the saved dataset reconciled cleanly at the last upload. The same rows are emailed after each sales / receipt / outstanding upload, and a repeat upload with an identical set of differences does not re-send.
- Admin, manager, and invoice-maker can manually rebuild the saved reconciliation from Outstanding Compare with **Recalculate**; the synchronous `POST /api/outstanding-reconcile` response refreshes both saved customer differences and unmatched-bill categories. This manual action does not send email.
- Do not force FIFO open or paid to equal the outstanding file. Tests in `tests/paymentBehavior.test.mjs` lock this (including the case “open is FIFO residual, not outstanding 610”).
- Cash is applied oldest invoice first.
- Unpaired credit notes with an explicit reference to a sales voucher apply to that referenced invoice first (provided the credit-note date is not before the invoice); any excess then follows oldest-open FIFO. Credit notes without a matching reference apply oldest-open FIFO.
- Receipts posted before an invoice are customer prepayments and apply to the oldest open invoice in FIFO order, including a later-dated invoice; their payment-days contribution is zero. Credit notes dated before an invoice never reduce that later sale.
- Same-day or next-day credit notes (`IMMEDIATE_REVERSAL_MAX_DAYS = 1`) that match the invoice (amount and line fingerprint) are immediate reversals. They stay inside sales but are excluded from average days. They are not “payments”.
- A next-day **reissue** is not a reversal. Orphan credit notes that do not match an invoice reduce open balance rather than being dropped.
- Average days uses paid receipts first. Open invoices are included only when they are older than that paid average. Younger FIFO residuals are excluded.
- Partial credit notes and sales returns appear in the credit-note table, not as reversed invoices.
- Avg days / FIFO settlement must load sales history from day 1 through today (customer-history `fullHistory=1` / `scope=settlement`). That includes Customer Audit, Payment Settlement, Order PDF, New Order payment behavior, and WhatsApp avg-days helpers. Do not use the default ~6-month BI performance window for avg days — receipts are still full-ledger, and truncated sales skew the weighted average dramatically.
- Screens and PDFs that show avg days also show a parallel **6-month avg** (`avgDaysToPay6m`): sales + receipts + open invoices on/after the first day of the month that is `HISTORIC_PERFORMANCE_MONTHS` before the current KSA month (same span as the BI performance window). Open invoices still enter only when older than that window’s paid-only avg. Lifetime remains `avgDaysToPay`.
- Tolerance for amount matches is 0.02.
- Customer Audit and New Order payment-behavior summaries also show receipt amount collected in the last 10 days (date-windowed by receipt date).

## Salesman incentive scheme

Implemented in `app/lib/salesmanIncentive.js` (pure) and `app/lib/salesmanIncentiveServer.js` (loaders). Screen: `/management/salesman-incentive`, API `/api/salesman-incentive`. Tests: `tests/salesmanIncentive.test.mjs`.

- Collection incentive, measured from invoice date to receipt date:
  - Office supplies: **0.25%** when collected within **35 days**. Nothing after that.
  - Electronics: **0.40%** within **35 days**, **0.20%** within **60 days**.
  - All other categories: **1%** within **35 days**, **0.5%** within **60 days**. Nothing after 60 days.
- **Cash deals override every category rate.** An invoice whose voucher number starts with a cash prefix (`RC`, `DC`, `JC` — `isCashSalesVoucher` in `app/lib/paymentBehavior.js`) earns **0.20% only**, and only when the cash is received within **3 days** (`INCENTIVE_CASH_DAYS`). After 3 days a cash deal earns nothing. The invoice is not split by category at all.
- Growth incentive: **0.5%** of the amount by which this month's net sales exceed the salesman's **best net-sales month ever** (`resolvePeakMonthlySales`). The current month is never its own benchmark, and the benchmark floors at zero, so a salesman with no positive history is measured against 0. Beating last month is not enough — the record must be beaten. A shortfall pays zero and is never carried as a penalty.
- **A salesman's first month earns no growth incentive at all.** With no earlier month there is nothing to compare against, so `hasHistory` is false and both the delta and the incentive are forced to zero (`has_sales_history` on the summary). Without this the whole first month would count as growth over 0.
- **Every sales figure in this report is ex-VAT.** `sales_raw.sales_amount` / `active_sales.sales_amount` are exclusive of VAT, and the BI cube stores them unchanged, so current-month and peak-month sales are ex-VAT. The incentive base is ex-VAT too. The only VAT-inclusive number on the screen is `collected_amount` ("Cash collected"), which is the actual cash received.
- The all-time monthly series comes from the `sales_bi_cube_v1` BI cube (`loadMonthlyNetSalesBySalesman`), which already spans the whole active batch and is already net of credit notes. If the cube is unavailable the report falls back to aggregating the sales rows it loaded.
- Receipts are matched to invoices with the same cash FIFO as `matchPaymentsFifo`. The report never re-implements settlement.
- A settled chunk of a non-cash invoice is split across office supplies / electronics / other using that invoice's own item mix. Office supplies wins when a line matches both classifiers. `isOfficeSuppliesSale` comes from `app/lib/performanceKpis.js` (the same classifier as KPI Targets); electronics is `isElectronicsSale`, which reads the category fields only, not the item name.
- The incentive **base is net (ex-VAT)**. Receipts are VAT-inclusive, so each settled chunk is converted with the invoice's own `sales_amount` ÷ VAT-inclusive ratio. Net sales for the growth part are `sales_amount` minus credit notes / returns.
- The report credits the **invoice's** `salesman_code`, not the collector and not the customer's current owner.
- **Every receipt dated in the report month counts, whatever the invoice date.** Sales and receipts both load the full ledger from day 1 (no rolling window), per the avg-days rule above, so a receipt settles the real bill it paid even when that bill is years old. Do not reintroduce a month window here — truncating sales silently reassigns cash to newer invoices and inflates the incentive.
- Collections older than 60 days (and cash deals older than 3 days) still appear in the table under the `late` tier so the figure can be audited.
- **TRENDYOL and NOON are ecom channels, not salesmen, and are excluded from the report** (`isExcludedIncentiveSalesman`, using `ECOM_SALESMAN_TOKENS` from `app/lib/salesmanTeamMom.js` — the same canonical set the BI team report uses).
- Per-salesman figures are reported in `tier_base` and `tier_incentive` maps keyed by `INCENTIVE_TIER_KEYS`. Add a new rate by extending `INCENTIVE_RATES`, `INCENTIVE_TIER_KEYS` and `INCENTIVE_TIER_LABELS` — the screen builds its columns from `tierKeys` in the API payload and shows each tier's rate and earned incentive.
- Every amount in the summary is a drill-down: clicking it filters the settled-collections table below to the exact invoices and receipts behind that figure. The sales / growth columns are not clickable because they come from monthly totals, not from listed receipts.
- The salesman's **daily visit report email** carries a "Your incentive" section (`buildSalesmanIncentiveEmailSection` in `app/lib/salesmanIncentiveEmail.js`), laid out as vertical label/value rows so it reads on a phone. It shows month-to-date figures: only the tiers that actually earned (with their rate), late collections that earned nothing, collection incentive, this month vs best month ever, growth incentive, and the total. The incentive report is loaded **once per email cycle** (it scans the whole ledger) and is wrapped in try/catch — if it fails the section is dropped and the daily email still goes out.
- Admin and manager see every salesman. A salesman sees only their own code; any other `salesman` parameter is rejected with 403.

## Sales import and BI

- Only the active batch is “the sales file.” Archiving is done by `activate_sales_batch`, which refuses `FAILED` batches and refuses deletion of the active batch.
- `profit_amount` is gross-profit amount for BI only. Do not surface cost or margin percent from the Excel file.
- BI periods: all time, this month, last month, this quarter, last 3/6/12 months, this year, last year, custom (`app/lib/biReportPeriod.js`).
- Month-over-month charts skip the in-progress month when they need a closed month (`resolveMomComparisonMonths`).
- Up/down colors compare to the previous period. The current MTD/QTD/YTD column uses `moduleBiMonthCell--current`.
- Category growth and salesman MoM share `categoryGrowth.js` math. Change the helper, not each grid.
- Building-material and e-com/store splits exist in `salesmanTeamMom.js` (`__ecom_sales__`, `__store_sales__`, `__no_team__`). Do not fold those into a single salesman total without checking the team report.

## GPS rules

- Salesman home coordinates are managed in Salesman Hierarchy (`profiles.home_latitude/home_longitude`). Login and logout attendance punches within 500 m of that user's home are rejected by the database, and the sign-in screen also blocks a GPS-confirmed login there. Customer GPS writes from within the actor's 500 m home radius are rejected across manual updates, imports, and visit auto-promotion. Coordinates within 25 m of any saved home are never accepted as a customer pin; saving a home clears matching customer pins and records the clear in `customer_gps_history`.
- Historical home candidates are review-only: `scripts/audit-salesman-home-locations.mjs` groups login/logout GPS into 500 m clusters and reports clusters present on at least six distinct KSA dates. It does not update profiles or customers; confirm inferred home points before assigning them.
- Customer GPS updates record `gps_updated_at`, actor, and source: `customer_master`, `visit`, `excel_import`, or `home_location_cleanup`.
- History rows go to `customer_gps_history` with the previous coordinates.
- When a field visit (or order GPS capture) has coordinates and the customer master has **no** saved GPS, the visit location is **auto-promoted** onto `customers.latitude/longitude` (source `visit`) without asking. This runs on the server in `/api/visit-reports` and payment-collection saves (`promoteEntryGpsToCustomerIfMissing`), and on the client via `maybePromptCustomerLocationUpdate`. If the customer already has GPS and the salesman is farther than `CUSTOMER_LOCATION_DISTANCE_THRESHOLD_KM` (0.5 km), the app still prompts before overwriting.
- When the salesman accepts that GPS update prompt, the Daily Visit Report labels the matching visit **GPS update accepted** and does not mark it Far. New My Day saves retain the choice in the activity note; collection saves link an activity note to the saved visit. Older visits can be recognized from a matching same-user `customer_gps_history` overwrite within five minutes, provided it replaced an existing pin (automatic first-time promotions are not treated as accepted prompts).
- Outstanding Without GPS lists customers who have an outstanding balance and no saved coordinates. Loading the report (and the daily email job) **backfills** customer master GPS from the latest My Day visit report or collection visit location when the visit stored coordinates but the customer row still has none (`backfillCustomerGpsFromLastVisits`, using `stored_customer_code` so dirty/name codes get the pin). Dirty master codes (`1428_Name…`, `Zahrat Ghubaira…`) are dropped when the clean canonical code already has GPS (`excludeRowsWithCanonicalGpsSibling`, case-insensitive). Rows that remain after that have no visit GPS on file (blocked/unavailable) or never had a visit with coordinates. The daily email goes to each salesman at 00:25 KSA, and hierarchy bosses get one consolidated digest for their subordinate books instead of repeated CC copies; consolidated digests render a separate customer table and subtotal for each salesman. It skips the Friday holiday the same way as other salesman emails.
- Stale overdue collections email (00:35 KSA, skip Friday) digests due-queue customers where overdue aging exceeds the displayed/uploaded salesman threshold (Parvez/Junaid: **>30 days**; others: **>60 days**; stale customer-master ownership does not grant the exception), received in the last **8 days** is zero, no non-FAR collection visit occurred in the last **3 KSA working days** (Friday skipped; Saturday counts), and the last near visit-without-order is older than **7 calendar days** (or never visited). Recent visits are read from a date-bounded collection-visit scan and matched to due rows by account equivalence, not exact stored account code. One HTML table per salesman. Default To `malik@pinasz.com`; default CC Soyeb and Fazlur. The same salesman table is appended to each field user’s daily visit report email so bosses see it in their team digests.
- GPS pings are rejected when the KSA workday is already ended.

## Email and push rules

- Inactivity and late-login mail go to the user and the reporting chain, on the inactivity cron.
- Daily visit report: 00:10 KSA, previous working day. Each field user still gets their own email, but bosses no longer sit on every subordinate email; each boss gets one consolidated digest for their subordinate reports. Friday is the KSA holiday, so the workflow skips Thursday 21:10 UTC (which is Friday 00:10 KSA).
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
- Field write path (`offlineApi.js` defaults `queueFirst: true` for resilient JSON/form saves)
