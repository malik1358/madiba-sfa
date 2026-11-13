import test from "node:test";
import assert from "node:assert/strict";
import { buildExpectedCollectionDetailRows } from "../app/lib/expectedCollectionReport.js";
import { buildCustomerCategoryMixFromSalesRows } from "../app/lib/expectedCollectionReportServer.js";

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
