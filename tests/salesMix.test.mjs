import test from "node:test";
import assert from "node:assert/strict";

import { emptyGrowthFilters } from "../app/lib/categoryGrowth.js";
import { buildSalesMixReport } from "../app/lib/salesMix.js";
import { createSalesBiCube, ingestSalesRowsIntoCube, salesBiFactToGrowthRow, salesBiFactsFromCube } from "../app/lib/salesBiCube.js";

const rows = [
  { transaction_date: "2026-01-04", voucher_number: "RC/100", local_import: "Local", sales_amount: 100 },
  { transaction_date: "2026-01-05", voucher_number: "NFD/101", local_import: "Imported", sales_amount: 200 },
  { transaction_date: "2026-01-06", voucher_number: "NFD/102", local_import: "", sales_amount: 50 },
  { transaction_date: "2026-01-07", voucher_number: "CN/103", voucher_type: "Credit Note", local_import: "Local", sales_amount: 30 },
  { transaction_date: "2026-02-02", voucher_number: "DC/104", local_import: "Import", sales_amount: 80 },
];

test("sales mix groups cash, credit, local, and import invoices while excluding credit notes", () => {
  const report = buildSalesMixReport(rows, emptyGrowthFilters());

  assert.deepEqual(report.months, ["2026-01", "2026-02"]);
  assert.equal(report.monthly["2026-01"].cash_sales_amount, 100);
  assert.equal(report.monthly["2026-01"].credit_sales_amount, 250);
  assert.equal(report.monthly["2026-01"].local_sales_amount, 100);
  assert.equal(report.monthly["2026-01"].import_sales_amount, 200);
  assert.equal(report.monthly["2026-01"].unclassified_origin_sales_amount, 50);
  assert.equal(report.totals.cash_sales_amount, 180);
  assert.equal(report.totals.credit_sales_amount, 250);
  assert.equal(report.totals.local_sales_amount, 100);
  assert.equal(report.totals.import_sales_amount, 280);
  assert.equal(report.totals.unclassified_origin_sales_amount, 50);
  assert.equal(report.totals.sales_adjustments_amount, -30);
  assert.equal(report.totals.gross_invoice_sales, 430);
  assert.equal(report.totals.net_sales, 400);
  assert.equal(report.quarters[0], "2026-Q1");
  assert.equal(report.quarterly["2026-Q1"].cash_sales_amount, 180);
  assert.equal(report.quarterly["2026-Q1"].credit_sales_amount, 250);
  assert.equal(report.quarterly["2026-Q1"].sales_adjustments_amount, -30);
  assert.equal(report.quarterlyShares.payment["2026-Q1"].cash_sales_amount, (180 / 430) * 100);
  assert.equal(report.monthlyShares.payment["2026-01"].cash_sales_amount, (100 / 350) * 100);
  assert.equal(report.monthlyShares.origin["2026-01"].unclassified_origin_sales_amount, (50 / 350) * 100);
});

test("sales mix respects the selected BI date range", () => {
  const report = buildSalesMixReport(rows, {
    ...emptyGrowthFilters(),
    dateFrom: "2026-02-01",
    dateTo: "2026-02-28",
  });

  assert.deepEqual(report.months, ["2026-02"]);
  assert.equal(report.totals.cash_sales_amount, 80);
  assert.equal(report.totals.import_sales_amount, 80);
});

test("September net sales reconcile positive and negative credit-note rows", () => {
  const report = buildSalesMixReport([
    { transaction_date: "2026-09-02", voucher_number: "RC/900", local_import: "Local", sales_amount: 120 },
    { transaction_date: "2026-09-12", voucher_number: "NFD/901", local_import: "Import", sales_amount: 80 },
    { transaction_date: "2026-09-15", voucher_number: "CN/902", voucher_type: "Credit Note", local_import: "Local", sales_amount: 25 },
    { transaction_date: "2026-09-19", voucher_number: "SR/903", sales_amount: -10 },
  ], emptyGrowthFilters());

  assert.equal(report.monthly["2026-09"].cash_sales_amount, 120);
  assert.equal(report.monthly["2026-09"].credit_sales_amount, 80);
  assert.equal(report.monthly["2026-09"].sales_adjustments_amount, -35);
  assert.equal(report.totals.net_sales, 165);
});

test("September gross invoice sales reconcile to the net category total", () => {
  const report = buildSalesMixReport([
    { transaction_date: "2026-09-03", voucher_number: "RC/1001", local_import: "Local", sales_amount: 1127814 },
    { transaction_date: "2026-09-20", voucher_number: "NFD/1002", local_import: "Import", sales_amount: 1901586 },
    { transaction_date: "2026-09-24", voucher_number: "CN/1003", voucher_type: "Credit Note", local_import: "Import", sales_amount: 488453 },
  ], emptyGrowthFilters());

  assert.equal(report.monthly["2026-09"].cash_sales_amount + report.monthly["2026-09"].credit_sales_amount, 3029400);
  assert.equal(report.monthly["2026-09"].sales_adjustments_amount, -488453);
  assert.equal(report.monthly["2026-09"].cash_sales_amount + report.monthly["2026-09"].credit_sales_amount + report.monthly["2026-09"].sales_adjustments_amount, 2540947);
});

test("credit note adjustment is part of cash-credit and origin period-table totals", () => {
  const report = buildSalesMixReport([
    { transaction_date: "2026-09-03", voucher_number: "RC/1001", local_import: "Local", sales_amount: 1127814 },
    { transaction_date: "2026-09-20", voucher_number: "NFD/1002", local_import: "Import", sales_amount: 1901586 },
    { transaction_date: "2026-09-24", voucher_number: "CN/1003", voucher_type: "Credit Note", local_import: "Import", sales_amount: 488453 },
  ], emptyGrowthFilters());
  const september = report.monthly["2026-09"];
  const quarter = report.quarterly["2026-Q3"];

  const septemberPaymentNet = september.cash_sales_amount + september.credit_sales_amount + september.sales_adjustments_amount;
  const septemberOriginNet = september.local_sales_amount + september.import_sales_amount + september.unclassified_origin_sales_amount + september.sales_adjustments_amount;
  const quarterPaymentNet = quarter.cash_sales_amount + quarter.credit_sales_amount + quarter.sales_adjustments_amount;
  const quarterOriginNet = quarter.local_sales_amount + quarter.import_sales_amount + quarter.unclassified_origin_sales_amount + quarter.sales_adjustments_amount;

  assert.equal(septemberPaymentNet, 2540947);
  assert.equal(septemberOriginNet, 2540947);
  assert.equal(quarterPaymentNet, 2540947);
  assert.equal(quarterOriginNet, 2540947);
});

test("sales mix reads precomputed measures from prepared monthly cube facts", () => {
  const cube = createSalesBiCube();
  ingestSalesRowsIntoCube(cube, rows);
  const report = buildSalesMixReport(
    salesBiFactsFromCube(cube).map(salesBiFactToGrowthRow),
    emptyGrowthFilters(),
  );

  assert.equal(report.totals.cash_sales_amount, 180);
  assert.equal(report.totals.credit_sales_amount, 250);
  assert.equal(report.totals.local_sales_amount, 100);
  assert.equal(report.totals.import_sales_amount, 280);
  assert.equal(report.totals.unclassified_origin_sales_amount, 50);
  assert.equal(report.totals.sales_adjustments_amount, -30);
  assert.equal(report.totals.net_sales, 400);
});
