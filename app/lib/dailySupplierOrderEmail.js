import { isLikelyEmail, parseEmailList } from "./mailer.js";
import {
  DEFAULT_MISSING_INVOICE_EMAIL_CC,
  DEFAULT_MISSING_INVOICE_EMAIL_TO,
  invoiceStatusLabel,
  isTestCustomerOrder,
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

export function selectDailySupplierOrders(orders = []) {
  return (orders || [])
    .filter((order) => String(order?.status || "").trim().toUpperCase() === "SUBMITTED")
    .filter((order) => !isTestCustomerOrder(order))
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

export function buildDailySupplierOrderRow(order, meta = null, extra = {}) {
  const orderValue = Number.isFinite(Number(extra.orderValue)) ? Number(extra.orderValue) : Number(order?.total_value);
  const invoiceValue = extra.invoiceValue == null || extra.invoiceValue === ""
    ? null
    : Number(extra.invoiceValue);
  return {
    order: formatSalesOrderNumber(order) || String(order?.id || "").trim() || "-",
    customer: customerLabel(order),
    salesman: supplierOrderDisplayName(order, extra.profile || null),
    orderStatus: String(order?.status || "").trim() || "-",
    invoiceStatus: invoiceStatusLabel(meta),
    createdAt: formatKsaDateTime(order?.created_at || order?.submitted_at),
    orderValue: Number.isFinite(orderValue) ? orderValue : 0,
    invoiceValue: Number.isFinite(invoiceValue) ? invoiceValue : null,
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

function tableHeader(includeSalesman) {
  return `<tr style="background:#0f4c81;color:#ffffff;">
    <th style="text-align:left;padding:6px 8px;border:1px solid #0f4c81;">Order</th>
    <th style="text-align:left;padding:6px 8px;border:1px solid #0f4c81;">Customer</th>
    ${includeSalesman ? '<th style="text-align:left;padding:6px 8px;border:1px solid #0f4c81;">Salesman</th>' : ""}
    <th style="text-align:left;padding:6px 8px;border:1px solid #0f4c81;">Order status</th>
    <th style="text-align:left;padding:6px 8px;border:1px solid #0f4c81;">Invoice status</th>
    <th style="text-align:left;padding:6px 8px;border:1px solid #0f4c81;">Created (KSA)</th>
    <th style="text-align:right;padding:6px 8px;border:1px solid #0f4c81;">Order value (excl. VAT)</th>
    <th style="text-align:right;padding:6px 8px;border:1px solid #0f4c81;">Invoice made (excl. VAT)</th>
  </tr>`;
}

function tableRow(row, index, includeSalesman) {
  const rowBg = index % 2 === 0 ? "#ffffff" : "#eef6fb";
  return `<tr style="background:${rowBg};">
    <td style="border:1px solid #c5d4de;padding:6px 8px;">${escapeHtml(row.order)}</td>
    <td style="border:1px solid #c5d4de;padding:6px 8px;">${escapeHtml(row.customer)}</td>
    ${includeSalesman ? `<td style="border:1px solid #c5d4de;padding:6px 8px;">${escapeHtml(row.salesman)}</td>` : ""}
    <td style="border:1px solid #c5d4de;padding:6px 8px;">${escapeHtml(row.orderStatus)}</td>
    <td style="border:1px solid #c5d4de;padding:6px 8px;">${escapeHtml(row.invoiceStatus)}</td>
    <td style="border:1px solid #c5d4de;padding:6px 8px;">${escapeHtml(row.createdAt)}</td>
    <td style="text-align:right;border:1px solid #c5d4de;padding:6px 8px;">${escapeHtml(formatSupplierMoney(row.orderValue))}</td>
    <td style="text-align:right;border:1px solid #c5d4de;padding:6px 8px;">${escapeHtml(formatSupplierMoney(row.invoiceValue))}</td>
  </tr>`;
}

function totalRow(totals, includeSalesman) {
  const span = includeSalesman ? 6 : 5;
  return `<tr style="background:#0f4c81;color:#ffffff;font-weight:700;">
    <td style="padding:8px;border:1px solid #0c3d67;" colspan="${span}">Total (${totals.orders} order${totals.orders === 1 ? "" : "s"})</td>
    <td style="text-align:right;padding:8px;border:1px solid #0c3d67;">${escapeHtml(formatSupplierMoney(totals.orderValue))}</td>
    <td style="text-align:right;padding:8px;border:1px solid #0c3d67;">${escapeHtml(formatSupplierMoney(totals.invoiceValue))}</td>
  </tr>`;
}

function renderTable(rows, { includeSalesman = false } = {}) {
  const totals = summarizeDailySupplierOrderRows(rows);
  const body = rows.length
    ? rows.map((row, index) => tableRow(row, index, includeSalesman)).join("")
    : `<tr><td colspan="${includeSalesman ? 8 : 7}" style="border:1px solid #c5d4de;padding:8px;">No submitted orders.</td></tr>`;
  return `<table style="border-collapse: collapse; font-size: 13px; width: 100%;">
    <thead>${tableHeader(includeSalesman)}</thead>
    <tbody>${body}${rows.length ? totalRow(totals, includeSalesman) : ""}</tbody>
  </table>`;
}

function textTable(rows, includeSalesman) {
  const header = includeSalesman
    ? "Order | Customer | Salesman | Order status | Invoice status | Created (KSA) | Order value excl VAT | Invoice made excl VAT"
    : "Order | Customer | Order status | Invoice status | Created (KSA) | Order value excl VAT | Invoice made excl VAT";
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
} = {}) {
  const totals = summarizeDailySupplierOrderRows(rows);
  const who = String(salesmanName || "").trim();
  const subject = who
    ? `Orders raised ${date} — ${who} (${totals.orders})`
    : `Orders raised ${date} — all salesmen (${totals.orders})`;
  const intro = who
    ? `Submitted orders you raised on ${date} (KSA), with current invoice status. Values are without VAT. Invoice made value is read from the attached invoice PDF.`
    : `Submitted orders raised on ${date} (KSA), grouped by salesman. Values are without VAT. Invoice made value is read from the attached invoice PDF.`;

  const html = `<div style="font-family: Arial, sans-serif; color: #1f2933; line-height: 1.5;">
  <h2 style="margin: 0 0 12px; color: #0f4c81;">Daily order confirmation — ${escapeHtml(date)}</h2>
  <p style="margin: 0 0 16px;">${escapeHtml(intro)}</p>
  ${who ? `<p style="margin: 0 0 16px;"><strong>${escapeHtml(who)}</strong></p>` : ""}
  ${renderTable(rows, { includeSalesman })}
  <p style="margin: 16px 0 0; color: #52616b; font-size: 13px;">Totals are without VAT. Invoice made is taken from the attached invoice; blank means no invoice PDF yet or the total could not be read.</p>
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
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? String(value.date || value.lastSentDate || "")
    : String(value || "");
  const date = raw.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}
