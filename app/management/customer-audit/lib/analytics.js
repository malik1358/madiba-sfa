import { buildLast12Months, monthKey, salesUnitQty } from './format';

export function buildAnalytics(transactions) {
  if (!transactions.length) {
    return null;
  }

  let latestDate = null;

  for (const row of transactions) {
    if (row.transaction_date && (!latestDate || row.transaction_date > latestDate)) {
      latestDate = row.transaction_date;
    }
  }

  const allMonths = buildLast12Months(latestDate);
  const monthSet = new Set(allMonths);

  const monthlyMap = new Map();
  allMonths.forEach((month) => {
    monthlyMap.set(month, {
      sales: 0,
      skus: new Set(),
      orders: new Set(),
      hasActivity: false,
    });
  });

  const categoryMap = new Map();
  const itemMap = new Map();
  const orderSet = new Set();

  for (const row of transactions) {
    const month = monthKey(row.transaction_date);
    const sales = Number(row.sales_amount || 0);
    const quantity = salesUnitQty(row);
    const itemCode = String(row.item_code || '').trim();
    const itemName = row.item_name || itemCode || 'Unknown Item';
    const itemKey = itemCode || itemName;
    const category = row.category || 'Unclassified';
    const orderKey = row.voucher_number || row.reference || `ROW-${row.id}`;

    orderSet.add(orderKey);

    if (monthSet.has(month)) {
      const monthly = monthlyMap.get(month);
      monthly.sales += sales;
      monthly.hasActivity = true;

      if (itemCode || itemName) {
        monthly.skus.add(itemKey);
      }

      monthly.orders.add(orderKey);
    }

    if (!categoryMap.has(category)) {
      const monthValues = {};
      allMonths.forEach((monthValue) => {
        monthValues[monthValue] = { sales: 0, skus: new Set() };
      });

      categoryMap.set(category, {
        category,
        months: monthValues,
        totalSales: 0,
        totalSkus: new Set(),
        itemKeys: new Set(),
      });
    }

    const categoryData = categoryMap.get(category);
    categoryData.itemKeys.add(itemKey);

    if (monthSet.has(month)) {
      categoryData.months[month].sales += sales;
      categoryData.months[month].skus.add(itemKey);
      categoryData.totalSales += sales;
      categoryData.totalSkus.add(itemKey);
    }

    if (!itemMap.has(itemKey)) {
      const itemMonths = {};
      allMonths.forEach((monthValue) => {
        itemMonths[monthValue] = { value: 0, quantity: 0 };
      });

      itemMap.set(itemKey, {
        item_key: itemKey,
        item_code: itemCode,
        item_name: itemName,
        category,
        abc_class: row.abc_class,
        months: itemMonths,
        total_value: 0,
        total_quantity: 0,
        last_date: row.transaction_date,
      });
    }

    const item = itemMap.get(itemKey);

    if (monthSet.has(month)) {
      item.months[month].value += sales;
      item.months[month].quantity += quantity;
      item.total_value += sales;
      item.total_quantity += quantity;
    }

    if (row.transaction_date && (!item.last_date || row.transaction_date > item.last_date)) {
      item.last_date = row.transaction_date;
    }
  }

  const activeMonths = allMonths.filter((month) => monthlyMap.get(month).hasActivity);
  const months = activeMonths.slice(-6);

  const yearGroups = [];
  months.forEach((month) => {
    const year = month.slice(0, 4);
    const existing = yearGroups.find((group) => group.year === year);

    if (existing) {
      existing.months.push(month);
    } else {
      yearGroups.push({ year, months: [month] });
    }
  });

  const monthlySummary = months.map((month) => ({
    month,
    sales: monthlyMap.get(month).sales,
    skuCount: monthlyMap.get(month).skus.size,
    orderCount: monthlyMap.get(month).orders.size,
  }));

  const items = Array.from(itemMap.values())
    .filter((item) => item.item_code)
    .sort((a, b) => b.total_value - a.total_value);

  const itemLookup = {};
  items.forEach((item) => {
    itemLookup[item.item_key] = item;
  });

  const categories = Array.from(categoryMap.values())
    .map((category) => {
      const monthData = {};
      months.forEach((month) => {
        monthData[month] = {
          sales: category.months[month].sales,
          skuCount: category.months[month].skus.size,
        };
      });

      const categoryItems = Array.from(category.itemKeys)
        .map((itemKey) => itemLookup[itemKey])
        .filter(Boolean)
        .sort((a, b) => b.total_value - a.total_value);

      const visibleTotalSales = months.reduce((total, month) => total + Number(monthData[month]?.sales || 0), 0);
      const visibleSkuSet = new Set();

      months.forEach((month) => {
        const originalMonth = category.months[month];
        if (originalMonth) {
          originalMonth.skus.forEach((sku) => visibleSkuSet.add(sku));
        }
      });

      return {
        category: category.category,
        months: monthData,
        totalSales: visibleTotalSales,
        totalSkuCount: visibleSkuSet.size,
        items: categoryItems,
      };
    })
    .filter((category) => category.totalSales !== 0 || category.totalSkuCount > 0)
    .sort((a, b) => b.totalSales - a.totalSales);

  return {
    latestDate,
    months,
    yearGroups,
    monthlySummary,
    categories,
    items,
    itemLookup,
    orderCount: orderSet.size,
    itemCount: itemMap.size,
    transactionCount: transactions.length,
  };
}
