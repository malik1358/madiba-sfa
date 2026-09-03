import test from "node:test";
import assert from "node:assert/strict";
import {
  customerMatchesSalesmanFilter,
  dateOnly,
  enrichOutstandingNoGpsRow,
  formatSalesmanDisplay,
  laterVisitAt,
  outstandingNoGpsExportRows,
  sortOutstandingNoGpsRows,
} from "../app/lib/outstandingNoGps.js";

test("dateOnly keeps YYYY-MM-DD and laterVisitAt picks the newest timestamp", () => {
  assert.equal(dateOnly("2026-08-12T15:04:00Z"), "2026-08-12");
  assert.equal(
    dateOnly(laterVisitAt("2026-08-01", "2026-08-12T09:00:00Z", "2026-07-30")),
    "2026-08-12",
  );
});

test("formatSalesmanDisplay shows name and code together", () => {
  assert.equal(formatSalesmanDisplay("S01", "Parvez"), "Parvez (S01)");
  assert.equal(formatSalesmanDisplay("PARVEZ", "PARVEZ"), "PARVEZ");
  assert.equal(formatSalesmanDisplay("S01", ""), "S01");
});

test("enrichOutstandingNoGpsRow fills last invoice, salesman, and outstanding", () => {
  const row = enrichOutstandingNoGpsRow(
    {
      customer_code: "1062C",
      customer_name: "AL TAWFEER TRADING COMPANY",
      current_salesman_code: "S01",
      latest_transaction_date: "2026-04-01",
      latitude: null,
      longitude: null,
    },
    {
      salesmanNameByCode: new Map([["S01", "Parvez"]]),
      lastVisitByCustomer: new Map([["1062C", "2026-08-20T10:00:00Z"]]),
      outstandingDataset: {
        rows: [{
          customer_code: "1062C",
          customer_name: "AL TAWFEER",
          total_outstanding: 12500,
          salesman: "Parvez",
        }],
        invoices: [{
          customer_code: "1062C",
          customer_name: "AL TAWFEER",
          invoice_date: "2026-07-15",
          pending_amount: 12500,
        }],
      },
      todayIso: "2026-09-03",
    },
  );

  assert.equal(row.total_outstanding, 12500);
  assert.equal(row.last_invoice_date, "2026-07-15");
  assert.equal(row.last_visit_date, "2026-08-20");
  assert.equal(row.salesman_display, "Parvez (S01)");
  assert.equal(row.missing_gps, true);
});

test("sortOutstandingNoGpsRows orders by outstanding then salesman filter matches code or name", () => {
  const sorted = sortOutstandingNoGpsRows([
    { customer_name: "B", total_outstanding: 10 },
    { customer_name: "A", total_outstanding: 90 },
  ]);
  assert.equal(sorted[0].customer_name, "A");

  assert.equal(customerMatchesSalesmanFilter({
    current_salesman_code: "S01",
    salesman_name: "Parvez",
  }, "parvez"), true);
  assert.equal(customerMatchesSalesmanFilter({
    current_salesman_code: "S02",
    salesman_name: "Junaid",
  }, "S01"), false);
});

test("outstandingNoGpsExportRows writes report columns", () => {
  const [exported] = outstandingNoGpsExportRows([{
    customer_code: "1062C",
    customer_name: "AL TAWFEER TRADING COMPANY",
    salesman_display: "Parvez (S01)",
    current_salesman_code: "S01",
    city: "Riyadh",
    area: "North",
    total_outstanding: 12500,
    last_invoice_date: "2026-07-15",
    last_visit_date: "2026-08-20",
  }]);

  assert.equal(exported["Customer Code"], "1062C");
  assert.equal(exported["Last Invoice Date"], "2026-07-15");
  assert.equal(exported["Last Visit Date"], "2026-08-20");
  assert.equal(exported["Outstanding Amount"], 12500);
});
