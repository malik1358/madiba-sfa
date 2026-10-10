import {
  buildInvoiceUploadEmail,
  DEFAULT_INVOICE_UPLOAD_FIXED_RECIPIENTS,
  resolveInvoiceUploadEmailRecipients,
} from "./invoiceUploadEmail.js";
import { getMailerConfig, isEmailConfigured, normalizeDeliverableEmail, parseEmailList, sendEmail } from "./mailer.js";
import {
  buildOrderPdfSnapshotFromSavedOrder,
  createOrderPdfDocument,
} from "./orderPdfDocument.js";
import { buildOrderPdfFileName } from "./orderPdfExport.js";
import { loadCachedPricingCatalog } from "./orderPricing.js";
import { formatSalesOrderNumber } from "./salesOrderNumber.js";
import { resolveReportingChainFromAuth } from "./salesHierarchy.js";
import { resolveUserReportEmail } from "./dailyVisitReportEmail.js";
import { isMissingSchemaColumn } from "./performanceKpis.js";
import { readOrderInvoiceFile } from "./storage/attachmentRecords.js";

const META_PAGE = 1000;

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function profileDisplayName(profile) {
  return String(profile?.salesman_name || profile?.salesman_code || "").trim();
}

function profileEmail(profile) {
  return resolveUserReportEmail({
    reportEmail: profile?.report_email,
    email: profile?.email,
  });
}

function parseMeta(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value || "null") : value;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function hasUploadedInvoice(meta) {
  return Boolean(
    String(meta?.invoiceFilePath || "").trim()
    || String(meta?.invoiceAttachmentId || "").trim()
    || String(meta?.invoiceUploadedAt || "").trim(),
  );
}

function metaUploadedAtMs(meta) {
  const candidates = [meta?.invoiceUploadedAt, meta?.updatedAt, meta?.statusUpdatedAt];
  for (const value of candidates) {
    const ms = Date.parse(String(value || ""));
    if (Number.isFinite(ms)) return ms;
  }
  return 0;
}

async function listAuthUsers(admin) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  return data?.users || [];
}

async function loadProfiles(admin) {
  const full = "id,salesman_code,salesman_name,role,email,report_email";
  const fallback = "id,salesman_code,salesman_name,role,email";
  let result = await admin.from("profiles").select(full);
  if (result.error && isMissingSchemaColumn(result.error)) {
    result = await admin.from("profiles").select(fallback);
  }
  if (result.error) throw result.error;
  return result.data || [];
}

function findSalesmanProfile(order, profiles = []) {
  const salesmanCode = normalizeCode(order?.salesman_code);
  if (salesmanCode) {
    const byCode = profiles.find((profile) => normalizeCode(profile.salesman_code) === salesmanCode);
    if (byCode) return byCode;
  }
  const createdBy = String(order?.created_by || "").trim();
  if (createdBy) {
    return profiles.find((profile) => String(profile.id) === createdBy) || null;
  }
  return null;
}

function authUserEmail(authUsers, userId) {
  const user = (authUsers || []).find((entry) => String(entry.id) === String(userId || ""));
  return normalizeDeliverableEmail(user?.email);
}

export async function buildOrderCopyPdfAttachment(admin, orderId, {
  now = new Date(),
  loadCatalog = loadCachedPricingCatalog,
} = {}) {
  const id = String(orderId || "").trim();
  if (!id) throw new Error("Order id is required.");

  const { data: order, error: orderError } = await admin
    .from("sales_orders")
    .select("id,order_number,customer_code,customer_name,salesman_code,salesman_name,status,created_at,updated_at,created_by")
    .eq("id", id)
    .maybeSingle();
  if (orderError) throw orderError;
  if (!order) throw new Error("Order not found.");

  const { data: lines, error: linesError } = await admin
    .from("sales_order_items")
    .select("id,item_code,item_name,category,quantity,rate,line_value")
    .eq("order_id", id)
    .order("item_name");
  if (linesError) throw linesError;
  if (!lines?.length) throw new Error("Order has no line items.");

  let pricingCatalog = null;
  try {
    pricingCatalog = await loadCatalog(admin);
  } catch {
    pricingCatalog = null;
  }

  const snapshot = buildOrderPdfSnapshotFromSavedOrder({
    order,
    lines,
    pricingCatalog,
  });
  const doc = await createOrderPdfDocument(snapshot);
  const orderNumber = formatSalesOrderNumber(snapshot) || id;
  const filename = buildOrderPdfFileName({
    orderId: orderNumber,
    customerCode: order.customer_code,
    savedAtIso: now.toISOString(),
  });

  return {
    order,
    filename,
    content: Buffer.from(doc.output("arraybuffer")),
    contentType: "application/pdf",
  };
}

