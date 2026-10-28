import assert from "node:assert/strict";
import test from "node:test";
import { flattenDatewiseLines, sumDatewise } from "../app/lib/datewiseLines.js";

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
