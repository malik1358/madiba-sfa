import { escapeHtml } from "./dailyVisitReportEmail.js";
import { normalizeDeliverableEmail, parseEmailList } from "./mailer.js";
import { formatKsaDateTime } from "./workdayActivity.js";

export const DEFAULT_INVOICE_UPLOAD_FIXED_RECIPIENTS = [
  "iliyas.belliyaru@noorshukran.com",
];

function pushUniqueEmail(list, value) {
  const email = normalizeDeliverableEmail(value);
  if (!email || list.includes(email)) return;
  list.push(email);
}

export function resolveInvoiceUploadEmailRecipients({
  uploaderEmail = "",
  salesmanEmail = "",
  directBossEmail = "",
  fixedEmails = DEFAULT_INVOICE_UPLOAD_FIXED_RECIPIENTS,
  extraTo = "",
  extraCc = "",
} = {}) {
  const to = [];
  const cc = [];
  pushUniqueEmail(to, uploaderEmail);
  pushUniqueEmail(to, salesmanEmail);
  pushUniqueEmail(to, directBossEmail);
  (Array.isArray(fixedEmails) ? fixedEmails : parseEmailList(fixedEmails)).forEach((email) => {
    pushUniqueEmail(to, email);
  });
  parseEmailList(extraTo).forEach((email) => pushUniqueEmail(to, email));
  parseEmailList(extraCc).forEach((email) => {
    if (to.includes(email)) return;
    pushUniqueEmail(cc, email);
  });
  return { to, cc };
}

export function buildInvoiceUploadEmail({
  orderNumber = "",
  customerCode = "",
  customerName = "",
  salesmanName = "",
  uploaderName = "",
  uploadedAtIso = "",
  attachmentNames = [],
  orderPdfIncluded = true,
  invoicePdfIncluded = true,
} = {}) {
  const orderLabel = String(orderNumber || "").trim() || "-";
  const customerLabel = [String(customerCode || "").trim(), String(customerName || "").trim()]
    .filter(Boolean)
    .join(" — ") || "-";
  const salesmanLabel = String(salesmanName || "").trim() || "-";
  const uploaderLabel = String(uploaderName || "").trim() || "-";
  const uploadedLabel = uploadedAtIso ? formatKsaDateTime(uploadedAtIso) : "-";
  const names = (Array.isArray(attachmentNames) ? attachmentNames : [])
    .map((name) => String(name || "").trim())
    .filter(Boolean);

  const subject = `Invoice uploaded — Order ${orderLabel} — ${customerLabel}`;

  const attachmentLines = names.length
    ? names.map((name) => `- ${name}`).join("\n")
    : [
      orderPdfIncluded ? "- Order copy (PDF)" : "",
      invoicePdfIncluded ? "- Uploaded invoice (PDF)" : "",
    ].filter(Boolean).join("\n");

  const notes = [];
  if (!orderPdfIncluded) notes.push("Order PDF could not be generated; invoice copy is attached.");
  if (!invoicePdfIncluded) notes.push("Invoice PDF was unavailable for attachment.");

  const text = [
    "An invoice was uploaded against a sales order.",
    "",
    `Order: ${orderLabel}`,
    `Customer: ${customerLabel}`,
    `Salesman: ${salesmanLabel}`,
    `Uploaded by: ${uploaderLabel}`,
    `Uploaded at (KSA): ${uploadedLabel}`,
    "",
    "Attachments:",
    attachmentLines || "- (none)",
    ...(notes.length ? ["", ...notes] : []),
  ].join("\n");

  const attachmentHtml = names.length
    ? `<ul style="margin:8px 0 0;padding-left:18px;">${names.map((name) => `<li>${escapeHtml(name)}</li>`).join("")}</ul>`
    : `<ul style="margin:8px 0 0;padding-left:18px;">${[
      orderPdfIncluded ? "<li>Order copy (PDF)</li>" : "",
      invoicePdfIncluded ? "<li>Uploaded invoice (PDF)</li>" : "",
    ].filter(Boolean).join("")}</ul>`;

  const noteHtml = notes.length
    ? `<p style="margin:16px 0 0;color:#9a3412;font-size:13px;">${notes.map((note) => escapeHtml(note)).join("<br/>")}</p>`
    : "";

  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;color:#102a43;line-height:1.45;">
  <h2 style="margin:0 0 12px;color:#0f4c5c;">Invoice uploaded</h2>
  <p style="margin:0 0 16px;">An invoice PDF was uploaded against a sales order. The order copy and invoice copy are attached.</p>
  <table style="border-collapse:collapse;width:100%;max-width:640px;font-size:14px;">
    <tr><td style="padding:6px 8px;border:1px solid #c5d4de;background:#0f4c5c;color:#fff;width:160px;">Order</td><td style="padding:6px 8px;border:1px solid #c5d4de;">${escapeHtml(orderLabel)}</td></tr>
    <tr><td style="padding:6px 8px;border:1px solid #c5d4de;background:#f0f7f8;">Customer</td><td style="padding:6px 8px;border:1px solid #c5d4de;">${escapeHtml(customerLabel)}</td></tr>
    <tr><td style="padding:6px 8px;border:1px solid #c5d4de;background:#f0f7f8;">Salesman</td><td style="padding:6px 8px;border:1px solid #c5d4de;">${escapeHtml(salesmanLabel)}</td></tr>
    <tr><td style="padding:6px 8px;border:1px solid #c5d4de;background:#f0f7f8;">Uploaded by</td><td style="padding:6px 8px;border:1px solid #c5d4de;">${escapeHtml(uploaderLabel)}</td></tr>
    <tr><td style="padding:6px 8px;border:1px solid #c5d4de;background:#f0f7f8;">Uploaded at (KSA)</td><td style="padding:6px 8px;border:1px solid #c5d4de;">${escapeHtml(uploadedLabel)}</td></tr>
  </table>
  <p style="margin:16px 0 0;font-weight:600;color:#0f4c5c;">Attachments</p>
  ${attachmentHtml}
  ${noteHtml}
</div>`;

  return { subject, text, html };
}
