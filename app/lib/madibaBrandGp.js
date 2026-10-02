export function grossProfitPercent(sales, profit) {
  const netSales = Number(sales);
  const grossProfit = Number(profit);
  if (!Number.isFinite(netSales) || !Number.isFinite(grossProfit) || netSales === 0) return null;
  return (grossProfit / netSales) * 100;
}

export function buildMadibaGpPeriodRows(report, visibleRows, periods, valuesKey) {
  const salesRows = new Map((report?.measures?.sales?.groups || []).map((row) => [row.label, row]));
  const profitRows = new Map((report?.measures?.profit?.groups || []).map((row) => [row.label, row]));
  const rows = (visibleRows || []).map((visibleRow) => {
    const salesValues = salesRows.get(visibleRow.label)?.[valuesKey] || {};
    const profitValues = profitRows.get(visibleRow.label)?.[valuesKey] || {};
    const salesTotal = periods.reduce((sum, period) => sum + Number(salesValues[period] || 0), 0);
    const profitTotal = periods.reduce((sum, period) => sum + Number(profitValues[period] || 0), 0);
    return {
      label: visibleRow.label,
      salesValues,
      profitValues,
      gpValues: Object.fromEntries(periods.map((period) => [period, grossProfitPercent(salesValues[period] || 0, profitValues[period] || 0)])),
      gpTotal: grossProfitPercent(salesTotal, profitTotal),
      salesTotal,
      profitTotal,
    };
  });
  const totals = Object.fromEntries(periods.map((period) => [period, grossProfitPercent(
    rows.reduce((sum, row) => sum + Number(row.salesValues[period] || 0), 0),
    rows.reduce((sum, row) => sum + Number(row.profitValues[period] || 0), 0),
  )]));
  totals.__total__ = grossProfitPercent(
    rows.reduce((sum, row) => sum + row.salesTotal, 0),
    rows.reduce((sum, row) => sum + row.profitTotal, 0),
  );
  return { rows, totals };
}