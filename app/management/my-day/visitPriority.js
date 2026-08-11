function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

export function buildRecentSalesByCustomer(rows) {
  const byCustomer = new Map();

  (rows || []).forEach((row) => {
    const customerCode = normalizeCode(row?.customer_code);
    if (!customerCode) return;

    const current = byCustomer.get(customerCode) || { salesValue: 0, transactionCount: 0 };
    current.salesValue += Math.max(Number(row?.sales_amount || 0), 0);
    current.transactionCount += 1;
    byCustomer.set(customerCode, current);
  });

  return byCustomer;
}

export function visitOrderPriority(row) {
  const recentSalesValue = Math.max(Number(row?.recent_sales_value || 0), 0);
  const daysSinceInvoice = Math.max(Number(row?.days_since_last_invoice || 0), 0);
  const purchaseGapFactor = Math.min(2, Math.max(0.5, daysSinceInvoice / 30));
  const completionFactor = row?.status === "Visited" ? 0.1 : 1;
  return recentSalesValue * purchaseGapFactor * completionFactor;
}

export function filterAndRankVisitCustomers(rows, search = "") {
  const query = String(search || "").trim().toLowerCase();

  return (rows || [])
    .filter((row) => {
      if (!query) return true;
      return [row?.customer_code, row?.customer_name]
        .some((value) => String(value || "").toLowerCase().includes(query));
    })
    .sort((a, b) => {
      const byPriority = visitOrderPriority(b) - visitOrderPriority(a);
      if (byPriority !== 0) return byPriority;
      const byValue = Number(b?.recent_sales_value || 0) - Number(a?.recent_sales_value || 0);
      if (byValue !== 0) return byValue;
      return String(a?.customer_name || a?.customer_code || "").localeCompare(String(b?.customer_name || b?.customer_code || ""));
    });
}

export function splitVisitCustomersByOutstanding(rows) {
  return (rows || []).reduce((groups, row) => {
    const under60Balance = Number(row?.outstanding_0_30 || 0) + Number(row?.outstanding_30_60 || 0);
    const above60Balance = Number(row?.outstanding_above_60 || 0);

    if (above60Balance > 0) groups.above60.push(row);
    else if (under60Balance > 0) groups.under60.push(row);
    return groups;
  }, { under60: [], above60: [] });
}