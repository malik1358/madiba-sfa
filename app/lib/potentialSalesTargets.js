import { escapeHtml } from "./dailyVisitReportEmail.js";
import { parseOutstandingSheetDate, resolveInvoiceAgingDays } from "./outstanding.js";
import { addKsaCalendarDays, getKsaDateString } from "./workdayActivity.js";

function normalizeSalesmanIdentity(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function matchesSalesmanProfile(value, identitySet) {
  const raw = String(value || "").trim();
  if (identitySet.has(normalizeSalesmanIdentity(raw))) return true;
  return [...raw.matchAll(/\(([^)]+)\)/g)]
    .some((match) => identitySet.has(normalizeSalesmanIdentity(match[1])));
}

export function isPotentialSalesTarget(row = {}, { todayKey = getKsaDateString() } = {}) {
  if (row.is_active === false) return false;
  const outstanding = Number(row.total_outstanding);
  if (!Number.isFinite(outstanding) || outstanding <= 0 || outstanding >= 15000) return false;
  const olderBuckets = [row.outstanding_61_90, row.outstanding_91_120, row.outstanding_above_120];
  if (olderBuckets.some((amount) => Number(amount) > 0)) return false;
  const invoices = (row.invoices || []).filter((invoice) => Number(invoice.pending_amount) > 0);
  if (!invoices.length) return false;
  if (invoices.some((invoice) => resolveInvoiceAgingDays(invoice, `${todayKey}T12:00:00+03:00`) >= 60)) return false;
  const lastInvoiceDate = parseOutstandingSheetDate(row.last_invoice_date || row.latest_transaction_date);
  return Boolean(lastInvoiceDate && lastInvoiceDate < addKsaCalendarDays(todayKey, -15));
}

export function filterPotentialSalesTargetsForProfile(rows = [], profile = {}) {
  const profileCode = normalizeSalesmanIdentity(profile.salesman_code);
  const identities = new Set([profileCode, normalizeSalesmanIdentity(profile.salesman_name)].filter(Boolean));
  return (rows || []).filter((row) => (
    Boolean(profileCode) && [row.current_salesman_code, row.previous_salesman_code]
      .some((code) => normalizeSalesmanIdentity(code) === profileCode)
    || matchesSalesmanProfile(row.salesman_code, identities)
    || matchesSalesmanProfile(row.salesman_name, identities)
  ));
}

export function daysSincePotentialSalesTargetInvoice(row = {}, todayKey = getKsaDateString()) {
  const invoiceDate = parseOutstandingSheetDate(row.last_invoice_date || row.latest_transaction_date);
  if (!invoiceDate) return null;
  return Math.round((Date.parse(`${todayKey}T00:00:00Z`) - Date.parse(`${invoiceDate}T00:00:00Z`)) / 86400000);
}

export function buildPotentialSalesTargetsSection({ rows = [], todayKey = getKsaDateString() } = {}) {
  const targets = rows.filter((row) => isPotentialSalesTarget(row, { todayKey }))
    .sort((left, right) => String(left.last_invoice_date || left.latest_transaction_date)
      .localeCompare(String(right.last_invoice_date || right.latest_transaction_date))
      || String(left.customer_code).localeCompare(String(right.customer_code)));
  const money = (value) => Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const total = targets.reduce((sum, row) => sum + Number(row.total_outstanding), 0);
  const headers = ["Customer Code", "Customer", "City / Area", "Last Invoice", "Days Since Invoice", "Outstanding (SAR)"];
  const values = (row) => {
    const date = parseOutstandingSheetDate(row.last_invoice_date || row.latest_transaction_date);
    const days = daysSincePotentialSalesTargetInvoice(row, todayKey);
    return [row.customer_code, row.customer_name, [row.city, row.area].filter(Boolean).join(" / ") || "-", date, days, money(row.total_outstanding)];
  };
  const text = [
    "Potential Sales Target Customers",
    `As of ${todayKey} (KSA)`,
    headers.join(" | "),
    ...targets.map((row) => values(row).join(" | ")),
    ...(!targets.length ? ["No qualifying customers."] : []),
    `Total | ${targets.length} customers | ${money(total)} SAR`,
  ].join("\n");
  const html = `<h2 style="font-size:16px;color:#0f4c5c;">Potential Sales Target Customers</h2>
    <p style="font-size:12px;">As of ${escapeHtml(todayKey)} (KSA)</p>
    <table cellpadding="8" cellspacing="0" border="1" style="border-collapse:collapse;font-size:12px;width:100%;border-color:#99d5cf;">
      <thead style="background:#0f4c5c;color:#ffffff;"><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
      <tbody>${targets.map((row, index) => `<tr style="background:${index % 2 ? "#ecfdf5" : "#ffffff"};">${values(row).map((value, column) => `<td${column === 5 ? ' style="text-align:right;background:#dcfce7;font-weight:700;"' : ""}>${escapeHtml(value)}</td>`).join("")}</tr>`).join("")
        || '<tr><td colspan="6">No qualifying customers.</td></tr>'}</tbody>
      <tfoot style="background:#0f4c5c;color:#ffffff;font-weight:700;"><tr><td colspan="5">Total (${targets.length} customers)</td><td style="text-align:right;">${money(total)} SAR</td></tr></tfoot>
    </table>`;
  return {
    html,
    text,
    rows: targets.map((row) => ({ ...row, days_since_last_invoice: daysSincePotentialSalesTargetInvoice(row, todayKey) })),
    customerCount: targets.length,
    totalOutstanding: total,
  };
}