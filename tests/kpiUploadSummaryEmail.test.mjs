import test from "node:test";
import assert from "node:assert/strict";
import {
  KPI_UPLOAD_SUMMARY_DEBOUNCE_MS,
  buildActiveCustomersSalesSummaryRow,
  buildActiveCustomersSummaryRow,
  buildActiveCustomersSummaryRows,
  buildAverageCollectionDaysSummaryRow,
  buildAverageCollectionDaysSummaryRows,
  buildKpiUploadSummaryEmail,
  buildKpiUploadSummaryTable,
  compareActiveCustomersSalesToPriorMonth,
  compareActiveCustomersToPriorMonth,
  compareAverageCollectionDaysToPriorMonth,
  isKpiUploadSummaryDue,
  kpiUploadSummarySignature,
  mergeKpiUploadSummaryPending,
  nextKpiUploadSummarySendAfter,
  resolveKpiUploadSummaryEmailCc,
  resolveKpiUploadSummaryEmailRecipients,
} from "../app/lib/kpiUploadSummaryEmail.js";
import { buildActiveCustomersReport } from "../app/lib/activeCustomers.js";
import { buildReceivableDaysReport } from "../app/lib/receivableDays.js";
import { runKpiUploadSummaryEmailCycle } from "../app/lib/kpiUploadSummaryEmailServer.js";
import { ksaWorkdayProgressRatio } from "../app/lib/performanceKpis.js";

const ahmed = {
  salesmanCode: "AHMED",
  salesmanName: "Ahmed",
  isTeam: false,
  officeSupplies: "100000",
  localItemSales: "50000",
  otherSales: "50000",
  totalSales: "200000",
  collection: "300000",
  paceShares: null,
  salesAsOfDate: "2026-10-15",
  receiptAsOfDate: "2026-10-14",
  kpis: [
    { key: "officeSupplies", actual: 100_000 },
    { key: "localItemSales", actual: 50_000 },
    { key: "otherSales", actual: 50_000 },
    { key: "totalSales", actual: 200_000 },
    { key: "collection", actual: 300_000 },
    { key: "cashCollection", actual: 0 },
    { key: "totalCashCollected", actual: 300_000 },
    { key: "newCustomers", actual: 0 },
    { key: "repeatCustomers", actual: 0 },
  ],
};

test("debounce pending merges triggers and resets sendAfter", () => {
  const first = mergeKpiUploadSummaryPending({}, {
    trigger: "sales-upload",
    now: new Date("2026-10-29T10:00:00.000Z"),
    debounceMs: 18 * 60 * 1000,
  });
  assert.equal(first.pending, true);
  assert.deepEqual(first.triggers, ["sales-upload"]);
  assert.equal(first.sendAfter, "2026-10-29T10:18:00.000Z");

  const second = mergeKpiUploadSummaryPending(first, {
    trigger: "receipt-upload",
    now: new Date("2026-10-29T10:05:00.000Z"),
    debounceMs: 18 * 60 * 1000,
  });
  assert.deepEqual(second.triggers, ["sales-upload", "receipt-upload"]);
  assert.equal(second.sendAfter, "2026-10-29T10:23:00.000Z");
  assert.equal(isKpiUploadSummaryDue(second, new Date("2026-10-29T10:22:00.000Z")), false);
  assert.equal(isKpiUploadSummaryDue(second, new Date("2026-10-29T10:23:00.000Z")), true);
});

test("next sendAfter uses 18 minute default", () => {
  assert.equal(KPI_UPLOAD_SUMMARY_DEBOUNCE_MS, 18 * 60 * 1000);
  assert.equal(
    nextKpiUploadSummarySendAfter(new Date("2026-10-29T12:00:00.000Z")),
    "2026-10-29T12:18:00.000Z",
  );
});

