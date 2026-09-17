"use client";

import { useState } from "react";
import ExportableTable from "../../../components/ExportableTable";

function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatCount(value) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function statusClass(status) {
  if (status === "Paid") return "paymentSettleStatus paymentSettleStatus--paid";
  if (status === "Partial") return "paymentSettleStatus paymentSettleStatus--partial";
  if (status === "Reversed") return "paymentSettleStatus paymentSettleStatus--reversed";
  if (status === "Credit" || status === "Sales Return" || status === "Credit Note") {
    return "paymentSettleStatus paymentSettleStatus--credit";
  }
  return "paymentSettleStatus paymentSettleStatus--open";
}

function InvoiceSettlementRow({ invoice, open, onToggle }) {
  const receiptCount = Array.isArray(invoice.settlements) ? invoice.settlements.length : 0;
  const creditCount = Array.isArray(invoice.credit_notes) ? invoice.credit_notes.length : 0;
  const detailCount = receiptCount + creditCount;

  return (
    <>
      <tr>
        <td>{invoice.invoice_date || "—"}</td>
        <td>{invoice.voucher_number || "—"}</td>
        <td>{formatMoney(invoice.amount_excl_vat)}</td>
        <td>{formatMoney(invoice.amount_incl_vat)}</td>
        <td>{formatMoney(invoice.paid_amount)}</td>
        <td>{formatMoney(invoice.remaining)}</td>
        <td><span className={statusClass(invoice.status)}>{invoice.status}</span></td>
        <td>
          {invoice.payment_days != null
            ? invoice.payment_days
            : (invoice.open_days > 0 ? `Open ${invoice.open_days}d` : "—")}
        </td>
        <td>
          {detailCount ? (
            <button type="button" className="moduleInlineButton" onClick={onToggle}>
              {open ? "Hide" : `Show ${detailCount}`}
            </button>
          ) : "—"}
        </td>
      </tr>
      {open && (invoice.settlements || []).map((settlement, index) => (
        <tr key={`${invoice.invoice_date}-rcpt-${settlement.receipt_date}-${index}`} className="paymentSettleChildRow">
          <td colSpan={2} style={{ paddingLeft: 18 }}>
            Paid on {settlement.receipt_date}
            {settlement.vch_no ? ` · Rcpt ${settlement.vch_no}` : ""}
          </td>
          <td colSpan={2} />
          <td>{formatMoney(settlement.amount)}</td>
          <td />
          <td />
          <td>{settlement.days != null ? `${settlement.days} days` : "—"}</td>
          <td />
        </tr>
      ))}
      {open && (invoice.credit_notes || []).map((note, index) => (
        <tr key={`${invoice.invoice_date}-cn-${note.voucher_number}-${index}`} className="paymentSettleChildRow paymentSettleChildRow--credit">
          <td colSpan={2} style={{ paddingLeft: 18 }}>
            {note.kind || "Credit note"}
            {" · "}
            {note.voucher_number || "—"}
            {note.credit_date ? ` · ${note.credit_date}` : ""}
          </td>
          <td colSpan={2} />
          <td>{formatMoney(note.amount)}</td>
          <td />
          <td><span className={statusClass("Credit")}>{note.kind || "Credit"}</span></td>
          <td>Not in avg days</td>
          <td />
        </tr>
      ))}
    </>
  );
}

