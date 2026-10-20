import { createHash } from "node:crypto";

export const HISTORICAL_COLLECTION_COUNTS = Object.freeze({
  objects: 1589,
  receipts: 1323,
  payments: 266,
});

export const HISTORICAL_R2_BUCKET = "madiba-attachments-prod";
export const HISTORICAL_SUPABASE_BUCKET = "payment-collections";
export const SIGN_BATCH_LIMIT = 20;

const RECEIPT_FILENAME = /^receipt-copies\/[^/]+$/;
const PAYMENT_FILENAME = /^payment-copies\/[^/]+$/;

function progressObject(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function manifestEntries(progress, pattern, issues) {
  const payload = progressObject(progress);
  const verified = payload.verified && typeof payload.verified === "object" ? payload.verified : {};
  const reconciled = payload.reconciled && typeof payload.reconciled === "object" ? payload.reconciled : {};
  const entries = [];
  for (const [name, sha] of Object.entries(verified)) {
    const checksum = String(sha || "").toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(checksum) || String(reconciled[name] || "").toLowerCase() !== checksum || !pattern.test(name)) {
      issues.add("manifest-mismatch");
      continue;
    }
    entries.push({ name, sha256: checksum });
  }
  for (const name of Object.keys(reconciled)) {
    if (!Object.prototype.hasOwnProperty.call(verified, name)) issues.add("manifest-mismatch");
  }
  return entries;
}

/**
 * Builds the only set of historical receipt and payment keys that may be backed up.
 * Every Supabase object must be a flat file whose checksum was both copied and reconciled.
 */
export function historicalBackupPlan({
  files = [],
  receiptProgress,
  paymentProgress,
  expected = HISTORICAL_COLLECTION_COUNTS,
} = {}) {
  const issues = new Set();
  const filesByPath = new Map();
  let other = 0;
  for (const file of files) {
    const path = String(file?.path || "").replace(/^\/+/, "");
    if (!path || path.split("/").some((part) => part === "." || part === "..")) {
      issues.add("unexpected-object");
      continue;
    }
    if (filesByPath.has(path)) issues.add("duplicate-object");
    filesByPath.set(path, file);
    if (!RECEIPT_FILENAME.test(path) && !PAYMENT_FILENAME.test(path)) other += 1;
  }

  const receiptFiles = [...filesByPath.keys()].filter((path) => RECEIPT_FILENAME.test(path));
  const paymentFiles = [...filesByPath.keys()].filter((path) => PAYMENT_FILENAME.test(path));
  if (filesByPath.size !== expected.objects) issues.add("object-count");
  if (receiptFiles.length !== expected.receipts) issues.add("receipt-count");
  if (paymentFiles.length !== expected.payments) issues.add("payment-count");
  if (other !== 0) issues.add("unexpected-object");

  const receipts = manifestEntries(receiptProgress, RECEIPT_FILENAME, issues);
  const payments = manifestEntries(paymentProgress, PAYMENT_FILENAME, issues);
  if (receipts.length !== expected.receipts || payments.length !== expected.payments) issues.add("manifest-count");

  const entries = [];
  for (const entry of [...receipts, ...payments]) {
    const file = filesByPath.get(entry.name);
    const bytes = Number(file?.bytes);
    if (!file) {
      issues.add("missing-supabase");
      continue;
    }
    if (!Number.isInteger(bytes) || bytes <= 0) {
      issues.add("missing-size");
      continue;
    }
    entries.push({
      name: entry.name,
      sha256: entry.sha256,
      supabaseBytes: bytes,
      key: `${HISTORICAL_SUPABASE_BUCKET}/${entry.name}`,
    });
  }

  const listed = new Set([...receiptFiles, ...paymentFiles]);
  if (entries.length !== listed.size || [...listed].some((name) => !entries.some((entry) => entry.name === name))) {
    issues.add("inventory-mismatch");
  }

  entries.sort((a, b) => a.key.localeCompare(b.key));
  return {
    ok: issues.size === 0,
    issues: [...issues].sort(),
    counts: {
      objects: filesByPath.size,
      receipts: receiptFiles.length,
      payments: paymentFiles.length,
      other,
      manifest: receipts.length + payments.length,
    },
    entries: issues.size === 0 ? entries : [],
  };
}

export function assertSignBatch(entries, names) {
  if (!Array.isArray(names) || names.length < 1 || names.length > SIGN_BATCH_LIMIT) {
    throw Object.assign(new Error("Invalid backup batch."), { code: "bad-batch" });
  }
  const allowed = new Map((entries || []).map((entry) => [entry.name, entry]));
  return names.map((name) => {
    const entry = allowed.get(name);
    if (!entry) throw Object.assign(new Error("Backup batch is outside the historical inventory."), { code: "outside-inventory" });
    return entry;
  });
}

export function verifyDownloadedObject({ bytes, sha256, supabaseBytes } = {}) {
  const body = Buffer.from(bytes || []);
  const actual = createHash("sha256").update(body).digest("hex");
  if (actual !== String(sha256 || "").toLowerCase()) {
    throw Object.assign(new Error("Downloaded R2 checksum does not match the migration manifest."), { code: "checksum-mismatch" });
  }
  if (body.length !== Number(supabaseBytes)) {
    throw Object.assign(new Error("Downloaded R2 size does not match the Supabase object."), { code: "size-mismatch" });
  }
  return { sha256: actual, bytes: body.length };
}

export function restorationInstructions() {
  return [
    "MADIBA historical receipt and payment-copy backup",
    "",
    "This archive is the independent copy of the 1,589 historical files in Cloudflare R2 bucket madiba-attachments-prod.",
    "Each file was downloaded from R2 and matched to the approved migration manifest SHA-256 and the Supabase object size before this archive was created.",
    "Decrypt with the offline age private key that matches the public backup recipient. Do not store that private key in GitHub or in this archive.",
    "",
    "age --decrypt --identity <private-key> --output historical-collection-copies.tar.gz <archive.tar.gz.age>",
    "Then extract the tar.gz. files/ contains the object keys. manifest.json contains every key, SHA-256, and byte size.",
    "",
    "To restore one object, upload files/<payment-collections/...key> back to that same key.",
    "Supabase bucket: payment-collections. The object path is the key without the payment-collections/ prefix.",
    "R2 bucket: madiba-attachments-prod. The object key is the full payment-collections/... path.",
    "After upload, compare the SHA-256 and size with manifest.json before serving the file.",
    "",
    "This archive does not change attachment rows, visit links, or financial records. Restoring a file does not by itself switch the application back to Supabase.",
    "Do not use this archive to replace customer-documents, order-invoices, upload-files, or product-catalogue.",
    "",
  ].join("\n");
}
