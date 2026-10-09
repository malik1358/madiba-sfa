import { customerCodeCandidates, customerAccountCodesMatch, resolveCustomerAccountCode } from "./outstanding.js";

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

export function promoterCoverageMonthKeys(fromMonth, toMonth) {
  const from = String(fromMonth || "");
  const to = String(toMonth || "");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(from) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(to) || from > to) return [];

  const [fromYear, fromNumber] = from.split("-").map(Number);
  const [toYear, toNumber] = to.split("-").map(Number);
  const count = (toYear - fromYear) * 12 + toNumber - fromNumber + 1;
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(fromYear, fromNumber - 1 + index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

export function promoterCoverageCustomerCodeVariants(value) {
  const raw = String(value || "").trim();
  const normalized = normalizeCode(raw);
  const candidates = [raw, normalized, ...customerCodeCandidates(normalized), resolveCustomerAccountCode(normalized)];
  const accountCodes = candidates.map((candidate) => normalizeCode(resolveCustomerAccountCode(candidate))).filter(Boolean);

  accountCodes.forEach((code) => {
    const accountMatch = code.match(/^0*(\d{3,6})([A-Z]?)$/);
    if (!accountMatch) return;
    const base = String(Number(accountMatch[1]));
    const suffix = accountMatch[2] || "C";
    for (let width = base.length; width <= 6; width += 1) {
      const padded = base.padStart(width, "0");
      candidates.push(padded, `${padded}${suffix}`);
    }
  });

  return [...new Set(candidates.map((candidate) => String(candidate || "").trim()).filter(Boolean))];
}

function accountMatchKey(value) {
  const account = normalizeCode(resolveCustomerAccountCode(value));
  const match = account.match(/^0*(\d{3,6})[A-Z]?$/);
  return match ? String(Number(match[1])) : account;
}

export function filterPromoterCoverageSalesRows(salesRows = [], customerCodes = []) {
  const teamKeys = new Set(customerCodes.map(accountMatchKey).filter(Boolean));
  return salesRows.filter((sale) => teamKeys.has(accountMatchKey(sale.customer_code)));
}

function monthOf(value) {
  return String(value || "").slice(0, 7);
}

function visitTimestamp(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function dedupeVisits(visits = []) {
  const sorted = [...visits].sort((left, right) => visitTimestamp(left.savedAt) - visitTimestamp(right.savedAt));
  const kept = [];

  sorted.forEach((visit) => {
    const code = normalizeCode(visit.customerCode);
    if (!code) return;
    const timestamp = visitTimestamp(visit.savedAt);
    const outcome = String(visit.outcome || "").trim().toUpperCase();
    const duplicate = [...kept].reverse().find((prior) => (
      normalizeCode(prior.customerCode) === code
      && String(prior.outcome || "").trim().toUpperCase() === outcome
      && timestamp - visitTimestamp(prior.savedAt) <= 120000
    ));
    if (!duplicate) kept.push(visit);
  });

  return kept;
}

function resolveSalesTrend(monthSales, monthKeys, currentMonth) {
  const completedMonths = monthKeys.filter((month) => month < currentMonth);
  if (completedMonths.length < 2) return { trend: "insufficient_history", recentSales: 0, previousSales: 0, changePercent: null };

  const previousMonth = completedMonths.at(-2);
  const recentMonth = completedMonths.at(-1);
  const previousSales = monthSales[previousMonth] || 0;
  const recentSales = monthSales[recentMonth] || 0;
  if (previousSales <= 0 && recentSales > 0) {
    return { trend: "new_sales", recentSales, previousSales, changePercent: null };
  }
  if (previousSales <= 0) {
    return { trend: "no_sales", recentSales, previousSales, changePercent: null };
  }

  const changePercent = ((recentSales - previousSales) / previousSales) * 100;
  const trend = changePercent > 0.5 ? "increasing" : changePercent < -0.5 ? "decreasing" : "stable";
  return { trend, recentSales, previousSales, changePercent };
}

export function buildPromoterCoverageReport({
  customers = [],
  salesRows = [],
  visits = [],
  monthKeys = [],
  currentMonth = "",
} = {}) {
  const months = [...new Set(monthKeys.map((month) => String(month || "").slice(0, 7)).filter(Boolean))].sort();
  const trendCurrentMonth = currentMonth || (() => {
    const date = new Date(`${months.at(-1) || "1970-01"}-01T00:00:00.000Z`);
    date.setUTCMonth(date.getUTCMonth() + 1);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  })();
  const byCode = new Map();

  const ensureCustomer = (code, fallback = {}) => {
    const key = normalizeCode(code);
    if (!key) return null;
    if (!byCode.has(key)) {
      byCode.set(key, {
        customerCode: key,
        customerName: String(fallback.customer_name || fallback.customerName || "").trim(),
        teamSalesmanCode: String(fallback.current_salesman_code || fallback.salesman_code || fallback.teamSalesmanCode || "").trim(),
        monthSales: Object.fromEntries(months.map((month) => [month, 0])),
        monthSkuCodes: Object.fromEntries(months.map((month) => [month, new Set()])),
        visits: [],
      });
    }
    const row = byCode.get(key);
    if (!row.customerName) row.customerName = String(fallback.customer_name || fallback.customerName || "").trim();
    if (!row.teamSalesmanCode) {
      row.teamSalesmanCode = String(fallback.current_salesman_code || fallback.salesman_code || fallback.teamSalesmanCode || "").trim();
    }
    return row;
  };

  customers.forEach((customer) => ensureCustomer(customer.customer_code, customer));
  salesRows.forEach((sale) => {
    const customer = ensureCustomer(sale.customer_code, sale);
    const month = monthOf(sale.transaction_date);
    if (!customer || !Object.hasOwn(customer.monthSales, month)) return;
    customer.monthSales[month] += Number(sale.net_sales_amount ?? sale.sales_amount ?? 0) || 0;
    const itemCode = String(sale.item_code || "").trim().toUpperCase();
    if (!sale.is_credit_note && Number(sale.sales_amount || 0) > 0 && itemCode) {
      customer.monthSkuCodes[month].add(itemCode);
    }
  });

  dedupeVisits(visits).forEach((visit) => {
    const customer = ensureCustomer(visit.customerCode, visit);
    if (customer) customer.visits.push(visit);
  });

  const rows = [...byCode.values()].map((customer) => {
    const orderedVisits = customer.visits.sort((left, right) => visitTimestamp(left.savedAt) - visitTimestamp(right.savedAt));
    const { monthSkuCodes, ...reportCustomer } = customer;
    const monthSkuCount = Object.fromEntries(months.map((month) => [month, monthSkuCodes[month].size]));
    const monthSalesChange = {};
    const monthSkuChange = {};
    months.forEach((month, index) => {
      if (month >= trendCurrentMonth || index === 0) {
        monthSalesChange[month] = null;
        monthSkuChange[month] = null;
        return;
      }
      const previousMonth = months[index - 1];
      const priorSales = customer.monthSales[previousMonth] || 0;
      const currentSales = customer.monthSales[month] || 0;
      const priorSkus = monthSkuCount[previousMonth] || 0;
      const currentSkus = monthSkuCount[month] || 0;
      monthSalesChange[month] = priorSales === 0
        ? (currentSales > 0 ? { trend: "new_sales", changePercent: null } : { trend: "stable", changePercent: 0 })
        : {
          trend: currentSales > priorSales ? "increasing" : currentSales < priorSales ? "decreasing" : "stable",
          changePercent: ((currentSales - priorSales) / Math.abs(priorSales)) * 100,
        };
      monthSkuChange[month] = priorSkus === 0
        ? (currentSkus > 0 ? { trend: "new_sales", changePercent: null } : { trend: "stable", changePercent: 0 })
        : {
          trend: currentSkus > priorSkus ? "increasing" : currentSkus < priorSkus ? "decreasing" : "stable",
          changePercent: ((currentSkus - priorSkus) / priorSkus) * 100,
        };
    });
    const skuTrend = resolveSalesTrend(monthSkuCount, months, trendCurrentMonth);
    return {
      ...reportCustomer,
      monthSkuCount,
      monthSalesChange,
      monthSkuChange,
      visitCount: orderedVisits.length,
      lastVisitAt: orderedVisits.at(-1)?.savedAt || "",
      visitStatus: orderedVisits.length === 0 ? "not_visited" : orderedVisits.length > 1 ? "repeated" : "visited_once",
      ...resolveSalesTrend(customer.monthSales, months, trendCurrentMonth),
      skuTrend: skuTrend.trend,
      skuRecentCount: skuTrend.recentSales,
      skuPreviousCount: skuTrend.previousSales,
      skuChangePercent: skuTrend.changePercent,
    };
  }).sort((left, right) => {
    const statusOrder = { not_visited: 0, repeated: 1, visited_once: 2 };
    return statusOrder[left.visitStatus] - statusOrder[right.visitStatus]
      || left.customerName.localeCompare(right.customerName)
      || left.customerCode.localeCompare(right.customerCode);
  });

  return {
    monthKeys: months,
    customerCount: rows.length,
    visitedCustomerCount: rows.filter((row) => row.visitCount > 0).length,
    notVisitedCustomerCount: rows.filter((row) => row.visitCount === 0).length,
    repeatedCustomerCount: rows.filter((row) => row.visitCount > 1).length,
    increasingCustomerCount: rows.filter((row) => row.trend === "increasing" || row.trend === "new_sales").length,
    decreasingCustomerCount: rows.filter((row) => row.trend === "decreasing").length,
    increasingSkuCustomerCount: rows.filter((row) => row.skuTrend === "increasing" || row.skuTrend === "new_sales").length,
    decreasingSkuCustomerCount: rows.filter((row) => row.skuTrend === "decreasing").length,
    rows,
  };
}

export function promoterCoverageSalesmanMatches(value, salesmanValues = []) {
  const code = normalizeCode(value);
  return Boolean(code) && salesmanValues.some((salesmanValue) => normalizeCode(salesmanValue) === code);
}