import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBalanceConfirmationLedgerRows,
  buildCustomerLedgerPdfModel,
  formatBalanceSide,
  ledgerLineDebitCredit,
  ledgerLineParticulars,
} from "../app/lib/customerLedgerPdf.js";

test("ledger debit/credit maps invoices receipts and CN like a party ledger", () => {
  assert.deepEqual(ledgerLineDebitCredit({
    kind: "Invoice",
    sales_incl_vat: 1150,
  }), { debit: 1150, credit: 0 });

  assert.deepEqual(ledgerLineDebitCredit({
    kind: "Sales Return",
    sales_incl_vat: -230,
  }), { debit: 0, credit: 230 });

  assert.deepEqual(ledgerLineDebitCredit({
    kind: "Receipt",
    collected_amount: 400,
  }), { debit: 0, credit: 400 });

  assert.deepEqual(ledgerLineDebitCredit({
    kind: "Payment",
    collected_amount: -100,
  }), { debit: 100, credit: 0 });

  assert.deepEqual(ledgerLineDebitCredit({
    kind: "Purchase",
    purchase_amount: 200,
  }), { debit: 0, credit: 200 });
});

test("balance confirmation running balance is receivable Dr", () => {
  const statement = buildBalanceConfirmationLedgerRows([
    {
      date: "2026-01-01",
      kind: "Invoice",
      voucher: "S1",
      sales_incl_vat: 1150,
      detail: "Open",
    },
    {
      date: "2026-01-15",
      kind: "Receipt",
      voucher: "R1",
      collected_amount: 400,
      detail: "",
    },
    {
      date: "2026-01-20",
      kind: "Credit Note",
      voucher: "CN1",
      sales_incl_vat: -115,
      detail: "Partial return",
    },
  ]);

  assert.equal(statement.rows.length, 3);
  assert.equal(statement.rows[0].balance, 1150);
  assert.equal(statement.rows[1].balance, 750);
  assert.equal(statement.rows[2].balance, 635);
  assert.equal(statement.totalDebit, 1150);
  assert.equal(statement.totalCredit, 515);
  assert.equal(statement.closingBalance, 635);
  assert.equal(formatBalanceSide(635), "635.00 Dr");
  assert.equal(statement.rows[0].particulars, "Sales — Open");
  assert.equal(ledgerLineParticulars({
    kind: "Invoice",
    detail: "Open",
  }), "Sales — Open");
});

test("PDF model excludes reversed invoices from ledger and lists schedules", () => {
  const model = buildCustomerLedgerPdfModel({
    customer: { customer_code: "1198", customer_name: "Test Party" },
    asOfDate: "2026-10-28",
    ledger: {
      datewise: [
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
          ],
          receipts: [],
          purchases: [],
        },
      ],
      invoices: [
        {
          invoice_date: "2025-11-13",
          voucher_number: "1821",
          amount_excl_vat: 1000,
          amount_incl_vat: 1150,
          paid_amount: 0,
          remaining: 1150,
          status: "Open",
          open_days: 10,
        },
      ],
      reversedInvoices: [
        {
          invoice_date: "2025-11-13",
          voucher_number: "1730",
          amount_incl_vat: 8554,
          credit_note_date: "2025-11-13",
          credit_note_voucher: "43",
          credit_note_amount: 8554,
        },
      ],
      totals: {},
    },
  });

  assert.ok(model);
  assert.equal(model.subtitle, "Balance Confirmation");
  assert.equal(model.ledger.rows.length, 1);
  assert.equal(model.ledger.rows[0].voucher, "1821");
  assert.equal(model.ledger.closingBalance, 1150);
  assert.equal(model.openInvoices.length, 1);
  assert.equal(model.openTotal, 1150);
  assert.equal(model.reversedInvoices.length, 1);
  assert.match(model.confirmationText, /1,150\.00 Dr/);
  assert.match(model.filename, /balance-confirmation-1198/);
});
