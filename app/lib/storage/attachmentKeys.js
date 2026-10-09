// Object keys are `${bucket}/${path}` so the same key works for Supabase today and R2 later.
export const ATTACHMENT_BUCKETS = Object.freeze({
  collections: "payment-collections",
  orderInvoices: "order-invoices",
  customerDocuments: "customer-documents",
});

export const ATTACHMENT_CATEGORIES = Object.freeze({
  receiptCopy: "receipt_copy",
  paymentCopy: "payment_copy",
  orderInvoice: "order_invoice",
  customerDocument: "customer_document",
});

const COLLECTION_COPY_FOLDERS = {
  receipt: "receipt-copies",
  payment: "payment-copies",
};

const PUBLIC_URL_MARKER = "/storage/v1/object/public/";

export function safeObjectFileName(name, fallback = "file") {
  return String(name || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "") || fallback;
}

function nowMs(now) {
  const value = typeof now === "number" ? now : new Date(now ?? Date.now()).getTime();
  return Number.isFinite(value) ? value : Date.now();
}

export function joinObjectKey(bucket, path) {
  const cleanBucket = String(bucket || "").trim().replace(/^\/+|\/+$/g, "");
  const cleanPath = String(path || "").trim().replace(/^\/+/, "");
  if (!cleanBucket || !cleanPath) throw new Error("Attachment bucket and path are required.");
  return `${cleanBucket}/${cleanPath}`;
}

export function splitObjectKey(key) {
  const text = String(key || "").trim().replace(/^\/+/, "");
  const slash = text.indexOf("/");
  if (slash <= 0 || slash === text.length - 1) {
    throw new Error("Attachment object key must include a bucket and a path.");
  }
  return { bucket: text.slice(0, slash), path: text.slice(slash + 1) };
}

export function buildCollectionCopyKey({ kind, customerCode, extension, now } = {}) {
  const folder = COLLECTION_COPY_FOLDERS[kind];
  if (!folder) throw new Error("Collection copy kind must be receipt or payment.");
  const code = String(customerCode || "").trim();
  if (!code) throw new Error("Customer code is required for collection attachments.");
  const ext = String(extension || "jpg").replace(/^\./, "").toLowerCase() || "jpg";
  return joinObjectKey(ATTACHMENT_BUCKETS.collections, `${folder}/${code}-${nowMs(now)}-${kind}.${ext}`);
}

export function buildOrderInvoiceKey({ customerCode, orderId, fileName, now } = {}) {
  const code = String(customerCode || "").trim().toUpperCase() || "UNKNOWN";
  const order = String(orderId || "").trim();
  if (!order) throw new Error("Order id is required for invoice attachments.");
  const safeName = safeObjectFileName(fileName, "invoice.pdf");
  return joinObjectKey(ATTACHMENT_BUCKETS.orderInvoices, `${code}/${order}/${nowMs(now)}-${safeName}`);
}

export function buildCustomerDocumentKey({ customerCode, documentType, fileName, now } = {}) {
  const code = String(customerCode || "").trim();
  const type = String(documentType || "").trim();
  if (!code || !type) throw new Error("Customer code and document type are required.");
  const safeName = safeObjectFileName(fileName, "document.pdf");
  return joinObjectKey(ATTACHMENT_BUCKETS.customerDocuments, `${code}/${type}/${nowMs(now)}-${safeName}`);
}

// "legacy" keeps the historical Supabase paths; "immutable" is used for R2-primary writes.
export const KEY_LAYOUTS = Object.freeze({ legacy: "legacy", immutable: "immutable" });

function keySegment(value, fallback) {
  const text = String(value || "").trim().toUpperCase().replace(/[^A-Z0-9._-]+/g, "_").replace(/^[_.]+|_+$/g, "");
  return text || fallback;
}

function riyadhDateParts(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(nowMs(now))).map((part) => [part.type, part.value]));
  return { yyyy: parts.year, mm: parts.month, dd: parts.day };
}

function newUuid(uuid) {
  const value = String(uuid || globalThis.crypto.randomUUID()).toLowerCase();
  if (!/^[0-9a-f-]{36}$/.test(value)) throw new Error("Invalid attachment uuid.");
  return value;
}

export function buildImmutableCollectionCopyKey({ kind, customerCode, extension, now, uuid } = {}) {
  const folder = COLLECTION_COPY_FOLDERS[kind];
  if (!folder) throw new Error("Collection copy kind must be receipt or payment.");
  if (!String(customerCode || "").trim()) throw new Error("Customer code is required for collection attachments.");
  const ext = String(extension || "jpg").replace(/^\./, "").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const { yyyy, mm, dd } = riyadhDateParts(now);
  return joinObjectKey(
    ATTACHMENT_BUCKETS.collections,
    `${folder}/${yyyy}/${mm}/${keySegment(customerCode, "UNKNOWN")}/${yyyy}${mm}${dd}-${newUuid(uuid)}.${ext}`,
  );
}

