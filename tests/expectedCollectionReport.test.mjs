import test from "node:test";
import assert from "node:assert/strict";
import { buildExpectedCollectionDetailRows } from "../app/lib/expectedCollectionReport.js";

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
