import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  assessStoredCollectionUpload,
  classifyCollectionAttachmentLinks,
  isPermanentVerificationFailure,
  verificationFailureDetail,
} from "../app/lib/storage/verifyCollectionUploads.js";

const KEY = "payment-collections/receipt-copies/2026/10/1222C/20261017-9f339f6b-8cf3-475e-ab0c-9b25f0c2d9cd.jpg";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0x11, 0x22]);

function record(overrides = {}) {
  return {
    id: "receipt-1",
    category: "receipt_copy",
    storage_provider: "r2",
    object_key: KEY,
    content_type: "image/jpeg",
    size_bytes: JPEG.length,
    sha256: createHash("sha256").update(JPEG).digest("hex"),
    entity_id: "2575",
    ...overrides,
  };
}

test("a dated R2 upload verifies only when the download matches the stored row", () => {
  const ok = assessStoredCollectionUpload({ record: record(), bytes: JPEG, signedBytes: JPEG });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.reasons, []);

  const wrong = assessStoredCollectionUpload({
    record: record(),
    bytes: Buffer.from([0xff, 0xd8, 0xff, 0x99]),
    signedBytes: Buffer.from([0xff, 0xd8, 0xff, 0x99]),
  });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.reasons.includes("checksum"), true);
  assert.equal(wrong.reasons.includes("size-mismatch"), true);
  assert.equal(isPermanentVerificationFailure(wrong.reasons), true);
  assert.deepEqual(verificationFailureDetail({ statusCode: 404 }), ["missing"]);
  assert.deepEqual(verificationFailureDetail(new Error("timeout")), ["download"]);
});

test("flat historical keys and mismatched categories are not stamped from this check", () => {
  const flat = assessStoredCollectionUpload({
    record: record({ object_key: "payment-collections/receipt-copies/1114C-1-receipt.jpg" }),
    bytes: JPEG,
    signedBytes: JPEG,
  });
  assert.equal(flat.ok, false);
  assert.equal(flat.reasons.includes("object-key"), true);

  const swapped = assessStoredCollectionUpload({
    record: record({ category: "payment_copy" }),
    bytes: JPEG,
    signedBytes: JPEG,
  });
  assert.equal(swapped.reasons.includes("category-key"), true);
});

test("unlinked rows are classified without merging them", () => {
  const visits = [{ id: 10, receipt_attachment_id: "linked", payment_attachment_id: null }];
  const rows = [
    { id: "linked", category: "receipt_copy", sha256: "aaa", entity_id: "10" },
    { id: "spare", category: "receipt_copy", sha256: "aaa", entity_id: null },
    { id: "abandoned", category: "payment_copy", sha256: "bbb", entity_id: "11" },
    { id: "alone", category: "payment_copy", sha256: "ccc", entity_id: null },
  ];
  const counts = classifyCollectionAttachmentLinks(rows, visits);
  assert.equal(counts.linked, 1);
  assert.equal(counts.duplicateUploads, 1);
  assert.equal(counts.abandonedSubmissions, 1);
  assert.equal(counts.unlinkedUnique, 1);
  assert.equal(counts.byCategory.receipt_copy.duplicateUploads, 1);
  assert.equal(counts.byCategory.payment_copy.abandonedSubmissions, 1);
  assert.equal(counts.byCategory.payment_copy.unlinkedUnique, 1);
});
