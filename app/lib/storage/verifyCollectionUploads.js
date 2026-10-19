import { assessCopiedBytes, contentTypeForPayment, sha256Hex } from "./copyReceiptsToR2.js";

export const COLLECTION_UPLOAD_VERIFY_KEY = "collection_r2_upload_verify_v1";

const DATED_KEY = /^payment-collections\/(receipt-copies|payment-copies)\/[0-9]{4}\/[0-9]{2}\/[^/]+\/[0-9]{8}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|pdf)$/i;

const PERMANENT_REASONS = new Set([
  "object-key",
  "category-key",
  "provider",
  "content-type",
  "checksum",
  "size-mismatch",
  "empty",
  "signed-url-mismatch",
  "not-jpeg",
  "not-png",
  "not-pdf",
  "signed-host",
  "signed-read",
  "download-gate",
  "missing",
  "verified-at",
]);

export function isPermanentVerificationFailure(reasons) {
  return (reasons || []).some((reason) => PERMANENT_REASONS.has(reason));
}

export function assessStoredCollectionUpload({ record, bytes, signedBytes } = {}) {
  const reasons = [];
  const key = String(record?.object_key || "");
  if (key.split("/").some((part) => part === "." || part === "..")) reasons.push("object-key");
  const match = DATED_KEY.exec(key);
  if (!match) reasons.push("object-key");
  const expectedFolder = record?.category === "payment_copy"
    ? "payment-copies"
    : record?.category === "receipt_copy"
      ? "receipt-copies"
      : "";
  if (!expectedFolder || match?.[1] !== expectedFolder) reasons.push("category-key");
  if (record?.storage_provider !== "r2") reasons.push("provider");
  const expectedType = contentTypeForPayment(key);
  if (!record?.content_type || record.content_type !== expectedType) reasons.push("content-type");
  const storedSha = String(record?.sha256 || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(storedSha)) reasons.push("checksum");
  const assessed = assessCopiedBytes({
    bytes,
    signedBytes,
    sizeBytes: record?.size_bytes,
    contentType: record?.content_type,
  });
  for (const reason of assessed.reasons) {
    if (!reasons.includes(reason)) reasons.push(reason);
  }
  if (/^[0-9a-f]{64}$/.test(storedSha) && storedSha !== assessed.sha256) reasons.push("checksum");
  return {
    ok: reasons.length === 0,
    reasons,
    sha256: assessed.sha256,
    bytes: assessed.bytes,
    kind: assessed.kind,
  };
}

export function verificationFailureDetail(error) {
  const status = Number(error?.statusCode || error?.status || 0);
  if (status === 404) return ["missing"];
  return ["download"];
}

export function classifyCollectionAttachmentLinks(rows, visits) {
  const selected = new Set();
  for (const visit of visits || []) {
    if (visit?.receipt_attachment_id) selected.add(String(visit.receipt_attachment_id));
    if (visit?.payment_attachment_id) selected.add(String(visit.payment_attachment_id));
  }
  const selectedChecksums = new Set();
  for (const row of rows || []) {
    if (selected.has(String(row?.id || "")) && row?.sha256) selectedChecksums.add(String(row.sha256).toLowerCase());
  }
  const counts = {
    linked: 0,
    duplicateUploads: 0,
    abandonedSubmissions: 0,
    unlinkedUnique: 0,
    byCategory: {
      receipt_copy: { linked: 0, duplicateUploads: 0, abandonedSubmissions: 0, unlinkedUnique: 0 },
      payment_copy: { linked: 0, duplicateUploads: 0, abandonedSubmissions: 0, unlinkedUnique: 0 },
    },
  };
  for (const row of rows || []) {
    const bucket = counts.byCategory[row?.category];
    if (!bucket) continue;
    let kind = "unlinkedUnique";
    if (selected.has(String(row.id))) kind = "linked";
    else if (row.entity_id) kind = "abandonedSubmissions";
    else if (row.sha256 && selectedChecksums.has(String(row.sha256).toLowerCase())) kind = "duplicateUploads";
    counts[kind] += 1;
    bucket[kind] += 1;
  }
  return counts;
}

export function sameStoredBytes(left, right) {
  return sha256Hex(left || []) === sha256Hex(right || []);
}