test("summary table transposes footer rows into columns for sales, collection, and total cash", () => {
  const summary = buildKpiUploadSummaryTable({
    rows: [ahmed],
    reportDate: "2026-10-01",
    todayIso: "2026-10-20",
    salesAsOfDate: "2026-10-15",
    receiptAsOfDate: "2026-10-14",
    priorMonth: "2026-09",
    priorMonthActualsByCode: {
      AHMED: {
        totalSales: 250_000,
        collection: 200_000,
        officeSupplies: 0,
        localItemSales: 0,
        otherSales: 0,
        cashCollection: 50_000,
      },
    },
  });

  assert.equal(summary.salesmanCount, 1);
  assert.equal(summary.columns.length, 3);
  assert.deepEqual(summary.columns.map((col) => col.key), [
    "totalFiltered",
    "paceEstimate",
    "vsLastMonth",
  ]);
  assert.equal(summary.rows.length, 3);
  assert.equal(summary.rows[0].key, "totalSales");
  assert.equal(summary.rows[0].label, "Total sales");
  assert.equal(summary.rows[0].totalFiltered.actual, 200_000);
  assert.equal(summary.rows[0].totalFiltered.target, 200_000);
  assert.ok(summary.rows[0].paceEstimate.estimate != null);
  assert.ok(summary.rows[0].vsLastMonth);
  assert.equal(summary.rows[1].key, "collection");
  assert.equal(summary.rows[1].totalFiltered.actual, 300_000);
  assert.equal(summary.rows[2].key, "totalCashCollected");
  assert.equal(summary.rows[2].label, "Total cash collected");
  assert.equal(summary.rows[2].totalFiltered.actual, 300_000);
  assert.equal(summary.rows[2].vsLastMonth.priorActual, 250_000);
});

test("upload summary Total sales status matches ~100% estimate instead of workday behind-pace", () => {
  const target = 4_580_000;
  const salesAsOfDate = "2026-11-03";
  // Method A floors historical share at workday progress — set booked actual so
  // actual / workday_pace ≈ target (estimate ~100% of target).
  const workdayFrac = ksaWorkdayProgressRatio(salesAsOfDate);
  const actual = Math.round(target * workdayFrac);
  const personalPaceShares = {
    shares: Object.fromEntries(
      Array.from({ length: 31 }, (_, index) => {
        const day = index + 1;
        // Keep historical at-or-above workday so the floor is not the only driver.
        return [day, Math.min(1, Math.max(workdayFrac, day / 31))];
      }),
    ),
  };
  const salesman = {
    ...ahmed,
    officeSupplies: "2290000",
    localItemSales: "1145000",
    otherSales: "1145000",
    totalSales: "4580000",
    collection: "3268000",
    paceShares: personalPaceShares,
    salesAsOfDate,
    receiptAsOfDate: "2026-11-08",
    kpis: [
      { key: "officeSupplies", actual: Math.round(actual * 0.5) },
      { key: "localItemSales", actual: Math.round(actual * 0.25) },
      { key: "otherSales", actual: actual - Math.round(actual * 0.5) - Math.round(actual * 0.25) },
      { key: "totalSales", actual },
      { key: "collection", actual: 828_959 },
      { key: "cashCollection", actual: 0 },
      { key: "totalCashCollected", actual: 828_959 },
      { key: "newCustomers", actual: 0 },
      { key: "repeatCustomers", actual: 0 },
    ],
  };
  const summary = buildKpiUploadSummaryTable({
    rows: [salesman],
    reportDate: "2026-11-01",
    todayIso: "2026-11-10",
    salesAsOfDate: "2026-11-03",
    receiptAsOfDate: "2026-11-08",
  });
  const totalSales = summary.rows.find((row) => row.key === "totalSales");
  assert.ok(totalSales);
  assert.ok(Number(totalSales.paceEstimate.achievement) > 99);
  assert.ok(Number(totalSales.paceEstimate.achievement) < 101);
  assert.match(totalSales.totalFiltered.statusLabel, /On pace|ahead of pace|Achieved/);
  assert.doesNotMatch(totalSales.totalFiltered.statusLabel, /behind pace/);
});

test("average collection days treats lower days as improving", () => {
  const improving = compareAverageCollectionDaysToPriorMonth(40, 50);
  assert.equal(improving.direction, "up");
  assert.equal(improving.delta, -10);
  assert.equal(improving.polarity, "lower-is-better");

  const worsening = compareAverageCollectionDaysToPriorMonth(55, 50);
  assert.equal(worsening.direction, "down");
  assert.equal(worsening.delta, 5);
});

