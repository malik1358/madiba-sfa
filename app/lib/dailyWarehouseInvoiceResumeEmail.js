import { escapeHtml } from "./dailyVisitReportEmail.js";
import { hasUploadedInvoice, parseInvoiceMeta } from "./missingInvoiceEmail.js";
import { formatSalesOrderNumber } from "./salesOrderNumber.js";
import { formatKsaDateTime } from "./workdayActivity.js";
import {
  invoiceFileNumberFromName,
  pricingRegionLabel,
  resolveDailyWarehouseInvoiceResumeCc,
  resolveDailyWarehouseInvoiceResumeTo,
  warehouseInvoiceBucketKey,
  warehouseInvoiceBucketLabel,
  warehouseInvoicePricingRegion,
  WAREHOUSE_INVOICE_BUCKET_DAMMAM,
  WAREHOUSE_INVOICE_BUCKET_RIYADH_JEDDAH,
} from "./warehouseInvoiceRecipients.js";

export const DAILY_WAREHOUSE_INVOICE_RESUME_KEY_PREFIX = "daily_warehouse_invoice_resume_email:";

const HEADER_BG = "#0f4c5c";
const ZEBRA = "#f4f8f9";

export function dailyWarehouseInvoiceResumeClaimKey(date) {
  return `${DAILY_WAREHOUSE_INVOICE_RESUME_KEY_PREFIX}${String(date || "").trim().slice(0, 10)}`;
}

export function invoiceUploadedAtMs(meta) {
  const payload = parseInvoiceMeta(meta) || {};
  const ms = Date.parse(String(payload.invoiceUploadedAt || ""));
  return Number.isFinite(ms) ? ms : null;
}

export function buildWarehouseInvoiceResumeRow({
  order = {},
  meta = null,
  pricingRegion = "",
} = {}) {
  const payload = parseInvoiceMeta(meta) || {};
  if (!hasUploadedInvoice(payload)) return null;
  const uploadedMs = invoiceUploadedAtMs(payload);
  if (!Number.isFinite(uploadedMs)) return null;

  const region = warehouseInvoicePricingRegion(
    pricingRegion || payload.pricingRegion || payload.region || "",
  );
  const fileName = String(payload.originalFileName || payload.invoiceFileName || "").trim();
  const amount = Number(payload.invoiceAmountExclVat);
  return {
    orderId: String(order?.id || payload.orderId || "").trim(),
    orderNumber: formatSalesOrderNumber(order) || String(order?.order_number || "").trim() || "-",
    customerCode: String(order?.customer_code || "").trim().toUpperCase(),
    customerName: String(order?.customer_name || "").trim(),
    salesmanName: String(order?.salesman_name || order?.salesman_code || "").trim() || "-",
    pricingRegion: region,
    cityLabel: pricingRegionLabel(region),
    bucketKey: warehouseInvoiceBucketKey(region),
    invoiceFileNumber: invoiceFileNumberFromName(fileName) || "-",
    invoiceFileName: fileName || "-",
    amountExclVat: Number.isFinite(amount) ? amount : null,
    uploadedAtIso: payload.invoiceUploadedAt || "",
    uploadedAtMs: uploadedMs,
  };
}

export function selectWarehouseInvoiceResumeRows({
  orders = [],
  metaByOrder = new Map(),
  pricingRegionByOrder = new Map(),
  sinceMs = 0,
  asOfMs = Date.now(),
} = {}) {
  const rows = [];
  for (const order of orders || []) {
    const orderId = String(order?.id || "").trim();
    if (!orderId) continue;
    if (String(order?.status || "").trim().toUpperCase() !== "SUBMITTED") continue;
    const meta = metaByOrder.get(orderId) || null;
    const row = buildWarehouseInvoiceResumeRow({
      order,
      meta,
      pricingRegion: pricingRegionByOrder.get(orderId) || "",
    });
    if (!row) continue;
    if (row.uploadedAtMs < sinceMs || row.uploadedAtMs > asOfMs) continue;
    rows.push(row);
  }
  rows.sort((a, b) => {
    if (b.uploadedAtMs !== a.uploadedAtMs) return b.uploadedAtMs - a.uploadedAtMs;
    return String(a.orderNumber).localeCompare(String(b.orderNumber));
  });
  return rows;
}

export function bucketWarehouseInvoiceResumeRows(rows = []) {
  const buckets = {
    [WAREHOUSE_INVOICE_BUCKET_RIYADH_JEDDAH]: [],
    [WAREHOUSE_INVOICE_BUCKET_DAMMAM]: [],
  };
  for (const row of rows || []) {
    const key = row?.bucketKey === WAREHOUSE_INVOICE_BUCKET_DAMMAM
      ? WAREHOUSE_INVOICE_BUCKET_DAMMAM
      : WAREHOUSE_INVOICE_BUCKET_RIYADH_JEDDAH;
    buckets[key].push(row);
  }
  return buckets;
}