export async function findLatestUploadedInvoiceMeta(admin) {
  let from = 0;
  let latest = null;

  while (true) {
    const { data, error } = await admin
      .from("system_settings")
      .select("setting_key,setting_value")
      .like("setting_key", "order_invoice_meta:%")
      .range(from, from + META_PAGE - 1);
    if (error) throw error;

    (data || []).forEach((row) => {
      const meta = parseMeta(row.setting_value);
      if (!meta || !hasUploadedInvoice(meta)) return;
      const orderId = String(meta.orderId || String(row.setting_key || "").replace(/^order_invoice_meta:/, "")).trim();
      if (!orderId) return;
      const at = metaUploadedAtMs(meta);
      if (!latest || at >= latest.at) {
        latest = { orderId, meta: { ...meta, orderId }, at };
      }
    });

    if (!data || data.length < META_PAGE) break;
    from += META_PAGE;
  }

  return latest;
}

async function loadInvoiceMeta(admin, orderId) {
  const id = String(orderId || "").trim();
  if (!id) return null;
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_key,setting_value")
    .eq("setting_key", `order_invoice_meta:${id}`)
    .maybeSingle();
  if (error) throw error;
  const meta = parseMeta(data?.setting_value);
  if (!meta || !hasUploadedInvoice(meta)) return null;
  return { orderId: id, meta: { ...meta, orderId: id }, at: metaUploadedAtMs(meta) };
}

