import test from "node:test";
import assert from "node:assert/strict";

import {
  combineOutstandingHeaderRows,
  customerCodeCandidates,
  findOutstandingHeaderRow,
  findOutstandingCustomerCodesForSalesmen,
  findOutstandingInvoiceDayColumn,
  isOutstandingInvoiceDayHeader,
  prioritizeOutstandingSheets,
  resolveOutstandingCustomerOwnership,
} from "../app/lib/outstanding.js";

test("findOutstandingCustomerCodesForSalesmen matches normalized salesman identity", () => {
  const dataset = {
    invoices: [
      {
        customer_code: "1173C LOULOAT AL NILE TRADING CO.",
        customer_name: "1173C LOULOAT AL NILE TRADING CO.",
        salesman: "Ahmed Nabil",
      },
      { customer_code: "2001A", salesman: "Another Salesman" },
    ],
  };

  assert.deepEqual(
    findOutstandingCustomerCodesForSalesmen(dataset, ["AHMED NABIL"]),
    ["1173C"]
  );
});

test("findOutstandingCustomerCodesForSalesmen does not widen unrelated scope", () => {
  const dataset = {
    invoices: [
      { customer_code: "1173C", salesman: "Ahmed Nabil" },
      { customer_code: "2001A", salesman: "Another Salesman" },
    ],
  };

  assert.deepEqual(
    findOutstandingCustomerCodesForSalesmen(dataset, ["AHMED NABIL"]),
    ["1173C"]
  );
});

test("outstanding ownership records other salesman assignments as authoritative", () => {
  const ownership = resolveOutstandingCustomerOwnership({
    invoices: [
      { customer_code: "1173C", salesman: "Ahmed Nabil" },
      { customer_code: "1114C", salesman: "Junaid" },
    ],
  }, ["AHMED NABIL"]);

  assert.deepEqual([...ownership.assignedCustomerCodes], ["1173C", "1114C"]);
  assert.deepEqual([...ownership.ownedCustomerCodes], ["1173C"]);
});

test("customerCodeCandidates extracts code from a combined customer master value", () => {
  assert.deepEqual(
    customerCodeCandidates("1173C LOULOAT AL NILE TRADING CO."),
    ["1173C LOULOAT AL NILE TRADING CO.", "1173C"]
  );
});

test("findOutstandingHeaderRow accepts Open Balance and Aging invoice detail headers", () => {
  const rows = [
    ["Outstanding Report"],
    ["Date", "Ref No", "Customer Account", "Open Balance", "Due Date", "Aging", "Salesman"],
    ["10/08/2026", "INV-1", "1173C Customer", 250, "20/08/2026", 15, "Ahmed Nabil"],
  ];

  assert.equal(findOutstandingHeaderRow(rows), 1);
});

test("findOutstandingHeaderRow accepts Pending Amount and Overdue Days without Invoice Day", () => {
  const rows = [
    ["Date", "Ref No", "Customer Name", "Pending Amount", "Due Date", "Overdue Days", "Salesman"],
    ["10/08/2026", "INV-1", "1173C Customer", 250, "20/08/2026", 15, "Ahmed Nabil"],
  ];

  assert.equal(findOutstandingHeaderRow(rows), 0);
});

test("Invoice Day is distinguished from Overdue Days", () => {
  assert.equal(isOutstandingInvoiceDayHeader("Overdue Days"), false);
  assert.equal(isOutstandingInvoiceDayHeader("Invoice Day"), true);
  assert.equal(isOutstandingInvoiceDayHeader("Invoice Days"), true);
});

test("Invoice Day falls back to the distinct column after Overdue Days", () => {
  const headers = ["Date", "Ref. No.", "Party's Name", "Pending Amount", "Due Date", "Overdue Days", "Invoice Da", "Salesman"];

  assert.equal(findOutstandingInvoiceDayColumn(headers, 5, 7), 6);
});

test("findOutstandingHeaderRow accepts short Party, Balance, and Days headers", () => {
  const rows = [
    ["Party", "Voucher", "Balance", "Days", "Sales Person"],
    ["1173C Customer", "INV-1", 250, 15, "Ahmed Nabil"],
  ];

  assert.equal(findOutstandingHeaderRow(rows), 0);
});

test("combined outstanding headers preserve parent and child labels", () => {
  const rows = [
    ["Customer", "", "Outstanding", "Aging"],
    ["Code", "Name", "Balance", "Days"],
  ];

  assert.deepEqual(combineOutstandingHeaderRows(rows, 1), [
    "Customer Code",
    "Name",
    "Outstanding Balance",
    "Aging Days",
  ]);
  assert.equal(findOutstandingHeaderRow(rows), 1);
});

test("single-cell report titles are not merged into detail headers", () => {
  const rows = [
    ["Pending Bills"],
    ["Date", "Ref. No.", "Party's Name", "Pending Amount", "Due Date", "Overdue Days", "Invoice Day", "Salesman"],
  ];

  assert.deepEqual(combineOutstandingHeaderRows(rows, 1), rows[1]);
});

test("Pending Bills is preferred over an older Bills Receivable sheet", () => {
  assert.deepEqual(
    prioritizeOutstandingSheets(["Bills Receivable", "Summary", "Pending Bills"]),
    ["Pending Bills", "Bills Receivable", "Summary"]
  );
});

test("findOutstandingHeaderRow scans beyond the old 25-row report preamble", () => {
  const rows = Array.from({ length: 30 }, () => [""]);
  rows.push(["Customer Name", "0-30", "31-60", "Open Invoices"]);

  assert.equal(findOutstandingHeaderRow(rows), 30);
});