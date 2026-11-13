import { lastDayOfMonth } from "./biReportPeriod.js";
import { loadLegalTransferRows } from "./badDebtReportServer.js";
import {
  attachAvgDaysToPayToRecords,
  loadReceiptRowsByCustomer,
  loadSalesRowsByCustomer,
  lookupByCustomerCode,
} from "./collectionAvgDays.js";
import { buildExpectedCollectionDetailRows } from "./expectedCollectionReport.js";
import {
  buildCustomerCategoryMixFromFacts,
  buildKpiUploadSummaryExcludedCustomerSet,
  isKpiUploadSummaryCustomerExcluded,
  pickCustomerAvgDaysToPay,
} from "./kpiUploadSummaryCategories.js";
import { OUTSTANDING_DATASET_KEY, normalizeCode } from "./outstanding.js";
import { monthStartDate } from "./performanceKpis.js";
import { getKsaDateString } from "./workdayActivity.js";

/** Short process cache so reopen/refresh does not re-scan sales history. */
const EXPECTED_COLLECTION_CACHE_TTL_MS = 3 * 60 * 1000;
let expectedCollectionReportCache = null;

export function clearExpectedCollectionReportCache() {
  expectedCollectionReportCache = null;
}

async function readJsonSetting(admin, key) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", key)
    .maybeSingle();
  if (error) throw error;
  try {
    return JSON.parse(String(data?.setting_value || "null"));
  } catch {
    return null;
  }
}

async function loadOutstandingInvoices(admin) {
  const payload = await readJsonSetting(admin, OUTSTANDING_DATASET_KEY);
  const invoices = Array.isArray(payload?.invoices) ? payload.invoices : [];
  return invoices.filter((invoice) => Number(invoice?.pending_amount || 0) > 0);
}

function groupOutstandingInvoicesByCustomer(invoices = []) {
  const byCustomer = new Map();
  (invoices || []).forEach((invoice) => {
    const code = normalizeCode(invoice?.customer_code);
    if (!code) return;
    const current = byCustomer.get(code) || {
      customer_code: code,
      customer_name: String(invoice?.customer_name || "").trim(),
      invoices: [],
    };
    current.invoices.push(invoice);
    if (!current.customer_name && invoice?.customer_name) {
      current.customer_name = String(invoice.customer_name).trim();
    }
    byCustomer.set(code, current);
  });
  return [...byCustomer.values()];
}

function resolveMonthEnd(monthOrDate = "") {
  const raw = String(monthOrDate || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return lastDayOfMonth(raw.slice(0, 7)) || `${raw.slice(0, 7)}-28`;
  }
  if (/^\d{4}-\d{2}$/.test(raw)) {
    return lastDayOfMonth(raw) || `${raw}-28`;
  }
  const today = getKsaDateString();
  const monthKey = String(monthStartDate(today) || today).slice(0, 7);
  return lastDayOfMonth(monthKey) || `${monthKey}-28`;
}

function customerHasReceiptRows(receiptsByCustomer, customerCode) {
  return lookupByCustomerCode(receiptsByCustomer, customerCode).length > 0;
}

/**
 * Build BM/Electronics/Rest mix from the same active_sales rows used for avg days.
 * Avoids loading the full sales BI cube on every Expected Collection open.
 */
export function buildCustomerCategoryMixFromSalesRows(salesByCustomer = new Map()) {
  const facts = [];
  (salesByCustomer instanceof Map ? salesByCustomer : new Map()).forEach((rows, fallbackCode) => {
    (rows || []).forEach((row) => {
      facts.push({
        customer_code: row?.customer_code || fallbackCode,
        sales_amount: row?.sales_amount,
        category: row?.category,
        item_code: row?.item_code,
        item_name: row?.item_name,
        month: String(row?.transaction_date || "").slice(0, 7),
      });
    });
  });
  return buildCustomerCategoryMixFromFacts(facts);
}

/**
 * Live BM+Rest expected-collection detail for the management report.
 * Same rules as the KPI upload summary Collection expected-remaining categories.
 * Only customers with at least one receipt are enriched (never-paid excluded).
 */
export async function loadExpectedCollectionReport(admin, {
  month = "",
  todayIso = "",
} = {}) {
  const asOf = String(todayIso || getKsaDateString()).slice(0, 10);
  const monthEnd = resolveMonthEnd(month || asOf);
  const cacheKey = `${monthEnd}|${asOf}`;
  const cached = expectedCollectionReportCache;
  if (
    cached
    && cached.key === cacheKey
    && (Date.now() - Number(cached.at || 0)) < EXPECTED_COLLECTION_CACHE_TTL_MS
    && cached.report
  ) {
    return cached.report;
  }

  const [outstandingInvoices, legalTransfers, receiptsByCustomer] = await Promise.all([
    loadOutstandingInvoices(admin),
    loadLegalTransferRows(admin).catch(() => []),
    loadReceiptRowsByCustomer(admin),
  ]);

  const excludedLegalCustomers = buildKpiUploadSummaryExcludedCustomerSet(
    (legalTransfers || [])
      .filter((row) => Boolean(row?.is_transferred))
      .map((row) => row?.customer_code),
  );

  const customerRecords = groupOutstandingInvoicesByCustomer(outstandingInvoices)
    .filter((row) => {
      const code = normalizeCode(row.customer_code);
      if (!code) return false;
      if (isKpiUploadSummaryCustomerExcluded(code, excludedLegalCustomers)) return false;
      return customerHasReceiptRows(receiptsByCustomer, code);
    });

  const salesByCustomer = customerRecords.length
    ? await loadSalesRowsByCustomer(
      admin,
      customerRecords.map((row) => row.customer_code),
    )
    : new Map();

  const customerMix = buildCustomerCategoryMixFromSalesRows(salesByCustomer);

  const enrichedCustomers = attachAvgDaysToPayToRecords(customerRecords, {
    salesByCustomer,
    receiptsByCustomer,
    todayIso: asOf,
  });
  const enrichedByCode = new Map(
    enrichedCustomers.map((row) => [normalizeCode(row.customer_code), row]),
  );
  const avgDaysByCustomer = new Map(
    enrichedCustomers.map((row) => [normalizeCode(row.customer_code), pickCustomerAvgDaysToPay(row)]),
  );

  const detail = buildExpectedCollectionDetailRows(outstandingInvoices, {
    avgDaysByCustomer,
    enrichedByCode,
    customerMix,
    monthEnd,
    excludedCustomerCodes: excludedLegalCustomers,
  });

  const report = {
    asOf,
    monthEnd: detail.monthEnd,
    rule: "max(lifetime avg, last paid invoice days); require ≥1 payment; avg days >120 excluded; exclude legal; BM+Rest share; approx pay ≤ month-end",
    total: detail.total,
    bmTotal: detail.bmTotal,
    restTotal: detail.restTotal,
    customerCount: detail.customerCount,
    invoiceCount: detail.invoiceCount,
    rows: detail.rows,
  };
  expectedCollectionReportCache = {
    key: cacheKey,
    at: Date.now(),
    report,
  };
  return report;
}
