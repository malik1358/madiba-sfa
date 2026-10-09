import { currentMonthDateRange } from "./salesInvoices.js";
import {
  buyingCustomerCodesFromSales,
  buildPerformanceSnapshot,
  classifyBuyingCustomers,
  emptyPerformanceActuals,
  emptyPerformanceTargets,
  isMissingSchemaColumn,
  normalizePerformanceTargets,
  normalizeSalesmanCode,
  averageCumulativeDayShares,
  pickSalesmanPaceShares,
  splitCollectionActualsByInvoice,
  splitSalesActuals,
} from "./performanceKpis.js";
import { buildKpiActualDetails } from "./kpiActualDetails.js";
import {
  normalizeReportSalesmanCode,
  reportSalesmanCodeAliases,
} from "./salesmanReportIdentity.js";
import { isKpiTargetProfile } from "./kpiTargetsTable.js";
import { getKsaDateString, ksaDayBounds } from "./workdayActivity.js";

const TARGET_SELECTS = [
  "id,salesman_code,target_month,sales_target,office_supplies_sales_target,local_item_sales_target,other_sales_target,collection_target,new_buying_customers_target,existing_customers_buying_target,is_approved,updated_at,updated_by",
  "id,salesman_code,target_month,sales_target,office_supplies_sales_target,local_item_sales_target,other_sales_target,new_buying_customers_target,existing_customers_buying_target,is_approved,updated_at",
  "id,salesman_code,target_month,sales_target,local_item_sales_target,new_buying_customers_target,existing_customers_buying_target,is_approved,updated_at",
  "id,salesman_code,target_month,sales_target,new_buying_customers_target,existing_customers_buying_target,is_approved,updated_at",
];

const PERFORMANCE_KPI_CACHE_VERSION = 2;
const PERFORMANCE_KPI_CACHE_KEY_PREFIX = "performance_kpi_actuals_v2:";

function isMissingColumnError(error) {
  return isMissingSchemaColumn(error);
}

function isMissingTableError(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42P01"
    || message.includes("could not find the table")
    || (message.includes("relation") && message.includes("does not exist"));
}