function formatAmount(value) {
  if (!Number.isFinite(Number(value))) return "-";
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function customerLabel(row) {
  return [row?.customerCode, row?.customerName].filter(Boolean).join(" — ") || "-";
}

export function resolveDailyWarehouseInvoiceResumeRecipients(bucketKey, env = process.env) {
  const to = resolveDailyWarehouseInvoiceResumeTo(bucketKey, env);
  const cc = resolveDailyWarehouseInvoiceResumeCc(env, to);
  return { to, cc };
}

export function buildDailyWarehouseInvoiceResumeEmail({
  date = "",
  bucketKey = WAREHOUSE_INVOICE_BUCKET_RIYADH_JEDDAH,
  rows = [],
} = {}) {
  const label = warehouseInvoiceBucketLabel(bucketKey);
  const list = Array.isArray(rows) ? rows : [];
  const totalAmount = list.reduce((sum, row) => sum + (Number.isFinite(row.amountExclVat) ? row.amountExclVat : 0), 0);
  const subject = `Daily warehouse invoices — ${label} — ${date} (${list.length})`;

  const textLines = [
    `Daily warehouse invoice resume — ${label}`,
    `Report date (KSA): ${date}`,
    `Invoices uploaded: ${list.length}`,
    `Total excl. VAT: ${formatAmount(totalAmount)}`,
    "",
    ...list.map((row, index) => [
      `${index + 1}. ${customerLabel(row)}`,
      `   Order: ${row.orderNumber}`,
      `   Invoice file: ${row.invoiceFileNumber}`,
      `   City: ${row.cityLabel}`,
      `   Salesman: ${row.salesmanName}`,
      `   Amount excl. VAT: ${formatAmount(row.amountExclVat)}`,
      `   Uploaded (KSA): ${row.uploadedAtIso ? formatKsaDateTime(row.uploadedAtIso) : "-"}`,
    ].join("\n")),
  ];

  const bodyRows = list.map((row, index) => {
    const bg = index % 2 === 1 ? ZEBRA : "#ffffff";
    return `<tr style="background:${bg};">
  <td style="padding:6px 8px;border:1px solid #c5d4de;">${escapeHtml(customerLabel(row))}</td>
  <td style="padding:6px 8px;border:1px solid #c5d4de;">${escapeHtml(row.orderNumber)}</td>
  <td style="padding:6px 8px;border:1px solid #c5d4de;font-weight:600;">${escapeHtml(row.invoiceFileNumber)}</td>
  <td style="padding:6px 8px;border:1px solid #c5d4de;text-align:right;">${escapeHtml(formatAmount(row.amountExclVat))}</td>
  <td style="padding:6px 8px;border:1px solid #c5d4de;">${escapeHtml(row.salesmanName)}</td>
  <td style="padding:6px 8px;border:1px solid #c5d4de;">${escapeHtml(row.cityLabel)}</td>
  <td style="padding:6px 8px;border:1px solid #c5d4de;">${escapeHtml(row.uploadedAtIso ? formatKsaDateTime(row.uploadedAtIso) : "-")}</td>
</tr>`;
  }).join("");

  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;color:#102a43;line-height:1.45;">
  <div style="background:${HEADER_BG};color:#fff;padding:14px 16px;border-radius:8px 8px 0 0;">
    <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;opacity:0.9;">MADIBA SFA</div>
    <h2 style="margin:6px 0 0;font-size:20px;">Daily warehouse invoices — ${escapeHtml(label)}</h2>
    <div style="font-size:14px;opacity:0.95;">${escapeHtml(date)} · ${list.length} invoice${list.length === 1 ? "" : "s"} · Total ${escapeHtml(formatAmount(totalAmount))} excl. VAT</div>
  </div>
  <table style="border-collapse:collapse;width:100%;max-width:960px;font-size:13px;margin-top:0;">
    <thead>
      <tr>
        <th style="padding:8px;border:1px solid #0a3a46;background:${HEADER_BG};color:#fff;text-align:left;">Customer</th>
        <th style="padding:8px;border:1px solid #0a3a46;background:${HEADER_BG};color:#fff;text-align:left;">Order</th>
        <th style="padding:8px;border:1px solid #0a3a46;background:${HEADER_BG};color:#fff;text-align:left;">Invoice file #</th>
        <th style="padding:8px;border:1px solid #0a3a46;background:${HEADER_BG};color:#fff;text-align:right;">Amount excl. VAT</th>
        <th style="padding:8px;border:1px solid #0a3a46;background:${HEADER_BG};color:#fff;text-align:left;">Salesman</th>
        <th style="padding:8px;border:1px solid #0a3a46;background:${HEADER_BG};color:#fff;text-align:left;">City</th>
        <th style="padding:8px;border:1px solid #0a3a46;background:${HEADER_BG};color:#fff;text-align:left;">Uploaded (KSA)</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows || `<tr><td colspan="7" style="padding:12px;border:1px solid #c5d4de;">No invoices uploaded.</td></tr>`}
      <tr style="background:#e8f2f4;font-weight:700;">
        <td style="padding:8px;border:1px solid #c5d4de;" colspan="3">Total (${list.length})</td>
        <td style="padding:8px;border:1px solid #c5d4de;text-align:right;">${escapeHtml(formatAmount(totalAmount))}</td>
        <td style="padding:8px;border:1px solid #c5d4de;" colspan="3"></td>
      </tr>
    </tbody>
  </table>
</div>`;

  return {
    subject,
    text: textLines.join("\n"),
    html,
    counts: {
      invoiceCount: list.length,
      totalAmountExclVat: totalAmount,
      bucketKey,
      bucketLabel: label,
    },
  };
}
