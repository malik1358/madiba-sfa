export function salesUnitQty(row) {
  const salesAmount = Number(row?.sales_amount || 0);
  const rate = Number(row?.rate || 0);

  if (!rate) return 0;

  return salesAmount / rate;
}

export function trendClass(current, previous, hasPrevious = true) {
  if (!hasPrevious) return "";

  const currentValue = Number(current || 0);
  const previousValue = Number(previous || 0);

  if (currentValue > previousValue) return "auditTrendUp";
  if (currentValue < previousValue) return "auditTrendDown";
  return "auditTrendSame";
}
