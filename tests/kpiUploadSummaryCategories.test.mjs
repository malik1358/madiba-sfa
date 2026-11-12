import test from "node:test";
import assert from "node:assert/strict";

import {
  allocateReceiptsToCategoryBuckets,
  buildCustomerCategoryMixFromFacts,
  buildCategoryCollectionDaysRows,
  buildCategoryReceivableDays,
  buildKpiUploadSummaryCategoryRows,
  classifyKpiUploadSummaryCategory,
  insertKpiUploadSummaryCategoryRows,
  isOpenInvoiceExpectedThisMonth,
  KPI_UPLOAD_SUMMARY_NEVER_PAID_AVG_DAYS,
  buildKpiUploadSummaryExcludedCustomerSet,
  pickCustomerAvgDaysToPay,
  resolveLastPaidInvoiceDays,
  reconstructPriorOutstandingCategoryBuckets,
  resolveExpectedPayDate,
  scaleKpiUploadSummaryCategoryBuckets,
  sumExpectedCollectionCategoryBuckets,
  sumOutstandingCategoryBuckets,
  sumSalesCategoryBucketsFromFacts,
  withKpiUploadSummaryNonBuilding,
} from "../app/lib/kpiUploadSummaryCategories.js";
import {
  buildKpiUploadSummaryTable,
  compareAverageCollectionDaysToPriorMonth,
} from "../app/lib/kpiUploadSummaryEmail.js";
import { buildReceivableDaysReport } from "../app/lib/receivableDays.js";

test("classify prefers building material over electronics", () => {
  assert.equal(classifyKpiUploadSummaryCategory({
    category: "Building Material",
    item_name: "MDF 18MM",
  }), "buildingMaterial");
  assert.equal(classifyKpiUploadSummaryCategory({
    category: "Electronics",
    item_name: "Calculator",
  }), "electronics");
  assert.equal(classifyKpiUploadSummaryCategory({
    category: "Office supplies",
    item_name: "Stapler",
  }), "rest");
});

test("non-building is electronics plus rest and scales to parent total", () => {
  const scaled = scaleKpiUploadSummaryCategoryBuckets({
    buildingMaterial: 100,
    electronics: 50,
    rest: 50,
  }, 400);
  assert.equal(scaled.buildingMaterial, 200);
  assert.equal(scaled.electronics, 100);
  assert.equal(scaled.rest, 100);
  assert.equal(scaled.nonBuilding, 200);
  assert.equal(scaled.buildingMaterial + scaled.nonBuilding, 400);
  assert.equal(scaled.electronics + scaled.rest, scaled.nonBuilding);
});

test("cube facts sum into category buckets for the KPI salesman roster", () => {
  const facts = [
    { month: "2026-11", salesman_code: "S01", category: "Building Material", item_name: "Plywood", sales_amount: 1000 },
    { month: "2026-11", salesman_code: "S01", category: "Electronics", item_name: "Fan", sales_amount: 400 },
    { month: "2026-11", salesman_code: "S01", category: "Stationery", item_name: "Pen", sales_amount: 600 },
    { month: "2026-11", salesman_code: "OTHER", category: "Electronics", item_name: "TV", sales_amount: 9999 },
    { month: "2026-10", salesman_code: "S01", category: "Building Material", item_name: "Plywood", sales_amount: 500 },
  ];
  const buckets = sumSalesCategoryBucketsFromFacts(facts, {
    month: "2026-11",
    salesmanCodes: ["S01"],
  });
  assert.deepEqual(buckets, withKpiUploadSummaryNonBuilding({
    buildingMaterial: 1000,
    electronics: 400,
    rest: 600,
  }));
});

test("receipts allocate by customer sales mix and fall back to rest", () => {
  const mix = buildCustomerCategoryMixFromFacts([
    { month: "2026-11", salesman_code: "S01", customer_code: "1001", category: "Electronics", sales_amount: 75 },
    { month: "2026-11", salesman_code: "S01", customer_code: "1001", category: "Stationery", sales_amount: 25 },
    { month: "2026-11", salesman_code: "S01", customer_code: "1002", category: "Building Material", item_name: "MDF", sales_amount: 100 },
  ], { month: "2026-11", salesmanCodes: ["S01"] });

  const buckets = allocateReceiptsToCategoryBuckets([
    { customer_code: "1001", amount: 100 },
    { customer_code: "1002", amount: 50 },
    { customer_code: "9999", amount: 20 },
  ], mix);

  assert.equal(buckets.electronics, 75);
  assert.equal(buckets.rest, 45);
  assert.equal(buckets.buildingMaterial, 50);
  assert.equal(buckets.nonBuilding, 120);
});

