import { loadReceiptRowsByCustomer } from "./collectionAvgDays.js";
import { customerAccountCodesMatch, resolveCustomerAccountCode, toNumber } from "./outstanding.js";
import { salesBiCubeFacts } from "./salesBiCube.js";
import { loadSalesBiCube } from "./salesBiCubeServer.js";
import {
  normalizeReportSalesmanCode,
  normalizeReportSalesmanName,
  reportSalesmanCodeAliases,
} from "./salesmanReportIdentity.js";
import {
  buildMonthlyNetSalesBySalesman,
  buildSalesmanIncentiveReport,
  incentiveMonthRange,
  parseIncentiveMonth,
  shiftIncentiveMonth,
} from "./salesmanIncentive.js";

const SALES_SELECT = [
  "transaction_date",
  "voucher_number",
  "voucher_type",
  "reference",
  "customer_code",
  "customer_name",
  "salesman_code",
  "salesman_name",
  "sales_amount",
  "item_code",
  "item_name",
  "category",
  "quantity",
].join(",");

const PAGE_SIZE = 1000;
const CODE_CHUNK = 60;

function canonicalCode(value) {
  return resolveCustomerAccountCode(value);
}

function lookupByCustomerCode(map, customerCode) {
  const key = canonicalCode(customerCode);
  if (!key) return [];
  if (map.has(key)) return map.get(key) || [];
  for (const [candidate, rows] of map.entries()) {
    if (customerAccountCodesMatch(candidate, key)) return rows || [];
  }
  return [];
}

