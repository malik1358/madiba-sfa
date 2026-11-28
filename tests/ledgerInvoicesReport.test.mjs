import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLedgerInvoicesReport,
  groupLedgerInvoicesByMonth,
  resolveLedgerInvoiceFetchWindow,
  shiftIsoDate,
} from "../app/lib/ledgerInvoicesReport.js";

test("resolveLedgerInvoiceFetchWindow pads seven days for CN void matching", () => {
  assert.deepEqual(
    resolveLedgerInvoiceFetchWindow({ from: "2026-11-01", to: "2026-11-30" }),
    { from: "2026-10-25", to: "2026-12-07" },
  );
  assert.equal(shiftIsoDate("2026-03-01", -1), "2026-02-28");
});

test("buildLedgerInvoicesReport keeps open sales and drops immediate CN reversals", () => {
  const report = buildLedgerInvoicesReport([
    {
      transaction_date: "2026-11-10",
      voucher_number: "NFD/100",
      customer_code: "C1",
      customer_name: "Alpha",
      salesman_code: "S1",
      salesman_name: "Saleh",
      item_code: "A1",
      item_name: "Paper",
      quantity: 10,
      sales_amount: 1000,
      category: "Paper",
    },
    {
      transaction_date: "2026-11-10",
      voucher_number: "NFD/101",
      customer_code: "C1",
      customer_name: "Alpha",
      salesman_code: "S1",
      salesman_name: "Saleh",
      item_code: "A1",
      item_name: "Paper",
      quantity: 5,
      sales_amount: 500,
      category: "Paper",
    },
    {
      transaction_date: "2026-11-10",
      voucher_number: "CN/50",
      voucher_type: "Credit Note",
      reference: "NFD/101",
      customer_code: "C1",
      customer_name: "Alpha",
      salesman_code: "S1",
      salesman_name: "Saleh",
      item_code: "A1",
      item_name: "Paper",
      quantity: 5,
      sales_amount: -500,
      category: "Paper",
    },
    {
      transaction_date: "2026-11-12",
      voucher_number: "NFD/200",
      customer_code: "C2",
      customer_name: "Beta",
      salesman_code: "S2",
      salesman_name: "Sam",
      item_code: "B1",
      item_name: "Pen",
      quantity: 2,
      sales_amount: 200,
      category: "Stationery",
    },
  ], { from: "2026-11-01", to: "2026-11-30" });

  assert.equal(report.summary.invoiceCount, 2);
  assert.equal(report.summary.reversedCount, 1);
  assert.equal(report.summary.customerCount, 2);
  assert.deepEqual(
    report.invoices.map((row) => row.voucherNumber).sort(),
    ["NFD/100", "NFD/200"],
  );
  assert.equal(report.reversedInvoices[0].voucherNumber, "NFD/101");
  assert.equal(report.reversedInvoices[0].creditNoteVoucher, "CN/50");
  assert.equal(report.reversedInvoices[0].status, "Reversed");
  assert.equal(report.invoices.every((row) => row.status === "Ledger"), true);

  assert.equal(report.days.length, 2);
  assert.equal(report.months.length, 1);
  assert.equal(report.months[0].monthKey, "2026-11");
  assert.equal(report.months[0].invoiceCount, 2);
  assert.equal(report.months[0].reversedCount, 1);
});

test("ledger report does not cross-customer reverse same-amount bills", () => {
  const report = buildLedgerInvoicesReport([
    {
      transaction_date: "2026-11-05",
      voucher_number: "A1",
      customer_code: "C1",
      customer_name: "One",
      salesman_code: "S1",
      salesman_name: "Saleh",
      item_code: "X",
      item_name: "Item",
      quantity: 1,
      sales_amount: 100,
      category: "Paper",
    },
    {
      transaction_date: "2026-11-05",
      voucher_number: "CN-X",
      voucher_type: "Credit Note",
      customer_code: "C2",
      customer_name: "Two",
      salesman_code: "S2",
      salesman_name: "Sam",
      item_code: "X",
      item_name: "Item",
      quantity: 1,
      sales_amount: -100,
      category: "Paper",
    },
  ], { from: "2026-11-01", to: "2026-11-30" });

  assert.equal(report.summary.invoiceCount, 1);
  assert.equal(report.summary.reversedCount, 0);
  assert.equal(report.invoices[0].voucherNumber, "A1");
});

test("date filter excludes invoices outside the requested range", () => {
  const report = buildLedgerInvoicesReport([
    {
      transaction_date: "2026-10-31",
      voucher_number: "OLD",
      customer_code: "C1",
      customer_name: "Alpha",
      salesman_code: "S1",
      salesman_name: "Saleh",
      item_code: "A1",
      item_name: "Paper",
      quantity: 1,
      sales_amount: 100,
      category: "Paper",
    },
    {
      transaction_date: "2026-11-15",
      voucher_number: "IN",
      customer_code: "C1",
      customer_name: "Alpha",
      salesman_code: "S1",
      salesman_name: "Saleh",
      item_code: "A1",
      item_name: "Paper",
      quantity: 1,
      sales_amount: 250,
      category: "Paper",
    },
  ], { from: "2026-11-01", to: "2026-11-30" });

  assert.equal(report.summary.invoiceCount, 1);
  assert.equal(report.invoices[0].voucherNumber, "IN");
  assert.equal(Number(report.summary.amountExclVat.toFixed(2)), 250);
});

test("groupLedgerInvoicesByMonth aggregates considered and reversed", () => {
  const months = groupLedgerInvoicesByMonth(
    [
      {
        invoiceDate: "2026-10-02",
        monthKey: "2026-10",
        voucherNumber: "1",
        customerCode: "C1",
        amountExclVat: 100,
        amountInclVat: 115,
      },
      {
        invoiceDate: "2026-11-02",
        monthKey: "2026-11",
        voucherNumber: "2",
        customerCode: "C2",
        amountExclVat: 200,
        amountInclVat: 230,
      },
    ],
    [
      {
        invoiceDate: "2026-11-03",
        monthKey: "2026-11",
        voucherNumber: "3",
        customerCode: "C2",
        amountExclVat: 50,
        amountInclVat: 57.5,
      },
    ],
  );

  assert.equal(months.length, 2);
  assert.equal(months[0].monthKey, "2026-11");
  assert.equal(months[0].invoiceCount, 1);
  assert.equal(months[0].reversedCount, 1);
  assert.equal(months[1].monthKey, "2026-10");
  assert.equal(months[1].reversedCount, 0);
});
