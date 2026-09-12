import { amountInclVat } from "./invoiceAmountFromPdf.js";
import { isLikelyEmail, parseEmailList } from "./mailer.js";
import {
  DEFAULT_MISSING_INVOICE_EMAIL_CC,
  DEFAULT_MISSING_INVOICE_EMAIL_TO,
  hasUploadedInvoice,
  invoiceStatusLabel,
  isInvoiceNotUploadedStatus,
  isTestCustomerOrder,
  MISSING_INVOICE_CREATED_FROM,
  parseInvoiceMeta,
} from "./missingInvoiceEmail.js";
import { formatSalesOrderNumber } from "./salesOrderNumber.js";
import { formatKsaDateTime } from "./workdayActivity.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const DAILY_SUPPLIER_ORDER_EMAIL_LAST_SENT_KEY = "daily_supplier_order_email_last_sent";

function mergeEmailList(defaults, extraValue) {
  const extras = parseEmailList(extraValue);
  const base = (defaults || [])
    .flatMap((value) => parseEmailList(value))
    .filter((email) => isLikelyEmail(email));
  return [...new Set([...base, ...extras])];
}

export function resolveDailySupplierOrderDigestRecipients(env = process.env) {
  return mergeEmailList(DEFAULT_MISSING_INVOICE_EMAIL_TO, env.DAILY_SUPPLIER_ORDER_EMAIL_TO || env.MISSING_INVOICE_EMAIL_TO);
}

export function resolveDailySupplierOrderDigestCc(env = process.env, to = []) {
  const recipients = new Set((to || []).map((email) => String(email || "").trim().toLowerCase()));
  return mergeEmailList(DEFAULT_MISSING_INVOICE_EMAIL_CC, env.DAILY_SUPPLIER_ORDER_EMAIL_CC || env.MISSING_INVOICE_EMAIL_CC)
    .filter((email) => !recipients.has(email));
}

export function supplierOrderGroupKey(order = {}) {
  const code = String(order?.salesman_code || "").trim().toUpperCase();
  if (code) return `code:${code}`;
  const createdBy = String(order?.created_by || "").trim();
  if (createdBy) return `user:${createdBy}`;
  return "unknown";
}

export function supplierOrderDisplayName(order = {}, profile = null) {
  const name = String(profile?.salesman_name || order?.salesman_name || "").trim();
  const code = String(profile?.salesman_code || order?.salesman_code || "").trim();
  if (name && code) return `${name} (${code})`;
  return name || code || "Unknown salesman";
}

export function isAwaitingBillingUpdate(meta) {
  return isInvoiceNotUploadedStatus(meta) && !hasUploadedInvoice(meta);
}

export function orderRaisedAtMs(order = {}) {
  const candidates = [order?.submitted_at, order?.created_at]
    .map((value) => Date.parse(String(value || "")))
    .filter((value) => Number.isFinite(value));
  return candidates.length ? Math.min(...candidates) : null;
}

export function orderActivityAtMs(order = {}) {
  const candidates = [order?.updated_at, order?.submitted_at, order?.created_at]
    .map((value) => Date.parse(String(value || "")))
    .filter((value) => Number.isFinite(value));
  return candidates.length ? Math.max(...candidates) : null;
}

export function invoiceActivityAtMs(meta) {
  const payload = parseInvoiceMeta(meta) || {};
  const candidates = [
    payload.statusUpdatedAt,
    payload.invoiceUploadedAt,
    payload.invoiceAmountExtractedAt,
  ]
    .map((value) => Date.parse(String(value || "")))
    .filter((value) => Number.isFinite(value));
  return candidates.length ? Math.max(...candidates) : null;
}

