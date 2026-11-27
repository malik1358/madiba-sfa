import assert from "node:assert/strict";
import test from "node:test";
import {
  appendSettlementDeletionLog,
  buildSettlementDeletionEntry,
  classifySettlementDeleteSource,
  removeOutstandingInvoiceFromDataset,
  summarizeSalesRowsForAudit,
  vouchersMatch,
} from "../app/lib/settlementTransactionDelete.js";
import { canDeleteSettlementTransaction } from "../app/lib/moduleAccess.js";

test("vouchersMatch treats INV/NFD1862 like NFD/1862", () => {
  assert.equal(vouchersMatch("NFD/1862", "NFD/1862"), true);
  assert.equal(vouchersMatch("INV/NFD1862", "NFD/1862"), true);
  assert.equal(vouchersMatch("739", "739"), true);
  assert.equal(vouchersMatch("739", "740"), false);
});

test("classifySettlementDeleteSource routes datewise kinds", () => {
  assert.equal(classifySettlementDeleteSource("Receipt"), "receipt_register");
  assert.equal(classifySettlementDeleteSource("Payment"), "receipt_register");
  assert.equal(classifySettlementDeleteSource("Purchase"), "receipt_register");
  assert.equal(classifySettlementDeleteSource("Invoice"), "sales");
  assert.equal(classifySettlementDeleteSource("Credit Note"), "sales");
  assert.equal(classifySettlementDeleteSource("Credit Note / Return"), "sales");
});

test("appendSettlementDeletionLog keeps newest entries and upload/delete stamps", () => {
  const first = buildSettlementDeletionEntry({
    deletedAt: "2026-11-27T10:00:00.000Z",
    deletedBy: { id: "u1", salesmanName: "Chaina", salesmanCode: "IV006" },
    source: "sales_raw",
    kind: "Invoice",
    customerCode: "1708",
    voucher: "JNFD/021",
    transactionDate: "2026-11-18",
    uploadedAt: "2026-11-19T08:00:00.000Z",
    removedCount: 53,
  });
  const second = buildSettlementDeletionEntry({
    deletedAt: "2026-11-27T11:00:00.000Z",
    deletedBy: { id: "u1", salesmanName: "Chaina" },
    source: "receipt_register",
    kind: "Receipt",
    customerCode: "1594",
    voucher: "2235",
    transactionDate: "2026-11-09",
    uploadedAt: "2026-11-10T07:00:00.000Z",
    removedCount: 1,
  });
  const log = appendSettlementDeletionLog(
    appendSettlementDeletionLog({}, first),
    second,
  );
  assert.equal(log.entries.length, 2);
  assert.equal(log.entries[0].voucher, "2235");
  assert.equal(log.entries[0].uploadedAt, "2026-11-10T07:00:00.000Z");
  assert.equal(log.entries[0].deletedAt, "2026-11-27T11:00:00.000Z");
  assert.equal(log.entries[1].voucher, "JNFD/021");
  assert.equal(log.entries[1].uploadedAt, "2026-11-19T08:00:00.000Z");
});

test("removeOutstandingInvoiceFromDataset drops the bill and recomputes or removes the customer row", () => {
  const dataset = {
    uploadedAt: "2026-11-08T10:00:00.000Z",
    invoices: [
      {
        customer_code: "1367",
        customer_name: "Wubl",
        ref_no: "RNFD/0642",
        invoice_date: "2026-11-04",
        pending_amount: 506,
      },
      {
        customer_code: "1367",
        customer_name: "Wubl",
        ref_no: "RNFD/470",
        invoice_date: "2026-10-01",
        pending_amount: 1487.8,
      },
    ],
    rows: [{
      customer_code: "1367",
      customer_name: "Wubl",
      total_outstanding: 1993.8,
      open_invoices: 2,
      buckets: { "0-30": 506, "31-60": 1487.8 },
    }],
  };

  const partial = removeOutstandingInvoiceFromDataset(dataset, {
    customerCode: "1367",
    voucher: "RNFD/0642",
    transactionDate: "2026-11-04",
  });
  assert.equal(partial.removedCount, 1);
  assert.equal(partial.dataset.invoices.length, 1);
  assert.equal(partial.dataset.invoices[0].ref_no, "RNFD/470");
  assert.equal(partial.customerDropped, false);
  assert.equal(partial.dataset.rows.length, 1);
  assert.equal(Number(partial.dataset.rows[0].open_invoices), 1);

  const emptied = removeOutstandingInvoiceFromDataset({
    ...partial.dataset,
  }, {
    customerCode: "1367",
    voucher: "RNFD/470",
  });
  assert.equal(emptied.removedCount, 1);
  assert.equal(emptied.dataset.invoices.length, 0);
  assert.equal(emptied.customerDropped, true);
  assert.equal(emptied.dataset.rows.length, 0);
});

test("summarizeSalesRowsForAudit uses earliest created_at as uploadedAt", () => {
  const summary = summarizeSalesRowsForAudit([
    {
      voucher_number: "JNFD/021",
      transaction_date: "2026-11-18",
      sales_amount: 100,
      created_at: "2026-11-19T09:00:00.000Z",
    },
    {
      voucher_number: "JNFD/021",
      transaction_date: "2026-11-18",
      sales_amount: 50,
      created_at: "2026-11-19T08:00:00.000Z",
    },
  ]);
  assert.equal(summary.removedCount, 2);
  assert.equal(summary.amountExclVat, 150);
  assert.equal(summary.uploadedAt, "2026-11-19T08:00:00.000Z");
  assert.equal(summary.voucher, "JNFD/021");
});

test("Chaina and China names can delete settlement transactions", () => {
  assert.equal(canDeleteSettlementTransaction({
    role: "invoice-maker",
    salesmanCode: "IV006",
    salesmanName: "Chaina",
  }), true);
  assert.equal(canDeleteSettlementTransaction({
    role: "invoice-maker",
    salesmanName: "China",
  }), true);
  assert.equal(canDeleteSettlementTransaction({
    role: "invoice-maker",
    salesmanName: "Other",
  }), false);
});
