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
    en: "Open follows the outstanding upload. Sales − Collected should equal Open (unpaired credit notes are netted from Sales; immediate reversals stay in Sales but are excluded from avg days).",
    ar: "المفتوح يتبع ملف المستحقات. المبيعات − التحصيل يجب أن تساوي المفتوح (إشعارات الدائن غير المزدوجة تُخصم من المبيعات؛ العكس الفوري يبقى في المبيعات ويُستبعد من متوسط الأيام).",
  },
};

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
          {invoice.settlements.length ? (
            <button type="button" className="moduleInlineButton" onClick={onToggle}>
              {open ? "Hide" : `Show ${invoice.settlements.length}`}
            </button>
          ) : "—"}
        </td>
      </tr>
      {open && invoice.settlements.map((settlement, index) => (
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
    setExpandedInvoice("");

    try {
      const session = await resolveAuthSession(supabase);
      const headers = { Authorization: `Bearer ${session.access_token}` };
      const code = encodeURIComponent(customer.customer_code || "");
      const name = encodeURIComponent(customer.customer_name || "");

      const [historyResponse, outstandingResponse] = await Promise.all([
        fetch(`/api/customer-history?customerCode=${code}&customerName=${name}`, { headers }),
        fetch(`/api/outstanding?customerCode=${code}&customerName=${name}`, { headers }),
      ]);

      const historyPayload = await historyResponse.json().catch(() => ({}));
      const outstandingPayload = await outstandingResponse.json().catch(() => ({}));

      if (!historyResponse.ok || !historyPayload.success) {
        throw new Error(historyPayload.error || "Unable to load sales/receipt history.");
      }

      const nextLedger = buildPaymentSettlementLedger({
        transactions: Array.isArray(historyPayload.transactions) ? historyPayload.transactions : [],
        receipts: Array.isArray(historyPayload.receipts) ? historyPayload.receipts : [],
        outstandingCustomer: outstandingPayload?.customer || null,
        outstandingInvoices: Array.isArray(outstandingPayload?.customerInvoices)
          ? outstandingPayload.customerInvoices
          : [],
      });

      setSelectedCustomer(customer);
      setLedger(nextLedger);
      setMessage(
        nextLedger.summary?.summaryLabel
        || `Loaded ${nextLedger.totals.invoice_count} invoices for ${customer.customer_code}.`,
      );
    } catch (err) {
      setError(err.message || "Unable to load settlement.");
      setLedger(null);
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
                      {ledger.summary.avgDaysToPay != null ? `${ledger.summary.avgDaysToPay} days` : "—"}
                    </strong>
                  </div>
                  <div className="auditSummaryCard">
                    <span>Sales incl. VAT</span>
                    <strong>{formatMoney(unpaidSummary?.salesInclVat || ledger.totals.sales_incl_vat)}</strong>
                    {unpaidSummary?.creditNoteAmount > 0.009 ? (
                      <em className="auditSummaryCardMeta">
                        After credit notes {formatMoney(unpaidSummary.creditNoteAmount)}
                      </em>
                    ) : (
                      <em className="auditSummaryCardMeta">Gloves stay excl. VAT · other lines +15%</em>
                    )}
                  </div>
                  <div className="auditSummaryCard">
                    <span>Collected</span>
                    <strong>{formatMoney(ledger.totals.collected_amount)}</strong>
                  </div>
                  <div className="auditSummaryCard">
                    <span>Open / Outstanding</span>
                    <strong>{formatMoney(unpaidSummary?.openAmount || 0)}</strong>
                    {unpaidSummary?.matches === false ? (
                      <em className="auditSummaryCardMeta">
                        Does not match outstanding upload {formatMoney(unpaidSummary.outstandingUnpaid)}
                      </em>
                    ) : unpaidSummary?.balanceMatches === false ? (
                      <em className="auditSummaryCardMeta">
                        Sales − Collected {formatMoney(unpaidSummary.salesMinusCollected)} (gap {formatMoney(unpaidSummary.balanceDelta)})
                      </em>
                    ) : (
                      <em className="auditSummaryCardMeta">Sales − Collected = Open (matches outstanding)</em>
                    )}
                  </div>
                </div>
              </section>

              <section className="moduleSection">
                <div className="moduleSectionHeader">
                  <h2>Invoices & Settlement</h2>
                  <span>
                    {formatCount(ledger.totals.paid_invoice_count)} paid ·{" "}
                    {formatCount(ledger.totals.partial_invoice_count)} partial ·{" "}
                    {formatCount(ledger.totals.open_invoice_count)} open
                  </span>
                </div>
                <ExportableTable filename="payment-settlement-invoices" sheetName="Invoices" className="moduleTableWrap">
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
                          <td colSpan={9}>No sales invoices found for this customer in history.</td>
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
                        <td><strong>{formatMoney(ledger.totals.open_sales_amount)}</strong></td>
                        <td colSpan={3} />
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
                  Same-day or next-day credit notes that fully reverse an invoice. These are not customer payments.
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