export default function InvoiceSettlement({ ledger, filenamePrefix = "customer-settlement" }) {
  const [expandedInvoice, setExpandedInvoice] = useState("");

  if (!ledger) return null;

  const totals = ledger.totals || {};
  const summary = ledger.summary || {};
  const invoices = Array.isArray(ledger.invoices) ? ledger.invoices : [];
  const reversed = Array.isArray(ledger.reversedInvoices) ? ledger.reversedInvoices : [];
  const creditNotes = Array.isArray(ledger.creditNotes) ? ledger.creditNotes : [];
  const invoicePaidTotal = Number(totals.paid_amount || 0) - Number(totals.reversed_sales_incl_vat || 0);
  const salesInclVat = Number(
    totals.net_sales_incl_vat != null ? totals.net_sales_incl_vat : totals.sales_incl_vat || 0,
  );
  const collected = Number(totals.collected_amount || 0);
  const openAmount = Number(totals.open_sales_amount || 0);
  const salesMinusCollected = Number(
    totals.sales_minus_collected != null ? totals.sales_minus_collected : salesInclVat - collected,
  );
  const balanceMatches = totals.sales_collected_matches_open !== false;
  const openMatchesOutstanding = totals.open_matches_outstanding !== false;
  const creditNoteAmount = Number(totals.credit_note_amount || 0);

  return (
    <>
      <section className="auditSection">
        <div className="auditSummaryGrid" style={{ marginBottom: "12px" }}>
          <div className="auditSummaryCard">
            <span>Avg Days to Pay</span>
            <strong>
              {summary.avgDaysToPay != null ? `${summary.avgDaysToPay} days` : "—"}
            </strong>
            <em className="auditSummaryCardMeta">
              {summary.avgDaysToPay != null
                ? (Number(summary.openAmountInAvg || 0) > 0.009
                  ? "Paid avg + open invoices older than that avg only"
                  : "From collected receipts")
                : "Needs sales, receipts, or open invoices"}
            </em>
            {summary.avgDaysPaidOnly != null
              && Number(summary.openAmountInAvg || 0) > 0.009
              && summary.avgDaysPaidOnly !== summary.avgDaysToPay ? (
              <em className="auditSummaryCardMeta">
                Paid-only avg: {formatCount(summary.avgDaysPaidOnly)}d
              </em>
            ) : null}
            {Number(summary.outstandingOldestDays || 0) > 0 ? (
              <em className="auditSummaryCardMeta">
                Oldest unpaid invoice: {formatCount(summary.outstandingOldestDays)}d
                {Number(summary.outstandingOverdueCount || 0) > 0
                  ? ` · ${formatCount(summary.outstandingOverdueCount)} overdue`
                  : ""}
              </em>
            ) : null}
          </div>
          <div className="auditSummaryCard">
            <span>Sales incl. VAT</span>
            <strong>{formatMoney(salesInclVat)}</strong>
            {creditNoteAmount > 0.009 ? (
              <em className="auditSummaryCardMeta">
                After credit notes {formatMoney(creditNoteAmount)}
              </em>
            ) : (
              <em className="auditSummaryCardMeta">Gloves stay excl. VAT</em>
            )}
          </div>
          <div className="auditSummaryCard">
            <span>Collected</span>
            <strong>{formatMoney(collected)}</strong>
          </div>
          <div className="auditSummaryCard">
            <span>Open / Outstanding</span>
            <strong>{formatMoney(openAmount)}</strong>
            {openMatchesOutstanding === false ? (
              <em className="auditSummaryCardMeta">
                Does not match outstanding upload {formatMoney(totals.outstanding_unpaid)}
              </em>
            ) : balanceMatches === false ? (
              <em className="auditSummaryCardMeta">
                Sales − Collected {formatMoney(salesMinusCollected)} (gap {formatMoney(totals.balance_delta)})
              </em>
            ) : (
              <em className="auditSummaryCardMeta">Sales − Collected = Open (matches outstanding)</em>
            )}
          </div>
        </div>
      </section>

      <section className="auditSection">
        <div className="auditTransactionHeader">
          <div>
            <h3>Invoices & Settlement</h3>
            <p className="auditSectionNote">
              FIFO payment days from receipts. Open amounts follow the outstanding upload when available.
              Gloves are sold without VAT; other lines are grossed up at 15%.
            </p>
          </div>
          <span>
            {formatCount(totals.paid_invoice_count)} paid ·{" "}
            {formatCount(totals.partial_invoice_count)} partial ·{" "}
            {formatCount(totals.open_invoice_count)} open
          </span>
        </div>

        <ExportableTable filename={`${filenamePrefix}-invoices`} sheetName="Invoices" className="moduleTableWrap" style={{ marginTop: "10px" }}>
          <table className="moduleTable moduleBiTable paymentSettleTable">
            <thead>
              <tr>
                <th>Sales Date</th>
                <th>Voucher</th>
                <th>Sales excl VAT</th>
                <th>Sales incl VAT</th>
                <th>Paid</th>
                <th>Open</th>
                <th>Status</th>
                <th>Payment Days</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => {
                const key = `${invoice.invoice_date}::${invoice.voucher_number}`;
                const open = expandedInvoice === key;
                return (
                  <InvoiceSettlementRow
                    key={key}
                    invoice={invoice}
                    open={open}
                    onToggle={() => setExpandedInvoice(open ? "" : key)}
                  />
                );
              })}
              {!invoices.length && (
                <tr>
                  <td colSpan={9}>No sales invoices found for this customer in history.</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}><strong>Total</strong></td>
                <td><strong>{formatMoney(totals.invoice_sales_excl_vat ?? totals.sales_excl_vat)}</strong></td>
                <td><strong>{formatMoney(totals.invoice_sales_incl_vat ?? totals.sales_incl_vat)}</strong></td>
                <td><strong>{formatMoney(invoicePaidTotal)}</strong></td>
                <td><strong>{formatMoney(totals.open_sales_amount)}</strong></td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </ExportableTable>
      </section>

      <section className="auditSection">
        <div className="auditTransactionHeader">
          <div>
            <h3>Reversed by Credit Note</h3>
            <p className="auditSectionNote">
              Same-day or next-day credit notes that fully reverse an invoice. Excluded from avg days to pay.
            </p>
          </div>
          <span>{formatCount(totals.reversed_invoice_count || 0)} excluded from avg days</span>
        </div>

        <ExportableTable filename={`${filenamePrefix}-reversed`} sheetName="Reversed" className="moduleTableWrap" style={{ marginTop: "10px" }}>
          <table className="moduleTable moduleBiTable paymentSettleTable">
            <thead>
              <tr>
                <th>Sales Date</th>
                <th>Invoice Voucher</th>
                <th>Sales excl VAT</th>
                <th>Sales incl VAT</th>
                <th>Credit Note Date</th>
                <th>Credit Note Voucher</th>
                <th>Credit Note Amount</th>
                <th>Reversal Days</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {reversed.map((row) => (
                <tr key={`${row.invoice_date}::${row.voucher_number}::${row.credit_note_voucher}`}>
                  <td>{row.invoice_date || "—"}</td>
                  <td>{row.voucher_number || "—"}</td>
                  <td>{formatMoney(row.amount_excl_vat)}</td>
                  <td>{formatMoney(row.amount_incl_vat)}</td>
                  <td>{row.credit_note_date || "—"}</td>
                  <td>{row.credit_note_voucher || "—"}</td>
                  <td>{formatMoney(row.credit_note_amount)}</td>
                  <td>{row.reversal_days != null ? row.reversal_days : "—"}</td>
                  <td><span className={statusClass("Reversed")}>Reversed</span></td>
                </tr>
              ))}
              {!reversed.length && (
                <tr>
                  <td colSpan={9}>No immediate credit-note reversals for this customer.</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}><strong>Total</strong></td>
                <td><strong>{formatMoney(totals.reversed_sales_excl_vat || 0)}</strong></td>
                <td><strong>{formatMoney(totals.reversed_sales_incl_vat || 0)}</strong></td>
                <td colSpan={5} />
              </tr>
            </tfoot>
          </table>
        </ExportableTable>
      </section>

      <section className="auditSection">
        <div className="auditTransactionHeader">
          <div>
            <h3>Credit Notes & Sales Returns</h3>
            <p className="auditSectionNote">
              Partial or later credit notes and sales returns. Nested under the invoice with cash
              receipts for display only — never included in avg days to pay or collected cash.
            </p>
          </div>
          <span>{formatCount(totals.credit_note_count || creditNotes.length)} vouchers</span>
        </div>

        <ExportableTable filename={`${filenamePrefix}-credit-notes`} sheetName="CreditNotes" className="moduleTableWrap" style={{ marginTop: "10px" }}>
          <table className="moduleTable moduleBiTable paymentSettleTable">
            <thead>
              <tr>
                <th>Date</th>
                <th>Voucher</th>
                <th>Type</th>
                <th>Reference</th>
                <th>Applied To</th>
                <th>Excl VAT</th>
                <th>Incl VAT</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {creditNotes.map((row) => (
                <tr key={`${row.credit_date}::${row.voucher_number}`}>
                  <td>{row.credit_date || "—"}</td>
                  <td>{row.voucher_number || "—"}</td>
                  <td>{row.kind || row.voucher_type || "Credit Note"}</td>
                  <td>{row.reference || "—"}</td>
                  <td>{row.applied_to_voucher || "—"}</td>
                  <td>{formatMoney(row.amount_excl_vat)}</td>
                  <td>{formatMoney(row.amount_incl_vat)}</td>
                  <td><span className={statusClass("Credit")}>{row.kind || "Credit"}</span></td>
                </tr>
              ))}
              {!creditNotes.length && (
                <tr>
                  <td colSpan={8}>No partial credit notes or sales returns for this customer.</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}><strong>Total</strong></td>
                <td><strong>{formatMoney(totals.credit_note_excl_vat || 0)}</strong></td>
                <td><strong>{formatMoney(totals.credit_note_amount || 0)}</strong></td>
                <td />
              </tr>
            </tfoot>
          </table>
        </ExportableTable>
      </section>
    </>
  );
}
