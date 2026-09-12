"use client";

import { useCallback, useMemo } from "react";
import ExportableTable from "../../components/ExportableTable";
import { formatAmountWithDelta, formatMoneyAmount, formatWholePercent, growthPercent, monthChangeTone, periodGridTotals } from "../../lib/categoryGrowth";

function PeriodAmountCell({ amount, previous, hasPrevious, className = "" }) {
  const delta = hasPrevious ? formatWholePercent(growthPercent(amount, previous)) : "";
  return (
    <td className={className}>
      <span className="moduleBiAmountDelta">
        <strong>{Number(amount || 0) ? formatMoneyAmount(amount) : "—"}</strong>
        {delta ? <em>{delta}</em> : null}
      </span>
    </td>
  );
}
import BiExcelHead, { useBiExcelFilters } from "./BiExcelHead";

const NAME_KEY = "__name__";
const TOTAL_KEY = "__total__";

function periodAmountText(amount) {
  return Number(amount || 0) ? formatMoneyAmount(amount) : "—";
}

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
  allLabel = "All",
}) {
  const keys = useMemo(() => [NAME_KEY, ...periods, TOTAL_KEY], [periods]);
  const valueOf = useCallback((row, key) => {
    const values = valuesOf(row) || {};
    if (key === NAME_KEY) return row.label || row.category || "-";
    if (key === TOTAL_KEY) {
      return periodAmountText(periods.reduce((sum, period) => sum + Number(values[period] || 0), 0));
    }
    const previousKey = previousKeyOf?.(key, periods.indexOf(key), periods);
    return formatAmountWithDelta(values[key], values[previousKey], Boolean(previousKey));
  }, [periods, previousKeyOf, valuesOf]);
  const { filters, options, visibleRows, setFilter } = useBiExcelFilters(rows, keys, valueOf);
  const visibleTotals = useMemo(
    () => periodGridTotals(visibleRows, periods, valuesOf),
    [visibleRows, periods, valuesOf],
  );
  const gridTotals = visibleTotals || totals;

  return (
    <ExportableTable filename={filename} sheetName={sheetName} className="moduleTableWrap moduleBiTableWrap">
      <table className="moduleTable moduleBiTable">
        <thead>
          <tr>
            <BiExcelHead label={rowHeader} filterKey={NAME_KEY} options={options} filters={filters} onChange={setFilter} allLabel={allLabel} />
            {periods.map((period) => (
              <BiExcelHead
                key={period}
                label={periodLabel(period, currentPeriod)}
                filterKey={period}
                options={options}
                filters={filters}
                onChange={setFilter}
                allLabel={allLabel}
                className={period === currentPeriod ? "moduleBiMonthHead--current" : ""}
              />
            ))}
            <BiExcelHead
              label={totalLabel}
              filterKey={TOTAL_KEY}
              options={options}
              filters={filters}
              onChange={setFilter}
              allLabel={allLabel}
              className="moduleBiTotalCol"
            />
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row, rowIndex) => {
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
                    <PeriodAmountCell
                      key={period}
                      amount={amount}
                      previous={previous}
                      hasPrevious={Boolean(previousKey)}
                      className={[
                        tone ? `moduleBiMonthCell--${tone}` : "",
                        isCurrent ? "moduleBiMonthCell--current" : "",
                      ].filter(Boolean).join(" ")}
                    />
                  );
                })}
                <td className="moduleBiTotalCol">
                  {gridTotals.rowTotals[rowIndex] ? formatMoneyAmount(gridTotals.rowTotals[rowIndex]) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="moduleBiTotalRow">
            <td>{totalLabel}</td>
            {periods.map((period, index) => {
              const amount = Number(gridTotals.columnTotals[index] || 0);
              const previous = index > 0 ? Number(gridTotals.columnTotals[index - 1] || 0) : 0;
              const tone = monthChangeTone(amount, previous, index > 0);
              const isCurrent = period === currentPeriod;
              return (
                <PeriodAmountCell
                  key={`total-${period}`}
                  amount={amount}
                  previous={previous}
                  hasPrevious={index > 0}
                  className={[
                    tone ? `moduleBiMonthCell--${tone}` : "",
                    isCurrent ? "moduleBiMonthCell--current" : "",
                  ].filter(Boolean).join(" ")}
                />
              );
            })}
            <td className="moduleBiTotalCol">
              {gridTotals.grandTotal ? formatMoneyAmount(gridTotals.grandTotal) : "—"}
            </td>
          </tr>
        </tfoot>
      </table>
    </ExportableTable>
  );
}
