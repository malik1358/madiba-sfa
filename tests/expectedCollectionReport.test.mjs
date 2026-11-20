import test from "node:test";
import assert from "node:assert/strict";
import {
  buildExpectedCollectionDetailRows,
  buildExpectedCollectionHorizonReport,
  groupExpectedCollectionRowsByCustomer,
  groupExpectedCollectionRowsBySalesman,
  resolveExpectedCollectionMonthEnds,
} from "../app/lib/expectedCollectionReport.js";
import { buildCustomerCategoryMixFromSalesRows } from "../app/lib/expectedCollectionReportServer.js";
import { isOpenInvoiceExpectedThisMonth } from "../app/lib/kpiUploadSummaryCategories.js";

test("buildExpectedCollectionDetailRows keeps BM+Rest expected invoices and drops legal/electronics-only", () => {
  const avgDaysByCustomer = new Map([
    ["1001", 30],
    ["1002", 40],
    ["1258C", 20],
  ]);
  const customerMix = new Map([
    ["1001", { buildingMaterial: 100, electronics: 0, rest: 0 }],
    ["1002", { buildingMaterial: 0, electronics: 0, rest: 100 }],
    ["1258C", { buildingMaterial: 50, electronics: 0, rest: 50 }],
  ]);
  const excluded = new Set(["1258C", "1258"]);
  const report = buildExpectedCollectionDetailRows([
    {
      customer_code: "1001",
      customer_name: "BM Customer",
      ref_no: "A1",
      invoice_date: "2026-10-15",
      pending_amount: 1000,
    },
    {
      customer_code: "1002",
      customer_name: "Rest Customer",
      ref_no: "B1",
      invoice_date: "2026-10-20",
      pending_amount: 500,
    },
    {
      customer_code: "1258C",
      customer_name: "Legal Customer",
      ref_no: "L1",
      invoice_date: "2026-10-01",
      pending_amount: 9000,
    },
    {
      customer_code: "1001",
      customer_name: "BM Customer",
      ref_no: "LATE",
      invoice_date: "2026-11-20",
      pending_amount: 200,
    },
  ], {
    avgDaysByCustomer,
    customerMix,
    monthEnd: "2026-11-30",
    excludedCustomerCodes: excluded,
  });

  assert.equal(report.invoiceCount, 2);
  assert.equal(report.customerCount, 2);
  assert.equal(report.total, 1500);
  assert.equal(report.bmTotal, 1000);
  assert.equal(report.restTotal, 500);
  assert.equal(report.rows[0].approxPayDate, "2026-11-14");
  assert.equal(report.rows.some((row) => row.refNo === "LATE" || row.customerCode === "1258C"), false);
});

test("buildExpectedCollectionDetailRows drops customers with avg days above 120", () => {
  const report = buildExpectedCollectionDetailRows([
    {
      customer_code: "1601",
      customer_name: "ROWAD AL GHAD SANITARY WARE Co.",
      ref_no: "2498",
      invoice_date: "2026-01-10",
      pending_amount: 21668,
    },
    {
      customer_code: "1001",
      customer_name: "On-time Customer",
      ref_no: "A1",
      invoice_date: "2026-10-15",
      pending_amount: 1000,
    },
  ], {
    avgDaysByCustomer: new Map([
      ["1601", 180],
      ["1001", 30],
    ]),
    enrichedByCode: new Map([
      ["1601", { avg_days_to_pay: 145, last_paid_invoice_days: 180 }],
    ]),
    customerMix: new Map([
      ["1601", { buildingMaterial: 0, electronics: 0, rest: 100 }],
      ["1001", { buildingMaterial: 100, electronics: 0, rest: 0 }],
    ]),
    monthEnd: "2026-11-30",
  });

  assert.equal(report.invoiceCount, 1);
  assert.equal(report.customerCount, 1);
  assert.equal(report.total, 1000);
  assert.equal(report.rows.some((row) => row.customerCode === "1601"), false);
});

