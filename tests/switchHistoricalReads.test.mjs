import test from "node:test";
import assert from "node:assert/strict";
import {
  isHistoricalReadSwitchRow,
  isSwitchedHistoricalRow,
  sameIdSet,
  signedHostKind,
} from "../app/lib/storage/switchHistoricalReads.js";

const flatReceipt = {
  category: "receipt_copy",
  storage_provider: "supabase",
  verified_at: "2026-10-17T13:40:00.000Z",
  object_key: "payment-collections/receipt-copies/1114C-1720000000000-receipt.jpg",
};

test("only verified flat historical rows qualify for the read switch", () => {
  assert.equal(isHistoricalReadSwitchRow(flatReceipt), true);
  assert.equal(isHistoricalReadSwitchRow({ ...flatReceipt, verified_at: null }), false);
  assert.equal(isHistoricalReadSwitchRow({ ...flatReceipt, storage_provider: "r2" }), false);
  assert.equal(isHistoricalReadSwitchRow({
    ...flatReceipt,
    object_key: "payment-collections/receipt-copies/2026/10/1222C/file.jpg",
  }), false);
  assert.equal(isHistoricalReadSwitchRow({
    ...flatReceipt,
    category: "payment_copy",
  }), false);
  assert.equal(isHistoricalReadSwitchRow({
    ...flatReceipt,
    category: "order_invoice",
    object_key: "order-invoices/1002/1/file.pdf",
  }), false);
});

test("a switched row is the same flat key with the provider set to r2", () => {
  assert.equal(isSwitchedHistoricalRow({ ...flatReceipt, storage_provider: "r2" }), true);
  assert.equal(isSwitchedHistoricalRow(flatReceipt), false);
});

test("signed hosts stay classified without treating verified_at as the provider", () => {
  assert.equal(signedHostKind("https://example.r2.cloudflarestorage.com/payment-collections/receipt-copies/a.jpg"), "r2");
  assert.equal(signedHostKind("https://example.supabase.co/storage/v1/object/sign/payment-collections/receipt-copies/a.jpg"), "supabase");
  assert.equal(sameIdSet(["b", "a"], ["a", "b"]), true);
  assert.equal(sameIdSet(["a"], ["a", "b"]), false);
});
