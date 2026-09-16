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
  return "paymentSettleStatus paymentSettleStatus--open";
}

function InvoiceSettlementRow({ invoice, open, onToggle }) {
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
          {invoice.settlements?.length ? (
            <button type="button" className="moduleInlineButton" onClick={onToggle}>
              {open ? "Hide" : `Show ${invoice.settlements.length}`}
            </button>
          ) : "—"}
        </td>
      </tr>
      {open && (invoice.settlements || []).map((settlement, index) => (
        <tr key={`${invoice.invoice_date}-${settlement.receipt_date}-${index}`} className="paymentSettleChildRow">
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
    </>
  );
}

export default function InvoiceSettlement({ ledger, filenamePrefix = "customer-settlement" }) {
  const [expandedInvoice, setExpandedInvoice] = useState("");

  if (!ledger) return null;

  const totals = ledger.totals || {};
  const invoices = Array.isArray(ledger.invoices) ? ledger.invoices : [];
  const reversed = Array.isArray(ledger.reversedInvoices) ? ledger.reversedInvoices : [];
  const invoicePaidTotal = Number(totals.paid_amount || 0) - Number(totals.reversed_sales_incl_vat || 0);

  return (
    <>
      <section className="auditSection">
        <div className="auditTransactionHeader">
          <div>
            <h3>Invoices & Settlement</h3>
            <p className="auditSectionNote">
              FIFO payment days from receipts. Open amounts follow the outstanding upload when available.
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
    </>
  );
}
