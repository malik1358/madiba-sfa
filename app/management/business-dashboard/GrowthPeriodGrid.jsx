"use client";

import ExportableTable from "../../components/ExportableTable";
import { formatMoneyAmount, monthChangeTone } from "../../lib/categoryGrowth";

export default function GrowthPeriodGrid({
  filename,
  sheetName,
  rowHeader,
  rows = [],
  periods = [],
  currentPeriod = "",
  periodLabel,
  valuesOf = (row) => row.monthValues,
  previousKeyOf,
  totals,
  totalLabel,
  rowKeyOf = (row) => row.label || row.category,
}) {
  return (
    <ExportableTable filename={filename} sheetName={sheetName} className="moduleTableWrap moduleBiTableWrap">
      <table className="moduleTable moduleBiTable">
        <thead>
          <tr>
            <th>{rowHeader}</th>
            {periods.map((period) => (
              <th key={period} className={period === currentPeriod ? "moduleBiMonthHead--current" : ""}>
                {periodLabel(period, currentPeriod)}
              </th>
            ))}
            <th className="moduleBiTotalCol">{totalLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => {
            const values = valuesOf(row) || {};
            return (
              <tr key={`period-${rowKeyOf(row)}`}>
                <td>{row.label || row.category}</td>
                {periods.map((period, index) => {
                  const amount = Number(values[period] || 0);
                  const previousKey = previousKeyOf(period, index, periods);
                  const previous = Number(values[previousKey] || 0);
                  const tone = monthChangeTone(amount, previous, Boolean(previousKey));
                  const isCurrent = period === currentPeriod;
                  return (
                    <td
                      key={period}
                      className={[
                        tone ? `moduleBiMonthCell--${tone}` : "",
                        isCurrent ? "moduleBiMonthCell--current" : "",
                      ].filter(Boolean).join(" ")}
                    >
                      {amount ? formatMoneyAmount(amount) : "—"}
                    </td>
                  );
                })}
                <td className="moduleBiTotalCol">
                  {totals.rowTotals[rowIndex] ? formatMoneyAmount(totals.rowTotals[rowIndex]) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="moduleBiTotalRow">
            <td>{totalLabel}</td>
            {periods.map((period, index) => {
              const amount = Number(totals.columnTotals[index] || 0);
              const previous = index > 0 ? Number(totals.columnTotals[index - 1] || 0) : 0;
              const tone = monthChangeTone(amount, previous, index > 0);
              const isCurrent = period === currentPeriod;
              return (
                <td
                  key={`total-${period}`}
                  className={[
                    tone ? `moduleBiMonthCell--${tone}` : "",
                    isCurrent ? "moduleBiMonthCell--current" : "",
                  ].filter(Boolean).join(" ")}
                >
                  {amount ? formatMoneyAmount(amount) : "—"}
                </td>
              );
            })}
            <td className="moduleBiTotalCol">
              {totals.grandTotal ? formatMoneyAmount(totals.grandTotal) : "—"}
            </td>
          </tr>
        </tfoot>
      </table>
    </ExportableTable>
  );
}