test("summary table appends avg collection days with MoM indicator", () => {
  const receivableDaysReport = buildReceivableDaysReport({
    monthlyCreditSales: {
      "2026-08": 300_000,
      "2026-09": 300_000,
      "2026-10": 300_000,
    },
    monthlyReceivables: {
      "2026-08": 360_000,
      "2026-09": 300_000,
      "2026-10": 240_000,
    },
    asOfDate: "2026-10-20",
  });
  const summary = buildKpiUploadSummaryTable({
    rows: [ahmed],
    reportDate: "2026-10-01",
    todayIso: "2026-10-20",
    salesAsOfDate: "2026-10-15",
    receiptAsOfDate: "2026-10-14",
    priorMonth: "2026-09",
    priorMonthActualsByCode: {
      AHMED: { totalSales: 180_000, collection: 250_000, cashCollection: 0 },
    },
    receivableDaysReport,
  });

  assert.equal(summary.rows.length, 6);
  const daysRows = summary.rows.slice(3);
  assert.deepEqual(daysRows.map((row) => row.key), [
    "averageCollectionDays",
    "averageCollectionDays3m",
    "averageCollectionDays12m",
  ]);
  assert.deepEqual(daysRows.map((row) => row.label), [
    "Avg collection days (YTD)",
    "Avg collection days (Rolling 3m)",
    "Avg collection days (Rolling 12m)",
  ]);
  daysRows.forEach((daysRow) => {
    assert.equal(daysRow.kind, "collectionDays");
    assert.equal(daysRow.month, "2026-10");
    assert.ok(daysRow.totalFiltered.actual != null);
    assert.equal(daysRow.paceEstimate.estimate, null);
    assert.equal(daysRow.vsLastMonth.direction, "up");
    assert.ok(daysRow.vsLastMonth.delta < 0);
  });

  const alone = buildAverageCollectionDaysSummaryRow(receivableDaysReport);
  assert.equal(alone.key, "averageCollectionDays");
  assert.equal(alone.label, "Avg collection days (YTD)");
  assert.equal(alone.vsLastMonth.direction, "up");

  const allThree = buildAverageCollectionDaysSummaryRows(receivableDaysReport);
  assert.equal(allThree.length, 3);
  assert.equal(allThree[1].key, "averageCollectionDays3m");
  assert.equal(allThree[2].key, "averageCollectionDays12m");
});

test("active customers MoM is higher-is-better and appends to the KPI summary table", () => {
  const growing = compareActiveCustomersToPriorMonth(120, 100);
  assert.equal(growing.direction, "up");
  assert.equal(growing.delta, 20);
  assert.equal(growing.polarity, "higher-is-better");

  const shrinking = compareActiveCustomersToPriorMonth(90, 100);
  assert.equal(shrinking.direction, "down");
  assert.equal(shrinking.delta, -10);

  const activeCustomersReport = buildActiveCustomersReport([
    {
      transaction_date: "2026-07-10",
      customer_code: "1001",
      salesman_code: "SM01",
      salesman_name: "Ali",
      voucher_type: "Sales",
      sales_amount: 100,
    },
    {
      transaction_date: "2026-08-05",
      customer_code: "1001",
      salesman_code: "SM01",
      salesman_name: "Ali",
      voucher_type: "Sales",
      sales_amount: 120,
    },
    {
      transaction_date: "2026-09-12",
      customer_code: "1002",
      salesman_code: "SM01",
      salesman_name: "Ali",
      voucher_type: "Sales",
      sales_amount: 80,
    },
    {
      transaction_date: "2026-10-01",
      customer_code: "1003",
      salesman_code: "SM02",
      salesman_name: "Omar",
      voucher_type: "Sales",
      sales_amount: 90,
    },
  ], { asOfDate: "2026-11-05", companyOnly: true });

  const alone = buildActiveCustomersSummaryRow(activeCustomersReport);
  assert.equal(alone.key, "activeCustomers");
  assert.equal(alone.label, "Active customers");
  assert.equal(alone.kind, "activeCustomers");
  // Latest complete month is October when as-of is early November.
  assert.equal(alone.month, "2026-10");
  assert.equal(alone.totalFiltered.actual, 3);
  assert.equal(alone.paceEstimate.estimate, null);
  assert.equal(alone.vsLastMonth.direction, "up");
  assert.ok(alone.vsLastMonth.delta > 0);

  const salesGrowing = compareActiveCustomersSalesToPriorMonth(500_000, 400_000);
  assert.equal(salesGrowing.direction, "up");
  assert.equal(salesGrowing.delta, 100_000);
  assert.equal(salesGrowing.polarity, "higher-is-better");

  const salesAlone = buildActiveCustomersSalesSummaryRow(activeCustomersReport);
  assert.equal(salesAlone.key, "activeCustomersSales");
  assert.equal(salesAlone.label, "Active customers sales (120d)");
  assert.equal(salesAlone.kind, "activeCustomersSales");
  // Open-month trailing 120d (as of early November) vs end of October.
  assert.equal(salesAlone.month, "2026-11");
  assert.equal(salesAlone.totalFiltered.actual, activeCustomersReport.company.currentSales);
  assert.equal(salesAlone.vsLastMonth.priorActual, activeCustomersReport.company.latestCompleteSales);
  assert.equal(salesAlone.paceEstimate.estimate, null);

  const family = buildActiveCustomersSummaryRows(activeCustomersReport);
  assert.equal(family.length, 2);
  assert.equal(family[0].key, "activeCustomers");
  assert.equal(family[1].key, "activeCustomersSales");

  const summary = buildKpiUploadSummaryTable({
    rows: [ahmed],
    reportDate: "2026-11-01",
    todayIso: "2026-11-05",
    salesAsOfDate: "2026-10-15",
    receiptAsOfDate: "2026-10-14",
    priorMonth: "2026-10",
    priorMonthActualsByCode: {
      AHMED: { totalSales: 180_000, collection: 250_000, cashCollection: 0 },
    },
    activeCustomersReport,
  });
  assert.equal(summary.rows.length, 5);
  assert.equal(summary.rows.at(-2).key, "activeCustomers");
  assert.equal(summary.rows.at(-1).key, "activeCustomersSales");
  assert.equal(summary.rows.at(-2).vsLastMonth.direction, "up");
});