test("category rows insert under Total sales and Collection in the upload summary", () => {
  const ahmed = {
    salesmanCode: "AHMED",
    salesmanName: "Ahmed",
    isTeam: false,
    totalSales: "400",
    collection: "200",
    officeSupplies: "0",
    localItemSales: "0",
    otherSales: "0",
    kpis: [
      { key: "totalSales", actual: 400 },
      { key: "collection", actual: 200 },
      { key: "totalCashCollected", actual: 200 },
      { key: "officeSupplies", actual: 0 },
      { key: "localItemSales", actual: 0 },
      { key: "otherSales", actual: 0 },
      { key: "cashCollection", actual: 0 },
      { key: "newCustomers", actual: 0 },
      { key: "repeatCustomers", actual: 0 },
    ],
  };
  const summary = buildKpiUploadSummaryTable({
    rows: [ahmed],
    reportDate: "2026-11-01",
    todayIso: "2026-11-12",
    salesAsOfDate: "2026-11-11",
    receiptAsOfDate: "2026-11-11",
    priorMonth: "2026-10",
    priorMonthActualsByCode: {
      AHMED: { totalSales: 800, collection: 100 },
    },
    categoryBreakdown: {
      salesBuckets: { buildingMaterial: 100, electronics: 100, rest: 200 },
      priorSalesBuckets: { buildingMaterial: 400, electronics: 200, rest: 200 },
      collectionBuckets: { buildingMaterial: 50, electronics: 50, rest: 100 },
      priorCollectionBuckets: { buildingMaterial: 20, electronics: 30, rest: 50 },
      expectedCollectionBuckets: { buildingMaterial: 25, electronics: 10, rest: 15 },
      outstandingBuckets: { buildingMaterial: 200000, electronics: 50000, rest: 150000 },
      cubeFacts: [
        { month: "2026-11", salesman_code: "AHMED", category: "Building Material", item_name: "MDF", credit_sales_amount: 100000 },
        { month: "2026-11", salesman_code: "AHMED", category: "Electronics", credit_sales_amount: 80000 },
        { month: "2026-11", salesman_code: "AHMED", category: "Stationery", credit_sales_amount: 120000 },
        { month: "2026-10", salesman_code: "AHMED", category: "Building Material", item_name: "MDF", credit_sales_amount: 90000 },
        { month: "2026-09", salesman_code: "AHMED", category: "Electronics", credit_sales_amount: 70000 },
      ],
      salesmanCodes: ["AHMED"],
    },
    receivableDaysReport: buildReceivableDaysReport({
      monthlyCreditSales: { "2026-10": 100000, "2026-11": 120000 },
      monthlyReceivables: { "2026-10": 50000, "2026-11": 40000 },
      asOfDate: "2026-11-12",
    }),
  });

  const labels = summary.rows.map((row) => row.label);
  assert.ok(labels.indexOf("Total sales") < labels.indexOf("Sales — Building material"));
  assert.ok(labels.indexOf("Sales — Building material") < labels.indexOf("Sales — Non-building"));
  assert.ok(labels.indexOf("Sales — Electronics") < labels.indexOf("Sales — Rest"));
  assert.ok(labels.indexOf("Collection") < labels.indexOf("Collection — Building material"));
  assert.equal(
    summary.rows.find((row) => row.key === "sales_buildingMaterial").totalFiltered.actual
      + summary.rows.find((row) => row.key === "sales_nonBuilding").totalFiltered.actual,
    400,
  );
  assert.equal(
    summary.rows.find((row) => row.key === "collection_electronics").totalFiltered.actual
      + summary.rows.find((row) => row.key === "collection_rest").totalFiltered.actual,
    summary.rows.find((row) => row.key === "collection_nonBuilding").totalFiltered.actual,
  );
  assert.equal(
    summary.rows.find((row) => row.key === "collection_buildingMaterial").paceEstimate.estimate,
    75,
  );
  assert.match(
    summary.rows.find((row) => row.key === "collection_buildingMaterial").totalFiltered.statusLabel,
    /expected this month/,
  );
  assert.ok(labels.indexOf("Avg collection days (YTD)") < labels.indexOf("Avg collection days (YTD) — Building material"));
  assert.ok(summary.rows.some((row) => row.key === "averageCollectionDays_buildingMaterial"));
  for (const key of [
    "averageCollectionDays_buildingMaterial",
    "averageCollectionDays_nonBuilding",
    "averageCollectionDays_electronics",
    "averageCollectionDays_rest",
  ]) {
    const row = summary.rows.find((entry) => entry.key === key);
    assert.ok(row?.vsLastMonth, `${key} should have vs last month`);
    assert.equal(row.vsLastMonth.polarity, "lower-is-better");
    assert.ok(Number.isFinite(row.vsLastMonth.estimate), `${key} estimate`);
  }
  const bmDays = summary.rows.find((row) => row.key === "averageCollectionDays_buildingMaterial");
  assert.ok(Number.isFinite(bmDays.vsLastMonth.priorActual));
  assert.ok(Number.isFinite(bmDays.vsLastMonth.delta));
});

