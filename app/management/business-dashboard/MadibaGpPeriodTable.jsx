"use client";

import { useCallback, useMemo } from "react";
import ExportableTable from "../../components/ExportableTable";
import { buildMadibaGpPeriodRows, grossProfitPercent } from "../../lib/madibaBrandGp";
import BiExcelHead, { useBiExcelFilters } from "./BiExcelHead";

const NAME_KEY = "__name__";
const TOTAL_KEY = "__total__";

function formatGpPercent(value) {
  return value == null || !Number.isFinite(value)
    ? "—"
    : `${value.toLocaleString("en-SA", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function GpCell({ value, previous, current = false, total = false }) {
  const tone = value == null || previous == null || value === previous ? "" : value > previous ? "moduleBiMonthCell--up" : "moduleBiMonthCell--down";
  return (
    <td className={[tone, current ? "moduleBiMonthCell--current" : "", total ? "moduleBiTotalCol" : ""].filter(Boolean).join(" ")}>
      {formatGpPercent(value)}
    </td>
  );
}

export default function MadibaGpPeriodTable({ report, rows, periods, currentPeriod, periodLabel, valuesKey, filename, sheetName, labels }) {
  const model = useMemo(() => buildMadibaGpPeriodRows(report, rows, periods, valuesKey), [report, rows, periods, valuesKey]);
  const keys = useMemo(() => [NAME_KEY, ...periods, TOTAL_KEY], [periods]);
  const valueOf = useCallback((row, key) => {
    if (key === NAME_KEY) return row.label;
    return formatGpPercent(key === TOTAL_KEY ? row.gpTotal : row.gpValues[key]);
  }, []);
  const { filters, options, visibleRows, setFilter } = useBiExcelFilters(model.rows, keys, valueOf);
  const totalFor = (period) => grossProfitPercent(
    visibleRows.reduce((sum, row) => sum + Number(period === TOTAL_KEY ? row.salesTotal : row.salesValues[period] || 0), 0),
    visibleRows.reduce((sum, row) => sum + Number(period === TOTAL_KEY ? row.profitTotal : row.profitValues[period] || 0), 0),
  );

  return (
    <ExportableTable filename={filename} sheetName={sheetName} className="moduleTableWrap moduleBiTableWrap">
      <table className="moduleTable moduleBiTable">
        <thead>
          <tr>
            <BiExcelHead label={labels.category} filterKey={NAME_KEY} options={options} filters={filters} onChange={setFilter} />
            {periods.map((period) => (
              <BiExcelHead
                key={period}
                label={periodLabel(period, currentPeriod)}
                filterKey={period}
                options={options}
                filters={filters}
                onChange={setFilter}
                className={period === currentPeriod ? "moduleBiMonthHead--current" : ""}
              />
            ))}
            <BiExcelHead label={labels.total} filterKey={TOTAL_KEY} options={options} filters={filters} onChange={setFilter} className="moduleBiTotalCol" />
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              {periods.map((period, index) => (
                <GpCell
                  key={period}
                  value={row.gpValues[period]}
                  previous={index > 0 ? row.gpValues[periods[index - 1]] : null}
                  current={period === currentPeriod}
                />
              ))}
              <GpCell value={row.gpTotal} total />
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="moduleBiTotalRow">
            <td>{labels.total}</td>
            {periods.map((period, index) => (
              <GpCell key={period} value={totalFor(period)} previous={index > 0 ? totalFor(periods[index - 1]) : null} current={period === currentPeriod} />
            ))}
            <GpCell value={totalFor(TOTAL_KEY)} total />
          </tr>
        </tfoot>
      </table>
    </ExportableTable>
  );
}