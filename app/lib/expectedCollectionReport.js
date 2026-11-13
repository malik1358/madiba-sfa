import {
  isKpiUploadSummaryCustomerExcluded,
  isOpenInvoiceExpectedThisMonth,
  resolveExpectedPayDate,
  splitAmountByCategoryMix,
} from "./kpiUploadSummaryCategories.js";
import { normalizeCode } from "./outstanding.js";

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function daysBetween(from, to) {
  const a = Date.parse(`${String(from || "").slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(to || "").slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

/**
 * Flat invoice rows for BM+Rest open expected collection by month-end.
 * Matches the agreed estimate list: avg days from the map, legal excluded,
 * amount = BM + Rest mix share only (electronics share omitted).
 */
export function buildExpectedCollectionDetailRows(invoices = [], {
  avgDaysByCustomer = new Map(),
  enrichedByCode = new Map(),
  customerMix = new Map(),
  monthEnd = "",
  excludedCustomerCodes = null,
} = {}) {
  const end = String(monthEnd || "").slice(0, 10);
  const rows = [];

  (invoices || []).forEach((invoice) => {
    const pending = Number(invoice?.pending_amount ?? invoice?.amount ?? 0);
    if (!(pending > 0)) return;
    const customerCode = normalizeCode(invoice?.customer_code);
    if (!customerCode) return;
    if (isKpiUploadSummaryCustomerExcluded(customerCode, excludedCustomerCodes)) return;

    const avgDays = avgDaysByCustomer instanceof Map
      ? avgDaysByCustomer.get(customerCode)
      : avgDaysByCustomer?.[customerCode];
    const invoiceDate = String(invoice?.invoice_date || "").slice(0, 10);
    if (!isOpenInvoiceExpectedThisMonth({ invoiceDate, avgDays, monthEnd: end })) return;

    const mix = customerMix instanceof Map
      ? customerMix.get(customerCode)
      : customerMix?.[customerCode];
    const split = splitAmountByCategoryMix(pending, mix);
    const bmValue = money(split.buildingMaterial);
    const restValue = money(split.rest);
    const amount = money(bmValue + restValue);
    if (!(amount > 0.009)) return;

    const enriched = enrichedByCode instanceof Map
      ? enrichedByCode.get(customerCode)
      : enrichedByCode?.[customerCode];
    const approxPayDate = resolveExpectedPayDate(invoiceDate, avgDays);

    rows.push({
      customerCode,
      customerName: String(invoice?.customer_name || enriched?.customer_name || "").trim(),
      avgDays: Number.isFinite(Number(avgDays)) ? Number(avgDays) : null,
      lifetimeAvg: enriched?.avg_days_to_pay ?? enriched?.avgDaysToPay ?? null,
      lastPaidInvoiceDays: enriched?.last_paid_invoice_days ?? enriched?.lastPaidInvoiceDays ?? null,
      lastReceiptDate: String(enriched?.last_receipt_date || "").slice(0, 10) || "",
      refNo: String(invoice?.ref_no || invoice?.voucher_number || "").trim(),
      invoiceDate,
      pendingAmount: money(pending),
      amount,
      daysToMonthEnd: daysBetween(invoiceDate, end),
      approxPayDate,
      bmValue,
      restValue,
    });
  });

  rows.sort((left, right) => (
    right.amount - left.amount
    || String(left.customerCode).localeCompare(String(right.customerCode))
    || String(left.invoiceDate).localeCompare(String(right.invoiceDate))
    || String(left.refNo).localeCompare(String(right.refNo))
  ));

  const bmTotal = money(rows.reduce((sum, row) => sum + Number(row.bmValue || 0), 0));
  const restTotal = money(rows.reduce((sum, row) => sum + Number(row.restValue || 0), 0));
  const total = money(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0));
  const customerCodes = new Set(rows.map((row) => row.customerCode));

  return {
    monthEnd: end,
    total,
    bmTotal,
    restTotal,
    customerCount: customerCodes.size,
    invoiceCount: rows.length,
    rows,
  };
}
