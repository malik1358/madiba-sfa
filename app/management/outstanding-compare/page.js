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
  title: { en: "Tally vs Computed Outstanding", ar: "المستحقات: تالي مقابل المحسوب" },
  subtitle: {
    en: "Compare Tally outstanding to open after cash FIFO plus credit notes. Remaining gaps are real differences.",
    ar: "قارن مستحقات تالي بالمفتوح بعد التحصيل النقدي وإشعارات الدائن. الفجوات المتبقية فروق حقيقية.",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  settlement: { en: "Full Payment Settlement", ar: "تسوية المدفوعات كاملة" },
  search: { en: "Search customer code or name", ar: "بحث بكود أو اسم العميل" },
  loading: { en: "Loading comparison...", ar: "جاري تحميل المقارنة..." },
  selectCustomer: {
    en: "Select a customer to compare Tally outstanding with computed open (cash + credit notes).",
    ar: "اختر عميلاً لمقارنة مستحقات تالي بالمفتوح المحسوب (نقد + إشعارات دائن).",
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
  if (status === "Paid" || status === "Match" || status === "Computed only") {
    return "paymentSettleStatus paymentSettleStatus--paid";
  }
  if (status === "Partial" || status === "Computed lower") {
    return "paymentSettleStatus paymentSettleStatus--partial";
  }
  return "paymentSettleStatus paymentSettleStatus--open";
}

export default function OutstandingComparePage() {
  const { language, setLanguage, dir } = useAppLanguage();
  const t = (key) => translate(TEXT, key, language);
  const { access, loading: loadingAccess } = useModuleAccess();

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  usePopupMessages({ error, message });

  const [customers, setCustomers] = useState([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [loadingCompare, setLoadingCompare] = useState(false);
  const [ledger, setLedger] = useState(null);
  const [autoCode, setAutoCode] = useState("");

  const canAccess = access.canAccess("outstandingCompare")
    || access.canAccess("paymentSettlement")
    || access.canAccess("customerAudit");

  const filteredCustomers = useMemo(() => {
    const needle = String(customerSearch || "").trim().toLowerCase();
    if (!needle) return customers.slice(0, 40);
    return customers
      .filter((row) => {
        const code = String(row.customer_code || "").toLowerCase();
        const name = String(row.customer_name || "").toLowerCase();
        return code.includes(needle) || name.includes(needle);
      })
      .slice(0, 40);
  }, [customerSearch, customers]);

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

  const loadCompare = useCallback(async (customer) => {
    if (!customer?.customer_code) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;

    setLoadingCompare(true);
    setError("");
    setMessage("");
    setLedger(null);

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
      const gaps = Number(nextLedger.outstandingCompareTotals?.discrepancy_count || 0);
      setMessage(
        gaps
          ? `${gaps} outstanding gap(s) for ${customer.customer_code}.`
          : `No outstanding gaps for ${customer.customer_code}.`,
      );
    } catch (err) {
      setError(err.message || "Unable to load comparison.");
      setLedger(null);
    } finally {
      setLoadingCompare(false);
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
      void loadCompare(match);
    }
  }, [autoCode, customers, loadCompare, selectedCustomer]);

  const compareRows = ledger?.outstandingCompareTotals?.has_outstanding_rows
    ? (ledger.outstandingCompareRows || [])
    : (ledger?.outstandingCompareAllRows || []);
  const compareTotals = ledger?.outstandingCompareTotals || {};

  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Outstanding compare unavailable"
        message="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to use this screen."
      />
    );
  }

  if (loadingAccess) {
    return (
      <main className="modulePage" dir={dir}>
        <div className="moduleShell">
          <div className="moduleHint">Checking access...</div>
        </div>
      </main>
    );
  }

  if (!canAccess) {
    return (
      <main className="modulePage" dir={dir}>
        <div className="moduleShell">
          <div className="moduleHint">You do not have access to Outstanding Compare.</div>
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
              {selectedCustomer?.customer_code ? (
                <Link
                  href={`/management/payment-settlement?customer_code=${encodeURIComponent(selectedCustomer.customer_code)}`}
                  className="moduleBackLink"
                >
                  {t("settlement")}
                </Link>
              ) : null}
              <Link href="/management" className="moduleBackLink">{t("back")}</Link>
            </div>
          </div>

          <section className="moduleSection">
            <div className="moduleSectionHeader">
              <h2>Customer</h2>
              <span>{loadingCustomers ? "Loading customers..." : `${customers.length.toLocaleString()} visible`}</span>
            </div>
            <div className="moduleFilterRow">
              <input
                className="moduleInput"
                value={customerSearch}
                onChange={(event) => setCustomerSearch(event.target.value)}
                placeholder={t("search")}
              />
            </div>
            <div className="moduleChipList">
              {filteredCustomers.map((customer) => {
                const active = selectedCustomer?.customer_code === customer.customer_code;
                return (
                  <button
                    key={customer.customer_code}
                    type="button"
                    className={active ? "moduleChip moduleChip--active" : "moduleChip"}
                    onClick={() => void loadCompare(customer)}
                  >
                    <strong>{customer.customer_code}</strong>
                    <span>{customer.customer_name || "—"}</span>
                  </button>
                );
              })}
              {!filteredCustomers.length && !loadingCustomers ? (
                <div className="moduleHint">No matching customers.</div>
              ) : null}
            </div>
          </section>

          {loadingCompare ? <div className="moduleHint">{t("loading")}</div> : null}
          {!loadingCompare && !ledger ? <div className="moduleHint">{t("selectCustomer")}</div> : null}

          {ledger ? (
            <>
              <section className="moduleSection">
                <div className="moduleSectionHeader">
                  <h2>
                    {selectedCustomer?.customer_code}
                    {selectedCustomer?.customer_name ? ` · ${selectedCustomer.customer_name}` : ""}
                  </h2>
                  <span>
                    {formatCount(compareTotals.discrepancy_count || 0)} gaps
                  </span>
                </div>
                <div className="auditSummaryGrid">
                  <div className="auditSummaryCard">
                    <span>Tally outstanding</span>
                    <strong>{formatMoney(compareTotals.tally_open || 0)}</strong>
                  </div>
                  <div className="auditSummaryCard">
                    <span>Computed outstanding</span>
                    <strong>{formatMoney(compareTotals.computed_open || 0)}</strong>
                    <em className="auditSummaryCardMeta">
                      Cash {formatMoney(compareTotals.cash_settled || 0)}
                      {" + CN "}
                      {formatMoney(compareTotals.credit_note_settled || 0)}
                    </em>
                  </div>
                  <div className="auditSummaryCard">
                    <span>Open gap</span>
                    <strong className={deltaClass(compareTotals.open_delta || 0)}>
                      {formatDelta(compareTotals.open_delta || 0)}
                    </strong>
                    <em className="auditSummaryCardMeta">computed − Tally</em>
                  </div>
                </div>
              </section>

              <section className="moduleSection">
                <div className="moduleSectionHeader">
                  <h2>Invoice comparison</h2>
                  <span>
                    {compareTotals.has_outstanding_rows
                      ? `${formatCount(compareTotals.discrepancy_count || 0)} with gaps`
                      : `${formatCount(compareRows.length)} invoices (computed only)`}
                  </span>
                </div>
                <p className="moduleHint">
                  Computed open = sales − cash FIFO − credit notes on that invoice. Export Excel for review.
                </p>
                <ExportableTable filename="outstanding-compare" sheetName="OutstandingCompare" className="moduleTableWrap">
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
                      {compareRows.map((row) => (
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
                            <span className={statusClass(row.status)}>{row.status}</span>
                            <div className="auditSummaryCardMeta">{row.note}</div>
                          </td>
                        </tr>
                      ))}
                      {!compareRows.length && (
                        <tr>
                          <td colSpan={10}>
                            {compareTotals.has_outstanding_rows
                              ? "No gaps — computed open matches Tally on every invoice."
                              : "Upload outstanding to compare against Tally."}
                          </td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={2}><strong>Total</strong></td>
                        <td><strong>{formatMoney(compareTotals.sales_incl_vat || 0)}</strong></td>
                        <td><strong>{formatMoney(compareTotals.cash_settled || 0)}</strong></td>
                        <td><strong>{formatMoney(compareTotals.credit_note_settled || 0)}</strong></td>
                        <td className="moduleBiTotalCol">
                          <strong>{formatMoney(compareTotals.computed_settled || 0)}</strong>
                        </td>
                        <td><strong>{formatMoney(compareTotals.computed_open || 0)}</strong></td>
                        <td><strong>{formatMoney(compareTotals.tally_open || 0)}</strong></td>
                        <td className={deltaClass(compareTotals.open_delta || 0)}>
                          <strong>{formatDelta(compareTotals.open_delta || 0)}</strong>
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </ExportableTable>
              </section>
            </>
          ) : null}
        </div>
      </main>
    </MorningAttendanceGate>
  );
}