function chunkList(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function fetchPagedRows(admin, table, select, applyFilters) {
  const pageSize = 1000;
  const rows = [];
  let from = 0;

  while (true) {
    let query = admin.from(table).select(select).range(from, from + pageSize - 1);
    query = applyFilters(query);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

export function monthWindow(reportDate) {
  const range = currentMonthDateRange(reportDate);
  const start = ksaDayBounds(range.from);
  const end = ksaDayBounds(range.to);
  return {
    from: range.from,
    to: range.to,
    startIso: start.startIso,
    endIso: end.endIso,
  };
}

export async function loadSalesActuals(admin, { salesmanCode, reportDate }) {
  const code = normalizeSalesmanCode(salesmanCode);
  if (!code) {
    return { officeSupplies: 0, localItemSales: 0, otherSales: 0, monthCustomerCodes: [], priorCustomerCodes: [], salesRows: [] };
  }

  const { from, to } = monthWindow(reportDate);
  let monthRows;
  try {
    monthRows = await fetchPagedRows(
      admin,
      "active_sales",
      "transaction_date,customer_code,customer_name,sales_amount,category,item_name,local_import,voucher_type,voucher_number,reference,quantity",
      (query) => query
        .in("salesman_code", reportSalesmanCodeAliases(code))
        .gte("transaction_date", from)
        .lte("transaction_date", to),
    );
  } catch (error) {
    if (!isMissingColumnError(error)) throw error;
    monthRows = await fetchPagedRows(
      admin,
      "active_sales",
      "transaction_date,customer_code,customer_name,sales_amount,voucher_type,voucher_number,reference,quantity",
      (query) => query
        .in("salesman_code", reportSalesmanCodeAliases(code))
        .gte("transaction_date", from)
        .lte("transaction_date", to),
    );
  }

  const monthCustomerCodes = buyingCustomerCodesFromSales(monthRows);
  const uniqueMonthCodes = [...new Set(monthCustomerCodes)];
  const priorCustomerCodes = [];

  for (const chunk of chunkList(uniqueMonthCodes, 200)) {
    if (!chunk.length) continue;
    const priorRows = await fetchPagedRows(
      admin,
      "active_sales",
      "customer_code,sales_amount,voucher_type,voucher_number,reference,quantity",
      (query) => query
        .in("customer_code", chunk)
        .lt("transaction_date", from),
    );
    priorCustomerCodes.push(...buyingCustomerCodesFromSales(priorRows));
  }

  const split = splitSalesActuals(monthRows);
  return {
    officeSupplies: split.officeSupplies,
    localItemSales: split.localItemSales,
    otherSales: split.otherSales,
    monthCustomerCodes,
    priorCustomerCodes,
    salesRows: monthRows,
  };
}

function shiftMonthStart(iso, monthDelta) {
  const date = String(iso || "").slice(0, 10);
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const shifted = new Date(Date.UTC(year, month - 1 + monthDelta, 1));
  return shifted.toISOString().slice(0, 10);
}

export async function loadSalesPaceShares(admin, { reportDate } = {}) {
  const monthStart = monthWindow(reportDate).from;
  const historyStart = shiftMonthStart(monthStart, -6);
  const historyLastDay = monthWindow(shiftMonthStart(monthStart, -1)).to;

  if (!(historyStart < monthStart)) {
    return { company: null, bySalesman: new Map() };
  }

  let rows = [];
  try {
    rows = await fetchPagedRows(
      admin,
      "active_sales",
      "salesman_code,transaction_date,sales_amount",
      (query) => query
        .gte("transaction_date", historyStart)
        .lte("transaction_date", historyLastDay),
    );
  } catch (error) {
    if (!isMissingColumnError(error) && !isMissingTableError(error)) throw error;
    return { company: null, bySalesman: new Map() };
  }

  const bySalesman = new Map();
  const grouped = new Map();
  (rows || []).forEach((row) => {
    const code = normalizeReportSalesmanCode(row.salesman_code);
    if (!code) return;
    const list = grouped.get(code) || [];
    list.push(row);
    grouped.set(code, list);
  });
  grouped.forEach((list, code) => {
    const curve = averageCumulativeDayShares(list);
    if (curve.monthCount >= 1) bySalesman.set(code, curve.shares);
  });

  return {
    company: null,
    bySalesman,
  };
}

export function paceSharesForSalesman(pace, salesmanCode) {
  return pickSalesmanPaceShares(pace, salesmanCode);
}

export async function loadCollectionActual(admin, { salesmanCode, reportDate, includeDetails = false }) {
  const code = normalizeSalesmanCode(salesmanCode);
  if (!code) return { collection: 0, cashCollection: 0 };

  const { from, to, endIso } = monthWindow(reportDate);
  const customers = await fetchPagedRows(
    admin,
    "customers",
    "customer_code",
    (query) => query.eq("current_salesman_code", code),
  );
  const customerCodes = [...new Set(
    (customers || []).map((row) => normalizeSalesmanCode(row.customer_code)).filter(Boolean),
  )];
  if (!customerCodes.length) {
    return { collection: 0, cashCollection: 0, ...(includeDetails ? { salesRows: [], collectionVisits: [] } : {}) };
  }

  const visits = [];
  for (const chunk of chunkList(customerCodes, 200)) {
    const rows = await fetchPagedRows(
      admin,
      "collection_visits",
      "id,amount_received,customer_code,saved_at",
      (query) => query
        .in("customer_code", chunk)
        .lte("saved_at", endIso),
    );
    visits.push(...rows);
  }

  const salesByCustomer = new Map();
  for (const chunk of chunkList(customerCodes, 200)) {
    const rows = await fetchPagedRows(
      admin,
      "active_sales",
      "transaction_date,voucher_number,voucher_type,reference,customer_code,sales_amount,item_code,item_name,category,quantity,rate",
      (query) => query
        .in("customer_code", chunk)
        .lte("transaction_date", to),
    );
    rows.forEach((row) => {
      const customerCode = normalizeSalesmanCode(row.customer_code);
      const customerRows = salesByCustomer.get(customerCode) || [];
      customerRows.push(row);
      salesByCustomer.set(customerCode, customerRows);
    });
  }

  const visitsByCustomer = new Map();
  visits.forEach((visit) => {
    const customerCode = normalizeSalesmanCode(visit.customer_code);
    const customerVisits = visitsByCustomer.get(customerCode) || [];
    customerVisits.push(visit);
    visitsByCustomer.set(customerCode, customerVisits);
  });

  const totals = customerCodes.reduce((result, customerCode) => {
    const split = splitCollectionActualsByInvoice(
      salesByCustomer.get(customerCode) || [],
      visitsByCustomer.get(customerCode) || [],
      { fromDate: from, toDate: to },
    );
    result.collection += split.collection;
    result.cashCollection += split.cashCollection;
    return result;
  }, { collection: 0, cashCollection: 0 });
  return {
    ...totals,
    ...(includeDetails ? {
      salesRows: [...salesByCustomer.values()].flat(),
      collectionVisits: visits,
    } : {}),
  };
}

export async function loadKpiTargetsBySalesman(admin, { salesmanCodes, reportDate }) {
  const codes = [...new Set((salesmanCodes || []).map(normalizeSalesmanCode).filter(Boolean))];
  const empty = new Map();
  if (!codes.length) return empty;

  const targetMonth = monthWindow(reportDate).from;
  let result = { data: [], error: null };

  for (const select of TARGET_SELECTS) {
    result = await admin
      .from("kpi_targets")
      .select(select)
      .eq("target_month", targetMonth)
      .in("salesman_code", codes);

    if (!result.error) break;
    if (isMissingTableError(result.error)) return empty;
    if (!isMissingColumnError(result.error)) throw result.error;
  }

  if (result.error) throw result.error;

  const updaterIds = [...new Set(
    (result.data || []).map((row) => String(row.updated_by || "").trim()).filter(Boolean),
  )];
  const updaterNames = new Map();
  if (updaterIds.length) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id,salesman_name")
      .in("id", updaterIds);
    (profiles || []).forEach((profile) => {
      updaterNames.set(profile.id, String(profile.salesman_name || "").trim());
    });
  }

  const byCode = new Map();
  (result.data || []).forEach((row) => {
    const code = normalizeSalesmanCode(row.salesman_code);
    if (!code) return;
    byCode.set(code, {
      targets: normalizePerformanceTargets(row),
      updatedAt: row.updated_at || null,
      updatedByName: updaterNames.get(String(row.updated_by || "").trim()) || "",
    });
  });
  return byCode;
}

export async function loadPerformanceSnapshot(admin, {
  salesmanCode,
  salesmanName = "",
  reportDate,
  targetRow = null,
  todayIso = getKsaDateString(),
  paceShares = null,
} = {}) {
  const code = normalizeSalesmanCode(salesmanCode);
  const [salesActuals, collectionActuals, loadedPace] = await Promise.all([
    loadSalesActuals(admin, { salesmanCode: code, reportDate }),
    loadCollectionActual(admin, { salesmanCode: code, reportDate }),
    paceShares ? Promise.resolve(null) : loadSalesPaceShares(admin, { reportDate }),
  ]);
  const classified = classifyBuyingCustomers(
    salesActuals.monthCustomerCodes,
    salesActuals.priorCustomerCodes,
  );
  const actuals = {
    ...emptyPerformanceActuals(),
    officeSupplies: salesActuals.officeSupplies,
    localItemSales: salesActuals.localItemSales,
    otherSales: salesActuals.otherSales,
    collection: collectionActuals.collection,
    cashCollection: collectionActuals.cashCollection,
    newCustomers: classified.newCustomers,
    repeatCustomers: classified.repeatCustomers,
  };

  let resolvedTarget = targetRow;
  if (!resolvedTarget && code) {
    const targets = await loadKpiTargetsBySalesman(admin, { salesmanCodes: [code], reportDate });
    resolvedTarget = targets.get(code) || null;
  }

  const resolvedPace = paceShares || loadedPace;
  return buildPerformanceSnapshot({
    reportDate,
    salesmanCode: code,
    salesmanName,
    actuals,
    targets: resolvedTarget?.targets || emptyPerformanceTargets(),
    updatedAt: resolvedTarget?.updatedAt || null,
    updatedByName: resolvedTarget?.updatedByName || "",
    todayIso,
    paceShares: paceSharesForSalesman(resolvedPace, code),
  });
}

function performanceKpiCacheKey(reportDate) {
  return `${PERFORMANCE_KPI_CACHE_KEY_PREFIX}${monthWindow(reportDate).from}`;
}

async function activeSalesBatchId(admin) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", "active_sales_batch_id")
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error) || isMissingColumnError(error)) return "";
    throw error;
  }
  return String(data?.setting_value || "").trim();
}