export function shouldIncludeInSupplierOrderReport(order, meta = null, sinceMs = 0, asOfMs = Date.now()) {
  if (String(order?.status || "").trim().toUpperCase() !== "SUBMITTED") return false;
  if (isTestCustomerOrder(order)) return false;

  const raisedMs = orderRaisedAtMs(order);
  if (Number.isFinite(raisedMs) && raisedMs > asOfMs) return false;

  // Every order raised in the report window — Invoice made, pending, or not uploaded.
  if (Number.isFinite(raisedMs) && raisedMs >= sinceMs && raisedMs <= asOfMs) return true;

  // Older orders still waiting on billing keep appearing every day.
  if (isAwaitingBillingUpdate(meta)) return true;

  // Billing updates during the window for older orders.
  const invoiceMs = invoiceActivityAtMs(meta);
  if (Number.isFinite(invoiceMs) && invoiceMs >= sinceMs && invoiceMs <= asOfMs) return true;

  return false;
}

export function selectDailySupplierOrders(orders = [], metaByOrder = new Map(), {
  sinceIso = "",
  asOfIso = "",
} = {}) {
  const sinceMs = Date.parse(String(sinceIso || ""));
  const asOfMs = Date.parse(String(asOfIso || "")) || Date.now();
  const sinceFloor = Number.isFinite(sinceMs) ? sinceMs : 0;

  return (orders || [])
    .filter((order) => shouldIncludeInSupplierOrderReport(
      order,
      metaByOrder.get(String(order?.id || "").trim()) || null,
      sinceFloor,
      asOfMs,
    ))
    .sort((left, right) => {
      const salesman = supplierOrderDisplayName(left).localeCompare(supplierOrderDisplayName(right));
      if (salesman) return salesman;
      return String(formatSalesOrderNumber(left) || left?.id || "").localeCompare(
        String(formatSalesOrderNumber(right) || right?.id || ""),
        undefined,
        { numeric: true },
      );
    });
}

export function groupDailySupplierOrders(orders = [], profiles = []) {
  const profileByUserId = new Map();
  const profileByCode = new Map();
  (profiles || []).forEach((profile) => {
    const userId = String(profile?.id || "").trim();
    const code = String(profile?.salesman_code || "").trim().toUpperCase();
    if (userId) profileByUserId.set(userId, profile);
    if (code && !profileByCode.has(code)) profileByCode.set(code, profile);
  });

  const groups = new Map();
  (orders || []).forEach((order) => {
    const key = supplierOrderGroupKey(order);
    const profile = profileByCode.get(String(order?.salesman_code || "").trim().toUpperCase())
      || profileByUserId.get(String(order?.created_by || "").trim())
      || null;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        profile,
        salesmanName: supplierOrderDisplayName(order, profile),
        orders: [],
      });
    }
    groups.get(key).orders.push(order);
  });

  return [...groups.values()].sort((left, right) => left.salesmanName.localeCompare(right.salesmanName));
}

