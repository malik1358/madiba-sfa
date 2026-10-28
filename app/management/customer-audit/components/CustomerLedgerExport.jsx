"use client";

import { useMemo, useState } from "react";
import BiExcelHead, { useBiExcelFilters } from "../../business-dashboard/BiExcelHead";
import {
  datewiseFilterValue,
  flattenLedgerLinesExcludingReversed,
  formatOptionalMoney,
  openSettlementInvoices,
  sumDatewise,
} from "../../../lib/datewiseLines.js";
import {
  buildCustomerLedgerPdfModel,
  downloadCustomerLedgerPdf,
} from "../../../lib/customerLedgerPdf.js";
import { formatSettlementOpenDelta, isSettlementOpenDeltaDust, settlementTransactionDelta } from "../../../lib/settlementOpenDelta.js";
import { getKsaDateString } from "../../../lib/workdayActivity.js";

const LEDGER_FILTER_KEYS = ["date", "kind", "voucher", "excl", "incl", "collected", "open", "detail"];
const OPEN_FILTER_KEYS = ["date", "voucher", "excl", "incl", "paid", "machine", "tally", "delta", "status", "days"];
const REVERSED_FILTER_KEYS = ["date", "voucher", "excl", "incl", "cnDate", "cnVoucher", "cnAmount", "days", "status"];

function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatCount(value) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatDelta(value) {
  return formatSettlementOpenDelta(value);
}

function deltaClass(value) {
  if (isSettlementOpenDeltaDust(value)) return "";
  return Number(value || 0) > 0 ? "moduleBiMonthCell--up" : "moduleBiMonthCell--down";
}

function statusClass(status) {
  if (status === "Paid") return "paymentSettleStatus paymentSettleStatus--paid";
  if (status === "Partial") return "paymentSettleStatus paymentSettleStatus--partial";
  if (status === "Reversed" || status === "Tally") return "paymentSettleStatus paymentSettleStatus--reversed";
  if (status === "Credit" || status === "Sales Return" || status === "Credit Note") {
    return "paymentSettleStatus paymentSettleStatus--credit";
  }
  return "paymentSettleStatus paymentSettleStatus--open";
}

function kindClass(kind) {
  const key = String(kind || "").toLowerCase();
  if (key === "invoice") return "customerLedgerKind customerLedgerKind--invoice";
  if (key === "receipt") return "customerLedgerKind customerLedgerKind--receipt";
  if (key === "payment") return "customerLedgerKind customerLedgerKind--payment";
  if (key === "purchase") return "customerLedgerKind customerLedgerKind--purchase";
  if (key.includes("credit") || key.includes("return") || key.includes("sales return")) {
    return "customerLedgerKind customerLedgerKind--credit";
  }
  return "customerLedgerKind";
}

function openFilterValue(row, key) {
  if (key === "date") return row.invoice_date || "—";
  if (key === "voucher") return row.voucher_number || "—";
  if (key === "excl") return formatMoney(row.amount_excl_vat);
  if (key === "incl") return formatMoney(row.amount_incl_vat);
  if (key === "paid") return formatMoney(row.paid_amount);
  if (key === "machine") return formatMoney(row.remaining);
  if (key === "tally") {
    return row.outstanding_pending == null ? "—" : formatMoney(row.outstanding_pending);
  }
  if (key === "delta") {
    const delta = settlementTransactionDelta(row);
    return delta == null ? "—" : formatDelta(delta);
  }
  if (key === "status") return row.status || "—";
  if (row.payment_days != null) return String(row.payment_days);
  if (row.open_days > 0) return `Open ${row.open_days}d`;
  return "—";
}

function reversedFilterValue(row, key) {
  if (key === "date") return row.invoice_date || "—";
  if (key === "voucher") return row.voucher_number || "—";
  if (key === "excl") return formatMoney(row.amount_excl_vat);
  if (key === "incl") return formatMoney(row.amount_incl_vat);
  if (key === "cnDate") return row.credit_note_date || "—";
  if (key === "cnVoucher") return row.credit_note_voucher || "—";
  if (key === "cnAmount") return formatMoney(row.credit_note_amount);
  if (key === "days") return row.reversal_days != null ? String(row.reversal_days) : "—";
  return "Reversed";
}

