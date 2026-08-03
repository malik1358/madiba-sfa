import { monthKey, salesUnitQty } from './format';

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

function isDoNotUseItem(name) {
  const text = String(name || '').trim().toLowerCase();
  return /do\s*not\s*use+/i.test(text);
}

export function buildQuickOrderSuggestions({ analytics, transactions, peerTransactions, itemMaster }) {
  if (!analytics) {
    return { newItems: [], notBoughtRecently: [], buyingLess: [] };
  }

  const historyByCode = new Map();

  transactions.forEach((row) => {
    const code = normalizeCode(row.item_code);

    if (!code || isDoNotUseItem(row.item_name)) {
      return;
    }

    if (!historyByCode.has(code)) {
      historyByCode.set(code, {
        item_code: String(row.item_code || '').trim(),
        item_name: row.item_name || row.item_code || 'Unknown Item',
        category: row.category || 'Unclassified',
        lastBought: null,
        months: {},
        totalPositiveQty: 0,
        activePurchaseMonths: new Set(),
      });
    }

    const item = historyByCode.get(code);
    const qty = salesUnitQty(row);
    const month = monthKey(row.transaction_date);

    if (month) {
      if (item.months[month] === undefined) {
        item.months[month] = 0;
      }
      item.months[month] += qty;
    }

    if (qty > 0 && month) {
      item.totalPositiveQty += qty;
      item.activePurchaseMonths.add(month);
    }

    if (qty > 0 && row.transaction_date && (!item.lastBought || row.transaction_date > item.lastBought)) {
      item.lastBought = row.transaction_date;
    }
  });

  const cleanMaster = (itemMaster || [])
    .map((row) => ({
      item_code: String(row.item_code || '').trim(),
      item_name: String(row.item_name || '').trim(),
      category: String(row.category || 'Unclassified').trim(),
      rate: null,
      is_active: row.is_active,
    }))
    .filter((item) => item.item_code)
    .filter((item) => !isDoNotUseItem(item.item_name));

  const selectedBoughtCodes = new Set(
    transactions
      .filter((row) => Number(row.sales_amount || 0) > 0)
      .map((row) => normalizeCode(row.item_code))
      .filter(Boolean)
  );

  const peerCustomerItems = {};
  peerTransactions.forEach((row) => {
    if (Number(row.sales_amount || 0) <= 0) return;

    const customerCode = String(row.customer_code || '').trim();
    const itemCode = normalizeCode(row.item_code);

    if (!customerCode || !itemCode) return;

    if (!peerCustomerItems[customerCode]) {
      peerCustomerItems[customerCode] = new Set();
    }

    peerCustomerItems[customerCode].add(itemCode);
  });

  const similarCustomers = Object.entries(peerCustomerItems)
    .map(([customerCode, itemCodes]) => {
      let sharedItems = 0;
      itemCodes.forEach((itemCode) => {
        if (selectedBoughtCodes.has(itemCode)) {
          sharedItems += 1;
        }
      });

      return { customerCode, sharedItems, itemCodes };
    })
    .filter((customer) => customer.sharedItems > 0)
    .sort((a, b) => b.sharedItems - a.sharedItems);

  const topSimilarCustomers = similarCustomers.slice(0, 50);
  const topSimilarCodes = new Set(topSimilarCustomers.map((customer) => customer.customerCode));

  const candidateStats = {};
  peerTransactions.forEach((row) => {
    const customerCode = String(row.customer_code || '').trim();
    if (!topSimilarCodes.has(customerCode)) return;
    if (Number(row.sales_amount || 0) <= 0) return;

    const itemCode = normalizeCode(row.item_code);
    if (!itemCode || selectedBoughtCodes.has(itemCode)) return;

    if (!candidateStats[itemCode]) {
      candidateStats[itemCode] = { customerCodes: new Set(), totalSales: 0, latestDate: null };
    }

    candidateStats[itemCode].customerCodes.add(customerCode);
    candidateStats[itemCode].totalSales += Number(row.sales_amount || 0);

    const txDate = row.transaction_date;
    if (txDate && (!candidateStats[itemCode].latestDate || txDate > candidateStats[itemCode].latestDate)) {
      candidateStats[itemCode].latestDate = txDate;
    }
  });

  const newItems = cleanMaster
    .map((item) => {
      const code = normalizeCode(item.item_code);
      const stats = candidateStats[code];

      if (!stats) return null;
      if (isDoNotUseItem(item.item_name)) return null;
      if (item.is_active === false) return null;

      return {
        ...item,
        similarCustomerCount: stats.customerCodes.size,
        peerSales: stats.totalSales,
        peerLatestDate: stats.latestDate,
        recommendationReason: `Bought by ${stats.customerCodes.size} similar customers`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (b.similarCustomerCount !== a.similarCustomerCount) return b.similarCustomerCount - a.similarCustomerCount;
      if (b.peerSales !== a.peerSales) return b.peerSales - a.peerSales;
      return String(a.item_name || '').localeCompare(String(b.item_name || ''));
    })
    .slice(0, 3);

  const notBoughtRecently = Array.from(historyByCode.values())
    .filter((item) => item.lastBought)
    .sort((a, b) => String(a.lastBought).localeCompare(String(b.lastBought)))
    .slice(0, 2)
    .map((item) => ({ ...item, rate: null, recommendationReason: 'Not Bought Since Long' }));

  const visibleMonths = analytics.months || [];
  const latestMonth = visibleMonths.length ? visibleMonths[visibleMonths.length - 1] : null;

  const buyingLess = Array.from(historyByCode.values())
    .map((item) => {
      const activeMonths = item.activePurchaseMonths.size;
      const totalQty = Number(item.totalPositiveQty || 0);
      const avgQty = activeMonths > 0 ? totalQty / activeMonths : 0;
      const latestQty = latestMonth ? Number(item.months[latestMonth] || 0) : 0;
      const declineQty = avgQty - latestQty;
      const declinePercent = avgQty > 0 ? declineQty / avgQty : 0;

      return { ...item, totalQty, activeMonths, avgQty, latestQty, declineQty, declinePercent };
    })
    .filter((item) => item.avgQty > 0 && item.latestQty < item.avgQty)
    .sort((a, b) => {
      if (b.declinePercent !== a.declinePercent) return b.declinePercent - a.declinePercent;
      return b.declineQty - a.declineQty;
    })
    .slice(0, 2)
    .map((item) => ({ ...item, rate: null, recommendationReason: 'Buying Less' }));

  return { newItems, notBoughtRecently, buyingLess };
}