export function formatSupplierMoney(value) {
  if (value == null || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function customerLabel(order) {
  const code = String(order?.customer_code || "").trim();
  const name = String(order?.customer_name || "").trim();
  if (code && name) return `${code} — ${name}`;
  return code || name || "-";
}

export function toInclVatAmount(exclValue) {
  if (exclValue == null || exclValue === "") return null;
  const excl = Number(exclValue);
  if (!Number.isFinite(excl) || excl < 0) return null;
  return amountInclVat(excl);
}

export function buildDailySupplierOrderRow(order, meta = null, extra = {}) {
  const orderExcl = Number.isFinite(Number(extra.orderValue)) ? Number(extra.orderValue) : Number(order?.total_value);
  const invoiceExcl = extra.invoiceValue == null || extra.invoiceValue === ""
    ? null
    : Number(extra.invoiceValue);
  const orderValue = toInclVatAmount(Number.isFinite(orderExcl) ? orderExcl : 0) || 0;
  const invoiceValue = toInclVatAmount(invoiceExcl);
  return {
    order: formatSalesOrderNumber(order) || String(order?.id || "").trim() || "-",
    customer: customerLabel(order),
    salesman: supplierOrderDisplayName(order, extra.profile || null),
    orderStatus: String(order?.status || "").trim() || "-",
    invoiceStatus: invoiceStatusLabel(meta),
    createdAt: formatKsaDateTime(order?.created_at || order?.submitted_at),
    orderValue,
    invoiceValue,
  };
}

export function summarizeDailySupplierOrderRows(rows = []) {
  return (rows || []).reduce(
    (totals, row) => {
      totals.orders += 1;
      totals.orderValue += Number(row?.orderValue || 0);
      totals.invoiceValue += Number(row?.invoiceValue || 0);
      return totals;
    },
    { orders: 0, orderValue: 0, invoiceValue: 0 },
  );
}

function statusBadge(label, tone = "neutral") {
  const tones = {
    success: { bg: "#dcfce7", fg: "#166534", border: "#86efac" },
    warning: { bg: "#ffedd5", fg: "#9a3412", border: "#fdba74" },
    danger: { bg: "#fee2e2", fg: "#991b1b", border: "#fca5a5" },
    info: { bg: "#e0f2fe", fg: "#075985", border: "#7dd3fc" },
    neutral: { bg: "#f1f5f9", fg: "#334155", border: "#cbd5e1" },
  };
  const colors = tones[tone] || tones.neutral;
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${colors.bg};color:${colors.fg};border:1px solid ${colors.border};font-size:12px;font-weight:700;white-space:nowrap;">${escapeHtml(label)}</span>`;
}

function invoiceStatusTone(status) {
  const text = String(status || "").trim().toLowerCase();
  if (!text || text === "-" || text.includes("not uploaded")) return "warning";
  if (text.includes("invoice made") || text.includes("uploaded")) return "success";
  if (text.includes("reject")) return "danger";
  if (text.includes("credit") || text.includes("stock") || text.includes("waiting") || text.includes("quotation")) return "info";
  return "neutral";
}

function orderStatusTone(status) {
  const text = String(status || "").trim().toUpperCase();
  if (text === "SUBMITTED") return "info";
  if (text === "DRAFT" || text === "PENDING") return "warning";
  if (text === "CANCELLED") return "danger";
  return "neutral";
}

function tableHeader(includeSalesman) {
  return `<tr style="background:linear-gradient(90deg,#0f766e,#0f4c81);background-color:#0f4c81;color:#ffffff;">
    <th style="text-align:left;padding:10px 8px;border:1px solid #0c3d67;">Order</th>
    <th style="text-align:left;padding:10px 8px;border:1px solid #0c3d67;">Customer</th>
    ${includeSalesman ? '<th style="text-align:left;padding:10px 8px;border:1px solid #0c3d67;">Salesman</th>' : ""}
    <th style="text-align:left;padding:10px 8px;border:1px solid #0c3d67;">Order status</th>
    <th style="text-align:left;padding:10px 8px;border:1px solid #0c3d67;">Invoice status</th>
    <th style="text-align:left;padding:10px 8px;border:1px solid #0c3d67;">Created (KSA)</th>
    <th style="text-align:right;padding:10px 8px;border:1px solid #0c3d67;">Order value (incl. VAT)</th>
    <th style="text-align:right;padding:10px 8px;border:1px solid #0c3d67;">Invoice made (incl. VAT)</th>
  </tr>`;
}

function tableRow(row, index, includeSalesman) {
  const rowBg = index % 2 === 0 ? "#ffffff" : "#f0fdfa";
  return `<tr style="background:${rowBg};">
    <td style="border:1px solid #99f6e4;padding:8px;font-weight:700;color:#0f766e;">${escapeHtml(row.order)}</td>
    <td style="border:1px solid #99f6e4;padding:8px;">${escapeHtml(row.customer)}</td>
    ${includeSalesman ? `<td style="border:1px solid #99f6e4;padding:8px;">${escapeHtml(row.salesman)}</td>` : ""}
    <td style="border:1px solid #99f6e4;padding:8px;">${statusBadge(row.orderStatus, orderStatusTone(row.orderStatus))}</td>
    <td style="border:1px solid #99f6e4;padding:8px;">${statusBadge(row.invoiceStatus, invoiceStatusTone(row.invoiceStatus))}</td>
    <td style="border:1px solid #99f6e4;padding:8px;color:#475569;">${escapeHtml(row.createdAt)}</td>
    <td style="text-align:right;border:1px solid #99f6e4;padding:8px;font-weight:700;color:#0f4c81;">${escapeHtml(formatSupplierMoney(row.orderValue))}</td>
    <td style="text-align:right;border:1px solid #99f6e4;padding:8px;font-weight:700;color:#166534;">${escapeHtml(formatSupplierMoney(row.invoiceValue))}</td>
  </tr>`;
}

function totalRow(totals, includeSalesman) {
  const span = includeSalesman ? 6 : 5;
  return `<tr style="background:#134e4a;color:#ffffff;font-weight:700;">
    <td style="padding:10px 8px;border:1px solid #115e59;" colspan="${span}">Total (${totals.orders} order${totals.orders === 1 ? "" : "s"})</td>
    <td style="text-align:right;padding:10px 8px;border:1px solid #115e59;background:#0f766e;">${escapeHtml(formatSupplierMoney(totals.orderValue))}</td>
    <td style="text-align:right;padding:10px 8px;border:1px solid #115e59;background:#15803d;">${escapeHtml(formatSupplierMoney(totals.invoiceValue))}</td>
  </tr>`;
}

function renderTable(rows, { includeSalesman = false } = {}) {
  const totals = summarizeDailySupplierOrderRows(rows);
  const body = rows.length
    ? rows.map((row, index) => tableRow(row, index, includeSalesman)).join("")
    : `<tr><td colspan="${includeSalesman ? 8 : 7}" style="border:1px solid #99f6e4;padding:12px;background:#fff7ed;color:#9a3412;">No submitted orders.</td></tr>`;
  return `<table style="border-collapse: collapse; font-size: 13px; width: 100%; border:1px solid #99f6e4;">
    <thead>${tableHeader(includeSalesman)}</thead>
    <tbody>${body}${rows.length ? totalRow(totals, includeSalesman) : ""}</tbody>
  </table>`;
}

function summaryCards(totals) {
  return `<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:0 0;margin:0 0 16px;">
  <tr>
    <td style="width:33%;padding:0 6px 0 0;vertical-align:top;">
      <div style="background:#ecfeff;border:1px solid #67e8f9;border-radius:10px;padding:12px;">
        <div style="font-size:11px;font-weight:700;color:#0e7490;text-transform:uppercase;letter-spacing:0.04em;">Orders</div>
        <div style="font-size:22px;font-weight:800;color:#155e75;margin-top:4px;">${escapeHtml(String(totals.orders))}</div>
      </div>
    </td>
    <td style="width:33%;padding:0 3px;vertical-align:top;">
      <div style="background:#eff6ff;border:1px solid #93c5fd;border-radius:10px;padding:12px;">
        <div style="font-size:11px;font-weight:700;color:#1d4ed8;text-transform:uppercase;letter-spacing:0.04em;">Order value (incl. VAT)</div>
        <div style="font-size:22px;font-weight:800;color:#1e3a8a;margin-top:4px;">${escapeHtml(formatSupplierMoney(totals.orderValue))}</div>
      </div>
    </td>
    <td style="width:34%;padding:0 0 0 6px;vertical-align:top;">
      <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:12px;">
        <div style="font-size:11px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.04em;">Invoice made (incl. VAT)</div>
        <div style="font-size:22px;font-weight:800;color:#14532d;margin-top:4px;">${escapeHtml(formatSupplierMoney(totals.invoiceValue))}</div>
      </div>
    </td>
  </tr>
</table>`;
}

function textTable(rows, includeSalesman) {
  const header = includeSalesman
    ? "Order | Customer | Salesman | Order status | Invoice status | Created (KSA) | Order value incl VAT | Invoice made incl VAT"
    : "Order | Customer | Order status | Invoice status | Created (KSA) | Order value incl VAT | Invoice made incl VAT";
  const totals = summarizeDailySupplierOrderRows(rows);
  return [
    header,
    ...rows.map((row) => [
      row.order,
      row.customer,
      ...(includeSalesman ? [row.salesman] : []),
      row.orderStatus,
      row.invoiceStatus,
      row.createdAt,
      formatSupplierMoney(row.orderValue),
      formatSupplierMoney(row.invoiceValue),
    ].join(" | ")),
    `Total | ${totals.orders} orders | ${formatSupplierMoney(totals.orderValue)} | ${formatSupplierMoney(totals.invoiceValue)}`,
  ].join("\n");
}

export function buildDailySupplierOrderEmail({
  date,
  salesmanName = "",
  rows = [],
  includeSalesman = false,
  asOfLabel = "",
} = {}) {
  const totals = summarizeDailySupplierOrderRows(rows);
  const who = String(salesmanName || "").trim();
  const subject = who
    ? `Orders raised ${date} — ${who} (${totals.orders})`
    : `Orders raised ${date} — all salesmen (${totals.orders})`;
  const cutoff = String(asOfLabel || "").trim();
  const intro = who
    ? `All submitted orders you raised for ${date} (KSA)${cutoff ? ` as of ${cutoff}` : ""}, plus any older orders still waiting on billing. Every invoice status is included for comparison. Values include VAT.`
    : `All submitted orders raised for ${date} (KSA)${cutoff ? ` as of ${cutoff}` : ""}, grouped by salesman, plus any older orders still waiting on billing. Every invoice status is included. Values include VAT.`;

  const html = `<div style="font-family: Arial, Helvetica, sans-serif; color: #0f172a; line-height: 1.5; background:#f8fafc; padding:16px;">
  <div style="max-width:960px;margin:0 auto;background:#ffffff;border:1px solid #99f6e4;border-radius:14px;overflow:hidden;box-shadow:0 8px 24px rgba(15,118,110,0.12);">
    <div style="background:linear-gradient(135deg,#0f766e 0%,#0f4c81 55%,#155e75 100%);background-color:#0f4c81;padding:18px 20px;color:#ffffff;">
      <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;opacity:0.9;">MADIBA SFA</div>
      <h2 style="margin:6px 0 4px;font-size:22px;color:#ffffff;">Daily order confirmation</h2>
      <div style="font-size:14px;opacity:0.95;">${escapeHtml(date)}${cutoff ? ` · upload ${escapeHtml(cutoff)}` : ""}</div>
    </div>
    <div style="padding:18px 20px 8px;">
      <p style="margin:0 0 14px;color:#334155;">${escapeHtml(intro)}</p>
      ${who ? `<p style="margin:0 0 16px;"><span style="display:inline-block;padding:6px 12px;border-radius:999px;background:#ecfeff;border:1px solid #67e8f9;color:#0e7490;font-weight:800;">${escapeHtml(who)}</span></p>` : ""}
      ${summaryCards(totals)}
      ${renderTable(rows, { includeSalesman })}
      <p style="margin:16px 0 0; color: #64748b; font-size: 12px;">This list includes every submitted order raised that day (Invoice made, pending, or not uploaded), plus older orders still waiting on billing. Totals include VAT. Invoice made is taken from the attached invoice PDF when available. Hierarchy bosses are copied on each salesman email.</p>
    </div>
  </div>
</div>`;

  const text = [
    `Daily order confirmation — ${date}`,
    intro,
    who,
    "",
    textTable(rows, includeSalesman),
  ].filter(Boolean).join("\n");

  return { subject, text, html, orderCount: totals.orders, totals };
}

export function parseDailySupplierOrderLastSent(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const lastSentAt = String(value.lastSentAt || value.asOf || "").trim();
    const date = String(value.date || value.lastSentDate || "").trim();
    return {
      date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "",
      lastSentAt: Number.isFinite(Date.parse(lastSentAt)) ? new Date(lastSentAt).toISOString() : "",
    };
  }

  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return { date: raw, lastSentAt: "" };
  }
  if (Number.isFinite(Date.parse(raw))) {
    return { date: "", lastSentAt: new Date(raw).toISOString() };
  }
  return { date: "", lastSentAt: "" };
}

export function defaultSupplierOrderSinceIso() {
  return `${MISSING_INVOICE_CREATED_FROM}T00:00:00.000Z`;
}
