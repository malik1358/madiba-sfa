import assert from "node:assert/strict";
import test from "node:test";
import {
  flattenDatewiseLines,
  flattenLedgerLinesExcludingReversed,
  isImmediateReversalLedgerLine,
  openSettlementInvoices,
  sumDatewise,
} from "../app/lib/datewiseLines.js";

test("datewise lines stay one row per voucher on the same date", () => {
  const lines = flattenDatewiseLines([
    {
      date: "2025-10-02",
      invoice_count: 2,
      sales_excl_vat: 1500,
      sales_incl_vat: 1575,
      receipt_count: 1,
      collected_amount: 400,
      open_sales_amount: 1175,
      invoices: [
        {
          voucher_number: "S1",
          amount_excl_vat: 1000,
          amount_incl_vat: 1050,
          remaining: 650,
          status: "Partial",
        },
        {
          voucher_number: "S2",
          amount_excl_vat: 500,
          amount_incl_vat: 525,
          remaining: 525,
          status: "Open",
        },
      ],
      credit_notes: [
        {
          voucher_number: "43",
          amount_excl_vat: -200,
          amount_incl_vat: -230,
          remaining: 0,
          status: "Reverses S0",
          kind: "Credit Note",
        },
      ],
      purchases: [
        {
          vch_no: "P1",
          amount: 200,
          applications: [{ target_kind: "sales", voucher_number: "S1", amount: 200 }],
        },
      ],
      receipts: [
        {
          vch_no: "R1",
          amount: 400,
          ar_amount: 400,
          kind: "receipt",
          applications: [],
        },
      ],
    },
  ]);

  assert.deepEqual(lines.map((row) => `${row.kind} ${row.voucher}`), [
    "Invoice S1",
    "Invoice S2",
    "Credit Note 43",
    "Purchase P1",
    "Receipt R1",
  ]);
  assert.equal(lines.filter((row) => row.date === "2025-10-02").length, 5);
  assert.equal(sumDatewise(lines, "sales_incl_vat"), 1345);
  assert.equal(sumDatewise(lines, "collected_amount"), 400);
  assert.equal(sumDatewise(lines, "open_amount"), 1175);
  assert.equal(lines[3].detail.includes("Invoice S1"), true);
  assert.equal(lines.some((row) => row.kind === "Date"), false);
});

test("datewise receipt detail names a reversed sale when collection only funded a void", () => {
  const lines = flattenDatewiseLines([
    {
      date: "2026-07-19",
      receipts: [
        {
          vch_no: "JV/Coll/2026/0411",
          amount: 517.5,
          ar_amount: 0,
          kind: "receipt",
          applications: [{
            target_kind: "sales",
            voucher_number: "DNFD/038",
            amount: 517.5,
            status: "Reversed",
          }],
        },
      ],
    },
  ]);

  assert.equal(lines[0].kind, "Receipt");
  assert.equal(lines[0].collected_amount, 0);
  assert.equal(lines[0].detail, "Collection on reversed Invoice DNFD/038 (517.5)");
  assert.equal(isImmediateReversalLedgerLine(lines[0]), true);
});

test("datewise payment detail names a refund against the reversed invoice", () => {
  const lines = flattenDatewiseLines([
    {
      date: "2025-12-18",
      receipts: [
        {
          vch_no: "P-1061",
          amount: -1661,
          ar_amount: 0,
          kind: "payment",
          applications: [{
            target_kind: "sales",
            voucher_number: "2214",
            amount: 1661,
            status: "Refund",
          }],
        },
      ],
    },
  ]);

  assert.equal(lines[0].kind, "Payment");
  assert.equal(lines[0].detail, "Refund Invoice 2214 (1,661)");
});

test("datewise payment shows negative collected for unmatched overcollection refund", () => {
  const lines = flattenDatewiseLines([
    {
      date: "2026-06-16",
      receipts: [
        {
          vch_no: "Jun/Bpmt0057",
          amount: -3340.75,
          ar_amount: -3340.75,
          kind: "payment",
          applications: [{
            target_kind: "sales",
            voucher_number: "CNFD/APR/014",
            amount: 3340.75,
            status: "Refund",
            unmatched_collection: true,
          }],
        },
      ],
    },
  ]);

  assert.equal(lines[0].kind, "Payment");
  assert.equal(lines[0].collected_amount, -3340.75);
  assert.equal(lines[0].detail, "Refund Invoice CNFD/APR/014 (3,340.75)");
  assert.equal(sumDatewise(lines, "collected_amount"), -3340.75);
  assert.equal(isImmediateReversalLedgerLine(lines[0]), false);
});

test("customer ledger export drops reversed invoices and their voiding notes", () => {
  const days = [
    {
      date: "2025-11-13",
      invoices: [
        {
          voucher_number: "1730",
          amount_excl_vat: 8554,
          amount_incl_vat: 8554,
          remaining: 0,
          status: "Reversed",
        },
        {
          voucher_number: "1821",
          amount_excl_vat: 1000,
          amount_incl_vat: 1150,
          remaining: 1150,
          status: "Open",
        },
      ],
      credit_notes: [
        {
          voucher_number: "43",
          amount_excl_vat: -8554,
          amount_incl_vat: -8554,
          remaining: 0,
          status: "Reverses 1730",
          kind: "Credit Note",
        },
        {
          voucher_number: "50",
          amount_excl_vat: -100,
          amount_incl_vat: -115,
          remaining: 0,
          status: "Partial return",
          kind: "Sales Return",
        },
      ],
      receipts: [
        {
          vch_no: "P-1",
          amount: -8554,
          ar_amount: 0,
          kind: "payment",
          applications: [{
            target_kind: "sales",
            voucher_number: "1730",
            amount: 8554,
            status: "Refund",
          }],
        },
        {
          vch_no: "R-9",
          amount: 500,
          ar_amount: 500,
          kind: "receipt",
          applications: [],
        },
      ],
    },
  ];

  const all = flattenDatewiseLines(days);
  assert.equal(all.some((row) => row.voucher === "1730"), true);
  assert.equal(isImmediateReversalLedgerLine(all.find((row) => row.voucher === "1730")), true);
  assert.equal(isImmediateReversalLedgerLine(all.find((row) => row.voucher === "43")), true);
  assert.equal(isImmediateReversalLedgerLine(all.find((row) => row.voucher === "P-1")), true);
  assert.equal(isImmediateReversalLedgerLine(all.find((row) => row.voucher === "1821")), false);

  const ledger = flattenLedgerLinesExcludingReversed(days);
  assert.deepEqual(ledger.map((row) => `${row.kind} ${row.voucher}`), [
    "Invoice 1821",
    "Sales Return 50",
    "Receipt R-9",
  ]);
  assert.equal(sumDatewise(ledger, "sales_incl_vat"), 1035);
  assert.equal(sumDatewise(ledger, "collected_amount"), 500);
});

test("openSettlementInvoices keeps Machine Open and Tally-only pending bills", () => {
  const open = openSettlementInvoices([
    { voucher_number: "A", remaining: 100, status: "Open" },
    { voucher_number: "B", remaining: 0, status: "Paid" },
    { voucher_number: "C", remaining: 0.004, status: "Paid" },
    { voucher_number: "D", remaining: 50, status: "Partial" },
    { voucher_number: "E", remaining: 0, status: "Tally", tally_only: true, outstanding_pending: 25 },
  ]);
  assert.deepEqual(open.map((row) => row.voucher_number), ["A", "D", "E"]);
});
