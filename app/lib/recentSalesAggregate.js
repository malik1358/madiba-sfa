import { customerCodeCandidates, laterDateOnly } from "./outstanding.js";
import { mergeSalesSnapshots } from "./salesHistory.js";
import { monthKeyFromDate, summarizeMonthlySales } from "../management/my-day/visitPriority.js";
import { isMissingRpcError } from "./salesmanIdentityMatch.js";

const CODE_CHUNK = 200;
const PAGE_SIZE = 1000;

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function createRecentSalesMaps(customers) {
  const canonicalCodeByCandidate = new Map();
  (customers || []).forEach((customer) => {
    const canonicalCode = normalizeCode(customer.customer_code);
    customerCodeCandidates(customer.customer_code).forEach((candidate) => {
      canonicalCodeByCandidate.set(normalizeCode(candidate), canonicalCode);
    });
  });
  return {
    canonicalCodeByCandidate,
    salesValueByCustomer: new Map(),
    sales30dByCustomer: new Map(),
    monthlySalesByCustomer: new Map(),
    latestSalesDateByCustomer: new Map(),
  };
}

function canonicalCodeForRow(customerCode, maps) {
  return customerCodeCandidates(customerCode)
    .map((candidate) => maps.canonicalCodeByCandidate.get(normalizeCode(candidate)))
    .find(Boolean) || "";
}

function addAmount(map, code, amount) {
  map.set(code, (map.get(code) || 0) + amount);
}

function absorbMergedRow(row, maps, from30Iso) {
  const canonicalCode = canonicalCodeForRow(row.customer_code, maps);
  if (!canonicalCode) return;
  const amount = Math.max(Number(row.sales_amount || 0), 0);
  addAmount(maps.salesValueByCustomer, canonicalCode, amount);
  const saleDate = laterDateOnly(row.transaction_date);
  if (saleDate && saleDate >= from30Iso) {
    addAmount(maps.sales30dByCustomer, canonicalCode, amount);
  }
  const monthKey = monthKeyFromDate(row.transaction_date);
  if (monthKey && amount > 0) {
    const months = maps.monthlySalesByCustomer.get(canonicalCode) || new Map();
    months.set(monthKey, (months.get(monthKey) || 0) + amount);
    maps.monthlySalesByCustomer.set(canonicalCode, months);
  }
  const currentDate = maps.latestSalesDateByCustomer.get(canonicalCode) || "";
  if (saleDate && saleDate > currentDate) {
    maps.latestSalesDateByCustomer.set(canonicalCode, saleDate);
  }
}

export function absorbRecentSalesTotalRows(rows, maps) {
  (rows || []).forEach((row) => {
    const canonicalCode = canonicalCodeForRow(row.customer_code, maps);
    if (!canonicalCode) return;
    addAmount(maps.salesValueByCustomer, canonicalCode, Math.max(Number(row.recent_sales_value || 0), 0));
    addAmount(maps.sales30dByCustomer, canonicalCode, Math.max(Number(row.recent_30d_sales_value || 0), 0));
    const saleDate = laterDateOnly(row.latest_transaction_date);
    const currentDate = maps.latestSalesDateByCustomer.get(canonicalCode) || "";
    if (saleDate && saleDate > currentDate) {
      maps.latestSalesDateByCustomer.set(canonicalCode, saleDate);
    }
    const months = row.positive_sales_by_month && typeof row.positive_sales_by_month === "object"
      ? row.positive_sales_by_month
      : {};
    const monthMap = maps.monthlySalesByCustomer.get(canonicalCode) || new Map();
    Object.entries(months).forEach(([monthKey, value]) => {
      const amount = Math.max(Number(value || 0), 0);
      if (!monthKey || amount <= 0) return;
      monthMap.set(monthKey, (monthMap.get(monthKey) || 0) + amount);
    });
    maps.monthlySalesByCustomer.set(canonicalCode, monthMap);
  });
}

export function projectRecentSalesCustomers(customers, maps) {
  return (customers || []).map((customer) => {
    const code = normalizeCode(customer.customer_code);
    const latestSalesDate = maps.latestSalesDateByCustomer.get(code) || "";
    const monthlyStats = summarizeMonthlySales(maps.monthlySalesByCustomer.get(code) || new Map());
    return {
      ...customer,
      recent_sales_value: maps.salesValueByCustomer.get(code) || 0,
      recent_30d_sales_value: maps.sales30dByCustomer.get(code) || 0,
      average_monthly_purchase: monthlyStats.averageMonthlyPurchase,
      highest_monthly_sales: monthlyStats.highestMonthlySales,
      operational_months: monthlyStats.operationalMonths,
      latest_transaction_date: laterDateOnly(customer.latest_transaction_date, latestSalesDate)
        || customer.latest_transaction_date,
    };
  });
}

/** Line-level path used before recent_sales_customer_totals exists, and by the regression fixture. */
export function summarizeCustomersFromSalesRows(customers, salesRows, { fromDate, from30Iso }) {
  const maps = createRecentSalesMaps(customers);
  const windowRows = (salesRows || []).filter((row) => {
    const date = laterDateOnly(row?.transaction_date);
    return date && date >= fromDate;
  });
  mergeSalesSnapshots(windowRows).forEach((row) => absorbMergedRow(row, maps, from30Iso));
  return projectRecentSalesCustomers(customers, maps);
}

async function readSalesChunk(admin, codeChunk, fromDate) {
  const pageSize = PAGE_SIZE;
  let from = 0;
  const salesRows = [];
  while (true) {
    const { data, error } = await admin
      .from("sales_raw")
      .select("id,import_batch_id,transaction_date,voucher_number,reference,customer_code,item_code,quantity,sales_amount,rate")
      .gte("transaction_date", fromDate)
      .in("customer_code", codeChunk)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    salesRows.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return salesRows;
}

export async function attachRecentSalesValues(admin, customers) {
  const maps = createRecentSalesMaps(customers);
  const candidateCodes = [...maps.canonicalCodeByCandidate.keys()];
  const fromDateValue = new Date();
  fromDateValue.setUTCMonth(fromDateValue.getUTCMonth() - 6);
  const from30Date = new Date();
  from30Date.setUTCDate(from30Date.getUTCDate() - 30);
  const fromDate = fromDateValue.toISOString().slice(0, 10);
  const from30Iso = from30Date.toISOString().slice(0, 10);
  let rpcAvailable = typeof admin?.rpc === "function";

  for (let start = 0; start < candidateCodes.length; start += CODE_CHUNK) {
    const codeChunk = candidateCodes.slice(start, start + CODE_CHUNK);
    if (rpcAvailable) {
      const { data, error } = await admin.rpc("recent_sales_customer_totals", {
        customer_codes: codeChunk,
        from_date: fromDate,
        from_30_date: from30Iso,
      });
      if (!error) {
        absorbRecentSalesTotalRows(data, maps);
        continue;
      }
      if (!isMissingRpcError(error)) throw error;
      rpcAvailable = false;
    }

    const salesRows = await readSalesChunk(admin, codeChunk, fromDate);
    mergeSalesSnapshots(salesRows).forEach((row) => absorbMergedRow(row, maps, from30Iso));
  }

  return projectRecentSalesCustomers(customers, maps);
}
