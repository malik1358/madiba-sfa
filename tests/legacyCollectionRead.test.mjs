import test from "node:test";
import assert from "node:assert/strict";
import {
  legacyCollectionReadObject,
  legacyCollectionStoragePath,
  verifiedCopyNames,
} from "../app/lib/storage/legacyCollectionRead.js";

const SHA = "a".repeat(64);
const OTHER = "b".repeat(64);

function manifest(name, verifiedSha = SHA, reconciledSha = SHA) {
  return { verified: { [name]: verifiedSha }, reconciled: { [name]: reconciledSha } };
}

test("legacy receipt and payment paths map to the flat R2 key only from the checksum manifest", () => {
  const receipt = { provider: "supabase", key: "payment-collections/receipt-copies/1114C-1720000000000-receipt.jpg" };
  const names = verifiedCopyNames(manifest("receipt-copies/1114C-1720000000000-receipt.jpg"));
  assert.deepEqual(legacyCollectionReadObject(receipt, "receipt", names), {
    provider: "r2",
    key: receipt.key,
  });

  const payment = { provider: "supabase", key: "payment-collections/payment-copies/1114C-1720000000000-payment.jpg" };
  const paymentNames = verifiedCopyNames(manifest("payment-copies/1114C-1720000000000-payment.jpg"));
  assert.equal(legacyCollectionReadObject(payment, "payment", paymentNames).provider, "r2");
});

test("a filename, mismatched checksum, nested key, or rollback flag does not select R2", () => {
  const receipt = { provider: "supabase", key: "payment-collections/receipt-copies/a.jpg" };
  assert.equal(verifiedCopyNames({ verified: { "receipt-copies/a.jpg": true } }).has("receipt-copies/a.jpg"), false);
  assert.equal(legacyCollectionReadObject(receipt, "receipt", verifiedCopyNames({ verified: { "receipt-copies/a.jpg": SHA } })).provider, "supabase");
  assert.equal(legacyCollectionReadObject(receipt, "receipt", verifiedCopyNames(manifest("receipt-copies/a.jpg", SHA, OTHER))).provider, "supabase");
  assert.equal(legacyCollectionReadObject(receipt, "receipt", verifiedCopyNames(manifest("receipt-copies/a.jpg")), { forceSupabaseReads: true }).provider, "supabase");
  assert.equal(legacyCollectionStoragePath({ key: "payment-collections/receipt-copies/2026/10/a.jpg" }, "receipt"), "");
  assert.equal(legacyCollectionReadObject({ key: "payment-collections/payment-copies/a.jpg" }, "receipt", verifiedCopyNames(manifest("payment-copies/a.jpg"))).provider, "supabase");
  assert.equal(legacyCollectionReadObject({ key: "order-invoices/a.pdf" }, "receipt", verifiedCopyNames(manifest("receipt-copies/a.jpg"))).provider, "supabase");
});
