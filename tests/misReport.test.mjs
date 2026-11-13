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
  assert.equal(report.previousMonth, "2026-09");
  const building = report.categories.find((row) => row.period === "2026-10" && row.category === "Building Material");
  assert.ok(building);
  assert.equal(building.sales, 150000);
  assert.equal(building.previousSales, 200000);
  assert.ok(building.salesMomPct < 0);
  assert.equal(building.gp, 28000);
  assert.equal(building.previousGp, 30000);
  assert.equal(building.gpPct, 18.7);
  assert.equal(building.previousGpPct, 15);
  // Prior-only category still appears on the as-of mix with zero current sales.
  const personal = report.categories.find((row) => row.period === "2026-10" && row.category === "Personal Care");
  assert.ok(personal);
  assert.equal(personal.sales, 0);
  assert.equal(personal.previousSales, 50000);
  assert.equal(personal.salesMomPct, -100);
});


test("buildMisReport exposes category-wise repeat MoM", () => {
  const report = buildMisReport({
    asOfDate: "2026-10-31",
    salesRows: [
      { transaction_date: "2026-09-01", customer_code: "1001", item_name: "Hammer", category: "Building Material", salesman_name: "ZIA", sales_amount: 50000, profit_amount: 10000 },
      { transaction_date: "2026-09-10", customer_code: "1001", item_name: "Hammer", category: "Building Material", salesman_name: "ZIA", sales_amount: 70000, profit_amount: 14000 },
      { transaction_date: "2026-10-05", customer_code: "1001", item_name: "Hammer", category: "Building Material", salesman_name: "ZIA", sales_amount: 40000, profit_amount: 8000 },
      { transaction_date: "2026-09-02", customer_code: "2002", item_name: "Soap", category: "Personal Care", salesman_name: "OSAMA", sales_amount: 20000, profit_amount: 4000 },
      { transaction_date: "2026-10-12", customer_code: "2002", item_name: "Soap", category: "Personal Care", salesman_name: "OSAMA", sales_amount: 60000, profit_amount: 12000 },
    ],
    receiptRows: [],
    outstandingRows: [],
  });
  const building = report.repeatCategories.find((row) => row.category === "Building Material");
  const personal = report.repeatCategories.find((row) => row.category === "Personal Care");
  assert.ok(building);
  assert.equal(building.previousSales, 70000);
  assert.equal(building.sales, 40000);
  assert.equal(building.delta, -30000);
  assert.ok(building.salesMomPct < 0);
  assert.ok(personal);
  assert.equal(personal.previousSales, 0);
  assert.equal(personal.sales, 60000);
  assert.equal(personal.delta, 60000);
  assert.ok(personal.salesMomPct > 0);
});

