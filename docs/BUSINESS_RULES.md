# Business rules

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

Constants in `app/lib/workdayActivity.js`:

- Inactivity warning: 45 minutes without a transaction entry (`INACTIVITY_MS`).
- Inactivity email: 70 minutes (`INACTIVITY_EMAIL_MS`). This was lengthened from 40. Do not set it back without an explicit request.
- Inactivity push repeat: 15 minutes. Login reminder hour: 11:00 KSA, then every 30 minutes until login.
- Lunch reminder: 3 hours after lunch out, and a noon punch reminder at 12:00 KSA.
- Workday window used by helpers: 06:00–22:00 KSA.
- Background GPS idle threshold: 15 minutes.
- Auto-close looks back 14 days and inserts `END_OF_DAY` for sessions that have morning attendance and no end (`app/lib/autoCloseWorkdaysServer.js`). Cron closes the previous KSA day at 00:05 KSA and same-day at 23:59 KSA.
- Transaction types that count as activity: `VISIT_REPORT`, `ORDER_DRAFT`, `ORDER_EDITED`, `ORDER_SUBMITTED`, `PROSPECT_FOLLOW_UP`, `NOTE`. GPS-only punches do not clear the inactivity warning.
- `activity_reminders_enabled` on the profile can suppress reminders. Default is true.

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
- Pending Orders shows both `Current outstanding` and `Outstanding >60 days` from the uploaded outstanding dataset for the customer. The >60 value is the sum of buckets `61-90`, `91-120`, and `>120`.
- Orders created before the KSA day `2026-09-01` with no uploaded invoice are legacy and should be closed as `Rejected by management` / `Pre-September 2026 — invoice not uploaded`. Missing-invoice chase starts at `MISSING_INVOICE_CREATED_FROM = 2026-09-01`, after a 60-minute grace, and not more often than every 12 minutes.
- Credit approval (`app/lib/creditApproval.js`): cash orders skip it. Otherwise approval is required when outstanding over 60 days is greater than zero (buckets `61-90`, `91-120`, `>120`), or when order value plus total outstanding is over 10,000 and the credit application is missing or expired. Expired means expiry date is before today, or issue date plus one year is before today.
- Sales-order submission is blocked when `Avg Days to Pay >= 120` for the selected customer. Salesmen can still view the customer and build the order, but submit gets a blocking error. Admin can apply a per-customer unblock override from Customer Audit; removing that override re-enables the automatic block rule.
- Quantity caps live in `order_quantity_controls` (week window in Riyadh, customer scope). Defaults are in `DEFAULT_ORDER_QUANTITY_CONTROLS`. Enforcement is `assertOrderQuantityControls`.
- Schemes live in the `order_schemes` setting.

## Pricing

- Browser prices come from `price_catalog_cache` via `/api/pricing/cache`.
- Sync (`/api/admin/price-sync`) writes a snapshot and the cache, and appends `item_price_history` when a price changes. History UI shows at least the last five prices.
- VAT default on `products.vat_percent` is 15. Settlement line gross-up uses `regionalPricing.js` (category-aware), not a flat 15 for every line.
- **Gloves are VAT-exempt (0%)** on orders and settlement. `isVatExemptProduct` / `vatRateForProduct` in `regionalPricing.js` match `GLOVE`, `VINYL`, or Arabic `قفاز` in category/name/code. `getPricedOrderLine` and `summarizePricedLines` must use that rate (do not hardcode 15% on New Order / order PDF / WhatsApp). Mixed carts label the VAT column as plain `VAT`; gloves-only as `VAT 0%`; taxable-only as `VAT 15%`.
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
- Receipt copies and payment copies go to the `payment-collections` bucket. The save path must not hang when a Funds Received PDF or camera photo is attached: online saves upload directly (no IndexedDB serialize-first), photo compression is time-bounded with a fallback to the original file, bucket MIME refresh is best-effort, and Saving clears before the queue reload.
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
- Avg days / FIFO settlement must load sales history from day 1 through today (customer-history `fullHistory=1` / `scope=settlement`). That includes Customer Audit, Payment Settlement, Order PDF, New Order payment behavior, and WhatsApp avg-days helpers. Do not use the default ~6-month BI performance window for avg days — receipts are still full-ledger, and truncated sales skew the weighted average dramatically.
- Screens and PDFs that show avg days also show a parallel **6-month avg** (`avgDaysToPay6m`): sales + receipts + open invoices on/after the first day of the month that is `HISTORIC_PERFORMANCE_MONTHS` before the current KSA month (same span as the BI performance window). Open invoices still enter only when older than that window’s paid-only avg. Lifetime remains `avgDaysToPay`.
- Tolerance for amount matches is 0.02.
- Customer Audit and New Order payment-behavior summaries also show receipt amount collected in the last 10 days (date-windowed by receipt date).

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
- When a field visit (or order GPS capture) has coordinates and the customer master has **no** saved GPS, the visit location is **auto-promoted** onto `customers.latitude/longitude` (source `visit`) without asking. If the customer already has GPS and the salesman is farther than `CUSTOMER_LOCATION_DISTANCE_THRESHOLD_KM` (0.5 km), the app still prompts before overwriting.
- Outstanding Without GPS lists customers who have an outstanding balance and no saved coordinates. Rows can still show a last visit when that visit was older than auto-promote, GPS was blocked, or the role did not require transaction GPS. The daily email goes to each salesman, with hierarchy bosses on CC, at 00:25 KSA, skipping the Friday holiday the same way as other salesman emails.
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