export function buildImmutableOrderInvoiceKey({ customerCode, orderId, fileName, now, uuid } = {}) {
  const order = String(orderId || "").trim();
  if (!/^\d+$/.test(order)) throw new Error("Order id is required for invoice attachments.");
  const safeName = safeObjectFileName(fileName, "invoice.pdf");
  return joinObjectKey(
    ATTACHMENT_BUCKETS.orderInvoices,
    `${keySegment(customerCode, "UNKNOWN")}/${order}/${nowMs(now)}-${newUuid(uuid)}-${safeName}`,
  );
}

export function buildImmutableCustomerDocumentKey({ customerCode, documentType, fileName, now, uuid } = {}) {
  if (!String(customerCode || "").trim() || !String(documentType || "").trim()) {
    throw new Error("Customer code and document type are required.");
  }
  const safeName = safeObjectFileName(fileName, "document.pdf");
  return joinObjectKey(
    ATTACHMENT_BUCKETS.customerDocuments,
    `${keySegment(customerCode, "UNKNOWN")}/${keySegment(documentType, "OTHER")}/${nowMs(now)}-${newUuid(uuid)}-${safeName}`,
  );
}

const KEY_BUILDERS = {
  [ATTACHMENT_CATEGORIES.receiptCopy]: {
    legacy: (input) => buildCollectionCopyKey({ ...input, kind: "receipt" }),
    immutable: (input) => buildImmutableCollectionCopyKey({ ...input, kind: "receipt" }),
  },
  [ATTACHMENT_CATEGORIES.paymentCopy]: {
    legacy: (input) => buildCollectionCopyKey({ ...input, kind: "payment" }),
    immutable: (input) => buildImmutableCollectionCopyKey({ ...input, kind: "payment" }),
  },
  [ATTACHMENT_CATEGORIES.orderInvoice]: {
    legacy: buildOrderInvoiceKey,
    immutable: buildImmutableOrderInvoiceKey,
  },
  [ATTACHMENT_CATEGORIES.customerDocument]: {
    legacy: buildCustomerDocumentKey,
    immutable: buildImmutableCustomerDocumentKey,
  },
};

export function buildAttachmentKey(category, input = {}, layout = KEY_LAYOUTS.legacy) {
  const builders = KEY_BUILDERS[category];
  if (!builders) throw new Error(`Unknown attachment category "${category}".`);
  return (layout === KEY_LAYOUTS.immutable ? builders.immutable : builders.legacy)(input);
}

// Legacy business fields keep bucket-relative paths (invoiceFilePath, customer_documents.file_path).
export function bucketRelativePath(key, expectedBucket) {
  const { bucket, path } = splitObjectKey(key);
  if (expectedBucket && bucket !== expectedBucket) {
    throw new Error(`Attachment key is not in the ${expectedBucket} bucket.`);
  }
  return path;
}

// Historical rows hold public URLs; they are only parsed into bucket/path and then signed privately.
export function parseLegacySupabaseUrl(url) {
  const text = String(url || "").trim();
  const markerAt = text.indexOf(PUBLIC_URL_MARKER);
  if (markerAt < 0) return null;
  const rest = text.slice(markerAt + PUBLIC_URL_MARKER.length).split(/[?#]/)[0];
  const slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) return null;
  const bucket = rest.slice(0, slash);
  let path = rest.slice(slash + 1);
  try {
    path = decodeURIComponent(path);
  } catch {
    // Keep the raw path when it is not valid percent-encoding.
  }
  return { bucket, path, key: `${bucket}/${path}` };
}

export function legacyObjectKey(bucket, path) {
  const cleanPath = String(path || "").trim();
  if (!cleanPath) return "";
  return joinObjectKey(bucket, cleanPath);
}

// Legacy copy columns hold either a historical public URL or (pre-migration fallback) a bare object key.
export function parseStoredObjectReference(value, expectedBucket) {
  const text = String(value || "").trim();
  if (!text) return null;
  const parsed = text.includes(PUBLIC_URL_MARKER)
    ? parseLegacySupabaseUrl(text)
    : /^[a-z][a-z0-9+.-]*:/i.test(text)
      ? null
      : (() => {
        try {
          return { ...splitObjectKey(text), key: text.replace(/^\/+/, "") };
        } catch {
          return null;
        }
      })();
  if (!parsed || (expectedBucket && parsed.bucket !== expectedBucket)) return null;
  if (parsed.path.split("/").some((segment) => segment === "..")) return null;
  return parsed;
}
