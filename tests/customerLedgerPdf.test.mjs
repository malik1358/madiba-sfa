import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBalanceConfirmationLedgerRows,
  buildCustomerLedgerPdfModel,
  formatBalanceSide,
  formatLedgerMoney,
  ledgerLineDebitCredit,
  ledgerLineParticulars,
  LEDGER_COMPANY_NAME,
  LEDGER_COMPANY_NAME_AR,
  LEDGER_PDF_LANGUAGES,
  toEasternDigits,
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

test("receipt and payment particulars omit applied invoice numbers and amounts", () => {
  assert.equal(ledgerLineParticulars({
    kind: "Receipt",
    detail: "Invoice 2397 (5,000)",
  }), "Receipt");
  assert.equal(ledgerLineParticulars({
    kind: "Payment",
    detail: "Refund Invoice 2214 (1,661)",
  }), "Payment");
  assert.equal(ledgerLineParticulars({
    kind: "Purchase",
    detail: "2,000 → Invoice S1 (2,000)",
  }), "Purchase");
  assert.equal(ledgerLineParticulars({
    kind: "Invoice",
    detail: "Open",
  }), "Sales — Open");
  assert.equal(ledgerLineParticulars({
    kind: "Receipt",
    detail: "Invoice 2397 (5,000)",
  }, "ar"), "قبض");
  assert.equal(ledgerLineParticulars({
    kind: "Invoice",
    detail: "Open",
  }, "ar"), "مبيعات — مفتوح");
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
      detail: "Invoice S1 (400)",
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
  assert.equal(statement.rows[1].particulars, "Receipt");
  assert.equal(statement.totalDebit, 1150);
  assert.equal(statement.totalCredit, 515);
  assert.equal(statement.closingBalance, 635);
  assert.equal(formatBalanceSide(635), "635.00 Dr");
  assert.equal(toEasternDigits("82940.30"), "٨٢٩٤٠.٣٠");
  assert.equal(formatLedgerMoney(82940.3, "ar"), "٨٢,٩٤٠.٣٠");
  assert.equal(formatBalanceSide(635, "ar"), "٦٣٥.٠٠ مدين");
});

test("year sections close each year and open the next with opening balance", () => {
  const statement = buildBalanceConfirmationLedgerRows([
    {
      date: "2024-11-10",
      kind: "Invoice",
      voucher: "A1",
      sales_incl_vat: 1000,
      detail: "Open",
    },
    {
      date: "2024-12-05",
      kind: "Receipt",
      voucher: "R1",
      collected_amount: 200,
      detail: "Invoice A1 (200)",
    },
    {
      date: "2025-02-01",
      kind: "Invoice",
      voucher: "B1",
      sales_incl_vat: 500,
      detail: "Open",
    },
    {
      date: "2025-03-15",
      kind: "Invoice",
      voucher: "B2",
      sales_incl_vat: 100,
      detail: "Open",
    },
  ]);

  assert.equal(statement.years.length, 2);
  assert.equal(statement.years[0].year, "2024");
  assert.equal(statement.years[0].openingBalance, 0);
  assert.equal(statement.years[0].closingBalance, 800);
  assert.equal(statement.years[0].totalDebit, 1000);
  assert.equal(statement.years[0].totalCredit, 200);
  assert.equal(statement.years[0].rows[1].monthBreakBefore, true);

  assert.equal(statement.years[1].year, "2025");
  assert.equal(statement.years[1].openingBalance, 800);
  assert.equal(statement.years[1].closingBalance, 1400);
  assert.equal(statement.years[1].rows[1].monthBreakBefore, true);
  assert.equal(statement.closingBalance, 1400);
});

