import { lastDayOfMonth } from "./biReportPeriod.js";
import { loadLegalTransferRows } from "./badDebtReportServer.js";
import { enrichCollectionRecordsWithAvgDays } from "./collectionAvgDays.js";
import { buildExpectedCollectionDetailRows } from "./expectedCollectionReport.js";
import {
  buildCustomerCategoryMixFromFacts,
  buildKpiUploadSummaryExcludedCustomerSet,
  pickCustomerAvgDaysToPay,
} from "./kpiUploadSummaryCategories.js";
import { OUTSTANDING_DATASET_KEY, normalizeCode } from "./outstanding.js";
import { monthStartDate } from "./performanceKpis.js";
import { salesBiFactsFromCube } from "./salesBiCube.js";
import { loadSalesBiCube } from "./salesBiCubeServer.js";
import { getKsaDateString } from "./workdayActivity.js";

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

function cubeFactsList(cube) {
  if (!cube) return [];
  if (Array.isArray(cube.facts)) return cube.facts;
  if (cube.facts && typeof cube.facts.values === "function") return salesBiFactsFromCube(cube);
  return [];
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
    return lastDayOfMonth(raw.slice(0, 7)) || raw.slice(0, 7) + "-28";
  }
  if (/^\d{4}-\d{2}$/.test(raw)) {
    return lastDayOfMonth(raw) || `${raw}-28`;
  }
  const today = getKsaDateString();
  const monthKey = String(monthStartDate(today) || today).slice(0, 7);
  return lastDayOfMonth(monthKey) || `${monthKey}-28`;
}

/**
 * Live BM+Rest expected-collection detail for the management report.
 * Same rules as the KPI upload summary Collection expected-remaining categories.
 */
export async function loadExpectedCollectionReport(admin, {
  month = "",
  todayIso = "",
} = {}) {
  const asOf = String(todayIso || getKsaDateString()).slice(0, 10);
  const monthEnd = resolveMonthEnd(month || asOf);

  const [cube, outstandingInvoices, legalTransfers] = await Promise.all([
    loadSalesBiCube(admin, { allowStale: true }),
    loadOutstandingInvoices(admin),
    loadLegalTransferRows(admin).catch(() => []),
  ]);

  const facts = cubeFactsList(cube);
  const customerMix = buildCustomerCategoryMixFromFacts(facts);
  const customerRecords = groupOutstandingInvoicesByCustomer(outstandingInvoices);
  const enrichedCustomers = customerRecords.length
    ? await enrichCollectionRecordsWithAvgDays(admin, customerRecords, { todayIso: asOf })
    : [];
  const enrichedByCode = new Map(
    enrichedCustomers.map((row) => [normalizeCode(row.customer_code), row]),
  );
  const avgDaysByCustomer = new Map(
    enrichedCustomers.map((row) => [normalizeCode(row.customer_code), pickCustomerAvgDaysToPay(row)]),
  );
  const excludedLegalCustomers = buildKpiUploadSummaryExcludedCustomerSet(
    (legalTransfers || [])
      .filter((row) => Boolean(row?.is_transferred))
      .map((row) => row?.customer_code),
  );

  const detail = buildExpectedCollectionDetailRows(outstandingInvoices, {
    avgDaysByCustomer,
    enrichedByCode,
    customerMix,
    monthEnd,
    excludedCustomerCodes: excludedLegalCustomers,
  });

  return {
    asOf,
    monthEnd: detail.monthEnd,
    rule: "max(lifetime avg, last paid invoice days); 120 if never paid; avg days >120 excluded; exclude legal; BM+Rest share; approx pay ≤ month-end",
    total: detail.total,
    bmTotal: detail.bmTotal,
    restTotal: detail.restTotal,
    customerCount: detail.customerCount,
    invoiceCount: detail.invoiceCount,
    rows: detail.rows,
  };
}