test("reconstructPriorOutstandingCategoryBuckets floors at zero", () => {
  const prior = reconstructPriorOutstandingCategoryBuckets({
    currentOutstanding: { buildingMaterial: 100, electronics: 40, rest: 60 },
    creditSalesThisMonth: { buildingMaterial: 30, electronics: 50, rest: 10 },
    collectionMtd: { buildingMaterial: 20, electronics: 5, rest: 15 },
  });
  assert.equal(prior.buildingMaterial, 90);
  assert.equal(prior.electronics, 0);
  assert.equal(prior.rest, 65);
  assert.equal(prior.nonBuilding, 65);
});

test("buildCategoryCollectionDaysRows attaches lower-is-better MoM", () => {
  const rows = buildCategoryCollectionDaysRows({
    parentKey: "averageCollectionDays",
    parentLabel: "Avg collection days (YTD)",
    daysByCategory: buildCategoryReceivableDays({
      outstandingBuckets: { buildingMaterial: 80, electronics: 40, rest: 60 },
      creditSalesBuckets: { buildingMaterial: 100, electronics: 50, rest: 50 },
      days: 100,
    }),
    priorDaysByCategory: buildCategoryReceivableDays({
      outstandingBuckets: { buildingMaterial: 100, electronics: 30, rest: 70 },
      creditSalesBuckets: { buildingMaterial: 100, electronics: 50, rest: 50 },
      days: 100,
    }),
    compareFn: compareAverageCollectionDaysToPriorMonth,
    month: "2026-11",
  });
  const bm = rows.find((row) => row.categoryKey === "buildingMaterial");
  assert.equal(bm.month, "2026-11");
  assert.equal(bm.vsLastMonth.polarity, "lower-is-better");
  assert.equal(bm.vsLastMonth.direction, "up");
  assert.ok(bm.vsLastMonth.delta < 0);
});

test("overdue still-open invoices count toward this month expected remaining", () => {
  assert.equal(resolveExpectedPayDate("2026-09-20", 45), "2026-11-04");
  assert.equal(isOpenInvoiceExpectedThisMonth({
    invoiceDate: "2026-09-01",
    avgDays: 30,
    monthEnd: "2026-11-30",
  }), true);
  assert.equal(isOpenInvoiceExpectedThisMonth({
    invoiceDate: "2026-11-01",
    avgDays: 45,
    monthEnd: "2026-11-30",
  }), false);

  const mix = new Map([
    ["1002", withKpiUploadSummaryNonBuilding({ buildingMaterial: 100, electronics: 0, rest: 0 })],
  ]);
  const expected = sumExpectedCollectionCategoryBuckets([
    { customer_code: "1002", invoice_date: "2026-09-01", pending_amount: 100000 },
    { customer_code: "1002", invoice_date: "2026-11-01", pending_amount: 50000 },
  ], {
    avgDaysByCustomer: new Map([["1002", 30]]),
    customerMix: mix,
    monthEnd: "2026-11-30",
  });
  assert.equal(expected.buildingMaterial, 100000);

  const outstanding = sumOutstandingCategoryBuckets([
    { customer_code: "1002", pending_amount: 150000 },
  ], mix);
  assert.equal(outstanding.buildingMaterial, 150000);
});

