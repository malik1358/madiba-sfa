"use client";

import { useCallback, useMemo } from "react";
import ExportableTable from "../../components/ExportableTable";
import {
  formatAmountWithDelta,
  formatContributionPercent,
  formatMoneyAmount,
  formatSharePointDelta,
  formatWholePercent,
  growthPercent,
  monthChangeTone,
  periodGridTotals,
} from "../../lib/categoryGrowth";
import BiExcelHead, { useBiExcelFilters } from "./BiExcelHead";

const NAME_KEY = "__name__";
const TOTAL_KEY = "__total__";

function periodAmountText(amount) {
  return Number(amount || 0) ? formatMoneyAmount(amount) : "—";
}

function PeriodValueCell({ amount, previous, hasPrevious, className = "", valueKind = "amount" }) {
  const isPercent = valueKind === "percent";
  const main = isPercent ? formatContributionPercent(amount) : (Number(amount || 0) ? formatMoneyAmount(amount) : "—");
  const delta = isPercent
    ? formatSharePointDelta(amount, previous, hasPrevious)
    : (hasPrevious ? formatWholePercent(growthPercent(amount, previous)) : "");
  return (
    <td className={className}>
      <span className="moduleBiAmountDelta">
        <strong>{main}</strong>
        {delta ? <em>{delta}</em> : null}
      </span>
    </td>
  );
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
  valueKind = "amount",
  rowTotalOf,
}) {
  const isPercent = valueKind === "percent";
  const keys = useMemo(() => [NAME_KEY, ...periods, TOTAL_KEY], [periods]);
  const valueOf = useCallback((row, key) => {
    const values = valuesOf(row) || {};
    if (key === NAME_KEY) return row.label || row.category || "-";
    if (key === TOTAL_KEY) {
      if (typeof rowTotalOf === "function") {
        return isPercent ? formatContributionPercent(rowTotalOf(row)) : periodAmountText(rowTotalOf(row));
      }
      return periodAmountText(periods.reduce((sum, period) => sum + Number(values[period] || 0), 0));
    }
    const previousKey = previousKeyOf?.(key, periods.indexOf(key), periods);
    if (isPercent) {
      const current = Number(values[key] || 0);
      const previous = Number(values[previousKey] || 0);
      const delta = formatSharePointDelta(current, previous, Boolean(previousKey));
      return delta ? `${formatContributionPercent(current)} ${delta}` : formatContributionPercent(current);
    }
    return formatAmountWithDelta(values[key], values[previousKey], Boolean(previousKey));
  }, [isPercent, periods, previousKeyOf, rowTotalOf, valuesOf]);
  const { filters, options, visibleRows, setFilter } = useBiExcelFilters(rows, keys, valueOf);
  const visibleTotals = useMemo(() => {
    if (isPercent) {
      return {
        rowTotals: visibleRows.map((row) => (typeof rowTotalOf === "function" ? Number(rowTotalOf(row) || 0) : 0)),
        columnTotals: (periods || []).map(() => (visibleRows.length ? 100 : 0)),
        grandTotal: visibleRows.length ? 100 : 0,
      };
    }
    return periodGridTotals(visibleRows, periods, valuesOf);
  }, [isPercent, periods, rowTotalOf, valuesOf, visibleRows]);
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
            const rowTotal = typeof rowTotalOf === "function"
              ? Number(rowTotalOf(row) || 0)
              : Number(gridTotals.rowTotals[rowIndex] || 0);
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
                    <PeriodValueCell
                      key={period}
                      amount={amount}
                      previous={previous}
                      hasPrevious={Boolean(previousKey)}
                      valueKind={valueKind}
                      className={[
                        tone ? `moduleBiMonthCell--${tone}` : "",
                        isCurrent ? "moduleBiMonthCell--current" : "",
                      ].filter(Boolean).join(" ")}
                    />
                  );
                })}
                <td className="moduleBiTotalCol">
                  {isPercent ? formatContributionPercent(rowTotal) : (rowTotal ? formatMoneyAmount(rowTotal) : "—")}
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
              const tone = isPercent ? "" : monthChangeTone(amount, previous, index > 0);
              const isCurrent = period === currentPeriod;
              return (
                <PeriodValueCell
                  key={`total-${period}`}
                  amount={amount}
                  previous={previous}
                  hasPrevious={!isPercent && index > 0}
                  valueKind={valueKind}
                  className={[
                    tone ? `moduleBiMonthCell--${tone}` : "",
                    isCurrent ? "moduleBiMonthCell--current" : "",
                  ].filter(Boolean).join(" ")}
                />
              );
            })}
            <td className="moduleBiTotalCol">
              {isPercent
                ? formatContributionPercent(gridTotals.grandTotal)
                : (gridTotals.grandTotal ? formatMoneyAmount(gridTotals.grandTotal) : "—")}
            </td>
          </tr>
        </tfoot>
      </table>
    </ExportableTable>
  );
}
