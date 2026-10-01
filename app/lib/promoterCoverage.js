function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
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

function resolveSalesTrend(monthSales, monthKeys) {
  if (monthKeys.length < 6) return { trend: "insufficient_history", recentSales: 0, previousSales: 0, changePercent: null };

  const previousSales = monthKeys.slice(-6, -3).reduce((sum, month) => sum + (monthSales[month] || 0), 0);
  const recentSales = monthKeys.slice(-3).reduce((sum, month) => sum + (monthSales[month] || 0), 0);
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
} = {}) {
  const months = [...new Set(monthKeys.map((month) => String(month || "").slice(0, 7)).filter(Boolean))].sort();
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
  });

  dedupeVisits(visits).forEach((visit) => {
    const customer = ensureCustomer(visit.customerCode, visit);
    if (customer) customer.visits.push(visit);
  });

  const rows = [...byCode.values()].map((customer) => {
    const orderedVisits = customer.visits.sort((left, right) => visitTimestamp(left.savedAt) - visitTimestamp(right.savedAt));
    return {
      ...customer,
      visitCount: orderedVisits.length,
      lastVisitAt: orderedVisits.at(-1)?.savedAt || "",
      visitStatus: orderedVisits.length === 0 ? "not_visited" : orderedVisits.length > 1 ? "repeated" : "visited_once",
      ...resolveSalesTrend(customer.monthSales, months),
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
    rows,
  };
}