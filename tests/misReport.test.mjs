import test from "node:test";
import assert from "node:assert/strict";
import { buildMisReport } from "../app/lib/misReport.js";

test("buildMisReport computes month sales, GP, MoM and item-level repeat", () => {
  const report = buildMisReport({
    asOfDate: "2026-10-31",
    salesRows: [
      { transaction_date: "2026-08-10", customer_code: "1001", item_name: "Hammer", category: "Building Material", salesman_name: "ZIA", sales_amount: 100000, profit_amount: 20000 },
      { transaction_date: "2026-09-05", customer_code: "1001", item_name: "Hammer", category: "Building Material", salesman_name: "ZIA", sales_amount: 200000, profit_amount: 30000 },
      { transaction_date: "2026-09-12", customer_code: "2002", item_name: "Soap", category: "Personal Care", salesman_name: "OSAMA", sales_amount: 50000, profit_amount: 12000 },
      { transaction_date: "2026-10-08", customer_code: "1001", item_name: "Hammer", category: "Building Material", salesman_name: "ZIA", sales_amount: 150000, profit_amount: 28000 },
      { transaction_date: "2026-10-15", customer_code: "3003", item_name: "Perfume", category: "Fragrance", salesman_name: "PARVEZ", sales_amount: 80000, profit_amount: 20000 },
    ],
    receiptRows: [
      { receipt_date: "2026-09-20", vch_type: "Receipt", customer_code: "1001", amount: 90000 },
      { receipt_date: "2026-10-18", vch_type: "Receipt", customer_code: "1001", amount: 120000 },
      { receipt_date: "2026-10-19", vch_type: "Journal", customer_code: "1001", amount: 999999 },
    ],
    outstandingRows: [
      { total_outstanding: 500000, buckets: { "0-30": 100000, "31-60": 50000, "61-90": 50000, "91-120": 100000, ">120": 200000 } },
    ],
  });

  assert.equal(report.asOfMonth, "2026-10");
  assert.equal(report.headline.sales, 230000);
  assert.equal(report.headline.previousSales, 250000);
  assert.equal(report.headline.gp, 48000);
  assert.ok(report.headline.salesMomPct < 0);
  assert.equal(report.headline.collection, 120000);
  assert.equal(report.headline.gt90Ar, 300000);
  assert.equal(report.headline.previousYtdSales, 350000);
  assert.ok(Number.isFinite(report.headline.ytdMomPct));
  assert.ok(Number.isFinite(report.headline.repeatMomPct));
  // Hammer repurchase in Oct counts as repeat sale.
  assert.equal(report.headline.repeatSales, 150000);
  assert.equal(report.headline.newCustomers, 1);
  assert.equal(report.headline.repeatCustomers, 1);
  assert.ok(report.remarks.bottomLine);
  assert.ok(report.categories.some((row) => row.period === "2026-10" && row.category === "Building Material"));
});

test("buildMisReport attaches prior AR bucket MoM when provided", () => {
  const report = buildMisReport({
    asOfDate: "2026-10-31",
    salesRows: [
      { transaction_date: "2026-09-01", customer_code: "1", item_name: "A", category: "Sundry", salesman_name: "A", sales_amount: 100000, profit_amount: 10000 },
      { transaction_date: "2026-10-01", customer_code: "1", item_name: "A", category: "Sundry", salesman_name: "A", sales_amount: 120000, profit_amount: 15000 },
    ],
    receiptRows: [],
    outstandingRows: [
      { total_outstanding: 200000, buckets: { "0-30": 50000, "31-60": 50000, "61-90": 20000, "91-120": 30000, ">120": 50000 } },
    ],
    priorOutstanding: {
      totalAr: 180000,
      gt90Ar: 70000,
      arBuckets: { "0-30": 40000, "31-60": 40000, "61-90": 30000, "91-120": 20000, ">120": 50000 },
    },
    inventoryPhysical: {
      physical: 1000000,
      previousPhysical: 900000,
      byCategory: { Sundry: 600000, Fragrance: 400000 },
    },
  });
  assert.equal(report.headline.gt90Ar, 80000);
  assert.ok(report.headline.gt90ArMomPct > 0);
  assert.equal(report.headline.previousArBuckets["0-30"], 40000);
  assert.ok(report.headline.arBucketMomPct["0-30"] > 0);
  assert.equal(report.inventory.physical, 1000000);
  assert.equal(report.inventory.categories.length, 2);
});

test("buildMisReport collection days uses YTD DSO not month/30", () => {
  const report = buildMisReport({
    asOfDate: "2026-10-31",
    salesRows: [
      { transaction_date: "2026-01-15", customer_code: "1", item_name: "A", category: "Sundry", salesman_name: "A", sales_amount: 900000, profit_amount: 90000 },
      { transaction_date: "2026-10-15", customer_code: "1", item_name: "A", category: "Sundry", salesman_name: "A", sales_amount: 100000, profit_amount: 10000 },
    ],
    receiptRows: [],
    outstandingRows: [
      { total_outstanding: 500000, buckets: { "0-30": 500000, "31-60": 0, "61-90": 0, "91-120": 0, ">120": 0 } },
    ],
  });
  // (500000 / 1000000) × 304 = 152 — not 500000 / (100000 / 30) = 150.
  assert.equal(report.headline.collectionDays, 152);
  assert.match(report.remarks.receivables, /collection days ~152/);
});

test("buildMisReport tracks MADIBA monthly sales for focus categories", () => {
  const report = buildMisReport({
    asOfDate: "2026-10-31",
    salesRows: [
      { transaction_date: "2026-09-10", customer_code: "1", item_name: "MADIBA Soap", category: "Personal Care", salesman_name: "A", sales_amount: 40000, profit_amount: 8000 },
      { transaction_date: "2026-10-10", customer_code: "1", item_name: "MADIBA Cream", category: "Personal Care", salesman_name: "A", sales_amount: 60000, profit_amount: 12000 },
      { transaction_date: "2026-10-11", customer_code: "2", item_name: "Other Soap", category: "Personal Care", salesman_name: "A", sales_amount: 50000, profit_amount: 5000 },
    ],
    receiptRows: [],
    outstandingRows: [],
  });
  assert.equal(report.monthlyMadibaSales["2026-09"], 40000);
  assert.equal(report.monthlyMadibaSales["2026-10"], 60000);
  assert.equal(report.monthlyMadibaByCategory["2026-10"]["Personal Care"], 60000);
});

test("buildMisReport selected portfolio excludes electronics and building material", () => {
  const report = buildMisReport({
    asOfDate: "2026-10-31",
    salesRows: [
      { transaction_date: "2026-10-01", customer_code: "1", item_name: "Fan", category: "Electronics", salesman_name: "A", sales_amount: 100000, profit_amount: 5000 },
      { transaction_date: "2026-10-02", customer_code: "2", item_name: "Cream", category: "Personal Care", salesman_name: "B", sales_amount: 40000, profit_amount: 10000 },
    ],
    receiptRows: [],
    outstandingRows: [],
  });
  assert.equal(report.portfolio["2026-10"].sales, 40000);
  assert.equal(report.portfolio["2026-10"].gpPct, 25);
});
