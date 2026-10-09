import { ATTACHMENT_CATEGORIES } from "./attachmentKeys.js";
import {
  attachmentObjectRef,
  getAttachmentById,
  isAttachmentId,
  legacyCollectionCopyRef,
  legacyCustomerDocumentRef,
  legacyOrderInvoiceRef,
} from "./attachmentRecords.js";

const COLLECTION_VISIT_SELECT = "id,customer_code,created_by,receipt_copy_url,payment_copy_url,receipt_attachment_id,payment_attachment_id";
const COLLECTION_VISIT_LEGACY_SELECT = "id,customer_code,created_by,receipt_copy_url,payment_copy_url";
const CUSTOMER_DOCUMENT_SELECT = "id,customer_code,file_path,original_file_name,attachment_id";
const CUSTOMER_DOCUMENT_LEGACY_SELECT = "id,customer_code,file_path,original_file_name";

export const LEGACY_ATTACHMENT_KINDS = Object.freeze(Object.values(ATTACHMENT_CATEGORIES));

const COLLECTION_KIND = {
  [ATTACHMENT_CATEGORIES.receiptCopy]: "receipt",
  [ATTACHMENT_CATEGORIES.paymentCopy]: "payment",
};

// Lazy imports keep route modules out of this file's load path (no cycles, light tests).
export const defaultAccessDeps = {
  async getCollectionScope(admin, userId) {
    const { getSalesScope } = await import("../../api/payment-collections/route.js");
    return getSalesScope(admin, userId);
  },
  async collectionCustomerInScope(admin, scope, customerCode) {
    const route = await import("../../api/payment-collections/route.js");
    const records = await route.fetchOutstandingAndCollectionRecords(admin, scope);
    return Boolean(route.findScopedCollectionRecord(records, customerCode));
  },
  async getSalesScope(admin, userId) {
    const [{ resolveSalesScopeForUserId }, { withSalesScopeMatchers }] = await Promise.all([
      import("../../api/user/sales-scope/route.js"),
      import("../customerAccess.js"),
    ]);
    const payload = await resolveSalesScopeForUserId(admin, userId);
    return withSalesScopeMatchers({
      userId,
      role: payload.role,
      hasAllAccess: payload.hasAllAccess,
      visibleSalesmanCodes: payload.visibleSalesmanCodes || [],
      visibleMembers: payload.visibleMembers || [],
    });
  },
  async customerVisibleToSalesScope(admin, scope, customerCode) {
    const { ensureCustomerVisibleToScope } = await import("../customerAccess.js");
    try {
      await ensureCustomerVisibleToScope(admin, customerCode, scope);
      return true;
    } catch {
      return false;
    }
  },
  async getOrderScope(admin, token) {
    const { resolveOrderInvoiceScope } = await import("../../api/order-invoice/route.js");
    return resolveOrderInvoiceScope(admin, token);
  },
  async canSeeOrder(order, scope) {
    const { canSeeOrder } = await import("../../api/order-invoice/route.js");
    return canSeeOrder(order, scope);
  },
};

function isMissingColumn(error) {
  const message = String(error?.message || "").toLowerCase();
  return error?.code === "42703" || error?.code === "PGRST204" || (message.includes("column") && message.includes("does not exist"));
}

async function selectSingle(admin, table, selects, column, value) {
  for (const columns of selects) {
    const { data, error } = await admin.from(table).select(columns).eq(column, value).maybeSingle();
    if (!error) return data || null;
    if (!isMissingColumn(error)) throw error;
  }
  return null;
}

function parseJson(value) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(value || "null");
  } catch {
    return null;
  }
}

async function loadCollectionVisitById(admin, visitId) {
  return selectSingle(admin, "collection_visits", [COLLECTION_VISIT_SELECT, COLLECTION_VISIT_LEGACY_SELECT], "id", visitId);
}

async function loadCollectionVisitByAttachment(admin, category, attachmentId) {
  const column = category === ATTACHMENT_CATEGORIES.paymentCopy ? "payment_attachment_id" : "receipt_attachment_id";
  return selectSingle(admin, "collection_visits", [COLLECTION_VISIT_SELECT], column, attachmentId);
}

async function loadCustomerDocument(admin, column, value) {
  const selects = column === "attachment_id"
    ? [CUSTOMER_DOCUMENT_SELECT]
    : [CUSTOMER_DOCUMENT_SELECT, CUSTOMER_DOCUMENT_LEGACY_SELECT];
  return selectSingle(admin, "customer_documents", selects, column, value);
}

async function loadSalesOrder(admin, orderId) {
  return selectSingle(admin, "sales_orders", ["id,customer_code,created_by,salesman_code"], "id", orderId);
}

async function loadOrderInvoiceMeta(admin, orderId) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", `order_invoice_meta:${orderId}`)
    .maybeSingle();
  if (error) throw error;
  return parseJson(data?.setting_value);
}

function fileNameFromKey(key) {
  return String(key || "").split("/").pop() || "attachment";
}

async function targetFromRecord(admin, record) {
  const object = attachmentObjectRef(record);
  if (!object) return { status: 404 };

  let owner = null;
  if (COLLECTION_KIND[record.category]) {
    owner = await loadCollectionVisitByAttachment(admin, record.category, record.id);
  } else if (record.category === ATTACHMENT_CATEGORIES.orderInvoice) {
    owner = record.entity_id ? await loadSalesOrder(admin, record.entity_id) : null;
  } else if (record.category === ATTACHMENT_CATEGORIES.customerDocument) {
    owner = await loadCustomerDocument(admin, "attachment_id", record.id);
  } else {
    return { status: 404 };
  }

  return {
    status: 200,
    category: record.category,
    record,
    owner,
    object,
    fileName: record.original_file_name || fileNameFromKey(record.object_key),
    contentType: record.content_type || null,
  };
}

