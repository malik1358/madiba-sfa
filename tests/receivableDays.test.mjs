import test from "node:test";
import assert from "node:assert/strict";
import {
  accumulateMonthEndReceivables,
  buildReceivableDaysReport,
  creditSalesYtdThroughMonth,
  monthEndOpenReceivablesExclVat,
  receivableDays,
  receivableDaysChangeTone,
  ksaMonthKey,
  lastOutstandingUploadByMonth,
  parseStoredOutstandingUploadedAt,
  planOutstandingMonthUploads,
  receivableYtdDays,
  receivablesFromOutstandingPlan,
  sumTallyOutstandingRows,
  tallyReceivablesByMonth,
} from "../app/lib/receivableDays.js";
import { matchPaymentsFifo } from "../app/lib/paymentBehavior.js";

test("receivableDays uses YTD sales and YTD days", () => {
  // AR 300_000 / credit YTD 900_000 × 90 days = 30
  assert.equal(receivableDays(300000, 900000, 90), 30);
  assert.equal(receivableDays(0, 900000, 90), 0);
  assert.equal(receivableDays(300000, 0, 90), null);
  assert.equal(receivableDays(300000, 900000, 0), null);
});

test("receivableYtdDays counts from 1 Jan through month-end or asOf", () => {
  assert.equal(receivableYtdDays("2026-01"), 31);
  assert.equal(receivableYtdDays("2026-02"), 31 + 28);
  assert.equal(receivableYtdDays("2026-03", "2026-03-15"), 31 + 28 + 15);
  assert.equal(receivableYtdDays("2024-02"), 31 + 29);
});

test("creditSalesYtdThroughMonth sums calendar year months only", () => {
  const monthly = {
    "2025-12": 100,
    "2026-01": 200,
    "2026-02": 300,
    "2026-03": 400,
  };
  assert.equal(creditSalesYtdThroughMonth(monthly, "2026-02"), 500);
  assert.equal(creditSalesYtdThroughMonth(monthly, "2025-12"), 100);
  assert.equal(creditSalesYtdThroughMonth(monthly, "2026-03"), 900);
});

test("monthEndOpenReceivablesExclVat ignores later receipts and cash vouchers", () => {
  const fifo = matchPaymentsFifo(
    [
      {
        transaction_date: "2026-01-10",
        voucher_number: "NFD/100",
        voucher_type: "Sales",
        sales_amount: 1000,
        category: "Office Supplies",
        item_code: "A1",
        item_name: "Paper",
      },
      {
        transaction_date: "2026-01-12",
        voucher_number: "RC/55",
        voucher_type: "Sales",
        sales_amount: 500,
        category: "Office Supplies",
        item_code: "A1",
        item_name: "Paper",
      },
      {
        transaction_date: "2026-02-05",
        voucher_number: "NFD/200",
        voucher_type: "Sales",
        sales_amount: 2000,
        category: "Office Supplies",
        item_code: "A1",
        item_name: "Paper",
      },
    ],
    [
      // Full clear of Jan credit (1150 incl) after cash bill is ignored in AR numerator.
      { receipt_date: "2026-01-20", amount: 1150, vch_no: "R1", vch_type: "Receipt" },
      { receipt_date: "2026-01-21", amount: 575, vch_no: "R1b", vch_type: "Receipt" },
      { receipt_date: "2026-02-15", amount: 2300, vch_no: "R2", vch_type: "Receipt" },
    ],
  );

  // Before any receipt: credit AR is Jan credit only (cash RC excluded).
  assert.equal(monthEndOpenReceivablesExclVat(fifo, "2026-01-15"), 1000);

  // After both Jan receipts: credit cleared; cash never counts in AR.
  assert.equal(monthEndOpenReceivablesExclVat(fifo, "2026-01-31"), 0);

  // Later Feb invoice is invisible to Jan as-of.
  assert.equal(monthEndOpenReceivablesExclVat(fifo, "2026-01-31"), 0);

  // After Feb invoice, before Feb receipt: only Feb credit open.
  assert.equal(monthEndOpenReceivablesExclVat(fifo, "2026-02-10"), 2000);

  // After Feb receipt: cleared.
  assert.equal(monthEndOpenReceivablesExclVat(fifo, "2026-02-28"), 0);
});

test("accumulateMonthEndReceivables builds month map and respects asOf for open month", () => {
  const fifo = matchPaymentsFifo(
    [
      {
        transaction_date: "2026-03-01",
        voucher_number: "NFD/300",
        voucher_type: "Sales",
        sales_amount: 1500,
        category: "Office Supplies",
        item_code: "A1",
        item_name: "Paper",
      },
    ],
    [],
  );
  const map = accumulateMonthEndReceivables(fifo, ["2026-03"], new Map(), "2026-03-10");
  assert.equal(map.get("2026-03"), 1500);
});

