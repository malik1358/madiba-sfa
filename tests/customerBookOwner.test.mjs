import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLatestCustomerMapFromRows,
  laterTransactionDate,
  pickLatestCustomerRow,
  resolveImportedBookOwner,
} from "../app/lib/customerBookOwner.js";

test("a new customer takes the invoice salesman", () => {
  assert.equal(resolveImportedBookOwner({
    invoiceSalesman: "junaid",
  }), "JUNAID");
});

test("an existing book owner is not replaced by a later invoice salesman", () => {
  assert.equal(resolveImportedBookOwner({
    existingSalesman: "PARVEZ",
    invoiceSalesman: "OSAMA",
  }), "PARVEZ");
});

test("an explicit transfer lock wins over both the stored owner and the invoice", () => {
  assert.equal(resolveImportedBookOwner({
    existingSalesman: "OSAMA",
    invoiceSalesman: "JUNAID",
    lockedSalesman: "PARVEZ",
  }), "PARVEZ");
});

test("a blank existing owner still accepts the invoice salesman", () => {
  assert.equal(resolveImportedBookOwner({
    existingSalesman: "  ",
    invoiceSalesman: "parvez",
  }), "PARVEZ");
});

test("latest transaction date never moves backward", () => {
  assert.equal(laterTransactionDate("2026-03-10", "2025-12-02"), "2026-03-10");
  assert.equal(laterTransactionDate("2025-12-02", "2026-03-10"), "2026-03-10");
  assert.equal(laterTransactionDate("", "2026-03-10"), "2026-03-10");
  assert.equal(laterTransactionDate("2026-03-10", ""), "2026-03-10");
});

test("pickLatestCustomerRow prefers the newer transaction date", () => {
  const older = { customer_code: "1704", transaction_date: "2026-11-10", source_row_number: 99 };
  const newer = { customer_code: "1704", transaction_date: "2026-11-16", source_row_number: 1 };
  assert.equal(pickLatestCustomerRow(older, newer), newer);
  assert.equal(pickLatestCustomerRow(newer, older), newer);
});

test("pickLatestCustomerRow uses source_row_number when dates tie", () => {
  const first = { customer_code: "1704", transaction_date: "2026-11-16", source_row_number: 2 };
  const laterRow = { customer_code: "1704", transaction_date: "2026-11-16", source_row_number: 10 };
  assert.equal(pickLatestCustomerRow(first, laterRow), laterRow);
});

test("buildLatestCustomerMapFromRows keeps one latest row per customer code", () => {
  const map = buildLatestCustomerMapFromRows([
    {
      customer_code: "1704",
      customer_name: "Fahad Ali",
      salesman_code: "THAMER MOHAMMAD AHMED QASEM",
      transaction_date: "2026-11-10",
      source_row_number: 1,
    },
    {
      customer_code: "1704",
      customer_name: "Fahad Ali Hamad Al-Harbi Home Appliances Establishment",
      salesman_code: "THAMER MOHAMMAD AHMED QASEM",
      transaction_date: "2026-11-16",
      source_row_number: 2,
    },
    {
      customer_code: "1707",
      customer_name: "Zahrat Al-Khazzan",
      salesman_code: "BELAL",
      transaction_date: "2026-11-18",
      source_row_number: 3,
    },
    {
      customer_code: "  ",
      customer_name: "ignored",
      salesman_code: "BELAL",
      transaction_date: "2026-11-18",
      source_row_number: 4,
    },
  ]);

  assert.equal(map.size, 2);
  assert.equal(map.get("1704").customer_name, "Fahad Ali Hamad Al-Harbi Home Appliances Establishment");
  assert.equal(map.get("1704").transaction_date, "2026-11-16");
  assert.equal(map.get("1707").salesman_code, "BELAL");
});
