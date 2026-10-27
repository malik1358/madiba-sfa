"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ExportableTable from "../../components/ExportableTable";
import { fetchJsonWithTimeout, resolveAuthSession } from "../../lib/authSession";
import { ITEMS_SOLD_AT_LOSS_FILTER_KEYS } from "../../lib/itemsSoldAtLoss";
import { getSupabaseClient } from "../../lib/supabase";
import BiExcelHead, { useBiExcelFilters } from "./BiExcelHead";

function formatQty(value) {
  return Number(value || 0).toLocaleString("en-SA", { maximumFractionDigits: 3 });
}

function formatAmount(value) {
  return Number(value || 0).toLocaleString("en-SA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "—";
  const [year, month, day] = text.split("-");
  return `${day}/${month}/${year}`;
}

function cellValue(row, key) {
  if (key === "transactionDate") return formatDate(row.transactionDate);
  if (key === "voucherNumber") return row.voucherNumber || "";
  if (key === "voucherType") return row.voucherType || "";
  if (key === "reference") return row.reference || "";
  if (key === "salesmanCode") return row.salesmanCode || "";
  if (key === "salesmanName") return row.salesmanName || "";
  if (key === "customerCode") return row.customerCode || "";
  if (key === "customerName") return row.customerName || "";
  if (key === "itemCode") return row.itemCode || "";
  if (key === "itemName") return row.itemName || "";
  if (key === "category") return row.category || "";
  if (key === "localImport") return row.localImport || "";
  if (key === "abcClass") return row.abcClass || "";
  if (key === "quantity") return formatQty(row.quantity);
  if (key === "rate") return formatAmount(row.rate);
  if (key === "salesAmount") return formatAmount(row.salesAmount);
  if (key === "profitAmount") return formatAmount(row.profitAmount);
  return "";
}

export default function ItemsSoldAtLossReport({
  periodRange = {},
  periodLabel = "",
  labels = {},
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [report, setReport] = useState(null);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError("");
    setAccessDenied(false);
    try {
      const supabase = getSupabaseClient();
      const session = await resolveAuthSession(supabase, 12000);
      if (!session?.access_token) throw new Error(labels.signIn || "Please login again.");

      const params = new URLSearchParams();
      if (periodRange?.dateFrom) params.set("from", periodRange.dateFrom);
      if (periodRange?.dateTo) params.set("to", periodRange.dateTo);

      const { response, payload } = await fetchJsonWithTimeout(
        `/api/business-dashboard/items-sold-at-loss?${params.toString()}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } },
        90000,
      );

      if (response.status === 403) {
        setAccessDenied(true);
        setReport(null);
        return;
      }
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || labels.loadError || "Unable to load items sold at loss.");
      }
      setReport(payload);
    } catch (err) {
      setError(err.message || labels.loadError || "Unable to load items sold at loss.");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [labels.loadError, labels.signIn, periodRange?.dateFrom, periodRange?.dateTo]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const rows = useMemo(() => (Array.isArray(report?.rows) ? report.rows : []), [report]);
  const filterValueOf = useMemo(() => (row, key) => cellValue(row, key), []);
  const { filters, options, visibleRows, setFilter } = useBiExcelFilters(
    rows,
    ITEMS_SOLD_AT_LOSS_FILTER_KEYS,
    filterValueOf,
  );

  const visibleTotals = useMemo(() => visibleRows.reduce((totals, row) => ({
    lineCount: totals.lineCount + 1,
    quantity: totals.quantity + Number(row.quantity || 0),
    salesAmount: totals.salesAmount + Number(row.salesAmount || 0),
    profitAmount: totals.profitAmount + Number(row.profitAmount || 0),
  }), {
    lineCount: 0,
    quantity: 0,
    salesAmount: 0,
    profitAmount: 0,
  }), [visibleRows]);

  if (accessDenied) {
    return <div className="moduleNotice">{labels.accessDenied}</div>;
  }

  return (
    <section id="bi-items-sold-at-loss" className="moduleSection">
      <div className="moduleSectionHeader">
        <div>
          <h2>{labels.title}</h2>
          <p className="moduleSubtitle">
            {labels.subtitle}
            {periodLabel ? ` · ${periodLabel}` : ""}
          </p>
        </div>
        <button type="button" className="moduleButton" onClick={() => void loadReport()} disabled={loading}>
          {labels.refresh}
        </button>
      </div>

      {loading ? <div className="moduleLoading">{labels.loading}</div> : null}
      {error ? <div className="moduleError">{error}</div> : null}
      {report?.profitMissing ? <div className="moduleNotice">{report.message || labels.profitMissing}</div> : null}

      {!loading && !error && !accessDenied ? (
        <>
          <div className="moduleMetricGrid">
            <section className="moduleMetricCard">
              <span>{labels.lines}</span>
              <strong>{visibleTotals.lineCount.toLocaleString("en-SA")}</strong>
            </section>
            <section className="moduleMetricCard">
              <span>{labels.quantity}</span>
              <strong>{formatQty(visibleTotals.quantity)}</strong>
            </section>
            <section className="moduleMetricCard">
              <span>{labels.sales}</span>
              <strong>{formatAmount(visibleTotals.salesAmount)}</strong>
            </section>
            <section className="moduleMetricCard moduleBusinessKpi--red">
              <span>{labels.loss}</span>
              <strong>{formatAmount(visibleTotals.profitAmount)}</strong>
            </section>
          </div>

          {!visibleRows.length ? (
            <div className="moduleNotice">{labels.noRows}</div>
          ) : (
            <ExportableTable filename="items-sold-at-loss" sheetName="Sold at loss" className="moduleTableWrap moduleBiTableWrap">
              <table className="moduleTable moduleBiTable">
                <thead>
                  <tr>
                    <BiExcelHead label={labels.date} filterKey="transactionDate" options={options} filters={filters} onChange={setFilter} allLabel={labels.all} />
                    <BiExcelHead label={labels.voucher} filterKey="voucherNumber" options={options} filters={filters} onChange={setFilter} allLabel={labels.all} />
                    <BiExcelHead label={labels.voucherType} filterKey="voucherType" options={options} filters={filters} onChange={setFilter} allLabel={labels.all} />
                    <BiExcelHead label={labels.reference} filterKey="reference" options={options} filters={filters} onChange={setFilter} allLabel={labels.all} />
                    <BiExcelHead label={labels.salesmanCode} filterKey="salesmanCode" options={options} filters={filters} onChange={setFilter} allLabel={labels.all} />
                    <BiExcelHead label={labels.salesmanName} filterKey="salesmanName" options={options} filters={filters} onChange={setFilter} allLabel={labels.all} />
                    <BiExcelHead label={labels.customerCode} filterKey="customerCode" options={options} filters={filters} onChange={setFilter} allLabel={labels.all} />
                    <BiExcelHead label={labels.customerName} filterKey="customerName" options={options} filters={filters} onChange={setFilter} allLabel={labels.all} />
                    <BiExcelHead label={labels.itemCode} filterKey="itemCode" options={options} filters={filters} onChange={setFilter} allLabel={labels.all} />
                    <BiExcelHead label={labels.itemName} filterKey="itemName" options={options} filters={filters} onChange={setFilter} allLabel={labels.all} />
                    <BiExcelHead label={labels.category} filterKey="category" options={options} filters={filters} onChange={setFilter} allLabel={labels.all} />
                    <BiExcelHead label={labels.localImport} filterKey="localImport" options={options} filters={filters} onChange={setFilter} allLabel={labels.all} />
                    <BiExcelHead label={labels.abcClass} filterKey="abcClass" options={options} filters={filters} onChange={setFilter} allLabel={labels.all} />
                    <BiExcelHead label={labels.quantity} filterKey="quantity" options={options} filters={filters} onChange={setFilter} allLabel={labels.all} />
                    <BiExcelHead label={labels.price} filterKey="rate" options={options} filters={filters} onChange={setFilter} allLabel={labels.all} />
                    <BiExcelHead label={labels.sales} filterKey="salesAmount" options={options} filters={filters} onChange={setFilter} allLabel={labels.all} className="moduleBiTotalCol" />
                    <BiExcelHead label={labels.loss} filterKey="profitAmount" options={options} filters={filters} onChange={setFilter} allLabel={labels.all} className="moduleBiTotalCol" />
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row, index) => (
                    <tr key={`${row.transactionDate}-${row.voucherNumber}-${row.itemCode}-${row.customerCode}-${index}`}>
                      <td>{formatDate(row.transactionDate)}</td>
                      <td>{row.voucherNumber || "—"}</td>
                      <td>{row.voucherType || "—"}</td>
                      <td>{row.reference || "—"}</td>
                      <td>{row.salesmanCode || "—"}</td>
                      <td>{row.salesmanName || "—"}</td>
                      <td>{row.customerCode || "—"}</td>
                      <td>{row.customerName || "—"}</td>
                      <td>{row.itemCode || "—"}</td>
                      <td>{row.itemName || "—"}</td>
                      <td>{row.category || "—"}</td>
                      <td>{row.localImport || "—"}</td>
                      <td>{row.abcClass || "—"}</td>
                      <td>{formatQty(row.quantity)}</td>
                      <td>{formatAmount(row.rate)}</td>
                      <td className="moduleBiTotalCol">{formatAmount(row.salesAmount)}</td>
                      <td className="moduleBiTotalCol moduleBiMonthCell--down">{formatAmount(row.profitAmount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={13}>{labels.total} ({visibleTotals.lineCount.toLocaleString("en-SA")})</td>
                    <td>{formatQty(visibleTotals.quantity)}</td>
                    <td />
                    <td className="moduleBiTotalCol">{formatAmount(visibleTotals.salesAmount)}</td>
                    <td className="moduleBiTotalCol moduleBiMonthCell--down">{formatAmount(visibleTotals.profitAmount)}</td>
                  </tr>
                </tfoot>
              </table>
            </ExportableTable>
          )}
        </>
      ) : null}
    </section>
  );
}
