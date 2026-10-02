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

// Legacy business fields keep bucket-relative paths (invoiceFilePath, customer_documents.file_path).
export function bucketRelativePath(key, expectedBucket) {
  const { bucket, path } = splitObjectKey(key);
  if (expectedBucket && bucket !== expectedBucket) {
    throw new Error(`Attachment key is not in the ${expectedBucket} bucket.`);
  }
  return path;
}

export function legacySupabasePublicUrl(supabaseUrl, key) {
  const base = String(supabaseUrl || "").trim().replace(/\/+$/, "");
  const { bucket, path } = splitObjectKey(key);
  return `${base}${PUBLIC_URL_MARKER}${bucket}/${path}`;
}

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