test("buildExpectedCollectionDetailRows drops never-paid (null avg) but keeps paid avg 120", () => {
  const report = buildExpectedCollectionDetailRows([
    { customer_code: "1501", customer_name: "Alam", ref_no: "NFD/1106", invoice_date: "2026-07-28", pending_amount: 9251.27 },
    { customer_code: "1493", customer_name: "Wasail", ref_no: "RNFD/082", invoice_date: "2026-07-07", pending_amount: 7473.55 },
  ], {
    avgDaysByCustomer: new Map([["1501", null], ["1493", 120]]),
    customerMix: new Map([
      ["1501", { buildingMaterial: 0, electronics: 0, rest: 100 }],
      ["1493", { buildingMaterial: 0, electronics: 0, rest: 100 }],
    ]),
    monthEnd: "2026-11-30",
  });
  assert.equal(report.invoiceCount, 1);
  assert.equal(report.rows[0].customerCode, "1493");
  assert.equal(report.rows[0].avgDays, 120);
});

test("buildExpectedCollectionDetailRows carries salesman and groupExpectedCollectionRowsBySalesman totals Expected SAR", () => {
  const report = buildExpectedCollectionDetailRows([
    {
      customer_code: "1001",
      customer_name: "BM Customer",
      salesman: "Ahmed",
      ref_no: "A1",
      invoice_date: "2026-10-15",
      pending_amount: 1000,
    },
    {
      customer_code: "1002",
      customer_name: "Rest Customer",
      salesman: "Ahmed",
      ref_no: "B1",
      invoice_date: "2026-10-20",
      pending_amount: 500,
    },
    {
      customer_code: "1003",
      customer_name: "Other Customer",
      salesman: "Belal",
      ref_no: "C1",
      invoice_date: "2026-10-10",
      pending_amount: 200,
    },
  ], {
    avgDaysByCustomer: new Map([
      ["1001", 30],
      ["1002", 40],
      ["1003", 20],
    ]),
    customerMix: new Map([
      ["1001", { buildingMaterial: 100, electronics: 0, rest: 0 }],
      ["1002", { buildingMaterial: 0, electronics: 0, rest: 100 }],
      ["1003", { buildingMaterial: 50, electronics: 0, rest: 50 }],
    ]),
    monthEnd: "2026-11-30",
  });

  assert.equal(report.rows[0].salesmanName, "Ahmed");
  const groups = groupExpectedCollectionRowsBySalesman(report.rows);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].salesmanName, "Ahmed");
  assert.equal(groups[0].amount, 1500);
  assert.equal(groups[0].invoiceCount, 2);
  assert.equal(groups[1].salesmanName, "Belal");
  assert.equal(groups[1].amount, 200);
});

test("groupExpectedCollectionRowsByCustomer merges same customer invoices with Expected SAR total", () => {
  const report = buildExpectedCollectionDetailRows([
    {
      customer_code: "2001",
      customer_name: "Larsen & Toubro Saudi Arabia LLC",
      salesman: "Ahmed",
      ref_no: "L1",
      invoice_date: "2026-10-10",
      pending_amount: 1000,
    },
    {
      customer_code: "2001",
      customer_name: "Larsen & Toubro Saudi Arabia LLC",
      salesman: "Ahmed",
      ref_no: "L2",
      invoice_date: "2026-10-20",
      pending_amount: 500,
    },
    {
      customer_code: "2002",
      customer_name: "QTC Joint Venture",
      salesman: "Ahmed",
      ref_no: "Q1",
      invoice_date: "2026-10-15",
      pending_amount: 300,
    },
  ], {
    avgDaysByCustomer: new Map([
      ["2001", 40],
      ["2002", 30],
    ]),
    customerMix: new Map([
      ["2001", { buildingMaterial: 100, electronics: 0, rest: 0 }],
      ["2002", { buildingMaterial: 0, electronics: 0, rest: 100 }],
    ]),
    monthEnd: "2026-11-30",
  });

  const customers = groupExpectedCollectionRowsByCustomer(report.rows);
  assert.equal(customers.length, 2);
  assert.equal(customers[0].customerCode, "2001");
  assert.equal(customers[0].invoiceCount, 2);
  assert.equal(customers[0].amount, 1500);
  assert.equal(customers[0].rows.length, 2);
  assert.equal(customers[1].customerCode, "2002");
  assert.equal(customers[1].invoiceCount, 1);
  assert.equal(customers[1].amount, 300);
});

