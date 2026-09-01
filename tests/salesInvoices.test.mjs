import test from "node:test";
import assert from "node:assert/strict";

import {
  currentMonthDateRange,
  groupSalesRowsIntoInvoices,
  resolveInvoiceSalesmanCodes,
  resolveSalesInvoiceDateRange,
  summarizeSalesInvoices,
} from "../app/lib/salesInvoices.js";

test("current month date range uses first and last day of the month", () => {
  assert.deepEqual(currentMonthDateRange("2026-09-01"), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(currentMonthDateRange("2026-02-18"), { from: "2026-02-01", to: "2026-02-28" });
});

test("date range defaults to the current month and swaps inverted dates", () => {
  assert.deepEqual(
    resolveSalesInvoiceDateRange({ todayIso: "2026-09-12" }),
    { from: "2026-09-01", to: "2026-09-30" },
  );
  assert.deepEqual(
    resolveSalesInvoiceDateRange({ from: "2026-09-20", to: "2026-09-05", todayIso: "2026-09-12" }),
    { from: "2026-09-05", to: "2026-09-20" },
  );
});

test("sales invoices group line items by date, voucher, and customer", () => {
  const invoices = groupSalesRowsIntoInvoices([
    {
      id: 1,
      transaction_date: "2026-09-02",
      voucher_number: "INV-100",
      customer_code: "C1",
      customer_name: "Alpha",
      salesman_code: "S1",
      item_code: "I1",
      item_name: "Oil",
      quantity: 2,
      rate: 10,
      sales_amount: 20,
    },
    {
      id: 2,
      transaction_date: "2026-09-02",
      voucher_number: "INV-100",
      customer_code: "C1",
      customer_name: "Alpha",
      salesman_code: "S1",
      item_code: "I2",
      item_name: "Rice",
      quantity: 1,
      rate: 15,
      sales_amount: 15,
    },
    {
      id: 3,
      transaction_date: "2026-09-03",
      voucher_number: "INV-200",
      customer_code: "C2",
      customer_name: "Beta",
      salesman_code: "S1",
      item_code: "I3",
      item_name: "Sugar",
      quantity: 4,
      rate: 5,
      sales_amount: 20,
    },
  ]);

  assert.equal(invoices.length, 2);
  assert.equal(invoices[0].voucher_number, "INV-200");
  assert.equal(invoices[1].voucher_number, "INV-100");
  assert.equal(invoices[1].total_amount, 35);
  assert.equal(invoices[1].item_count, 2);
  assert.deepEqual(invoices[1].items.map((item) => item.item_code), ["I1", "I2"]);
  assert.deepEqual(summarizeSalesInvoices(invoices), {
    invoiceCount: 2,
    totalAmount: 55,
    customerCount: 2,
  });
});

test("salesman invoice scope uses requested code when allowed and all codes when unrestricted", () => {
  assert.deepEqual(
    resolveInvoiceSalesmanCodes({ hasAllAccess: false, visibleSalesmanCodes: ["s1", "S2"] }, "s1"),
    ["S1"],
  );
  assert.equal(resolveInvoiceSalesmanCodes({ hasAllAccess: true, visibleSalesmanCodes: ["S1"] }, ""), null);
  assert.deepEqual(
    resolveInvoiceSalesmanCodes({ hasAllAccess: false, visibleSalesmanCodes: ["S1", "S2"] }, ""),
    ["S1", "S2"],
  );
  assert.throws(
    () => resolveInvoiceSalesmanCodes({ hasAllAccess: false, visibleSalesmanCodes: ["S1"] }, "S9"),
    /do not have access/,
  );
});