async function pageThrough(buildQuery) {
  const all = [];
  let from = 0;
  while (true) {
    const { data, error } = await buildQuery()
      .order("transaction_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = Array.isArray(data) ? data : [];
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

/** Customer codes billed by the requested salesmen, across the whole ledger. */
async function loadCustomerCodesForSalesmen(admin, salesmanCodes) {
  const rows = await pageThrough(() => admin
    .from("active_sales")
    .select("transaction_date,customer_code")
    .in("salesman_code", salesmanCodes.flatMap(reportSalesmanCodeAliases)));
  return [...new Set(rows.map((row) => String(row.customer_code || "").trim()).filter(Boolean))];
}

async function loadSalesRows(admin, { customerCodes = null } = {}) {
  if (!customerCodes) {
    return pageThrough(() => admin
      .from("active_sales")
      .select(SALES_SELECT));
  }

  const rows = [];
  for (let index = 0; index < customerCodes.length; index += CODE_CHUNK) {
    const chunk = customerCodes.slice(index, index + CODE_CHUNK);
    // eslint-disable-next-line no-await-in-loop
    const page = await pageThrough(() => admin
      .from("active_sales")
      .select(SALES_SELECT)
      .in("customer_code", chunk));
    rows.push(...page);
  }
  return rows;
}

/**
 * Historical `salesman -> month -> net sales` from the BI cube, with the
 * selected report month refreshed from active_sales so it matches KPI actuals.
 */
export async function loadMonthlyNetSalesBySalesman(admin, { month, salesmanCodes = [] } = {}) {
  const byCode = new Map();
  try {
    const cube = await loadSalesBiCube(admin, { allowStale: true });
    salesBiCubeFacts(cube).forEach((fact) => {
      const code = normalizeReportSalesmanCode(fact?.salesman_code);
      const month = String(fact?.month || "").slice(0, 7);
      if (!code || !/^\d{4}-\d{2}$/.test(month)) return;
      const byMonth = byCode.get(code) || new Map();
      byMonth.set(month, toNumber(byMonth.get(month)) + toNumber(fact?.sales_amount));
      byCode.set(code, byMonth);
    });
  } catch (error) {
    console.error("Unable to load sales BI cube for incentive growth:", error);
  }

  if (!month) return byCode;

  const monthKey = parseIncentiveMonth(month);
  const range = incentiveMonthRange(monthKey);
  const requested = [...new Set((salesmanCodes || [])
    .map((code) => normalizeReportSalesmanCode(code))
    .filter(Boolean))];
  const rows = await pageThrough(() => {
    let query = admin.from("active_sales")
      .select(SALES_SELECT)
      .gte("transaction_date", range.from)
      .lte("transaction_date", range.to);
    if (requested.length) {
      query = query.in("salesman_code", requested.flatMap(reportSalesmanCodeAliases));
    }
    return query;
  });

  const scopedCodes = new Set(requested);
  byCode.forEach((byMonth, code) => {
    if (!scopedCodes.size || scopedCodes.has(normalizeReportSalesmanCode(code))) {
      byMonth.delete(monthKey);
    }
  });
  buildMonthlyNetSalesBySalesman(rows, byCode);
  return byCode;
}

/**
 * Build the salesman incentive report straight from Supabase.
 * Sales and receipts both load the full ledger from day 1, so a receipt in the
 * report month settles its real invoice no matter how old the bill is.
 */
export async function buildSalesmanIncentiveReportFromDb(admin, {
  month,
  salesmanCodes = [],
} = {}) {
  const monthKey = parseIncentiveMonth(month);
  const requested = [...new Set((salesmanCodes || []).map((code) => normalizeReportSalesmanCode(code)).filter(Boolean))];

  const customerCodes = requested.length
    ? await loadCustomerCodesForSalesmen(admin, requested)
    : null;

  const [salesRows, receiptsByCustomer, monthlySalesBySalesman] = await Promise.all([
    loadSalesRows(admin, { customerCodes }),
    loadReceiptRowsByCustomer(admin),
    loadMonthlyNetSalesBySalesman(admin, { month: monthKey, salesmanCodes: requested }),
  ]);

  const salesByCustomer = new Map();
  const customerNames = new Map();
  salesRows.forEach((row) => {
    const key = canonicalCode(row.customer_code);
    if (!key) return;
    const list = salesByCustomer.get(key) || [];
    list.push(row);
    salesByCustomer.set(key, list);
    const name = String(row.customer_name || "").trim();
    if (name && !customerNames.has(key)) customerNames.set(key, name);
  });

  const customers = [...salesByCustomer.entries()].map(([key, transactions]) => ({
    customerCode: key,
    customerName: customerNames.get(key) || "",
    transactions,
    receipts: lookupByCustomerCode(receiptsByCustomer, key),
  }));

  const report = buildSalesmanIncentiveReport({
    month: monthKey,
    customers,
    salesmanCodes: requested.length ? requested : null,
    monthlySalesBySalesman,
  });

  const range = incentiveMonthRange(monthKey);
  return {
    ...report,
    monthStart: range.from,
    monthEnd: range.to,
    customerCount: customers.length,
  };
}

/** Salesman codes + names billing in the report month or the month before it. */
export async function listIncentiveSalesmen(admin, { month } = {}) {
  const monthKey = parseIncentiveMonth(month);
  const previous = incentiveMonthRange(shiftIncentiveMonth(monthKey, -1));
  const current = incentiveMonthRange(monthKey);
  const rows = await pageThrough(() => admin
    .from("active_sales")
    .select("transaction_date,salesman_code,salesman_name")
    .gte("transaction_date", previous.from)
    .lte("transaction_date", current.to));

  const names = new Map();
  rows.forEach((row) => {
    const code = normalizeReportSalesmanCode(row.salesman_code);
    if (!code) return;
    const name = normalizeReportSalesmanName(row.salesman_name)
      || normalizeReportSalesmanName(row.salesman_code);
    if (!names.has(code) || (!names.get(code) && name)) names.set(code, name);
  });

  return [...names.entries()]
    .map(([code, name]) => ({ salesman_code: code, salesman_name: name }))
    .sort((left, right) => left.salesman_code.localeCompare(right.salesman_code));
}