test("PDF model uses company name, excludes reversed, and includes outstanding buckets", () => {
  const model = buildCustomerLedgerPdfModel({
    customer: { customer_code: "1198", customer_name: "Test Party" },
    asOfDate: "2026-10-28",
    outstandingCustomer: {
      buckets: { "0-30": 500, "31-60": 650, "61-90": 0, "91-120": 0, ">120": 0 },
      open_invoices: 2,
      total_outstanding: 1150,
    },
    outstandingBucketLabels: ["0-30", "31-60", "61-90", "91-120", ">120"],
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
  assert.equal(model.companyName, LEDGER_COMPANY_NAME);
  assert.equal(model.companyName, "Noor Shukran Trading Company");
  assert.equal(model.companyNameAr, LEDGER_COMPANY_NAME_AR);
  assert.deepEqual(model.languages, LEDGER_PDF_LANGUAGES);
  assert.deepEqual(model.languages, ["ar", "en"]);
  assert.equal(model.subtitle, "Balance Confirmation");
  assert.equal(model.ledger.rows.length, 1);
  assert.equal(model.ledger.rows[0].voucher, "1821");
  assert.equal(model.ledger.closingBalance, 1150);
  assert.equal(model.ledger.years.length, 1);
  assert.equal(model.openInvoices.length, 1);
  assert.equal(model.openTotal, 1150);
  assert.equal(model.reversedInvoices.length, 1);
  assert.ok(model.outstandingBuckets.some((row) => row.label.startsWith("0-30") && row.amount === 1150));
  assert.ok(model.outstandingBuckets.some((row) => row.kind === "total" && row.amount === 1150));
  assert.equal(model.ledger.closingBalance, model.outstandingBuckets.find((row) => row.kind === "total")?.amount);
  assert.match(model.confirmationText, /1,150\.00 Dr/);
  assert.match(model.confirmationTextAr, /١,١٥٠\.٠٠ مدين/);
  assert.match(model.confirmationTextAr, /١١٩٨/);
  assert.doesNotMatch(model.confirmationTextAr, /þ/);
  assert.match(model.filename, /balance-confirmation-1198/);
});

test("PDF closing balance equals Machine Open aging total even when Tally upload differs", () => {
  const model = buildCustomerLedgerPdfModel({
    customer: { customer_code: "1224", customer_name: "RAWAAT" },
    asOfDate: "2026-10-29",
    outstandingCustomer: {
      buckets: { "0-30": 82940.3, "31-60": 0, "61-90": 0, "91-120": 7.6, ">120": 0 },
      open_invoices: 2,
      total_outstanding: 82947.9,
    },
    outstandingBucketLabels: ["0-30", "31-60", "61-90", "91-120", ">120"],
    ledger: {
      datewise: [
        {
          date: "2026-01-01",
          invoices: [{
            voucher_number: "2397",
            amount_excl_vat: 18026.2,
            amount_incl_vat: 20730.13,
            remaining: 0,
            status: "Paid",
          }],
          credit_notes: [{
            voucher_number: "121",
            amount_excl_vat: -18026.2,
            amount_incl_vat: -20730.13,
            remaining: 0,
            status: "Applied to 1737",
            kind: "Credit Note",
          }],
          receipts: [],
          purchases: [],
        },
        {
          date: "2026-07-20",
          invoices: [{
            voucher_number: "DUST",
            amount_excl_vat: 6.61,
            amount_incl_vat: 7.6,
            remaining: 7.6,
            status: "Open",
          }],
          credit_notes: [],
          receipts: [],
          purchases: [],
        },
        {
          date: "2026-10-14",
          invoices: [{
            voucher_number: "RNFD/569",
            amount_excl_vat: 72122,
            amount_incl_vat: 82940.3,
            remaining: 82940.3,
            status: "Open",
          }],
          credit_notes: [],
          receipts: [],
          purchases: [],
        },
      ],
      invoices: [
        {
          invoice_date: "2026-10-14",
          voucher_number: "RNFD/569",
          amount_incl_vat: 82940.3,
          paid_amount: 0,
          remaining: 82940.3,
          status: "Open",
          open_days: 15,
        },
        {
          invoice_date: "2026-07-20",
          voucher_number: "DUST",
          amount_incl_vat: 7.6,
          paid_amount: 0,
          remaining: 7.6,
          status: "Open",
          open_days: 101,
        },
      ],
      reversedInvoices: [],
      totals: {},
    },
  });

  const totalOutstanding = model.outstandingBuckets.find((row) => row.kind === "total")?.amount;
  assert.equal(model.ledger.closingBalance, 82947.9);
  assert.equal(totalOutstanding, 82947.9);
  assert.equal(model.openTotal, 82947.9);
  assert.ok(model.outstandingBuckets.some((row) => row.label.startsWith("0-30") && row.amount === 82940.3));
  assert.ok(model.outstandingBuckets.some((row) => row.label.startsWith("91-120") && row.amount === 7.6));
});