test("buildMisReport counts same-month repurchase after a one-day gap as repeat", () => {
  const report = buildMisReport({
    asOfDate: "2026-10-31",
    salesRows: [
      { transaction_date: "2026-10-01", customer_code: "1001", item_name: "Hammer", category: "Building Material", salesman_name: "ZIA", sales_amount: 100000, profit_amount: 20000 },
      { transaction_date: "2026-10-01", customer_code: "1001", item_name: "Hammer", category: "Building Material", salesman_name: "ZIA", sales_amount: 25000, profit_amount: 5000 },
      { transaction_date: "2026-10-02", customer_code: "1001", item_name: "Hammer", category: "Building Material", salesman_name: "ZIA", sales_amount: 80000, profit_amount: 16000 },
      { transaction_date: "2026-10-15", customer_code: "2002", item_name: "Soap", category: "Personal Care", salesman_name: "OSAMA", sales_amount: 40000, profit_amount: 8000 },
    ],
    receiptRows: [],
    outstandingRows: [],
  });
  // Same-day first purchases stay new; next-day Hammer is repeat.
  assert.equal(report.headline.repeatSales, 80000);
  assert.equal(report.monthlyRepeat["2026-10"].sales, 80000);
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

test("buildMisReport inventory days use last-30-day forward cover", () => {
  // Window 2026-10-02..2026-10-31. Sep sales must not affect current cover.
  const report = buildMisReport({
    asOfDate: "2026-10-31",
    salesRows: [
      { transaction_date: "2026-09-15", customer_code: "1", item_name: "A", category: "Sundry", salesman_name: "A", sales_amount: 999999, profit_amount: 1 },
      { transaction_date: "2026-10-05", customer_code: "1", item_name: "A", category: "Sundry", salesman_name: "A", sales_amount: 300000, profit_amount: 30000 },
      { transaction_date: "2026-10-20", customer_code: "2", item_name: "B", category: "Fragrance", salesman_name: "B", sales_amount: 150000, profit_amount: 20000 },
    ],
    receiptRows: [],
    outstandingRows: [],
    inventoryPhysical: {
      physical: 1000000,
      previousPhysical: 900000,
      byCategory: { Sundry: 600000, Fragrance: 400000 },
    },
  });
  assert.equal(report.inventory.sales30d, 450000);
  assert.equal(report.inventory.coverFrom, "2026-10-02");
  assert.equal(report.inventory.coverTo, "2026-10-31");
  // 1_000_000 ÷ (450_000 / 30) = 66.67 → 67
  assert.equal(report.inventory.days, 67);
  const sundry = report.inventory.categories.find((row) => row.category === "Sundry");
  const fragrance = report.inventory.categories.find((row) => row.category === "Fragrance");
  assert.equal(sundry.sales30d, 300000);
  assert.equal(sundry.days, 60); // 600000 ÷ (300000/30)
  assert.equal(sundry.forwardCoverDays, 60);
  assert.equal(fragrance.days, 80); // 400000 ÷ (150000/30)
  assert.equal(fragrance.forwardCoverDays, 80);
  // Prior cover ends 2026-09-30 → window 2026-09-01..2026-09-30 (only Sep 15 sale).
  assert.equal(report.inventory.previousSales30d, 999999);
  assert.equal(report.inventory.previousDays, 27); // 900000 ÷ (999999/30) ≈ 27
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
});

test("buildMisReport receivables remark uses rolling 3m collection days and change", () => {
  const report = buildMisReport({
    asOfDate: "2026-10-31",
    salesRows: [
      { transaction_date: "2026-08-15", customer_code: "1", item_name: "A", category: "Sundry", salesman_name: "A", sales_amount: 200000, profit_amount: 20000 },
      { transaction_date: "2026-09-15", customer_code: "1", item_name: "A", category: "Sundry", salesman_name: "A", sales_amount: 200000, profit_amount: 20000 },
      { transaction_date: "2026-10-15", customer_code: "1", item_name: "A", category: "Sundry", salesman_name: "A", sales_amount: 200000, profit_amount: 20000 },
    ],
    receiptRows: [],
    outstandingRows: [
      { total_outstanding: 300000, buckets: { "0-30": 0, "31-60": 0, "61-90": 0, "91-120": 100000, ">120": 200000 } },
    ],
    priorOutstanding: {
      totalAr: 360000,
      gt90Ar: 250000,
      arBuckets: { "0-30": 0, "31-60": 0, "61-90": 0, "91-120": 50000, ">120": 200000 },
    },
  });
  // Trailing 3m sales Aug–Oct = 600000; days Aug 1–Oct 31 = 92.
  // (300000 / 600000) × 92 = 46.
  assert.equal(report.headline.collectionDays3m, 46);
  // Prior: Sep end AR 360000; Jul–Sep sales only Aug+Sep = 400000 in this fixture; days Jul1–Sep30 = 92.
  // Jul has 0 sales so sales3m = 400000; (360000/400000)*92 = 82.8.
  assert.equal(report.headline.previousCollectionDays3m, 82.8);
  assert.equal(report.headline.collectionDays3mChange, -36.8);
  assert.match(report.remarks.receivables, /rolling 3m collection days ~46/);
  assert.match(report.remarks.receivables, /improving vs prior month/);
  assert.match(report.remarks.receivables, />90-day AR is SAR 300K/);
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

test("buildMisReport portfolio category MoM and top loss items exclude electronics", () => {
  const report = buildMisReport({
    asOfDate: "2026-10-31",
    salesRows: [
      {
        transaction_date: "2026-09-10",
        customer_code: "1",
        item_code: "P001",
        item_name: "Soap A",
        category: "Personal Care",
        salesman_name: "A",
        sales_amount: 100000,
        profit_amount: 20000,
      },
      {
        transaction_date: "2026-10-10",
        customer_code: "1",
        item_code: "P001",
        item_name: "Soap A",
        category: "Personal Care",
        salesman_name: "A",
        sales_amount: 40000,
        profit_amount: 8000,
      },
      {
        transaction_date: "2026-09-05",
        customer_code: "2",
        item_code: "S001",
        item_name: "Gift wrap",
        category: "Sundry",
        salesman_name: "B",
        sales_amount: 50000,
        profit_amount: 15000,
      },
      {
        transaction_date: "2026-10-05",
        customer_code: "2",
        item_code: "S001",
        item_name: "Gift wrap",
        category: "Sundry",
        salesman_name: "B",
        sales_amount: 50000,
        profit_amount: 15000,
      },
      {
        transaction_date: "2026-09-01",
        customer_code: "3",
        item_code: "E001",
        item_name: "Fan",
        category: "Electronics",
        salesman_name: "C",
        sales_amount: 200000,
        profit_amount: 5000,
      },
      {
        transaction_date: "2026-10-01",
        customer_code: "3",
        item_code: "E001",
        item_name: "Fan",
        category: "Electronics",
        salesman_name: "C",
        sales_amount: 50000,
        profit_amount: 2000,
      },
    ],
    receiptRows: [],
    outstandingRows: [],
  });

  const personalCare = report.portfolioCategories.find((row) => row.category === "Personal Care");
  assert.ok(personalCare);
  assert.equal(personalCare.sales, 40000);
  assert.equal(personalCare.previousSales, 100000);
  assert.equal(personalCare.salesLoss, 60000);
  assert.ok(personalCare.salesMomPct < 0);

  const sundry = report.portfolioCategories.find((row) => row.category === "Sundry");
  assert.ok(sundry);
  assert.equal(sundry.salesLoss, 0);

  assert.ok(report.portfolioTopLossItems.length >= 1);
  assert.equal(report.portfolioTopLossItems[0].itemCode, "P001");
  assert.equal(report.portfolioTopLossItems[0].salesLoss, 60000);
  assert.ok(!report.portfolioTopLossItems.some(
    (row) => String(row.category || "").trim().toLowerCase() === "electronics",
  ));
});
