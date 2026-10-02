import { getObject, putObject } from "./attachmentStorage.js";
import {
  ATTACHMENT_BUCKETS,
  ATTACHMENT_CATEGORIES,
  legacyObjectKey,
  parseLegacySupabaseUrl,
} from "./attachmentKeys.js";

const RECORD_SELECT = "id,category,storage_provider,object_key,content_type,size_bytes,original_file_name,customer_code,entity_type,entity_id,uploaded_by,created_at";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATEGORY_VALUES = new Set(Object.values(ATTACHMENT_CATEGORIES));

export const ATTACHMENT_ENTITY_TYPES = Object.freeze({
  collectionVisit: "collection_visit",
  salesOrder: "sales_order",
  customerDocument: "customer_document",
});

export function isAttachmentId(value) {
  return UUID_PATTERN.test(String(value || "").trim());
}

export function isMissingAttachmentSchemaError(error) {
  const message = String(error?.message || error?.details || error?.hint || "").toLowerCase();
  if (error?.code === "42P01" || error?.code === "PGRST205") return message.includes("attachments") || !message;
  if (message.includes("relation") && message.includes("attachments") && message.includes("does not exist")) return true;
  if (message.includes("could not find the table") && message.includes("attachments")) return true;
  const missingColumn = error?.code === "42703"
    || error?.code === "PGRST204"
    || (message.includes("column") && (message.includes("does not exist") || message.includes("could not find")));
  return missingColumn && message.includes("attachment_id");
}

// supported=false means the attachments migration is not applied; callers keep the legacy fields.
export async function createAttachmentRecord(admin, {
  category,
  stored,
  originalFileName = "",
  customerCode = "",
  entityType = "",
  entityId = "",
  uploadedBy = null,
}) {
  if (!CATEGORY_VALUES.has(category)) throw new Error(`Unknown attachment category "${category}".`);
  if (!stored?.key || !stored?.provider) throw new Error("Stored attachment details are required.");

  const { data, error } = await admin
    .from("attachments")
    .insert({
      category,
      storage_provider: stored.provider,
      object_key: stored.key,
      content_type: stored.contentType || null,
      size_bytes: Number.isFinite(Number(stored.size)) ? Number(stored.size) : null,
      sha256: stored.sha256 || null,
      md5: stored.md5 || null,
      original_file_name: String(originalFileName || "").trim() || null,
      customer_code: String(customerCode || "").trim() || null,
      entity_type: String(entityType || "").trim() || null,
      entity_id: entityId === null || entityId === undefined || entityId === "" ? null : String(entityId),
      uploaded_by: uploadedBy || null,
    })
    .select(RECORD_SELECT)
    .single();

  if (error) {
    if (isMissingAttachmentSchemaError(error)) return { record: null, supported: false };
    throw error;
  }
  return { record: data, supported: true };
}

// Upload + metadata row in one step; attachmentId is null until the attachments migration is applied.
export async function storeAttachment(admin, {
  category,
  key,
  body,
  contentType,
  originalFileName = "",
  customerCode = "",
  entityType = "",
  entityId = "",
  uploadedBy = null,
}) {
  const stored = await putObject(admin, { key, body, contentType });
  const { record, supported } = await createAttachmentRecord(admin, {
    category,
    stored,
    originalFileName,
    customerCode,
    entityType,
    entityId,
    uploadedBy,
  });
  return { stored, record, supported, attachmentId: record?.id || null };
}

export async function getAttachmentById(admin, id) {
  if (!isAttachmentId(id)) return null;
  const { data, error } = await admin
    .from("attachments")
    .select(RECORD_SELECT)
    .eq("id", String(id).trim())
    .maybeSingle();
  if (error) {
    if (isMissingAttachmentSchemaError(error)) return null;
    throw error;
  }
  return data || null;
}

export async function linkAttachmentsToEntity(admin, ids, { entityType, entityId }) {
  const attachmentIds = (ids || []).filter(isAttachmentId);
  if (attachmentIds.length === 0 || entityId === null || entityId === undefined) return;
  try {
    const { error } = await admin
      .from("attachments")
      .update({ entity_type: entityType, entity_id: String(entityId) })
      .in("id", attachmentIds);
    if (error) console.warn("Unable to link attachments to their owner:", error);
  } catch (error) {
    console.warn("Unable to link attachments to their owner:", error);
  }
}

export function attachmentObjectRef(record) {
  if (!record?.object_key || !record?.storage_provider) return null;
  return { provider: record.storage_provider, key: record.object_key };
}

// Queue payloads expose attachment ids and presence flags, never stored public URLs.
export function collectionVisitAttachmentSummary(visit) {
  if (!visit) return visit;
  const { receipt_copy_url: receiptUrl, payment_copy_url: paymentUrl, ...rest } = visit;
  const receiptAttachmentId = rest.receipt_attachment_id || null;
  const paymentAttachmentId = rest.payment_attachment_id || null;
  return {
    ...rest,
    receipt_attachment_id: receiptAttachmentId,
    payment_attachment_id: paymentAttachmentId,
    has_receipt_copy: Boolean(receiptAttachmentId || String(receiptUrl || "").trim()),
    has_payment_copy: Boolean(paymentAttachmentId || String(paymentUrl || "").trim()),
  };
}

export function legacyCollectionCopyRef(visit, kind) {
  const url = kind === "payment" ? visit?.payment_copy_url : visit?.receipt_copy_url;
  const parsed = parseLegacySupabaseUrl(url);
  if (!parsed || parsed.bucket !== ATTACHMENT_BUCKETS.collections) return null;
  return { provider: "supabase", key: parsed.key };
}

export function legacyCustomerDocumentRef(document) {
  const key = legacyObjectKey(ATTACHMENT_BUCKETS.customerDocuments, document?.file_path);
  return key ? { provider: "supabase", key } : null;
}

export function legacyOrderInvoiceRef(metaOrPath) {
  const path = typeof metaOrPath === "string" ? metaOrPath : metaOrPath?.invoiceFilePath;
  const key = legacyObjectKey(ATTACHMENT_BUCKETS.orderInvoices, path);
  return key ? { provider: "supabase", key } : null;
}

export async function resolveOrderInvoiceObject(admin, metaOrPath) {
  if (metaOrPath && typeof metaOrPath === "object" && isAttachmentId(metaOrPath.invoiceAttachmentId)) {
    const record = await getAttachmentById(admin, metaOrPath.invoiceAttachmentId);
    if (record?.category === ATTACHMENT_CATEGORIES.orderInvoice) return attachmentObjectRef(record);
  }
  return legacyOrderInvoiceRef(metaOrPath);
}

export async function readOrderInvoiceFile(admin, metaOrPath) {
  const ref = await resolveOrderInvoiceObject(admin, metaOrPath);
  if (!ref) throw new Error("Invoice file is missing.");
  return getObject(admin, ref);
}
