"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import ExportableTable from "../../components/ExportableTable";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { resolveAuthSession } from "../../lib/authSession";
import { buildPaymentSettlementLedger } from "../../lib/paymentBehavior.js";
import { getSupabaseClient } from "../../lib/supabase";
import { usePopupMessages } from "../../hooks/usePopupMessages";
import { useModuleAccess } from "../../hooks/useModuleAccess";

const TEXT = {
  title: { en: "Payment Settlement", ar: "تسوية المدفوعات" },
  subtitle: {
    en: "Customer-wise sales vs collections, FIFO settlement, and payment days per invoice.",
    ar: "مبيعات مقابل التحصيل لكل عميل، التسوية حسب الأقدم أولاً، وأيام الدفع لكل فاتورة.",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  audit: { en: "Customers Audit", ar: "عملائي" },
  search: { en: "Search customer code or name", ar: "بحث بكود أو اسم العميل" },
  loading: { en: "Loading settlement...", ar: "جاري تحميل التسوية..." },
  selectCustomer: {
    en: "Select a customer to see sales, collections, and settlement.",
    ar: "اختر عميلاً لعرض المبيعات والتحصيل والتسوية.",
  },
  note: {
    en: "Paid and Open follow cash FIFO on each invoice (not forced to the outstanding upload). Use Outstanding Compare for Tally vs computed gaps. Avg days uses paid receipts, then only open invoices older than that paid avg. Immediate credit-note reversals stay in Sales but are excluded from avg days.",
    ar: "المدفوع والمفتوح يتبعان التحصيل حسب الأقدم أولاً لكل فاتورة (دون إجبار ملف المستحقات). استخدم مقارنة المستحقات لفروق تالي. متوسط الأيام من الإيصالات المدفوعة ثم فقط الفواتير المفتوحة الأقدم من ذلك المتوسط. العكس الفوري بإشعار دائن يبقى في المبيعات ويُستبعد من متوسط الأيام.",
  },
};

function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatCount(value) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatDelta(value) {
  const number = Number(value || 0);
  if (Math.abs(number) <= 0.009) return "0";
  const sign = number > 0 ? "+" : "";
  return `${sign}${number.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function deltaClass(value) {
  const number = Number(value || 0);
  if (number > 0.02) return "moduleBiMonthCell--up";
  if (number < -0.02) return "moduleBiMonthCell--down";
  return "";
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
  const machineOpen = Number(invoice.remaining || 0);
  const tallyOpen = invoice.outstanding_pending == null ? null : Number(invoice.outstanding_pending || 0);
  const openDelta = tallyOpen == null ? null : machineOpen - tallyOpen;

  return (
    <>
      <tr>
        <td>{invoice.invoice_date || "—"}</td>
        <td>{invoice.voucher_number || "—"}</td>
        <td>{formatMoney(invoice.amount_excl_vat)}</td>
        <td>{formatMoney(invoice.amount_incl_vat)}</td>
        <td>{formatMoney(invoice.paid_amount)}</td>
        <td>{formatMoney(machineOpen)}</td>
        <td>{tallyOpen == null ? "—" : formatMoney(tallyOpen)}</td>
        <td className={openDelta == null ? "" : deltaClass(openDelta)}>
          {openDelta == null ? "—" : formatDelta(openDelta)}
        </td>
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
          <td colSpan={3} />
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
          <td colSpan={3} />
          <td><span className={statusClass("Credit")}>{note.kind || "Credit"}</span></td>
          <td>Not in avg days</td>
          <td />
        </tr>
      ))}
    </>
  );
}

export default function PaymentSettlementPage() {
  const { language, setLanguage, dir } = useAppLanguage();
  const t = (key) => translate(TEXT, key, language);
  const { access } = useModuleAccess();

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  usePopupMessages({ error, message });

  const [customers, setCustomers] = useState([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [loadingSettlement, setLoadingSettlement] = useState(false);
  const [ledger, setLedger] = useState(null);
  const [historyMeta, setHistoryMeta] = useState(null);
  const [expandedInvoice, setExpandedInvoice] = useState("");
  const [autoCode, setAutoCode] = useState("");

  const canAccess = access.canAccess("paymentSettlement") || access.canAccess("customerAudit");

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return customers.slice(0, 40);
    return customers
      .filter((customer) => (
        String(customer.customer_code || "").toLowerCase().includes(q)
        || String(customer.customer_name || "").toLowerCase().includes(q)
      ))
      .slice(0, 40);
  }, [customerSearch, customers]);

  const unpaidSummary = useMemo(() => {
    if (!ledger?.totals) return null;
    const openAmount = Number(ledger.totals.open_sales_amount || 0);
    const outstandingUnpaid = Number(
      ledger.totals.outstanding_unpaid || ledger.summary?.outstandingTotal || 0,
    );
    const salesInclVat = Number(
      ledger.totals.net_sales_incl_vat != null
        ? ledger.totals.net_sales_incl_vat
        : ledger.totals.sales_incl_vat || 0,
    );
    const collected = Number(ledger.totals.collected_amount || 0);
    const salesMinusCollected = Number(
      ledger.totals.sales_minus_collected != null
        ? ledger.totals.sales_minus_collected
        : salesInclVat - collected,
    );
    return {
      openAmount,
      outstandingUnpaid,
      matches: ledger.totals.open_matches_outstanding !== false,
      salesInclVat,
      collected,
      salesMinusCollected,
      creditNoteAmount: Number(ledger.totals.credit_note_amount || 0),
      balanceMatches: ledger.totals.sales_collected_matches_open !== false,
      balanceDelta: Number(ledger.totals.balance_delta || 0),
      tallyOpenTotal: (Array.isArray(ledger.invoices) ? ledger.invoices : []).reduce(
        (total, row) => total + (row.outstanding_pending == null ? 0 : Number(row.outstanding_pending || 0)),
        0,
      ),
      machineOpenTotal: openAmount,
    };
  }, [ledger]);

  const loadCustomers = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setLoadingCustomers(true);
    setError("");
    try {
      const session = await resolveAuthSession(supabase);
      const response = await fetch("/api/customers/visible", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to load customers.");
      }
      setCustomers(Array.isArray(payload.customers) ? payload.customers : []);
    } catch (err) {
      setError(err.message || "Unable to load customers.");
      setCustomers([]);
    } finally {
      setLoadingCustomers(false);
    }
  }, []);

  const loadSettlement = useCallback(async (customer) => {
    if (!customer?.customer_code) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;

    setLoadingSettlement(true);
    setError("");
    setMessage("");
    setLedger(null);
    setHistoryMeta(null);
    setExpandedInvoice("");

    try {
      const session = await resolveAuthSession(supabase);
      const headers = { Authorization: `Bearer ${session.access_token}` };
      const code = encodeURIComponent(customer.customer_code || "");
      const name = encodeURIComponent(customer.customer_name || "");

      const [historyResponse, outstandingResponse] = await Promise.all([
        fetch(`/api/customer-history?customerCode=${code}&customerName=${name}&fullHistory=1&scope=settlement`, { headers }),
        fetch(`/api/outstanding?customerCode=${code}&customerName=${name}`, { headers }),
      ]);

      const historyPayload = await historyResponse.json().catch(() => ({}));
      const outstandingPayload = await outstandingResponse.json().catch(() => ({}));

      if (!historyResponse.ok || !historyPayload.success) {
        throw new Error(historyPayload.error || "Unable to load sales/receipt history.");
      }

      const historyTransactions = Array.isArray(historyPayload.transactions) ? historyPayload.transactions : [];
      const nextLedger = buildPaymentSettlementLedger({
        transactions: historyTransactions,
        receipts: Array.isArray(historyPayload.receipts) ? historyPayload.receipts : [],
        outstandingCustomer: outstandingPayload?.customer || null,
        outstandingInvoices: Array.isArray(outstandingPayload?.customerInvoices)
          ? outstandingPayload.customerInvoices
          : [],
      });

      setSelectedCustomer(customer);
      setLedger(nextLedger);
      setHistoryMeta({
        fromDate: historyPayload.fromDate || "",
        fullHistory: Boolean(historyPayload.fullHistory),
        transactionCount: historyTransactions.length,
      });
      setMessage(
        nextLedger.summary?.summaryLabel
        || `Loaded ${nextLedger.totals.invoice_count} invoices for ${customer.customer_code}.`,
      );
    } catch (err) {
      setError(err.message || "Unable to load settlement.");
      setLedger(null);
      setHistoryMeta(null);
    } finally {
      setLoadingSettlement(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    setAutoCode(String(params.get("customer_code") || params.get("customerCode") || "").trim());
  }, []);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  useEffect(() => {
    if (!autoCode || !customers.length || selectedCustomer) return;
    const match = customers.find(
      (row) => String(row.customer_code || "").toUpperCase() === autoCode.toUpperCase(),
    );
    if (match) {
      setCustomerSearch(autoCode);
      void loadSettlement(match);
    }
  }, [autoCode, customers, loadSettlement, selectedCustomer]);

  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Payment Settlement unavailable"
        message="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to use this screen."
      />
    );
  }

  if (!canAccess) {
    return (
      <main className="modulePage" dir={dir}>
        <div className="moduleShell">
          <div className="moduleHint">You do not have access to Payment Settlement.</div>
        </div>
      </main>
    );
  }

  return (
    <MorningAttendanceGate>
      <main className="modulePage" dir={dir}>
        <div className="moduleShell">
          <div className="moduleHeader">
            <div>
              <p className="moduleEyebrow">MADIBA SFA</p>
              <h1>{t("title")}</h1>
              <p className="moduleSubtitle">{t("subtitle")}</p>
            </div>
            <div className="moduleHeaderMeta">
              <AppLanguageSwitch language={language} setLanguage={setLanguage} />
              <Link href="/management/outstanding-compare" className="moduleBackLink">Outstanding Compare</Link>
              <Link href="/management/customer-audit" className="moduleBackLink">{t("audit")}</Link>
              <Link href="/management" className="moduleBackLink">{t("back")}</Link>
            </div>
          </div>

          <section className="moduleSection">
            <div className="moduleSectionHeader">
              <h2>Customer</h2>
              <span>{loadingCustomers ? "Loading customers..." : `${customers.length.toLocaleString()} visible`}</span>
            </div>
            <p className="moduleHint">{t("note")}</p>
            <div className="moduleFilterRow">
              <input
                className="moduleInput"
                type="text"
                placeholder={t("search")}
                value={customerSearch}
                onChange={(event) => setCustomerSearch(event.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="paymentSettleCustomerList">
              {filteredCustomers.map((customer) => (
                <button
                  type="button"
                  key={customer.customer_code}
                  className="paymentSettleCustomerButton"
                  onClick={() => {
                    setCustomerSearch(`${customer.customer_code} ${customer.customer_name || ""}`.trim());
                    void loadSettlement(customer);
                  }}
                >
                  <strong>{customer.customer_code}</strong>
                  {" — "}
                  {customer.customer_name || "Unnamed"}
                </button>
              ))}
            </div>
          </section>

          {loadingSettlement && <div className="moduleLoading">{t("loading")}</div>}

          {!loadingSettlement && !ledger && (
            <div className="moduleHint">{t("selectCustomer")}</div>
          )}

          {!loadingSettlement && ledger && selectedCustomer && (
            <>
              <section className="moduleSection">
                <div className="moduleSectionHeader">
                  <h2>
                    {selectedCustomer.customer_code}
                    {" "}
                    {selectedCustomer.customer_name}
                  </h2>
                  <button type="button" className="moduleInlineButton" onClick={() => loadSettlement(selectedCustomer)}>
                    Refresh
                  </button>
                </div>

                <div className="auditSummaryGrid">
                  <div className="auditSummaryCard">
                    <span>Avg Days to Pay</span>
                    <strong>
                      {ledger.summary.avgDaysToPay != null
                        ? (
                          ledger.summary.avgDaysToPay6m != null
                            ? `${ledger.summary.avgDaysToPay} days · 6m ${ledger.summary.avgDaysToPay6m}`
                            : `${ledger.summary.avgDaysToPay} days`
                        )
                        : (ledger.summary.avgDaysToPay6m != null
                          ? `6m ${ledger.summary.avgDaysToPay6m} days`
                          : "—")}
                    </strong>
                    <em className="auditSummaryCardMeta">
                      {ledger.summary.avgDaysToPay != null
                        ? (Number(ledger.summary.openAmountInAvg || 0) > 0.009
                          ? "Lifetime · paid avg + open invoices older than that avg only"
                          : "Lifetime · from collected receipts")
                        : "Needs sales, receipts, or open invoices"}
                    </em>
                    {ledger.summary.avgDaysToPay6m != null ? (
                      <em className="auditSummaryCardMeta">
                        Last 6 months: {formatCount(ledger.summary.avgDaysToPay6m)} days
                        {Number(ledger.summary.openAmountInAvg6m || 0) > 0.009
                          ? " · includes open older than 6m paid avg"
                          : ""}
                      </em>
                    ) : null}
                    {ledger.summary.avgDaysPaidOnly != null
                      && Number(ledger.summary.openAmountInAvg || 0) > 0.009
                      && ledger.summary.avgDaysPaidOnly !== ledger.summary.avgDaysToPay ? (
                      <em className="auditSummaryCardMeta">
                        Paid-only avg: {formatCount(ledger.summary.avgDaysPaidOnly)}d
                      </em>
                    ) : null}
                    {Number(ledger.summary.outstandingOldestDays || 0) > 0 ? (
                      <em className="auditSummaryCardMeta">
                        Oldest unpaid invoice: {formatCount(ledger.summary.outstandingOldestDays)}d
                        {Number(ledger.summary.outstandingOverdueCount || 0) > 0
                          ? ` · ${formatCount(ledger.summary.outstandingOverdueCount)} overdue`
                          : ""}
                      </em>
                    ) : null}
                  </div>
                  <div className="auditSummaryCard">
                    <span>Sales incl. VAT</span>
                    <strong>{formatMoney(unpaidSummary?.salesInclVat || ledger.totals.sales_incl_vat)}</strong>
                    {unpaidSummary?.creditNoteAmount > 0.009 ? (
                      <em className="auditSummaryCardMeta">
                        After sales returns {formatMoney(unpaidSummary.creditNoteAmount)}
                      </em>
                    ) : (
                      <em className="auditSummaryCardMeta">Gloves stay excl. VAT · other lines +15%</em>
                    )}
                  </div>
                  <div className="auditSummaryCard">
                    <span>Sales Returns</span>
                    <strong>{formatMoney(ledger.totals.credit_note_amount || 0)}</strong>
                    <em className="auditSummaryCardMeta">
                      {(ledger.totals.credit_note_count || 0) > 0
                        ? `${formatCount(ledger.totals.credit_note_count)} partial / later CN · not cash`
                        : "No partial or later credit notes"}
                    </em>
                  </div>
                  <div className="auditSummaryCard">
                    <span>Collected</span>
                    <strong>{formatMoney(ledger.totals.collected_amount)}</strong>
                  </div>
                  <div className="auditSummaryCard">
                    <span>Open (FIFO)</span>
                    <strong>{formatMoney(unpaidSummary?.openAmount || 0)}</strong>
                    {unpaidSummary?.matches === false ? (
                      <em className="auditSummaryCardMeta">
                        Tally outstanding {formatMoney(unpaidSummary.outstandingUnpaid)} — see Outstanding Compare
                      </em>
                    ) : unpaidSummary?.balanceMatches === false ? (
                      <em className="auditSummaryCardMeta">
                        Sales − Collected {formatMoney(unpaidSummary.salesMinusCollected)} (gap {formatMoney(unpaidSummary.balanceDelta)})
                      </em>
                    ) : (
                      <em className="auditSummaryCardMeta">Matches Tally outstanding upload</em>
                    )}
                  </div>
                </div>
              </section>

              <section className="moduleSection">
                <div className="moduleSectionHeader">
                  <h2>Sales Returns & Credit Notes</h2>
                  <span>
                    {formatCount(ledger.totals.credit_note_count || 0)} not full immediate reversals
                  </span>
                </div>
                <p className="moduleHint">
                  Partial credit notes, later credit notes, and sales returns (not same-day / next-day
                  full invoice reversals). Orphans cross to a same-amount invoice ±1 day (items when
                  available). Reduce net sales; never counted as cash or avg days to pay.
                </p>
                <ExportableTable filename="payment-settlement-credit-notes" sheetName="CreditNotes" className="moduleTableWrap">
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
                      {(ledger.creditNotes || []).map((row) => (
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
                      {!(ledger.creditNotes || []).length && (
                        <tr>
                          <td colSpan={8}>No sales returns or partial/later credit notes for this customer.</td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={5}><strong>Total</strong></td>
                        <td><strong>{formatMoney(ledger.totals.credit_note_excl_vat || 0)}</strong></td>
                        <td><strong>{formatMoney(ledger.totals.credit_note_amount || 0)}</strong></td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </ExportableTable>
              </section>

              <section className="moduleSection">
                <div className="moduleSectionHeader">
                  <h2>Invoices & Settlement</h2>
                  <span>
                    {formatCount(ledger.totals.paid_invoice_count)} paid ·{" "}
                    {formatCount(ledger.totals.partial_invoice_count)} partial ·{" "}
                    {formatCount(ledger.totals.open_invoice_count)} open
                    {historyMeta?.fromDate ? ` · from ${historyMeta.fromDate}` : ""}
                    {historyMeta?.transactionCount != null
                      ? ` · ${formatCount(historyMeta.transactionCount)} sales lines`
                      : ""}
                  </span>
                </div>
                <p className="moduleHint">
                  Machine Open is FIFO (sales − cash applied). Tally Open is the outstanding upload per invoice.
                  Open Δ highlights where they disagree — use{" "}
                  <a href="#outstanding-compare">Tally vs Computed Outstanding</a> below for the full gap report.
                </p>
                <ExportableTable filename="payment-settlement-invoices" sheetName="Invoices" className="moduleTableWrap">
                  <table className="moduleTable moduleBiTable paymentSettleTable">
                    <thead>
                      <tr>
                        <th>Sales Date</th>
                        <th>Voucher</th>
                        <th>Sales excl VAT</th>
                        <th>Sales incl VAT</th>
                        <th>Paid</th>
                        <th>Machine Open</th>
                        <th>Tally Open</th>
                        <th>Open Δ</th>
                        <th>Status</th>
                        <th>Payment Days</th>
                        <th>Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.invoices.map((invoice) => {
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
                      {!ledger.invoices.length && (
                        <tr>
                          <td colSpan={11}>No sales invoices found for this customer in history.</td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={2}><strong>Total</strong></td>
                        <td><strong>{formatMoney(ledger.totals.invoice_sales_excl_vat ?? ledger.totals.sales_excl_vat)}</strong></td>
                        <td><strong>{formatMoney(ledger.totals.invoice_sales_incl_vat ?? ledger.totals.sales_incl_vat)}</strong></td>
                        <td><strong>{formatMoney(
                          Number(ledger.totals.paid_amount || 0) - Number(ledger.totals.reversed_sales_incl_vat || 0),
                        )}</strong></td>
                        <td><strong>{formatMoney(unpaidSummary?.machineOpenTotal ?? ledger.totals.open_sales_amount)}</strong></td>
                        <td><strong>{formatMoney(unpaidSummary?.tallyOpenTotal || 0)}</strong></td>
                        <td className={deltaClass(
                          Number(unpaidSummary?.machineOpenTotal || 0) - Number(unpaidSummary?.tallyOpenTotal || 0),
                        )}>
                          <strong>{formatDelta(
                            Number(unpaidSummary?.machineOpenTotal || 0) - Number(unpaidSummary?.tallyOpenTotal || 0),
                          )}</strong>
                        </td>
                        <td colSpan={3} />
                      </tr>
                    </tfoot>
                  </table>
                </ExportableTable>
              </section>

              <section className="moduleSection" id="outstanding-compare">
                <div className="moduleSectionHeader">
                  <h2>Tally vs Computed Outstanding</h2>
                  <span>
                    {formatCount(ledger.outstandingCompareTotals?.discrepancy_count || 0)} gaps ·{" "}
                    computed {formatMoney(ledger.outstandingCompareTotals?.computed_open || 0)} ·{" "}
                    Tally {formatMoney(ledger.outstandingCompareTotals?.tally_open || 0)}
                  </span>
                </div>
                <p className="moduleHint">
                  Computed open = sales − cash receipts (FIFO) − credit notes allocated to that invoice.
                  Compare that to Tally outstanding. Gaps that remain after credit notes are real
                  differences between the books and our calculation.
                </p>
                <div className="auditSummaryGrid" style={{ marginBottom: 12 }}>
                  <div className="auditSummaryCard">
                    <span>Tally outstanding</span>
                    <strong>{formatMoney(ledger.outstandingCompareTotals?.tally_open || 0)}</strong>
                  </div>
                  <div className="auditSummaryCard">
                    <span>Computed outstanding</span>
                    <strong>{formatMoney(ledger.outstandingCompareTotals?.computed_open || 0)}</strong>
                    <em className="auditSummaryCardMeta">
                      Cash {formatMoney(ledger.outstandingCompareTotals?.cash_settled || 0)}
                      {" + CN "}
                      {formatMoney(ledger.outstandingCompareTotals?.credit_note_settled || 0)}
                    </em>
                  </div>
                  <div className="auditSummaryCard">
                    <span>Open gap (computed − Tally)</span>
                    <strong className={deltaClass(ledger.outstandingCompareTotals?.open_delta || 0)}>
                      {formatDelta(ledger.outstandingCompareTotals?.open_delta || 0)}
                    </strong>
                    <em className="auditSummaryCardMeta">
                      Higher {formatMoney(ledger.outstandingCompareTotals?.computed_higher || 0)}
                      {" · Lower "}
                      {formatMoney(Math.abs(ledger.outstandingCompareTotals?.computed_lower || 0))}
                    </em>
                  </div>
                </div>
                <ExportableTable filename="payment-settlement-outstanding-compare" sheetName="OutstandingCompare" className="moduleTableWrap">
                  <table className="moduleTable moduleBiTable paymentSettleTable">
                    <thead>
                      <tr>
                        <th>Sales Date</th>
                        <th>Voucher</th>
                        <th>Sales incl VAT</th>
                        <th>Cash FIFO</th>
                        <th>Credit Notes</th>
                        <th>Computed Settled</th>
                        <th>Computed Open</th>
                        <th>Tally Open</th>
                        <th>Open Δ</th>
                        <th>Status / note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(
                        (ledger.outstandingCompareTotals?.has_outstanding_rows
                          ? ledger.outstandingCompareRows
                          : ledger.outstandingCompareAllRows)
                        || []
                      ).map((row) => (
                        <tr key={`oc-${row.invoice_date}-${row.voucher_number}`}>
                          <td>{row.invoice_date || "—"}</td>
                          <td>{row.voucher_number || "—"}</td>
                          <td>{formatMoney(row.sales_incl_vat)}</td>
                          <td>{formatMoney(row.cash_settled)}</td>
                          <td>{formatMoney(row.credit_note_settled)}</td>
                          <td className="moduleBiTotalCol">{formatMoney(row.computed_settled)}</td>
                          <td>{formatMoney(row.computed_open)}</td>
                          <td>{formatMoney(row.tally_open)}</td>
                          <td className={deltaClass(row.open_delta)}>{formatDelta(row.open_delta)}</td>
                          <td>
                            <span className={statusClass(
                              row.status === "Match" || row.status === "Computed only"
                                ? "Paid"
                                : (row.open_delta > 0 ? "Open" : "Partial"),
                            )}
                            >
                              {row.status}
                            </span>
                            <div className="auditSummaryCardMeta">{row.note}</div>
                            {(row.credit_chunks || []).length ? (
                              <div className="auditSummaryCardMeta">
                                {(row.credit_chunks || []).map((chunk, index) => (
                                  <div key={`cn-${chunk.voucher_number}-${index}`}>
                                    CN {chunk.voucher_number || "—"}
                                    {chunk.credit_date ? ` · ${chunk.credit_date}` : ""}
                                    {`: ${formatMoney(chunk.amount)}`}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                            {(row.receipt_chunks || []).length ? (
                              <div className="auditSummaryCardMeta">
                                {(row.receipt_chunks || []).map((chunk, index) => (
                                  <div key={`rc-${chunk.vch_no}-${index}`}>
                                    Rcpt {chunk.vch_no || "—"} on {chunk.receipt_date}: {formatMoney(chunk.amount)}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                      {!(
                        (ledger.outstandingCompareTotals?.has_outstanding_rows
                          ? ledger.outstandingCompareRows
                          : ledger.outstandingCompareAllRows)
                        || []
                      ).length && (
                        <tr>
                          <td colSpan={10}>
                            {Number(ledger.summary?.outstandingTotal || ledger.totals?.outstanding_unpaid || 0) > 0
                              || ledger.outstandingCompareTotals?.has_outstanding_rows
                              ? "No Tally vs computed outstanding gaps for this customer."
                              : "Upload outstanding invoice rows to compare Tally with computed open (cash + CN)."}
                          </td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={2}><strong>Total</strong></td>
                        <td><strong>{formatMoney(ledger.outstandingCompareTotals?.sales_incl_vat || 0)}</strong></td>
                        <td><strong>{formatMoney(ledger.outstandingCompareTotals?.cash_settled || 0)}</strong></td>
                        <td><strong>{formatMoney(ledger.outstandingCompareTotals?.credit_note_settled || 0)}</strong></td>
                        <td className="moduleBiTotalCol">
                          <strong>{formatMoney(ledger.outstandingCompareTotals?.computed_settled || 0)}</strong>
                        </td>
                        <td><strong>{formatMoney(ledger.outstandingCompareTotals?.computed_open || 0)}</strong></td>
                        <td><strong>{formatMoney(ledger.outstandingCompareTotals?.tally_open || 0)}</strong></td>
                        <td className={deltaClass(ledger.outstandingCompareTotals?.open_delta || 0)}>
                          <strong>{formatDelta(ledger.outstandingCompareTotals?.open_delta || 0)}</strong>
                        </td>
                        <td>
                          Unmatched receipts {formatMoney(ledger.outstandingCompareTotals?.unmatched_receipt_amount || 0)}
                          {" · Unapplied CN "}
                          {formatMoney(ledger.outstandingCompareTotals?.unmatched_credit_note_amount || 0)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </ExportableTable>
              </section>

              <section className="moduleSection">
                <div className="moduleSectionHeader">
                  <h2>Cash-only FIFO check</h2>
                  <span>
                    {formatCount(ledger.totals.tally_fifo_discrepancy_count || 0)} invoices ·{" "}
                    over {formatMoney(ledger.totals.tally_fifo_over_allocated || 0)} ·{" "}
                    under {formatMoney(Math.abs(ledger.totals.tally_fifo_under_allocated || 0))}
                  </span>
                </div>
                <p className="moduleHint">
                  Same invoices without counting credit notes — useful to see how much of a book gap
                  is explained by CNs in the table above.
                </p>
                <ExportableTable filename="payment-settlement-tally-fifo" sheetName="TallyVsFifo" className="moduleTableWrap">
                  <table className="moduleTable moduleBiTable paymentSettleTable">
                    <thead>
                      <tr>
                        <th>Sales Date</th>
                        <th>Voucher</th>
                        <th>Sales incl VAT</th>
                        <th>Book Paid</th>
                        <th>FIFO Paid</th>
                        <th>Paid Δ</th>
                        <th>Book Open</th>
                        <th>FIFO Open</th>
                        <th>Open Δ</th>
                        <th>Where / note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(ledger.tallyFifoDiscrepancies || []).map((row) => (
                        <tr key={`disc-${row.invoice_date}-${row.voucher_number}`}>
                          <td>{row.invoice_date || "—"}</td>
                          <td>{row.voucher_number || "—"}</td>
                          <td>{formatMoney(row.sales_incl_vat)}</td>
                          <td>{formatMoney(row.book_paid)}</td>
                          <td>{formatMoney(row.fifo_paid)}</td>
                          <td className={deltaClass(row.paid_delta)}>{formatDelta(row.paid_delta)}</td>
                          <td>{formatMoney(row.book_open)}</td>
                          <td>{formatMoney(row.fifo_open)}</td>
                          <td className={deltaClass(row.open_delta)}>{formatDelta(row.open_delta)}</td>
                          <td>
                            {row.note}
                            {(row.receipt_chunks || []).length ? (
                              <div className="auditSummaryCardMeta">
                                {(row.receipt_chunks || []).map((chunk, index) => (
                                  <div key={`${chunk.receipt_date}-${chunk.vch_no}-${index}`}>
                                    Rcpt {chunk.vch_no || "—"} on {chunk.receipt_date}: {formatMoney(chunk.amount)}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                      {!(ledger.tallyFifoDiscrepancies || []).length && (
                        <tr>
                          <td colSpan={10}>
                            {Number(ledger.summary?.outstandingTotal || ledger.totals?.outstanding_unpaid || 0) > 0
                              ? "No cash-only Tally vs FIFO gaps for this customer."
                              : "Upload outstanding invoice rows to compare Tally book settlement with FIFO."}
                          </td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={3}><strong>Discrepancy total</strong></td>
                        <td><strong>{formatMoney(ledger.tallyFifoTotals?.book_paid || 0)}</strong></td>
                        <td><strong>{formatMoney(ledger.tallyFifoTotals?.fifo_paid || 0)}</strong></td>
                        <td className={deltaClass(ledger.tallyFifoTotals?.paid_delta || 0)}>
                          <strong>{formatDelta(ledger.tallyFifoTotals?.paid_delta || 0)}</strong>
                        </td>
                        <td><strong>{formatMoney(ledger.tallyFifoTotals?.book_open || 0)}</strong></td>
                        <td><strong>{formatMoney(ledger.tallyFifoTotals?.fifo_open || 0)}</strong></td>
                        <td className={deltaClass(ledger.tallyFifoTotals?.open_delta || 0)}>
                          <strong>{formatDelta(ledger.tallyFifoTotals?.open_delta || 0)}</strong>
                        </td>
                        <td>
                          Unmatched receipts: {formatMoney(ledger.tallyFifoTotals?.unmatched_receipt_amount || 0)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </ExportableTable>
              </section>

              <section className="moduleSection">
                <div className="moduleSectionHeader">
                  <h2>Reversed by Credit Note</h2>
                  <span>
                    {formatCount(ledger.totals.reversed_invoice_count || 0)} excluded from avg days to pay
                  </span>
                </div>
                <p className="moduleHint">
                  Same-day, next-day, or previous-day credit notes that fully reverse an invoice
                  (including reissue pairs like CN on 31 Dec against invoice on 1 Jan). These are not
                  customer payments.
                </p>
                <ExportableTable filename="payment-settlement-reversed" sheetName="Reversed" className="moduleTableWrap">
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
                      {(ledger.reversedInvoices || []).map((row) => (
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
                      {!(ledger.reversedInvoices || []).length && (
                        <tr>
                          <td colSpan={9}>No immediate credit-note reversals for this customer.</td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={2}><strong>Total</strong></td>
                        <td><strong>{formatMoney(ledger.totals.reversed_sales_excl_vat || 0)}</strong></td>
                        <td><strong>{formatMoney(ledger.totals.reversed_sales_incl_vat || 0)}</strong></td>
                        <td colSpan={5} />
                      </tr>
                    </tfoot>
                  </table>
                </ExportableTable>
              </section>

              <section className="moduleSection">
                <div className="moduleSectionHeader">
                  <h2>Datewise Sales & Collections</h2>
                </div>
                <ExportableTable filename="payment-settlement-datewise" sheetName="Datewise" className="moduleTableWrap">
                  <table className="moduleTable moduleBiTable paymentSettleTable">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Invoices</th>
                        <th>Sales excl VAT</th>
                        <th>Sales incl VAT</th>
                        <th>Receipts</th>
                        <th>Collected</th>
                        <th>Open Sales on Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.datewise.map((row) => (
                        <tr key={row.date}>
                          <td>{row.date}</td>
                          <td>{formatCount(row.invoice_count)}</td>
                          <td>{formatMoney(row.sales_excl_vat)}</td>
                          <td>{formatMoney(row.sales_incl_vat)}</td>
                          <td>{formatCount(row.receipt_count)}</td>
                          <td>{formatMoney(row.collected_amount)}</td>
                          <td>{formatMoney(row.open_sales_amount)}</td>
                        </tr>
                      ))}
                      {!ledger.datewise.length && (
                        <tr>
                          <td colSpan={7}>No dated sales or collections found.</td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td><strong>Total</strong></td>
                        <td><strong>{formatCount(ledger.totals.invoice_count)}</strong></td>
                        <td><strong>{formatMoney(ledger.totals.invoice_sales_excl_vat ?? ledger.totals.sales_excl_vat)}</strong></td>
                        <td><strong>{formatMoney(ledger.totals.invoice_sales_incl_vat ?? ledger.totals.sales_incl_vat)}</strong></td>
                        <td />
                        <td><strong>{formatMoney(ledger.totals.collected_amount)}</strong></td>
                        <td><strong>{formatMoney(ledger.totals.open_sales_amount)}</strong></td>
                      </tr>
                    </tfoot>
                  </table>
                </ExportableTable>
              </section>

              <section className="moduleSection">
                <div className="moduleSectionHeader">
                  <h2>Settlement Events (FIFO)</h2>
                  <span>
                    Unmatched receipts: {formatMoney(ledger.totals.unmatched_receipt_amount)}
                  </span>
                </div>
                <ExportableTable filename="payment-settlement-events" sheetName="Settlements" className="moduleTableWrap">
                  <table className="moduleTable moduleBiTable paymentSettleTable">
                    <thead>
                      <tr>
                        <th>Receipt Date</th>
                        <th>Receipt No</th>
                        <th>Applied To Sales Date</th>
                        <th>Voucher</th>
                        <th>Amount</th>
                        <th>Days to Pay</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.settlementEvents.map((row, index) => (
                        <tr key={`${row.receipt_date}-${row.voucher_number}-${index}`}>
                          <td>{row.receipt_date}</td>
                          <td>{row.vch_no || "—"}</td>
                          <td>{row.invoice_date}</td>
                          <td>{row.voucher_number || "—"}</td>
                          <td>{formatMoney(row.amount)}</td>
                          <td>{row.days != null ? row.days : "—"}</td>
                        </tr>
                      ))}
                      {!ledger.settlementEvents.length && (
                        <tr>
                          <td colSpan={6}>No settlements yet — need both sales and receipt uploads for this customer.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </ExportableTable>
              </section>
            </>
          )}
        </div>
      </main>
    </MorningAttendanceGate>
  );
}
