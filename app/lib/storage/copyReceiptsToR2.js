import { createHash } from "node:crypto";

export const RECEIPT_COPY_PREFIX = "receipt-copies/";
export const RECEIPT_R2_BUCKET = "madiba-attachments-prod";
export const RECEIPT_COPY_PROGRESS_KEY = "receipt_r2_copy_progress_v1";
export const COPY_CONCURRENCY = 4;

const FILENAME = /^receipt-copies\/[^/]+$/;

export function receiptDestinationKey(objectName) {
  const name = String(objectName || "").replace(/^\/+/, "");
  if (!FILENAME.test(name)) {
    throw new Error("Receipt files stay in receipt-copies with their original filename.");
  }
  return `payment-collections/${name}`;
}

export function sha256Hex(bytes) {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

export function contentTypeForReceipt(objectName) {
  return String(objectName || "").toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg";
}

export function failureKind(error) {
  const status = Number(error?.statusCode || error?.status || 0);
  const message = String(error?.message || "");
  if (status === 401 || status === 403 || /forbidden|unauthorized|access denied/i.test(message)) return "auth";
  if (status === 409 || /did not match|different content|integrity/i.test(message)) return "integrity";
  return "file";
}

export function shouldStopCopy({ auth = 0, integrity = 0, fileFailures = 0, attempted = 0 } = {}) {
  if (auth > 0 || integrity > 0) return true;
  if (attempted >= 20 && fileFailures / attempted >= 0.25) return true;
  return false;
}

async function mapPool(items, limit, worker) {
  const results = [];
  let next = 0;
  async function run() {
    while (next < items.length) {
      const current = next;
      next += 1;
      results[current] = await worker(items[current], current);
    }
  }
  const width = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: width }, () => run()));
  return results;
}

/**
 * Copies one batch of receipt objects. Existing R2 objects are read and compared.
 * A different checksum is an integrity stop and is never overwritten.
 */
export async function copyReceiptBatch({
  names,
  download,
  put,
  get,
  markVerified,
  verifiedNames = new Set(),
  concurrency = COPY_CONCURRENCY,
  timeBudgetMs = 45000,
  now = Date.now,
} = {}) {
  const started = now();
  const pending = names.filter((name) => !verifiedNames.has(name));
  const summary = {
    attempted: 0,
    copied: 0,
    already: 0,
    failed: 0,
    auth: 0,
    integrity: 0,
    verifiedRows: 0,
    verified: [],
    failures: [],
    stop: false,
    stopReason: "",
  };

  await mapPool(pending, concurrency, async (name) => {
    if (summary.stop || now() - started > timeBudgetMs) return;
    summary.attempted += 1;
    let uploaded = false;
    try {
      const destinationKey = receiptDestinationKey(name);
      const source = Buffer.from(await download(name));
      const sourceSha = sha256Hex(source);
      try {
        await put(destinationKey, source, contentTypeForReceipt(name), sourceSha);
        uploaded = true;
      } catch (error) {
        if (Number(error?.statusCode) !== 412) throw error;
      }
      const remoteSha = sha256Hex(await get(destinationKey));
      if (remoteSha !== sourceSha) {
        summary.integrity += 1;
        summary.failed += 1;
        summary.failures.push({ name, reason: uploaded ? "uploaded-bytes-mismatch" : "existing-bytes-mismatch" });
        summary.stop = true;
        summary.stopReason = "integrity";
        return;
      }
      const rows = await markVerified(destinationKey);
      summary.verifiedRows += rows;
      summary.verified.push({ name, sha256: sourceSha, copied: uploaded });
      if (uploaded) summary.copied += 1;
      else summary.already += 1;
    } catch (error) {
      const kind = failureKind(error);
      summary.failed += 1;
      summary.failures.push({ name, reason: kind === "file" ? "copy-failed" : kind });
      if (kind === "auth") summary.auth += 1;
      if (kind === "integrity") summary.integrity += 1;
      if (shouldStopCopy({
        ...summary,
        fileFailures: summary.failed - summary.auth - summary.integrity,
      })) {
        summary.stop = true;
        summary.stopReason = kind === "auth" ? "auth" : kind === "integrity" ? "integrity" : "widespread";
      }
    }
  });

  return summary;
}