test("resolveExpectedCollectionMonthEnds returns current plus next two month-ends", () => {
  const months = resolveExpectedCollectionMonthEnds("2026-11-30");
  assert.equal(months.length, 3);
  assert.deepEqual(months.map((row) => row.monthKey), ["2026-11", "2026-12", "2027-01"]);
  assert.deepEqual(months.map((row) => row.monthEnd), ["2026-11-30", "2026-12-31", "2027-01-31"]);
  assert.equal(months[0].afterMonthEnd, "");
  assert.equal(months[1].afterMonthEnd, "2026-11-30");
  assert.equal(months[2].afterMonthEnd, "2026-12-31");
});

test("isOpenInvoiceExpectedThisMonth supports exclusive afterMonthEnd window", () => {
  assert.equal(isOpenInvoiceExpectedThisMonth({
    invoiceDate: "2026-10-15",
    avgDays: 30,
    monthEnd: "2026-11-30",
  }), true);
  assert.equal(isOpenInvoiceExpectedThisMonth({
    invoiceDate: "2026-10-15",
    avgDays: 30,
    monthEnd: "2026-12-31",
    afterMonthEnd: "2026-11-30",
  }), false);
  assert.equal(isOpenInvoiceExpectedThisMonth({
    invoiceDate: "2026-11-20",
    avgDays: 30,
    monthEnd: "2026-12-31",
    afterMonthEnd: "2026-11-30",
  }), true);
});

test("buildExpectedCollectionHorizonReport splits current and next two months", () => {
  const report = buildExpectedCollectionHorizonReport([
    {
      customer_code: "1001",
      customer_name: "Current Month",
      salesman: "Ahmed",
      ref_no: "NOW",
      invoice_date: "2026-10-15",
      pending_amount: 1000,
    },
    {
      customer_code: "1002",
      customer_name: "Next Month",
      salesman: "Ahmed",
      ref_no: "DEC",
      invoice_date: "2026-11-20",
      pending_amount: 400,
    },
    {
      customer_code: "1003",
      customer_name: "Month After",
      salesman: "Belal",
      ref_no: "JAN",
      invoice_date: "2026-12-15",
      pending_amount: 250,
    },
  ], {
    avgDaysByCustomer: new Map([
      ["1001", 30],
      ["1002", 30],
      ["1003", 30],
    ]),
    customerMix: new Map([
      ["1001", { buildingMaterial: 100, electronics: 0, rest: 0 }],
      ["1002", { buildingMaterial: 0, electronics: 0, rest: 100 }],
      ["1003", { buildingMaterial: 50, electronics: 0, rest: 50 }],
    ]),
    monthEnd: "2026-11-30",
  });

  assert.equal(report.months.length, 3);
  assert.equal(report.total, 1000);
  assert.equal(report.invoiceCount, 1);
  assert.equal(report.months[0].total, 1000);
  assert.equal(report.months[0].cumulativeTotal, 1000);
  assert.equal(report.months[1].total, 400);
  assert.equal(report.months[1].rows[0].refNo, "DEC");
  assert.equal(report.months[1].cumulativeTotal, 1400);
  assert.equal(report.months[2].total, 250);
  assert.equal(report.months[2].cumulativeTotal, 1650);
  assert.equal(report.months[2].cumulativeInvoiceCount, 3);
  assert.equal(report.months[2].cumulativeCustomerCount, 3);
});

test("buildCustomerCategoryMixFromSalesRows classifies BM and Rest without the BI cube", () => {
  const salesByCustomer = new Map([
    ["1001", [
      {
        customer_code: "1001",
        transaction_date: "2026-10-01",
        category: "Building Material",
        item_name: "MDF",
        sales_amount: 80,
      },
      {
        customer_code: "1001",
        transaction_date: "2026-10-02",
        category: "Stationery",
        item_name: "Pen",
        sales_amount: 20,
      },
    ]],
  ]);
  const mix = buildCustomerCategoryMixFromSalesRows(salesByCustomer);
  assert.equal(mix.get("1001").buildingMaterial, 80);
  assert.equal(mix.get("1001").rest, 20);
  assert.equal(mix.get("1001").electronics, 0);
  assert.equal(mix.get("1001").nonBuilding, 20);
});