async function targetFromAttachmentId(admin, id) {
  const record = await getAttachmentById(admin, id);
  if (!record) return { status: 404 };
  return targetFromRecord(admin, record);
}

async function targetFromLegacy(admin, kind, ref) {
  const reference = String(ref || "").trim();
  if (!LEGACY_ATTACHMENT_KINDS.includes(kind) || !/^\d{1,18}$/.test(reference)) return { status: 400 };

  if (COLLECTION_KIND[kind]) {
    const visit = await loadCollectionVisitById(admin, reference);
    if (!visit) return { status: 404 };
    const attachmentId = visit[`${COLLECTION_KIND[kind]}_attachment_id`];
    if (isAttachmentId(attachmentId)) return targetFromAttachmentId(admin, attachmentId);
    const object = legacyCollectionCopyRef(visit, COLLECTION_KIND[kind]);
    if (!object) return { status: 404 };
    return { status: 200, category: kind, record: null, owner: visit, object, fileName: fileNameFromKey(object.key), legacy: true };
  }

  if (kind === ATTACHMENT_CATEGORIES.customerDocument) {
    const document = await loadCustomerDocument(admin, "id", reference);
    if (!document) return { status: 404 };
    if (isAttachmentId(document.attachment_id)) return targetFromAttachmentId(admin, document.attachment_id);
    const object = legacyCustomerDocumentRef(document);
    if (!object) return { status: 404 };
    return {
      status: 200,
      category: kind,
      record: null,
      owner: document,
      object,
      fileName: document.original_file_name || fileNameFromKey(object.key),
      legacy: true,
    };
  }

  const order = await loadSalesOrder(admin, reference);
  if (!order) return { status: 404 };
  const meta = await loadOrderInvoiceMeta(admin, reference);
  if (isAttachmentId(meta?.invoiceAttachmentId)) {
    const target = await targetFromAttachmentId(admin, meta.invoiceAttachmentId);
    if (target.status === 200) return target;
  }
  const object = legacyOrderInvoiceRef(meta);
  if (!object) return { status: 404 };
  return { status: 200, category: kind, record: null, owner: order, object, fileName: fileNameFromKey(object.key), legacy: true };
}

export async function resolveAttachmentTarget(admin, { id, legacyKind = "", legacyRef = "" }) {
  if (String(id || "").trim() === "legacy") return targetFromLegacy(admin, String(legacyKind || "").trim(), legacyRef);
  if (!isAttachmentId(id)) return { status: 404 };
  return targetFromAttachmentId(admin, String(id).trim());
}

async function canReadCollectionVisit(admin, userId, visit, deps) {
  if (visit.created_by && String(visit.created_by) === String(userId)) return true;
  const scope = await deps.getCollectionScope(admin, userId);
  if (scope?.hasAllAccess || scope?.canSeeAllSchedulers) return true;
  if ((scope?.visibleSchedulerUserIds || []).map(String).includes(String(visit.created_by || ""))) return true;
  if (await deps.collectionCustomerInScope(admin, scope, visit.customer_code)) return true;
  const salesScope = await deps.getSalesScope(admin, userId);
  if (salesScope?.hasAllAccess) return true;
  return deps.customerVisibleToSalesScope(admin, salesScope, visit.customer_code);
}

export async function canReadCustomerDocument(admin, userId, customerCode, deps = defaultAccessDeps) {
  const scope = await deps.getSalesScope(admin, userId);
  if (scope?.hasAllAccess) return true;
  if (!String(customerCode || "").trim()) return false;
  return deps.customerVisibleToSalesScope(admin, scope, customerCode);
}

export async function authorizeAttachmentRead(admin, { user, token, target, deps = defaultAccessDeps }) {
  const userId = user?.id;
  if (!userId) return { allowed: false, reason: "Not authenticated" };

  const owner = target?.owner;
  if (!owner) {
    // Uploaded but never linked (e.g. the owning insert failed): only the uploader may read it.
    const allowed = Boolean(target?.record?.uploaded_by && String(target.record.uploaded_by) === String(userId));
    return { allowed, reason: allowed ? "uploader" : "Attachment is not linked to a record you can access." };
  }

  try {
    if (COLLECTION_KIND[target.category]) {
      const allowed = await canReadCollectionVisit(admin, userId, owner, deps);
      return { allowed, reason: allowed ? "collection_scope" : "You do not have access to this collection visit." };
    }
    if (target.category === ATTACHMENT_CATEGORIES.orderInvoice) {
      const scope = await deps.getOrderScope(admin, token);
      const allowed = Boolean(await deps.canSeeOrder(owner, scope));
      return { allowed, reason: allowed ? "order_scope" : "You do not have access to this order." };
    }
    if (target.category === ATTACHMENT_CATEGORIES.customerDocument) {
      const allowed = await canReadCustomerDocument(admin, userId, owner.customer_code, deps);
      return { allowed, reason: allowed ? "customer_scope" : "You do not have access to this customer's documents." };
    }
  } catch (error) {
    console.warn("Attachment access check failed:", error);
    return { allowed: false, reason: "Unable to verify access to this attachment." };
  }

  return { allowed: false, reason: "Unsupported attachment." };
}