export async function sendInvoiceUploadNotification(admin, {
  orderId,
  invoiceBuffer,
  invoiceFileName = "invoice.pdf",
  uploaderUserId = "",
  uploadedAtIso = "",
  extraCc = "",
  env = process.env,
  send = sendEmail,
  now = new Date(),
  loadCatalog = loadCachedPricingCatalog,
} = {}) {
  if (!isEmailConfigured(getMailerConfig(env))) {
    return { skipped: true, reason: "email_not_configured", sent: false };
  }

  const id = String(orderId || "").trim();
  if (!id) {
    return { skipped: true, reason: "missing_order_id", sent: false };
  }

  const invoiceBytes = invoiceBuffer == null
    ? null
    : Buffer.isBuffer(invoiceBuffer)
      ? invoiceBuffer
      : Buffer.from(invoiceBuffer);
  if (!invoiceBytes?.length) {
    return { skipped: true, reason: "missing_invoice_pdf", sent: false };
  }

  const [profiles, authUsers] = await Promise.all([
    loadProfiles(admin),
    listAuthUsers(admin),
  ]);

  let orderCopy = null;
  let orderPdfError = "";
  try {
    orderCopy = await buildOrderCopyPdfAttachment(admin, id, { now, loadCatalog });
  } catch (error) {
    orderPdfError = String(error?.message || error);
  }

  let order = orderCopy?.order || null;
  if (!order) {
    const { data, error } = await admin
      .from("sales_orders")
      .select("id,order_number,customer_code,customer_name,salesman_code,salesman_name,status,created_at,updated_at,created_by")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    order = data;
  }
  if (!order) {
    return { skipped: true, reason: "order_not_found", sent: false };
  }

  const uploaderProfile = profiles.find((profile) => String(profile.id) === String(uploaderUserId)) || null;
  const salesmanProfile = findSalesmanProfile(order, profiles);
  const directBoss = salesmanProfile?.id
    ? resolveReportingChainFromAuth({
      actorUserId: salesmanProfile.id,
      profiles,
      authUsers,
    })[0] || null
    : null;

  const recipients = resolveInvoiceUploadEmailRecipients({
    uploaderEmail: profileEmail(uploaderProfile) || authUserEmail(authUsers, uploaderUserId),
    salesmanEmail: profileEmail(salesmanProfile),
    directBossEmail: profileEmail(directBoss),
    fixedEmails: DEFAULT_INVOICE_UPLOAD_FIXED_RECIPIENTS,
    extraTo: env.INVOICE_UPLOAD_EMAIL_TO,
    extraCc: extraCc || env.INVOICE_UPLOAD_EMAIL_CC,
  });

  if (!recipients.to.length) {
    return { skipped: true, reason: "no_recipients", sent: false, orderPdfError };
  }

  const safeInvoiceName = String(invoiceFileName || "invoice.pdf").trim() || "invoice.pdf";
  const invoiceAttachmentName = /\.pdf$/i.test(safeInvoiceName) ? safeInvoiceName : `${safeInvoiceName}.pdf`;
  const attachments = [];
  if (orderCopy?.content?.length) {
    attachments.push({
      filename: orderCopy.filename,
      content: orderCopy.content,
      contentType: "application/pdf",
    });
  }
  attachments.push({
    filename: invoiceAttachmentName.startsWith("invoice-")
      ? invoiceAttachmentName
      : `invoice-${formatSalesOrderNumber(order) || id}-${invoiceAttachmentName}`,
    content: invoiceBytes,
    contentType: "application/pdf",
  });

  const message = buildInvoiceUploadEmail({
    orderNumber: formatSalesOrderNumber(order) || id,
    customerCode: order.customer_code,
    customerName: order.customer_name,
    salesmanName: order.salesman_name || profileDisplayName(salesmanProfile) || order.salesman_code,
    uploaderName: profileDisplayName(uploaderProfile) || uploaderProfile?.email || uploaderUserId,
    uploadedAtIso: uploadedAtIso || now.toISOString(),
    attachmentNames: attachments.map((entry) => entry.filename),
    orderPdfIncluded: Boolean(orderCopy?.content?.length),
    invoicePdfIncluded: true,
  });

  const delivery = await send({
    ...message,
    to: recipients.to,
    ...(recipients.cc.length ? { cc: recipients.cc } : {}),
    attachments,
  }, env);

  return {
    skipped: false,
    sent: true,
    orderId: id,
    to: recipients.to,
    cc: recipients.cc,
    provider: delivery?.provider || null,
    emailId: delivery?.id || null,
    attachmentCount: attachments.length,
    orderPdfError: orderPdfError || "",
  };
}

export async function resendInvoiceUploadNotification(admin, {
  orderId = "",
  extraCc = "malik@pinasz.com",
  env = process.env,
  send = sendEmail,
  now = new Date(),
  loadCatalog = loadCachedPricingCatalog,
  readInvoice = readOrderInvoiceFile,
} = {}) {
  const selected = String(orderId || "").trim()
    ? await loadInvoiceMeta(admin, orderId)
    : await findLatestUploadedInvoiceMeta(admin);

  if (!selected) {
    return { skipped: true, reason: "no_uploaded_invoice", sent: false };
  }

  const invoiceBuffer = await readInvoice(admin, selected.meta);
  const originalName = String(selected.meta.originalFileName || selected.meta.invoiceFileName || "invoice.pdf").trim()
    || "invoice.pdf";

  return sendInvoiceUploadNotification(admin, {
    orderId: selected.orderId,
    invoiceBuffer,
    invoiceFileName: originalName,
    uploaderUserId: selected.meta.invoiceUploadedBy || "",
    uploadedAtIso: selected.meta.invoiceUploadedAt || "",
    extraCc: parseEmailList(extraCc).join(",") || "malik@pinasz.com",
    env,
    send,
    now,
    loadCatalog,
  });
}
