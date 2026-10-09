import { loadReceiptRowsByCustomer } from "./collectionAvgDays.js";
import { customerAccountCodesMatch, resolveCustomerAccountCode } from "./outstanding.js";
import { normalizeSalesmanCode } from "./performanceKpis.js";
import {
  normalizeReportSalesmanCode,
  normalizeReportSalesmanName,
  reportSalesmanCodeAliases,
} from "./salesmanReportIdentity.js";
import {
  buildSalesmanIncentiveReport,
  incentiveHistoryStartDate,
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

/** Customer codes billed by the requested salesmen inside the loaded history window. */
async function loadCustomerCodesForSalesmen(admin, salesmanCodes, historyStart) {
  const rows = await pageThrough(() => admin
    .from("active_sales")
    .select("transaction_date,customer_code")
    .gte("transaction_date", historyStart)
    .in("salesman_code", salesmanCodes.flatMap(reportSalesmanCodeAliases)));
  return [...new Set(rows.map((row) => String(row.customer_code || "").trim()).filter(Boolean))];
}

async function loadSalesRows(admin, { historyStart, customerCodes = null }) {
  if (!customerCodes) {
    return pageThrough(() => admin
      .from("active_sales")
      .select(SALES_SELECT)
      .gte("transaction_date", historyStart));
  }

  const rows = [];
  for (let index = 0; index < customerCodes.length; index += CODE_CHUNK) {
    const chunk = customerCodes.slice(index, index + CODE_CHUNK);
    // eslint-disable-next-line no-await-in-loop
    const page = await pageThrough(() => admin
      .from("active_sales")
      .select(SALES_SELECT)
      .gte("transaction_date", historyStart)
      .in("customer_code", chunk));
    rows.push(...page);
  }
  return rows;
}

/**
 * Build the salesman incentive report straight from Supabase.
 * Sales and receipts are truncated at the same history start so FIFO settlement
 * is not distorted by invoices whose matching receipts were cut off.
 */
export async function buildSalesmanIncentiveReportFromDb(admin, {
  month,
  salesmanCodes = [],
  historyMonths,
} = {}) {
  const monthKey = parseIncentiveMonth(month);
  const historyStart = incentiveHistoryStartDate(monthKey, historyMonths);
  const requested = [...new Set((salesmanCodes || []).map((code) => normalizeSalesmanCode(code)).filter(Boolean))];

  const customerCodes = requested.length
    ? await loadCustomerCodesForSalesmen(admin, requested, historyStart)
    : null;

  const previousRange = incentiveMonthRange(shiftIncentiveMonth(monthKey, -1));
  const range = incentiveMonthRange(monthKey);
  const [salesRows, receiptsByCustomer, salesTransactions] = await Promise.all([
    loadSalesRows(admin, { historyStart, customerCodes }),
    loadReceiptRowsByCustomer(admin),
    pageThrough(() => {
      let query = admin.from("active_sales")
        .select(SALES_SELECT)
        .gte("transaction_date", previousRange.from)
        .lte("transaction_date", range.to);
      if (requested.length) query = query.in("salesman_code", requested.flatMap(reportSalesmanCodeAliases));
      return query;
    }),
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
    receipts: lookupByCustomerCode(receiptsByCustomer, key)
      .filter((receipt) => String(receipt?.receipt_date || "") >= historyStart),
  }));

  const report = buildSalesmanIncentiveReport({
    month: monthKey,
    customers,
    salesmanCodes: requested.length ? requested : null,
    salesTransactions,
  });

  return {
    ...report,
    historyStart,
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
    const name = normalizeReportSalesmanName(row.salesman_name);
    if (!names.has(code) || (!names.get(code) && name)) names.set(code, name);
  });

  return [...names.entries()]
    .map(([code, name]) => ({ salesman_code: code, salesman_name: name }))
    .sort((left, right) => left.salesman_code.localeCompare(right.salesman_code));
}