async function readPerformanceKpiCache(admin, reportDate, batchId) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", performanceKpiCacheKey(reportDate))
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error) || isMissingColumnError(error)) return null;
    throw error;
  }
  if (!data?.setting_value) return null;
  try {
    const cache = JSON.parse(String(data.setting_value));
    if (
      cache?.version !== PERFORMANCE_KPI_CACHE_VERSION
      || String(cache.batchId || "") !== batchId
      || !cache.actualsBySalesman
      || typeof cache.actualsBySalesman !== "object"
    ) return null;
    return cache;
  } catch {
    return null;
  }
}

async function writePerformanceKpiCache(admin, reportDate, cache) {
  const { error } = await admin.from("system_settings").upsert({
    setting_key: performanceKpiCacheKey(reportDate),
    setting_value: JSON.stringify(cache),
  }, { onConflict: "setting_key" });
  if (error && !isMissingTableError(error) && !isMissingColumnError(error)) throw error;
}

function cacheActualsForSalesman(salesActuals, collectionActuals) {
  const classified = classifyBuyingCustomers(
    salesActuals.monthCustomerCodes,
    salesActuals.priorCustomerCodes,
  );
  return {
    ...emptyPerformanceActuals(),
    officeSupplies: salesActuals.officeSupplies,
    localItemSales: salesActuals.localItemSales,
    otherSales: salesActuals.otherSales,
    collection: collectionActuals.collection,
    cashCollection: collectionActuals.cashCollection,
    newCustomers: classified.newCustomers,
    repeatCustomers: classified.repeatCustomers,
  };
}