test("resolveLastPaidInvoiceDays takes days from the latest paid invoice", () => {
  assert.equal(resolveLastPaidInvoiceDays([
    {
      invoice_date: "2026-01-10",
      voucher_number: "A",
      receipt_date: "2026-02-01",
      amount: 100,
      days: 22,
    },
    {
      invoice_date: "2026-03-01",
      voucher_number: "B",
      receipt_date: "2026-04-15",
      amount: 200,
      days: 45,
    },
    {
      invoice_date: "2026-03-01",
      voucher_number: "B",
      receipt_date: "2026-03-20",
      amount: 50,
      days: 19,
    },
  ]), 45);
  assert.equal(resolveLastPaidInvoiceDays([
    { receipt_date: "2026-04-01", amount: 10, days: 5, exclude_from_avg_days: true },
  ]), null);
});

test("estimate avg days uses max(lifetime, last paid invoice) and 120 when never paid", () => {
  assert.equal(KPI_UPLOAD_SUMMARY_NEVER_PAID_AVG_DAYS, 120);
  assert.equal(pickCustomerAvgDaysToPay({
    avg_days_to_pay: 19,
    avg_days_to_pay_6m: 10,
    last_paid_invoice_days: 45,
    last_receipt_date: "2026-10-13",
  }), 45);
  assert.equal(pickCustomerAvgDaysToPay({
    avg_days_to_pay: 79,
    avg_days_to_pay_6m: 10,
    last_paid_invoice_days: 40,
    last_receipt_date: "2026-10-13",
  }), 79);
  assert.equal(pickCustomerAvgDaysToPay({
    avg_days_to_pay: 40,
    avg_days_to_pay_6m: 12,
    avg_days_paid_only: 40,
  }), 40);
  assert.equal(pickCustomerAvgDaysToPay({
    avg_days_to_pay: 55,
    avg_days_to_pay_6m: 8,
  }), 120);
  assert.equal(pickCustomerAvgDaysToPay({
    avg_days_to_pay: null,
    avg_days_to_pay_6m: 15,
    last_receipt_date: "2026-09-01",
  }), 120);
  assert.equal(pickCustomerAvgDaysToPay({}), 120);
});

test("expected remaining excludes legal-queue customer codes", () => {
  const mix = new Map([
    ["1258C", withKpiUploadSummaryNonBuilding({ buildingMaterial: 0, electronics: 0, rest: 100 })],
    ["1224", withKpiUploadSummaryNonBuilding({ buildingMaterial: 0, electronics: 0, rest: 100 })],
  ]);
  const excluded = buildKpiUploadSummaryExcludedCustomerSet(["1258C"]);
  const expected = sumExpectedCollectionCategoryBuckets([
    {
      customer_code: "1258C",
      customer_name: "Sheem Al Majd Trading Company",
      invoice_date: "2026-02-12",
      pending_amount: 345844.7,
    },
    {
      customer_code: "1224",
      invoice_date: "2026-09-01",
      pending_amount: 10000,
    },
  ], {
    avgDaysByCustomer: new Map([["1258C", 260], ["1224", 30]]),
    customerMix: mix,
    monthEnd: "2026-11-30",
    excludedCustomerCodes: excluded,
  });
  assert.equal(expected.rest, 10000);
  assert.equal(expected.buildingMaterial, 0);
});

test("insertKpiUploadSummaryCategoryRows keeps unknown rows untouched when empty", () => {
  const rows = [{ key: "totalSales", label: "Total sales" }, { key: "collection", label: "Collection" }];
  assert.deepEqual(insertKpiUploadSummaryCategoryRows(rows, {}), rows);
  const built = buildKpiUploadSummaryCategoryRows({
    salesBuckets: { buildingMaterial: 1, electronics: 0, rest: 0 },
    totalSalesActual: 1,
    collectionActual: 0,
  });
  const next = insertKpiUploadSummaryCategoryRows(rows, built);
  assert.equal(next.length, 2 + 4 + 4);
});