test("summary table reads nested snapshot targets like the KPI Targets page", () => {
  const summary = buildKpiUploadSummaryTable({
    rows: [{
      salesmanCode: "AHMED",
      salesmanName: "Ahmed",
      targets: {
        officeSupplies: 100_000,
        localItemSales: 50_000,
        otherSales: 50_000,
        totalSales: 200_000,
        collection: 400_000,
      },
      kpis: [
        { key: "totalSales", actual: 180_000 },
        { key: "collection", actual: 300_000 },
      ],
    }],
    reportDate: "2026-10-01",
    todayIso: "2026-10-20",
  });
  assert.equal(summary.rows[0].totalFiltered.target, 200_000);
  assert.equal(summary.rows[1].totalFiltered.target, 400_000);
});

test("email HTML uses transposed header labels", () => {
  // Higher October AR vs thin October credit sales makes YTD DSO worsen vs September.
  const receivableDaysReport = buildReceivableDaysReport({
    monthlyCreditSales: {
      "2026-09": 600_000,
      "2026-10": 50_000,
    },
    monthlyReceivables: {
      "2026-09": 200_000,
      "2026-10": 500_000,
    },
    asOfDate: "2026-10-20",
  });
  const summary = buildKpiUploadSummaryTable({
    rows: [ahmed],
    reportDate: "2026-10-01",
    todayIso: "2026-10-20",
    salesAsOfDate: "2026-10-15",
    receiptAsOfDate: "2026-10-14",
    priorMonth: "2026-09",
    priorMonthActualsByCode: {
      AHMED: { totalSales: 180_000, collection: 250_000 },
    },
    receivableDaysReport,
  });
  assert.equal(summary.rows.at(-1).vsLastMonth.direction, "down");
  const activeCustomersReport = buildActiveCustomersReport([
    {
      transaction_date: "2026-08-01",
      customer_code: "A1",
      voucher_type: "Sales",
      sales_amount: 10,
    },
    {
      transaction_date: "2026-09-01",
      customer_code: "A1",
      voucher_type: "Sales",
      sales_amount: 10,
    },
    {
      transaction_date: "2026-09-15",
      customer_code: "A2",
      voucher_type: "Sales",
      sales_amount: 10,
    },
    {
      transaction_date: "2026-10-02",
      customer_code: "A1",
      voucher_type: "Sales",
      sales_amount: 10,
    },
    {
      transaction_date: "2026-10-03",
      customer_code: "A2",
      voucher_type: "Sales",
      sales_amount: 10,
    },
    {
      transaction_date: "2026-10-04",
      customer_code: "A3",
      voucher_type: "Sales",
      sales_amount: 10,
    },
  ], { asOfDate: "2026-11-05", companyOnly: true });
  const withActive = buildKpiUploadSummaryTable({
    rows: [ahmed],
    reportDate: "2026-11-01",
    todayIso: "2026-11-05",
    salesAsOfDate: "2026-10-15",
    receiptAsOfDate: "2026-10-14",
    priorMonth: "2026-10",
    priorMonthActualsByCode: {
      AHMED: { totalSales: 180_000, collection: 250_000 },
    },
    receivableDaysReport,
    activeCustomersReport,
  });
  assert.equal(
    summary.rows.find((row) => row.key === "averageCollectionDays")?.vsLastMonth.direction,
    "down",
  );
  const message = buildKpiUploadSummaryEmail({
    summary: withActive,
    triggers: ["sales-upload", "receipt-upload"],
    env: { NEXT_PUBLIC_APP_ORIGIN: "https://madiba-sfa.vercel.app" },
  });
  assert.match(message.subject, /KPI Targets summary/);
  assert.match(message.html, /Total \(filtered\)/);
  assert.match(message.html, /Estimated month-end sales/);
  assert.match(message.html, /vs last month/);
  assert.match(message.html, /Total sales/);
  assert.match(message.html, /Collection/);
  assert.match(message.html, /Total cash collected/);
  assert.match(message.html, /Avg collection days \(YTD\)/);
  assert.match(message.html, /Avg collection days \(Rolling 3m\)/);
  assert.match(message.html, /Avg collection days \(Rolling 12m\)/);
  assert.match(message.html, /getting worse vs last month/);
  assert.match(message.html, /Active customers/);
  assert.match(message.html, /Active customers sales \(120d\)/);
  assert.match(message.html, /Higher is better · 120-day sales/);
  assert.match(message.html, /growing vs last month/);
  assert.match(message.html, /Open Active Customers/);
  assert.match(message.html, /#0f4c5c/);
  assert.match(message.text, /Uploads: sales-upload, receipt-upload|sales-upload/);
  assert.match(message.text, /Avg collection days \(YTD\)/);
  assert.match(message.text, /Avg collection days \(Rolling 3m\)/);
  assert.match(message.text, /Avg collection days \(Rolling 12m\)/);
  assert.match(message.text, /getting worse vs last month/);
  assert.match(message.text, /Active customers/);
  assert.match(message.text, /Active customers sales \(120d\)/);
  assert.match(message.text, /growing vs last month/);
  assert.match(message.text, /\/management\/active-customers/);
});

test("recipients default to malik and accept overrides", () => {
  assert.deepEqual(resolveKpiUploadSummaryEmailRecipients({}), ["malik@pinasz.com"]);
  assert.deepEqual(
    resolveKpiUploadSummaryEmailRecipients({ KPI_UPLOAD_SUMMARY_EMAIL_TO: "a@x.com,b@y.com" }),
    ["malik@pinasz.com", "a@x.com", "b@y.com"],
  );
  assert.deepEqual(
    resolveKpiUploadSummaryEmailRecipients({ KPI_UPLOAD_SUMMARY_EMAIL_TEST_TO: "test@x.com" }),
    ["test@x.com"],
  );
});

test("CC defaults to Fazlur and accepts extras without duplicating To", () => {
  assert.deepEqual(
    resolveKpiUploadSummaryEmailCc({}, ["malik@pinasz.com"]),
    ["fazlur.rahiman@noorshukran.com"],
  );
  assert.deepEqual(
    resolveKpiUploadSummaryEmailCc(
      { KPI_UPLOAD_SUMMARY_EMAIL_CC: "extra@x.com" },
      ["malik@pinasz.com"],
    ),
    ["fazlur.rahiman@noorshukran.com", "extra@x.com"],
  );
  assert.deepEqual(
    resolveKpiUploadSummaryEmailCc({}, ["fazlur.rahiman@noorshukran.com"]),
    [],
  );
});

test("run cycle test to override skips CC and last-sent marker", async () => {
  const summary = buildKpiUploadSummaryTable({
    rows: [ahmed],
    reportDate: "2026-10-01",
    todayIso: "2026-10-20",
  });
  const sent = [];
  let lastSent = { signature: "keep-me" };
  const result = await runKpiUploadSummaryEmailCycle({}, {
    force: true,
    to: "test@example.com",
    env: {
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
      SMTP_USER: "u",
      SMTP_PASS: "p",
      SMTP_FROM: "from@example.com",
    },
    loadPending: async () => ({}),
    savePending: async () => {},
    clearPending: async () => {},
    loadLastSent: async () => lastSent,
    saveLastSent: async (_admin, value) => { lastSent = value; },
    loadPayload: async () => ({ summary }),
    send: async (message) => { sent.push(message); },
  });
  assert.equal(result.skipped, false);
  assert.deepEqual(result.to, ["test@example.com"]);
  assert.deepEqual(result.cc, []);
  assert.equal(sent.length, 1);
  assert.equal(lastSent.signature, "keep-me");
});

test("run cycle waits for debounce then sends once", async () => {
  const pending = mergeKpiUploadSummaryPending({}, {
    trigger: "sales-upload",
    now: new Date("2026-10-29T10:00:00.000Z"),
  });
  let savedPending = pending;
  let lastSent = {};
  const sent = [];
  const summary = buildKpiUploadSummaryTable({
    rows: [ahmed],
    reportDate: "2026-10-01",
    todayIso: "2026-10-20",
    salesAsOfDate: "2026-10-15",
    receiptAsOfDate: "2026-10-14",
    priorMonth: "2026-09",
    priorMonthActualsByCode: { AHMED: { totalSales: 100_000, collection: 100_000 } },
  });

  const early = await runKpiUploadSummaryEmailCycle({}, {
    now: new Date("2026-10-29T10:10:00.000Z"),
    env: {
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
      SMTP_USER: "u",
      SMTP_PASS: "p",
      SMTP_FROM: "from@example.com",
    },
    loadPending: async () => savedPending,
    savePending: async (_admin, value) => { savedPending = value; },
    clearPending: async () => { savedPending = { pending: false }; },
    loadLastSent: async () => lastSent,
    saveLastSent: async (_admin, value) => { lastSent = value; },
    loadPayload: async () => ({ summary }),
    send: async (message) => { sent.push(message); },
  });
  assert.equal(early.skipped, true);
  assert.equal(early.reason, "debounce_wait");
  assert.equal(sent.length, 0);

  const due = await runKpiUploadSummaryEmailCycle({}, {
    now: new Date("2026-10-29T10:18:00.000Z"),
    env: {
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
      SMTP_USER: "u",
      SMTP_PASS: "p",
      SMTP_FROM: "from@example.com",
    },
    loadPending: async () => savedPending,
    savePending: async (_admin, value) => { savedPending = value; },
    clearPending: async () => { savedPending = { pending: false }; },
    loadLastSent: async () => lastSent,
    saveLastSent: async (_admin, value) => { lastSent = value; },
    loadPayload: async () => ({ summary }),
    send: async (message) => { sent.push(message); },
  });
  assert.equal(due.skipped, false);
  assert.equal(due.sentCount, 1);
  assert.equal(sent.length, 1);
  assert.equal(savedPending.pending, false);
  assert.equal(lastSent.signature, kpiUploadSummarySignature(summary));

  savedPending = mergeKpiUploadSummaryPending({}, {
    trigger: "receipt-upload",
    now: new Date("2026-10-29T11:00:00.000Z"),
  });
  const unchanged = await runKpiUploadSummaryEmailCycle({}, {
    now: new Date("2026-10-29T11:18:00.000Z"),
    env: {
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
      SMTP_USER: "u",
      SMTP_PASS: "p",
      SMTP_FROM: "from@example.com",
    },
    loadPending: async () => savedPending,
    savePending: async (_admin, value) => { savedPending = value; },
    clearPending: async () => { savedPending = { pending: false }; },
    loadLastSent: async () => lastSent,
    saveLastSent: async (_admin, value) => { lastSent = value; },
    loadPayload: async () => ({ summary }),
    send: async (message) => { sent.push(message); },
  });
  assert.equal(unchanged.skipped, true);
  assert.equal(unchanged.reason, "unchanged");
  assert.equal(sent.length, 1);
});