async function buildPerformanceKpiSourceCache(admin, { salesmen, reportDate, batchId }) {
  const pace = await loadSalesPaceShares(admin, { reportDate });
  const entries = await Promise.all((salesmen || []).map(async (salesman) => {
    const code = normalizeSalesmanCode(salesman.salesmanCode || salesman.salesman_code);
    if (!code) return null;
    const [salesActuals, collectionActuals] = await Promise.all([
      loadSalesActuals(admin, { salesmanCode: code, reportDate }),
      loadCollectionActual(admin, { salesmanCode: code, reportDate }),
    ]);
    return [code, cacheActualsForSalesman(salesActuals, collectionActuals)];
  }));
  return {
    version: PERFORMANCE_KPI_CACHE_VERSION,
    reportMonth: monthWindow(reportDate).from,
    batchId,
    builtAt: new Date().toISOString(),
    actualsBySalesman: Object.fromEntries(entries.filter(Boolean)),
    paceBySalesman: Object.fromEntries([...pace.bySalesman.entries()]),
  };
}

export async function rebuildPerformanceKpiCache(admin, {
  salesmen = null,
  reportDate = getKsaDateString(),
} = {}) {
  let roster = salesmen;
  if (!roster) {
    const { data, error } = await admin
      .from("profiles")
      .select("salesman_code,salesman_name,role,is_active");
    if (error) throw error;
    roster = (data || []).filter(isKpiTargetProfile).map((profile) => ({
      salesmanCode: normalizeSalesmanCode(profile.salesman_code),
      salesmanName: String(profile.salesman_name || "").trim(),
    }));
  }
  const batchId = await activeSalesBatchId(admin);
  const cache = await buildPerformanceKpiSourceCache(admin, { salesmen: roster, reportDate, batchId });
  await writePerformanceKpiCache(admin, reportDate, cache);
  return cache;
}

