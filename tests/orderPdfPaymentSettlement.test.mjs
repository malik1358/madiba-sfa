import test from "node:test";
import assert from "node:assert/strict";

import { buildPaymentSettlementLedger } from "../app/lib/paymentBehavior.js";
import {
  appendPaymentSettlementToPdf,
  buildPaymentSettlementPdfModel,
} from "../app/lib/orderPdfPaymentSettlement.js";

function createMockDoc() {
  const texts = [];
  let fontSize = 10;
  let pages = 1;
  return {
    texts,
    internal: {
      pageSize: {
        getWidth: () => 595.28,
        getHeight: () => 841.89,
      },
    },
    setFillColor() {},
    setDrawColor() {},
    setFont() {},
    setFontSize(size) { fontSize = Number(size) || fontSize; },
    getFontSize() { return fontSize; },
    setTextColor() {},
    addPage() { pages += 1; },
    getNumberOfPages() { return pages; },
    rect() {},
    text(value) { texts.push(String(value)); },
  };
}

test("buildPaymentSettlementPdfModel maps invoice settlement rows", () => {
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2026-01-01", voucher_number: "V1", sales_amount: 1000, category: "Paper" },
      { transaction_date: "2026-01-20", voucher_number: "V2", sales_amount: 500, category: "Paper" },
    ],
    receipts: [{ receipt_date: "2026-01-31", amount: 1150, vch_no: "R1" }],
    outstandingInvoices: [],
    todayIso: "2026-02-15",
  });

  const model = buildPaymentSettlementPdfModel(ledger);
  assert.ok(model);
  assert.match(model.subtitle, /paid/);
  assert.equal(model.invoices.length, 2);
  assert.equal(model.invoices[0].voucher_number, "V1");
  assert.equal(model.invoices[0].status, "Paid");
  assert.ok(model.invoiceTotals.amount_incl_vat);
});

test("appendPaymentSettlementToPdf writes settlement title and voucher rows", () => {
  const ledger = buildPaymentSettlementLedger({
    transactions: [
      { transaction_date: "2026-02-10", voucher_number: "NFD/1", sales_amount: 1000, category: "Paper" },
    ],
    receipts: [{ receipt_date: "2026-03-01", amount: 1150 }],
    outstandingInvoices: [],
    todayIso: "2026-03-15",
  });
  const doc = createMockDoc();
  let y = 100;
  const nextY = appendPaymentSettlementToPdf(doc, {
    ledger,
    x: 40,
    y: () => y,
    maxWidth: 515,
    ensureSpace(height) {
      if (y + height > 780) {
        doc.addPage();
        y = 48;
      }
    },
  });

  assert.ok(nextY > 100);
  assert.ok(doc.texts.includes("Invoices & Settlement"));
  assert.ok(doc.texts.includes("NFD/1"));
  assert.ok(doc.texts.includes("Paid"));
});

test("appendPaymentSettlementToPdf is a no-op without ledger invoices", () => {
  const doc = createMockDoc();
  const nextY = appendPaymentSettlementToPdf(doc, {
    ledger: { invoices: [], reversedInvoices: [], totals: {} },
    x: 40,
    y: 120,
    maxWidth: 515,
    ensureSpace() {},
  });
  assert.equal(nextY, 120);
  assert.equal(doc.texts.length, 0);
});