test("buildReceivableDaysReport uses YTD denominator and marks MoM improvement", () => {
  const report = buildReceivableDaysReport({
    asOfDate: "2026-03-15",
    monthlyCreditSales: {
      "2026-01": 300000,
      "2026-02": 300000,
      "2026-03": 300000,
    },
    monthlyReceivables: {
      "2026-01": 300000,
      "2026-02": 250000,
      "2026-03": 200000,
    },
  });

  assert.equal(report.rows.length, 3);
  const jan = report.monthly["2026-01"];
  assert.equal(jan.credit_sales_ytd, 300000);
  assert.equal(jan.days, 31);
  assert.equal(jan.receivable_days, receivableDays(300000, 300000, 31));

  const feb = report.monthly["2026-02"];
  assert.equal(feb.credit_sales_ytd, 600000);
  assert.equal(feb.days, 31 + 28);
  assert.ok(feb.change_days < 0);
  assert.equal(feb.improved, true);
  assert.equal(feb.tone, "up");

  const mar = report.monthly["2026-03"];
  assert.equal(mar.credit_sales_ytd, 900000);
  assert.equal(mar.days, 31 + 28 + 15);
  assert.equal(mar.is_current, true);
  assert.equal(mar.improved, true);
});

test("receivableDaysChangeTone treats lower days as improvement", () => {
  assert.equal(receivableDaysChangeTone(40, 50), "up");
  assert.equal(receivableDaysChangeTone(55, 50), "down");
  assert.equal(receivableDaysChangeTone(50, 50), "");
  assert.equal(receivableDaysChangeTone(null, 50), "");
});

test("uploaded Tally outstanding is one balance on the as-of month", () => {
  assert.equal(sumTallyOutstandingRows([
    { total_outstanding: 10000.5 },
    { total_outstanding: 2500 },
    { total_outstanding: 0 },
  ]), 12500.5);

  const placed = tallyReceivablesByMonth(12500.5, "2026-10-16");
  assert.deepEqual(placed, { "2026-10": 12500.5 });
});

test("each month keeps the last outstanding import from that month", () => {
  assert.equal(
    parseStoredOutstandingUploadedAt("2026-09-28T18-00-00-000Z_outstanding.xlsx"),
    "2026-09-28T18:00:00.000Z",
  );
  assert.equal(ksaMonthKey("2026-09-30T21:30:00.000Z"), "2026-10");

  const stored = [
    { uploadedAt: "2026-09-02T08:00:00.000Z", filePath: "outstanding/sep-early.xlsx", total: 100 },
    { uploadedAt: "2026-09-28T18:00:00.000Z", filePath: "outstanding/sep-late.xlsx", total: 900 },
    { uploadedAt: "2026-10-16T06:00:00.000Z", filePath: "outstanding/oct.xlsx", total: 1 },
  ];
  assert.equal(lastOutstandingUploadByMonth(stored).find((row) => row.month === "2026-09").filePath, "outstanding/sep-late.xlsx");

  const plan = planOutstandingMonthUploads(stored, {
    uploadedAt: "2026-10-16T09:00:00.000Z",
    total: 4751738,
  });
  assert.deepEqual(receivablesFromOutstandingPlan([
    { month: "2026-09", total: 900 },
    ...plan.filter((row) => row.month === "2026-10"),
  ]), {
    "2026-09": 900,
    "2026-10": 4751738,
  });
  assert.equal(plan.find((row) => row.month === "2026-10").filePath, "");
  assert.equal(plan.find((row) => row.month === "2026-09").filePath, "outstanding/sep-late.xlsx");

  const report = buildReceivableDaysReport({
    asOfDate: "2026-10-16",
    monthlyCreditSales: {
      "2026-04": 28910,
      "2026-09": 20000,
      "2026-10": 40000,
    },
    monthlyReceivables: {
      "2026-09": 900,
      "2026-10": 4751738,
    },
  });

  assert.equal(report.monthly["2026-04"].receivables, null);
  assert.equal(report.monthly["2026-09"].receivables, 900);
  assert.equal(report.monthly["2026-10"].receivables, 4751738);
  assert.equal(report.totals.receivables, 4751738);
  assert.equal(report.receivablesSource, "tally_outstanding");
});

test("buildReceivableDaysReport respects date filters", () => {
  const report = buildReceivableDaysReport({
    asOfDate: "2026-06-30",
    dateFrom: "2026-02-01",
    dateTo: "2026-03-31",
    monthlyCreditSales: {
      "2026-01": 100,
      "2026-02": 100,
      "2026-03": 100,
      "2026-04": 100,
    },
    monthlyReceivables: {
      "2026-01": 50,
      "2026-02": 50,
      "2026-03": 50,
      "2026-04": 50,
    },
  });
  assert.deepEqual(report.months, ["2026-02", "2026-03"]);
  // YTD credit sales for Feb still includes January even when Jan is hidden.
  assert.equal(report.monthly["2026-02"].credit_sales_ytd, 200);
});