export async function loadPerformanceKpiActualDetails(admin, { salesmanCode, reportDate, kpiKey }) {
  const code = normalizeSalesmanCode(salesmanCode);
  if (!code) return { rows: [], actual: 0 };
  const { from, to } = monthWindow(reportDate);
  if (["collection", "cashCollection"].includes(kpiKey)) {
    const collectionData = await loadCollectionActual(admin, { salesmanCode: code, reportDate, includeDetails: true });
    return buildKpiActualDetails({
      kpiKey,
      salesmanCode: code,
      collectionVisits: collectionData.collectionVisits,
      collectionSalesRows: collectionData.salesRows,
      fromDate: from,
      toDate: to,
    });
  }
  const salesData = await loadSalesActuals(admin, { salesmanCode: code, reportDate });
  return buildKpiActualDetails({
    kpiKey,
    salesmanCode: code,
    salesRows: salesData.salesRows,
    priorCustomerCodes: salesData.priorCustomerCodes,
  });
}

export async function loadPerformanceSnapshotsForSalesmen(admin, {
  salesmen = [],
  reportDate,
} = {}) {
  const codes = [...new Set(
    (salesmen || []).map((row) => normalizeSalesmanCode(row.salesmanCode || row.salesman_code)).filter(Boolean),
  )];
  const todayIso = getKsaDateString();
  const [targetsByCode, batchId] = await Promise.all([
    loadKpiTargetsBySalesman(admin, { salesmanCodes: codes, reportDate }),
    activeSalesBatchId(admin),
  ]);
  let sourceCache = await readPerformanceKpiCache(admin, reportDate, batchId);
  const missingSalesmen = !sourceCache
    ? salesmen
    : salesmen.filter((salesman) => {
      const code = normalizeSalesmanCode(salesman.salesmanCode || salesman.salesman_code);
      return code && !Object.prototype.hasOwnProperty.call(sourceCache.actualsBySalesman, code);
    });
  if (missingSalesmen.length) {
    const refreshed = await buildPerformanceKpiSourceCache(admin, {
      salesmen: missingSalesmen,
      reportDate,
      batchId,
    });
    sourceCache = {
      ...refreshed,
      actualsBySalesman: {
        ...(sourceCache?.actualsBySalesman || {}),
        ...refreshed.actualsBySalesman,
      },
      paceBySalesman: {
        ...(sourceCache?.paceBySalesman || {}),
        ...refreshed.paceBySalesman,
      },
    };
    await writePerformanceKpiCache(admin, reportDate, sourceCache);
  }

  return Promise.all((salesmen || []).map((salesman) => {
    const code = normalizeSalesmanCode(salesman.salesmanCode || salesman.salesman_code);
    const actuals = sourceCache.actualsBySalesman?.[code];
    const pace = { bySalesman: sourceCache.paceBySalesman || {} };
    return buildPerformanceSnapshot({
      salesmanCode: code,
      salesmanName: salesman.salesmanName || salesman.salesman_name || "",
      reportDate,
      actuals: actuals || emptyPerformanceActuals(),
      targets: targetsByCode.get(code)?.targets || emptyPerformanceTargets(),
      updatedAt: targetsByCode.get(code)?.updatedAt || null,
      updatedByName: targetsByCode.get(code)?.updatedByName || "",
      todayIso,
      paceShares: paceSharesForSalesman(pace, code),
    });
  }));
}
