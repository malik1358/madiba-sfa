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
  splitSalesActuals,
  sumCollectionAmount,
} from "./performanceKpis.js";
import { ksaDayBounds } from "./workdayActivity.js";

const TARGET_SELECTS = [
  "id,salesman_code,target_month,sales_target,office_supplies_sales_target,other_sales_target,collection_target,new_buying_customers_target,existing_customers_buying_target,is_approved,updated_at,updated_by",
  "id,salesman_code,target_month,sales_target,office_supplies_sales_target,other_sales_target,new_buying_customers_target,existing_customers_buying_target,is_approved,updated_at",
  "id,salesman_code,target_month,sales_target,new_buying_customers_target,existing_customers_buying_target,is_approved,updated_at",
];

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
    return { officeSupplies: 0, otherSales: 0, monthCustomerCodes: [], priorCustomerCodes: [] };
  }

  const { from, to } = monthWindow(reportDate);
  let monthRows;
  try {
    monthRows = await fetchPagedRows(
      admin,
      "active_sales",
      "customer_code,sales_amount,category,item_name",
      (query) => query
        .eq("salesman_code", code)
        .gte("transaction_date", from)
        .lte("transaction_date", to),
    );
  } catch (error) {
    if (!isMissingColumnError(error)) throw error;
    monthRows = await fetchPagedRows(
      admin,
      "active_sales",
      "customer_code,sales_amount",
      (query) => query
        .eq("salesman_code", code)
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
      "customer_code",
      (query) => query
        .in("customer_code", chunk)
        .lt("transaction_date", from),
    );
    priorRows.forEach((row) => {
      const customerCode = normalizeSalesmanCode(row.customer_code);
      if (customerCode) priorCustomerCodes.push(customerCode);
    });
  }

  const split = splitSalesActuals(monthRows);
  return {
    officeSupplies: split.officeSupplies,
    otherSales: split.otherSales,
    monthCustomerCodes,
    priorCustomerCodes,
  };
}

export async function loadCollectionActual(admin, { salesmanCode, reportDate }) {
  const code = normalizeSalesmanCode(salesmanCode);
  if (!code) return 0;

  const { startIso, endIso } = monthWindow(reportDate);
  const customers = await fetchPagedRows(
    admin,
    "customers",
    "customer_code",
    (query) => query.eq("current_salesman_code", code),
  );
  const customerCodes = [...new Set(
    (customers || []).map((row) => normalizeSalesmanCode(row.customer_code)).filter(Boolean),
  )];
  if (!customerCodes.length) return 0;

  const visits = [];
  for (const chunk of chunkList(customerCodes, 200)) {
    const rows = await fetchPagedRows(
      admin,
      "collection_visits",
      "amount_received,customer_code",
      (query) => query
        .in("customer_code", chunk)
        .gte("saved_at", startIso)
        .lte("saved_at", endIso),
    );
    visits.push(...rows);
  }

  return sumCollectionAmount(visits);
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
} = {}) {
  const code = normalizeSalesmanCode(salesmanCode);
  const [salesActuals, collection] = await Promise.all([
    loadSalesActuals(admin, { salesmanCode: code, reportDate }),
    loadCollectionActual(admin, { salesmanCode: code, reportDate }),
  ]);
  const classified = classifyBuyingCustomers(
    salesActuals.monthCustomerCodes,
    salesActuals.priorCustomerCodes,
  );
  const actuals = {
    ...emptyPerformanceActuals(),
    officeSupplies: salesActuals.officeSupplies,
    otherSales: salesActuals.otherSales,
    collection,
    newCustomers: classified.newCustomers,
    repeatCustomers: classified.repeatCustomers,
  };

  let resolvedTarget = targetRow;
  if (!resolvedTarget && code) {
    const targets = await loadKpiTargetsBySalesman(admin, { salesmanCodes: [code], reportDate });
    resolvedTarget = targets.get(code) || null;
  }

  return buildPerformanceSnapshot({
    reportDate,
    salesmanCode: code,
    salesmanName,
    actuals,
    targets: resolvedTarget?.targets || emptyPerformanceTargets(),
    updatedAt: resolvedTarget?.updatedAt || null,
    updatedByName: resolvedTarget?.updatedByName || "",
  });
}

export async function loadPerformanceSnapshotsForSalesmen(admin, {
  salesmen = [],
  reportDate,
} = {}) {
  const codes = [...new Set(
    (salesmen || []).map((row) => normalizeSalesmanCode(row.salesmanCode || row.salesman_code)).filter(Boolean),
  )];
  const targetsByCode = await loadKpiTargetsBySalesman(admin, { salesmanCodes: codes, reportDate });
  return Promise.all((salesmen || []).map((salesman) => {
    const code = normalizeSalesmanCode(salesman.salesmanCode || salesman.salesman_code);
    return loadPerformanceSnapshot(admin, {
      salesmanCode: code,
      salesmanName: salesman.salesmanName || salesman.salesman_name || "",
      reportDate,
      targetRow: targetsByCode.get(code) || null,
    });
  }));
}
