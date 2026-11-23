import { escapeHtml } from "./dailyVisitReportEmail.js";
import { normalizeDeliverableEmail, parseEmailList } from "./mailer.js";
import { formatKsaDateTime } from "./workdayActivity.js";

function pushUniqueEmail(list, value) {
  const email = normalizeDeliverableEmail(value);
  if (!email || list.includes(email)) return;
  list.push(email);
}

/**
 * Guest order submit: email the salesman and every boss in the reporting chain.
 * Extra TO/CC can be set via CUSTOMER_ORDER_LINK_EMAIL_TO / _CC.
 */
export function resolveCustomerOrderLinkSubmitEmailRecipients({
  salesmanEmail = "",
  hierarchyEmails = [],
  extraTo = "",
  extraCc = "",
} = {}) {
  const to = [];
  const cc = [];
  pushUniqueEmail(to, salesmanEmail);
  (Array.isArray(hierarchyEmails) ? hierarchyEmails : []).forEach((email) => {
    pushUniqueEmail(to, email);
  });
  parseEmailList(extraTo).forEach((email) => pushUniqueEmail(to, email));
  parseEmailList(extraCc).forEach((email) => {
    if (to.includes(email)) return;
    pushUniqueEmail(cc, email);
  });
  return { to, cc };
}

export function buildCustomerOrderLinkSubmitEmail({
  orderNumber = "",
  customerCode = "",
  customerName = "",
  salesmanName = "",
  salesmanCode = "",
  totalValue = null,
  lineCount = 0,
  submittedAtIso = "",
  pricingRegion = "",
  pricingType = "",
  isProspect = false,
} = {}) {
  const orderLabel = String(orderNumber || "").trim() || "-";
  const customerLabel = [String(customerCode || "").trim(), String(customerName || "").trim()]
    .filter(Boolean)
    .join(" — ") || "-";
  const salesmanLabel = [
    String(salesmanName || "").trim(),
    String(salesmanCode || "").trim() ? `(${String(salesmanCode).trim()})` : "",
  ].filter(Boolean).join(" ") || "-";
  const whenLabel = submittedAtIso ? formatKsaDateTime(submittedAtIso) : "-";
  const valueLabel = Number.isFinite(Number(totalValue))
    ? `${Number(totalValue).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ﷼`
    : "-";
  const priceBook = [
    String(pricingRegion || "").trim(),
    String(pricingType || "").trim(),
  ].filter(Boolean).join(" · ") || "-";
  const sourceLabel = isProspect ? "Prospect order link" : "Customer order link";

  const subject = `Customer order link submitted — ${orderLabel} — ${customerLabel}`;

  const text = [
    "A customer submitted an order from a passwordless order link.",
    "",
    `Source: ${sourceLabel}`,
    `Order: ${orderLabel}`,
    `Customer: ${customerLabel}`,
    `Salesman: ${salesmanLabel}`,
    `Lines: ${Number(lineCount) || 0}`,
    `Total: ${valueLabel}`,
    `Price book: ${priceBook}`,
    `Submitted at (KSA): ${whenLabel}`,
    "",
    "The order PDF is attached.",
  ].join("\n");

  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;color:#102a43;line-height:1.45;">
  <h2 style="margin:0 0 12px;color:#0f4c5c;">Customer order link submitted</h2>
  <p style="margin:0 0 16px;">A guest submitted an order from a passwordless catalogue link. The order PDF is attached.</p>
  <table style="border-collapse:collapse;width:100%;max-width:640px;font-size:14px;">
    <tr><td style="padding:6px 8px;border:1px solid #c5d4de;background:#0f4c5c;color:#fff;width:160px;">Order</td><td style="padding:6px 8px;border:1px solid #c5d4de;">${escapeHtml(orderLabel)}</td></tr>
    <tr><td style="padding:6px 8px;border:1px solid #c5d4de;background:#f0f7f8;">Customer</td><td style="padding:6px 8px;border:1px solid #c5d4de;">${escapeHtml(customerLabel)}</td></tr>
    <tr><td style="padding:6px 8px;border:1px solid #c5d4de;background:#f0f7f8;">Salesman</td><td style="padding:6px 8px;border:1px solid #c5d4de;">${escapeHtml(salesmanLabel)}</td></tr>
    <tr><td style="padding:6px 8px;border:1px solid #c5d4de;background:#f0f7f8;">Source</td><td style="padding:6px 8px;border:1px solid #c5d4de;">${escapeHtml(sourceLabel)}</td></tr>
    <tr><td style="padding:6px 8px;border:1px solid #c5d4de;background:#f0f7f8;">Lines</td><td style="padding:6px 8px;border:1px solid #c5d4de;">${escapeHtml(String(Number(lineCount) || 0))}</td></tr>
    <tr><td style="padding:6px 8px;border:1px solid #c5d4de;background:#f0f7f8;">Total</td><td style="padding:6px 8px;border:1px solid #c5d4de;">${escapeHtml(valueLabel)}</td></tr>
    <tr><td style="padding:6px 8px;border:1px solid #c5d4de;background:#f0f7f8;">Price book</td><td style="padding:6px 8px;border:1px solid #c5d4de;">${escapeHtml(priceBook)}</td></tr>
    <tr><td style="padding:6px 8px;border:1px solid #c5d4de;background:#f0f7f8;">Submitted at (KSA)</td><td style="padding:6px 8px;border:1px solid #c5d4de;">${escapeHtml(whenLabel)}</td></tr>
  </table>
</div>`;

  return { subject, text, html };
}
