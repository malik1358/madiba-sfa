import test from "node:test";
import assert from "node:assert/strict";
import {
  assessCopiedBytes,
  contentTypeForPayment,
  copyReceiptBatch,
  newUploadAssociation,
  paymentDestinationKey,
} from "../app/lib/storage/copyReceiptsToR2.js";
import { historicalR2ReadCandidate, legacyCollectionCopyRef } from "../app/lib/storage/attachmentRecords.js";

test("historical payment filenames keep the approved flat R2 key", () => {
  assert.equal(
    paymentDestinationKey("payment-copies/1114C-1720000000000-payment.jpg"),
    "payment-collections/payment-copies/1114C-1720000000000-payment.jpg",
  );
  assert.equal(contentTypeForPayment("payment-copies/a.png"), "image/png");
  assert.equal(contentTypeForPayment("payment-copies/a.pdf"), "application/pdf");
  assert.throws(() => paymentDestinationKey("payment-copies/2026/10/file.jpg"), /original filename/);
  assert.throws(() => paymentDestinationKey("receipt-copies/file.jpg"), /original filename/);
});

test("payment copy reuses an identical R2 object and refuses different bytes", async () => {
  const store = new Map();
  const first = await copyReceiptBatch({
    names: ["payment-copies/a.png"],
    download: async () => Buffer.from("payment-a"),
    put: async (key, body) => {
      if (store.has(key)) throw Object.assign(new Error("exists"), { statusCode: 412 });
      store.set(key, Buffer.from(body));
    },
    get: async (key) => store.get(key),
    markVerified: async () => 1,
    destinationKeyFor: paymentDestinationKey,
    contentTypeFor: contentTypeForPayment,
    timeBudgetMs: 5000,
  });
  assert.equal(first.copied, 1);
  assert.equal(store.has("payment-collections/payment-copies/a.png"), true);

  const conflict = await copyReceiptBatch({
    names: ["payment-copies/a.png"],
    download: async () => Buffer.from("other"),
    put: async (key) => {
      if (store.has(key)) throw Object.assign(new Error("exists"), { statusCode: 412 });
    },
    get: async (key) => store.get(key),
    markVerified: async () => 1,
    destinationKeyFor: paymentDestinationKey,
    contentTypeFor: contentTypeForPayment,
    timeBudgetMs: 5000,
  });
  assert.equal(conflict.stopReason, "integrity");
  assert.equal(store.get("payment-collections/payment-copies/a.png").toString(), "payment-a");
});

test("new upload verification accepts matching jpeg bytes only", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x11]);
  assert.equal(assessCopiedBytes({
    bytes: jpeg,
    signedBytes: jpeg,
    sizeBytes: jpeg.length,
    contentType: "image/jpeg",
  }).ok, true);
  assert.equal(assessCopiedBytes({
    bytes: jpeg,
    signedBytes: Buffer.from("nope"),
    sizeBytes: jpeg.length,
    contentType: "image/jpeg",
  }).ok, false);
});

test("a linked new upload must match the visit and an unlinked duplicate stays unlinked", () => {
  const visit = { id: 2575, customer_code: "1222C", payment_attachment_id: "pay-1", receipt_attachment_id: "receipt-1" };
  assert.deepEqual(newUploadAssociation({
    id: "pay-1",
    category: "payment_copy",
    customer_code: "1222C",
    entity_id: "2575",
  }, visit), { state: "visit", ok: true });
  assert.deepEqual(newUploadAssociation({
    id: "pay-2",
    category: "payment_copy",
    entity_id: null,
  }, null), { state: "unlinked", ok: true });
});

test("verified_at does not switch the active read provider", () => {
  const record = {
    category: "payment_copy",
    storage_provider: "supabase",
    object_key: "payment-collections/payment-copies/1114C-1720000000000-payment.jpg",
    verified_at: "2026-10-17T00:00:00.000Z",
  };
  const candidate = historicalR2ReadCandidate(record);
  assert.equal(candidate.activeProvider, "supabase");
  assert.equal(candidate.ready, true);
  assert.equal(candidate.r2Key, record.object_key);
  assert.equal(historicalR2ReadCandidate({ ...record, verified_at: null }).ready, false);
  assert.equal(historicalR2ReadCandidate({
    ...record,
    object_key: "payment-collections/payment-copies/2026/10/1222C/file.jpg",
  }).ready, false);
  assert.deepEqual(
    legacyCollectionCopyRef({ payment_copy_url: "https://example.supabase.co/storage/v1/object/public/payment-collections/payment-copies/a.jpg" }, "payment"),
    { provider: "supabase", key: "payment-collections/payment-copies/a.jpg" },
  );
});
