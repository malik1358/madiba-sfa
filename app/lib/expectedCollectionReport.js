import {
  isKpiUploadSummaryCustomerExcluded,
  isOpenInvoiceExpectedThisMonth,
  resolveExpectedPayDate,
  splitAmountByCategoryMix,
} from "./kpiUploadSummaryCategories.js";
import { normalizeCode, normalizeName } from "./outstanding.js";

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function resolveExpectedCollectionSalesman(invoice = {}) {
  const raw = String(
    invoice?.salesman
    || invoice?.salesman_name
    || invoice?.salesmanName
    || invoice?.salesman_code
    || invoice?.salesmanCode
    || "",
  ).trim();
  if (!raw) {
    return { salesmanCode: "", salesmanName: "" };
  }
  return {
    salesmanCode: normalizeCode(raw),
    salesmanName: raw,
  };
}

/**
 * Group detail rows by salesman with Expected SAR (and related) totals.
 * Unassigned invoices land under key "__UNASSIGNED__".
 */
export function groupExpectedCollectionRowsBySalesman(rows = []) {
  const byKey = new Map();
  (rows || []).forEach((row) => {
    const code = normalizeCode(row?.salesmanCode || row?.salesmanName);
    const name = String(row?.salesmanName || row?.salesmanCode || "").trim();
    const key = code || normalizeName(name) || "__UNASSIGNED__";
    const current = byKey.get(key) || {
      key,
      salesmanCode: code,
      salesmanName: name || "Unassigned",
      invoiceCount: 0,
      customerCodes: new Set(),
      pendingAmount: 0,
      amount: 0,
      bmValue: 0,
      restValue: 0,
      rows: [],
    };
    current.invoiceCount += 1;
    if (row?.customerCode) current.customerCodes.add(normalizeCode(row.customerCode));
    current.pendingAmount = money(current.pendingAmount + Number(row?.pendingAmount || 0));
    current.amount = money(current.amount + Number(row?.amount || 0));
    current.bmValue = money(current.bmValue + Number(row?.bmValue || 0));
    current.restValue = money(current.restValue + Number(row?.restValue || 0));
    if (!current.salesmanName && name) current.salesmanName = name;
    current.rows.push(row);
    byKey.set(key, current);
  });

  return [...byKey.values()]
    .map((group) => ({
      key: group.key,
      salesmanCode: group.salesmanCode,
      salesmanName: group.salesmanName || "Unassigned",
      invoiceCount: group.invoiceCount,
      customerCount: group.customerCodes.size,
      pendingAmount: group.pendingAmount,
      amount: group.amount,
      bmValue: group.bmValue,
      restValue: group.restValue,
      rows: group.rows,
    }))
    .sort((left, right) => (
      right.amount - left.amount
      || String(left.salesmanName).localeCompare(String(right.salesmanName))
      || String(left.salesmanCode).localeCompare(String(right.salesmanCode))
    ));
}

/**
 * Group detail rows by customer with Expected SAR (and related) totals.
 * Used under an expanded salesman so duplicate customer invoice lines collapse.
 */
export function groupExpectedCollectionRowsByCustomer(rows = []) {
  const byKey = new Map();
  (rows || []).forEach((row) => {
    const code = normalizeCode(row?.customerCode);
    const name = String(row?.customerName || "").trim();
    const key = code || normalizeName(name) || "__UNKNOWN__";
    const current = byKey.get(key) || {
      key,
      customerCode: code,
      customerName: name || code || "—",
      salesmanCode: normalizeCode(row?.salesmanCode || row?.salesmanName),
      salesmanName: String(row?.salesmanName || row?.salesmanCode || "").trim(),
      avgDays: row?.avgDays ?? null,
      lifetimeAvg: row?.lifetimeAvg ?? null,
      lastPaidInvoiceDays: row?.lastPaidInvoiceDays ?? null,
      lastReceiptDate: row?.lastReceiptDate || "",
      invoiceCount: 0,
      pendingAmount: 0,
      amount: 0,
      bmValue: 0,
      restValue: 0,
      rows: [],
    };
    current.invoiceCount += 1;
    current.pendingAmount = money(current.pendingAmount + Number(row?.pendingAmount || 0));
    current.amount = money(current.amount + Number(row?.amount || 0));
    current.bmValue = money(current.bmValue + Number(row?.bmValue || 0));
    current.restValue = money(current.restValue + Number(row?.restValue || 0));
    if (!current.customerName && name) current.customerName = name;
    if (current.avgDays == null && row?.avgDays != null) current.avgDays = row.avgDays;
    if (current.lifetimeAvg == null && row?.lifetimeAvg != null) current.lifetimeAvg = row.lifetimeAvg;
    if (current.lastPaidInvoiceDays == null && row?.lastPaidInvoiceDays != null) {
      current.lastPaidInvoiceDays = row.lastPaidInvoiceDays;
    }
    if (!current.lastReceiptDate && row?.lastReceiptDate) {
      current.lastReceiptDate = row.lastReceiptDate;
    }
    current.rows.push(row);
    byKey.set(key, current);
  });

  return [...byKey.values()]
    .map((group) => ({
      key: group.key,
      customerCode: group.customerCode,
      customerName: group.customerName || group.customerCode || "—",
      salesmanCode: group.salesmanCode,
      salesmanName: group.salesmanName,
      avgDays: group.avgDays,
      lifetimeAvg: group.lifetimeAvg,
      lastPaidInvoiceDays: group.lastPaidInvoiceDays,
      lastReceiptDate: group.lastReceiptDate,
      invoiceCount: group.invoiceCount,
      pendingAmount: group.pendingAmount,
      amount: group.amount,
      bmValue: group.bmValue,
      restValue: group.restValue,
      rows: group.rows,
    }))
    .sort((left, right) => (
      right.amount - left.amount
      || String(left.customerName).localeCompare(String(right.customerName))
      || String(left.customerCode).localeCompare(String(right.customerCode))
    ));
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
    const salesman = resolveExpectedCollectionSalesman(invoice);

    rows.push({
      customerCode,
      customerName: String(invoice?.customer_name || enriched?.customer_name || "").trim(),
      salesmanCode: salesman.salesmanCode,
      salesmanName: salesman.salesmanName,
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
    String(left.salesmanName || left.salesmanCode || "").localeCompare(
      String(right.salesmanName || right.salesmanCode || ""),
    )
    || right.amount - left.amount
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