export default function CustomerLedgerExport({
  customer,
  ledger,
  outstandingCustomer = null,
  outstandingBucketLabels = [],
}) {
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportError, setExportError] = useState("");
  const invoices = Array.isArray(ledger?.invoices) ? ledger.invoices : [];
  const reversedInvoices = Array.isArray(ledger?.reversedInvoices) ? ledger.reversedInvoices : [];
  const totals = ledger?.totals || {};

  const ledgerLines = useMemo(
    () => flattenLedgerLinesExcludingReversed(ledger?.datewise || []),
    [ledger?.datewise],
  );
  const openInvoices = useMemo(() => openSettlementInvoices(invoices), [invoices]);

  const {
    filters: ledgerFilters,
    setFilter: setLedgerFilter,
    options: ledgerOptions,
    visibleRows: visibleLedgerLines,
  } = useBiExcelFilters(ledgerLines, LEDGER_FILTER_KEYS, datewiseFilterValue);

  const {
    filters: openFilters,
    setFilter: setOpenFilter,
    options: openOptions,
    visibleRows: visibleOpenInvoices,
  } = useBiExcelFilters(openInvoices, OPEN_FILTER_KEYS, openFilterValue);

  const {
    filters: reversedFilters,
    setFilter: setReversedFilter,
    options: reversedOptions,
    visibleRows: visibleReversed,
  } = useBiExcelFilters(reversedInvoices, REVERSED_FILTER_KEYS, reversedFilterValue);

  if (!ledger || !customer) return null;

  async function handleExportPdf() {
    if (exportingPdf) return;
    setExportingPdf(true);
    setExportError("");
    try {
      const model = buildCustomerLedgerPdfModel({
        customer,
        ledger,
        asOfDate: getKsaDateString(),
        lines: visibleLedgerLines,
        outstandingCustomer,
        outstandingBucketLabels,
      });
      if (!model) throw new Error("Ledger is not ready for PDF export.");
      await downloadCustomerLedgerPdf(model);
    } catch (error) {
      setExportError(error?.message || "Could not create the ledger PDF.");
    } finally {
      setExportingPdf(false);
    }
  }

  const openMachineTotal = visibleOpenInvoices.reduce(
    (total, row) => total + Number(row.remaining || 0),
    0,
  );
  const openTallyTotal = visibleOpenInvoices.reduce(
    (total, row) => total + (row.outstanding_pending == null ? 0 : Number(row.outstanding_pending || 0)),
    0,
  );
  const openDeltaTotal = visibleOpenInvoices.reduce(
    (total, row) => total + (settlementTransactionDelta(row) || 0),
    0,
  );
  const reversedExclTotal = visibleReversed.reduce(
    (total, row) => total + Number(row.amount_excl_vat || 0),
    0,
  );
  const reversedInclTotal = visibleReversed.reduce(
    (total, row) => total + Number(row.amount_incl_vat || 0),
    0,
  );

  return (
    <section className="auditSection customerLedgerExport">
      <div className="auditTransactionHeader">
        <div>
          <h3>Customer Ledger</h3>
          <p className="auditSectionNote">
            Balance-confirmation PDF: party ledger (Debit / Credit / Balance), open invoices,
            and reversed invoices excluded from the ledger. Immediate credit-note reversals
            stay out of the main account statement.
          </p>
        </div>
        <div className="customerLedgerExportActions">
          <span>
            {formatCount(ledgerLines.length)} ledger ·{" "}
            {formatCount(openInvoices.length)} open ·{" "}
            {formatCount(reversedInvoices.length)} reversed
          </span>
          <button
            type="button"
            className="moduleInlineButton"
            onClick={handleExportPdf}
            disabled={exportingPdf}
            title="Download balance confirmation PDF"
          >
            {exportingPdf ? "Preparing PDF..." : "Export Ledger PDF"}
          </button>
        </div>
      </div>
      {exportError ? (
        <div className="moduleHint" style={{ marginTop: "8px", color: "#9b1c1c" }}>{exportError}</div>
      ) : null}

      <div className="auditSummaryGrid" style={{ marginTop: "12px", marginBottom: "12px" }}>
        <div className="auditSummaryCard">
          <span>Ledger sales incl. VAT</span>
          <strong>{formatMoney(sumDatewise(visibleLedgerLines, "sales_incl_vat"))}</strong>
          <em className="auditSummaryCardMeta">Reversed invoices excluded</em>
        </div>
        <div className="auditSummaryCard">
          <span>Collected</span>
          <strong>{formatMoney(sumDatewise(visibleLedgerLines, "collected_amount"))}</strong>
        </div>
        <div className="auditSummaryCard">
          <span>Open invoices</span>
          <strong className="moduleBiMonthCell--down">{formatMoney(openMachineTotal)}</strong>
          <em className="auditSummaryCardMeta">{formatCount(visibleOpenInvoices.length)} bills</em>
        </div>
        <div className="auditSummaryCard">
          <span>Reversed (excluded)</span>
          <strong>{formatMoney(totals.reversed_sales_incl_vat || reversedInclTotal)}</strong>
          <em className="auditSummaryCardMeta">{formatCount(reversedInvoices.length)} voided</em>
        </div>
      </div>

      <div className="customerLedgerBlock">
        <div className="auditTransactionHeader">
          <div>
            <h4>Ledger</h4>
            <p className="auditSectionNote">
              One row per voucher. Reversed invoices and their voiding credit notes / refunds
              are not included here.
            </p>
          </div>
        </div>
        <div className="moduleTableWrap" style={{ marginTop: "10px" }}>
          <table className="moduleTable moduleBiTable paymentSettleTable customerLedgerTable">
            <thead>
              <tr>
                <BiExcelHead label="Date" filterKey="date" options={ledgerOptions} filters={ledgerFilters} onChange={setLedgerFilter} />
                <BiExcelHead label="Type" filterKey="kind" options={ledgerOptions} filters={ledgerFilters} onChange={setLedgerFilter} />
                <BiExcelHead label="Voucher" filterKey="voucher" options={ledgerOptions} filters={ledgerFilters} onChange={setLedgerFilter} />
                <BiExcelHead label="Sales excl VAT" filterKey="excl" options={ledgerOptions} filters={ledgerFilters} onChange={setLedgerFilter} />
                <BiExcelHead label="Sales incl VAT" filterKey="incl" options={ledgerOptions} filters={ledgerFilters} onChange={setLedgerFilter} />
                <BiExcelHead label="Collected" filterKey="collected" options={ledgerOptions} filters={ledgerFilters} onChange={setLedgerFilter} />
                <BiExcelHead label="Open" filterKey="open" options={ledgerOptions} filters={ledgerFilters} onChange={setLedgerFilter} className="moduleBiTotalCol" />
                <BiExcelHead label="Detail" filterKey="detail" options={ledgerOptions} filters={ledgerFilters} onChange={setLedgerFilter} />
              </tr>
            </thead>
            <tbody>
              {visibleLedgerLines.map((row) => (
                <tr key={row.id} className={`customerLedgerRow customerLedgerRow--${String(row.kind || "other").toLowerCase().replace(/\s+/g, "-")}`}>
                  <td>{row.date || "—"}</td>
                  <td><span className={kindClass(row.kind)}>{row.kind}</span></td>
                  <td>{row.voucher}</td>
                  <td>{formatOptionalMoney(row.sales_excl_vat)}</td>
                  <td>{formatOptionalMoney(row.sales_incl_vat)}</td>
                  <td className={row.collected_amount != null && Number(row.collected_amount) > 0.009 ? "moduleBiMonthCell--up" : ""}>
                    {formatOptionalMoney(row.collected_amount)}
                  </td>
                  <td className={`moduleBiTotalCol${row.open_amount != null && Number(row.open_amount) > 0.009 ? " moduleBiMonthCell--down" : ""}`}>
                    {formatOptionalMoney(row.open_amount)}
                  </td>
                  <td>
                    {row.kind === "Invoice" && row.detail
                      ? <span className={statusClass(row.detail)}>{row.detail}</span>
                      : (row.detail || "—")}
                  </td>
                </tr>
              ))}
              {!visibleLedgerLines.length && (
                <tr>
                  <td colSpan={8}>
                    {ledgerLines.length
                      ? "No rows match these column filters."
                      : "No dated sales or collections found for this customer."}
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td><strong>Total</strong></td>
                <td><strong>{formatCount(visibleLedgerLines.length)}</strong></td>
                <td />
                <td><strong>{formatMoney(sumDatewise(visibleLedgerLines, "sales_excl_vat"))}</strong></td>
                <td><strong>{formatMoney(sumDatewise(visibleLedgerLines, "sales_incl_vat"))}</strong></td>
                <td><strong>{formatMoney(sumDatewise(visibleLedgerLines, "collected_amount"))}</strong></td>
                <td className="moduleBiTotalCol"><strong>{formatMoney(sumDatewise(visibleLedgerLines, "open_amount"))}</strong></td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="customerLedgerBlock" style={{ marginTop: "18px" }}>
        <div className="auditTransactionHeader">
          <div>
            <h4>Open Invoices</h4>
            <p className="auditSectionNote">
              Bills still carrying Machine Open. Separate from the ledger so unpaid exposure is
              clear at a glance.
            </p>
          </div>
          <span>{formatCount(visibleOpenInvoices.length)} open</span>
        </div>
        <div className="moduleTableWrap" style={{ marginTop: "10px" }}>
          <table className="moduleTable moduleBiTable paymentSettleTable">
            <thead>
              <tr>
                <BiExcelHead label="Sales Date" filterKey="date" options={openOptions} filters={openFilters} onChange={setOpenFilter} />
                <BiExcelHead label="Voucher" filterKey="voucher" options={openOptions} filters={openFilters} onChange={setOpenFilter} />
                <BiExcelHead label="Sales excl VAT" filterKey="excl" options={openOptions} filters={openFilters} onChange={setOpenFilter} />
                <BiExcelHead label="Sales incl VAT" filterKey="incl" options={openOptions} filters={openFilters} onChange={setOpenFilter} />
                <BiExcelHead label="Paid" filterKey="paid" options={openOptions} filters={openFilters} onChange={setOpenFilter} />
                <BiExcelHead label="Machine Open" filterKey="machine" options={openOptions} filters={openFilters} onChange={setOpenFilter} />
                <BiExcelHead label="Tally Open" filterKey="tally" options={openOptions} filters={openFilters} onChange={setOpenFilter} />
                <BiExcelHead label="Open Δ" filterKey="delta" options={openOptions} filters={openFilters} onChange={setOpenFilter} className="moduleBiTotalCol" />
                <BiExcelHead label="Status" filterKey="status" options={openOptions} filters={openFilters} onChange={setOpenFilter} />
                <BiExcelHead label="Days" filterKey="days" options={openOptions} filters={openFilters} onChange={setOpenFilter} />
              </tr>
            </thead>
            <tbody>
              {visibleOpenInvoices.map((invoice) => {
                const openDelta = settlementTransactionDelta(invoice);
                const tallyOnly = Boolean(invoice.tally_only);
                return (
                  <tr key={`open-${invoice.invoice_date}::${invoice.voucher_number}`}>
                    <td>{invoice.invoice_date || "—"}</td>
                    <td>{invoice.voucher_number || "—"}</td>
                    <td>{tallyOnly ? "—" : formatMoney(invoice.amount_excl_vat)}</td>
                    <td>{tallyOnly ? "—" : formatMoney(invoice.amount_incl_vat)}</td>
                    <td>{tallyOnly ? "—" : formatMoney(invoice.paid_amount)}</td>
                    <td className="moduleBiMonthCell--down">{formatMoney(invoice.remaining)}</td>
                    <td>{invoice.outstanding_pending == null ? "—" : formatMoney(invoice.outstanding_pending)}</td>
                    <td className={`moduleBiTotalCol ${openDelta == null ? "" : deltaClass(openDelta)}`}>
                      {openDelta == null ? "—" : formatDelta(openDelta)}
                    </td>
                    <td><span className={statusClass(invoice.status)}>{invoice.status}</span></td>
                    <td>
                      {invoice.payment_days != null
                        ? invoice.payment_days
                        : (invoice.open_days > 0 ? `Open ${invoice.open_days}d` : "—")}
                    </td>
                  </tr>
                );
              })}
              {!visibleOpenInvoices.length && (
                <tr>
                  <td colSpan={10}>
                    {openInvoices.length
                      ? "No rows match these column filters."
                      : "No open invoices for this customer."}
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}><strong>Total</strong></td>
                <td><strong>{formatMoney(visibleOpenInvoices.reduce((t, r) => t + Number(r.amount_excl_vat || 0), 0))}</strong></td>
                <td><strong>{formatMoney(visibleOpenInvoices.reduce((t, r) => t + Number(r.amount_incl_vat || 0), 0))}</strong></td>
                <td><strong>{formatMoney(visibleOpenInvoices.reduce((t, r) => t + Number(r.paid_amount || 0), 0))}</strong></td>
                <td className="moduleBiMonthCell--down"><strong>{formatMoney(openMachineTotal)}</strong></td>
                <td><strong>{formatMoney(openTallyTotal)}</strong></td>
                <td className={`moduleBiTotalCol ${deltaClass(openDeltaTotal)}`}>
                  <strong>{formatDelta(openDeltaTotal)}</strong>
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="customerLedgerBlock" style={{ marginTop: "18px" }}>
        <div className="auditTransactionHeader">
          <div>
            <h4>Reversed Invoices</h4>
            <p className="auditSectionNote">
              Same-day / next-day / previous-day full credit-note reversals. Shown here only —
              not in the ledger table above.
            </p>
          </div>
          <span>{formatCount(visibleReversed.length)} excluded from ledger</span>
        </div>
        <div className="moduleTableWrap" style={{ marginTop: "10px" }}>
          <table className="moduleTable moduleBiTable paymentSettleTable">
            <thead>
              <tr>
                <BiExcelHead label="Sales Date" filterKey="date" options={reversedOptions} filters={reversedFilters} onChange={setReversedFilter} />
                <BiExcelHead label="Invoice Voucher" filterKey="voucher" options={reversedOptions} filters={reversedFilters} onChange={setReversedFilter} />
                <BiExcelHead label="Sales excl VAT" filterKey="excl" options={reversedOptions} filters={reversedFilters} onChange={setReversedFilter} />
                <BiExcelHead label="Sales incl VAT" filterKey="incl" options={reversedOptions} filters={reversedFilters} onChange={setReversedFilter} />
                <BiExcelHead label="Credit Note Date" filterKey="cnDate" options={reversedOptions} filters={reversedFilters} onChange={setReversedFilter} />
                <BiExcelHead label="Credit Note Voucher" filterKey="cnVoucher" options={reversedOptions} filters={reversedFilters} onChange={setReversedFilter} />
                <BiExcelHead label="Credit Note Amount" filterKey="cnAmount" options={reversedOptions} filters={reversedFilters} onChange={setReversedFilter} className="moduleBiTotalCol" />
                <BiExcelHead label="Reversal Days" filterKey="days" options={reversedOptions} filters={reversedFilters} onChange={setReversedFilter} />
                <BiExcelHead label="Status" filterKey="status" options={reversedOptions} filters={reversedFilters} onChange={setReversedFilter} />
              </tr>
            </thead>
            <tbody>
              {visibleReversed.map((row) => (
                <tr key={`rev-${row.invoice_date}::${row.voucher_number}::${row.credit_note_voucher}`}>
                  <td>{row.invoice_date || "—"}</td>
                  <td>{row.voucher_number || "—"}</td>
                  <td>{formatMoney(row.amount_excl_vat)}</td>
                  <td>{formatMoney(row.amount_incl_vat)}</td>
                  <td>{row.credit_note_date || "—"}</td>
                  <td>{row.credit_note_voucher || "—"}</td>
                  <td className="moduleBiTotalCol">{formatMoney(row.credit_note_amount)}</td>
                  <td>{row.reversal_days != null ? row.reversal_days : "—"}</td>
                  <td><span className={statusClass("Reversed")}>Reversed</span></td>
                </tr>
              ))}
              {!visibleReversed.length && (
                <tr>
                  <td colSpan={9}>
                    {reversedInvoices.length
                      ? "No rows match these column filters."
                      : "No immediate credit-note reversals for this customer."}
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}><strong>Total</strong></td>
                <td><strong>{formatMoney(reversedExclTotal)}</strong></td>
                <td><strong>{formatMoney(reversedInclTotal)}</strong></td>
                <td colSpan={5} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </section>
  );
}
