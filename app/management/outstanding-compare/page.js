"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import ExportableTable from "../../components/ExportableTable";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { useBiExcelFilters } from "../business-dashboard/BiExcelHead";
import ExcelColumnFilter from "../../components/ExcelColumnFilter";
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
  search: { en: "Search customer, code, or salesman", ar: "بحث بالعميل أو الكود أو المندوب" },
  loading: { en: "Loading comparison...", ar: "جاري تحميل المقارنة..." },
  selectCustomer: {
    en: "Select a customer to compare Tally outstanding with computed open (cash + credit notes).",
    ar: "اختر عميلاً لمقارنة مستحقات تالي بالمفتوح المحسوب (نقد + إشعارات دائن).",
  },
  code: { en: "Code", ar: "الكود" },
  customer: { en: "Customer", ar: "العميل" },
  salesman: { en: "Salesman", ar: "المندوب" },
  totalOutstanding: { en: "Tally outstanding", ar: "مستحق تالي" },
  computedOutstanding: { en: "Computed outstanding", ar: "المستحق المحسوب" },
  difference: { en: "Difference", ar: "الفرق" },
  compare: { en: "Compare", ar: "قارن" },
  total: { en: "Total", ar: "الإجمالي" },
  noCustomers: { en: "No matching customers.", ar: "لا يوجد عملاء مطابقون." },
  deltaLoading: { en: "…", ar: "…" },
  deltaPending: { en: "—", ar: "—" },
};

const CUSTOMER_FILTER_KEYS = ["code", "name", "salesman", "total", "computed", "diff"];

const CUSTOMER_COLUMNS = [
  { key: "code", labelKey: "code" },
  { key: "name", labelKey: "customer" },
  { key: "salesman", labelKey: "salesman" },
  { key: "total", labelKey: "totalOutstanding" },
  { key: "computed", labelKey: "computedOutstanding", className: "moduleBiTotalCol" },
  { key: "diff", labelKey: "difference" },
];

const DIFF_LOAD_CONCURRENCY = 4;

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

function outstandingCellClass(value) {
  return Number(value || 0) > 0.009 ? "moduleBiMonthCell--down" : "";
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

function customerOutstandingTotal(row) {
  return Number(row?.outstanding_0_30 || 0)
    + Number(row?.outstanding_30_60 || 0)
    + Number(row?.outstanding_61_90 || 0)
    + Number(row?.outstanding_above_90 || 0);
}

function settlementHref(customerCode) {
  return `/management/payment-settlement?customer_code=${encodeURIComponent(customerCode || "")}#invoices-settlement`;
}

async function fetchCustomerCompareTotals(customer, accessToken) {
  const headers = { Authorization: `Bearer ${accessToken}` };
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

  const ledger = buildPaymentSettlementLedger({
    transactions: Array.isArray(historyPayload.transactions) ? historyPayload.transactions : [],
    receipts: Array.isArray(historyPayload.receipts) ? historyPayload.receipts : [],
    outstandingCustomer: outstandingPayload?.customer || null,
    outstandingInvoices: Array.isArray(outstandingPayload?.customerInvoices)
      ? outstandingPayload.customerInvoices
      : [],
  });

  return {
    ledger,
    totals: ledger.outstandingCompareTotals || {},
  };
}

export default function OutstandingComparePage() {
  const { language, setLanguage, dir } = useAppLanguage();
  const t = translate(language, TEXT);
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
  const [deltaByCode, setDeltaByCode] = useState({});
  const deltaByCodeRef = useRef({});
  const deltaStartedRef = useRef(new Set());
  const diffRunIdRef = useRef(0);

  useEffect(() => {
    deltaByCodeRef.current = deltaByCode;
  }, [deltaByCode]);

  const canAccess = access.canAccess("outstandingCompare")
    || access.canAccess("paymentSettlement")
    || access.canAccess("customerAudit");

  const customerRows = useMemo(() => {
    const needle = String(customerSearch || "").trim().toLowerCase();
    const rows = customers
      .map((row) => {
        const code = String(row.customer_code || "");
        const delta = deltaByCode[code];
        return {
          ...row,
          outstanding_total: customerOutstandingTotal(row),
          salesman_name: String(row.salesman_name || row.current_salesman_code || "").trim(),
          open_delta: delta?.status === "ready" ? Number(delta.open_delta || 0) : null,
          computed_open: delta?.status === "ready" ? Number(delta.computed_open || 0) : null,
          delta_status: delta?.status || "pending",
        };
      })
      .filter((row) => {
        if (!needle) return true;
        const code = String(row.customer_code || "").toLowerCase();
        const name = String(row.customer_name || "").toLowerCase();
        const salesman = String(row.salesman_name || "").toLowerCase();
        return code.includes(needle) || name.includes(needle) || salesman.includes(needle);
      })
      .sort((a, b) => {
        const aDelta = a.open_delta;
        const bDelta = b.open_delta;
        if (aDelta != null && bDelta != null) {
          const byGap = Math.abs(bDelta) - Math.abs(aDelta);
          if (Math.abs(byGap) > 0.009) return byGap;
        } else if (aDelta != null && Math.abs(aDelta) > 0.02) {
          return -1;
        } else if (bDelta != null && Math.abs(bDelta) > 0.02) {
          return 1;
        }
        const byOutstanding = Number(b.outstanding_total || 0) - Number(a.outstanding_total || 0);
        if (Math.abs(byOutstanding) > 0.009) return byOutstanding;
        return String(a.customer_code || "").localeCompare(String(b.customer_code || ""));
      });
    return rows;
  }, [customerSearch, customers, deltaByCode]);

  const customerFilterValue = useCallback((row, key) => {
    if (key === "code") return String(row.customer_code || "—");
    if (key === "name") return String(row.customer_name || "—");
    if (key === "salesman") return String(row.salesman_name || "—");
    if (key === "computed") {
      if (row.delta_status === "ready") return formatMoney(row.computed_open);
      if (row.delta_status === "loading") return "…";
      return "—";
    }
    if (key === "diff") {
      if (row.delta_status === "ready") return formatDelta(row.open_delta);
      if (row.delta_status === "loading") return "…";
      return "—";
    }
    return formatMoney(row.outstanding_total);
  }, []);

  const {
    filters: customerFilters,
    options: customerFilterOptions,
    visibleRows: visibleCustomers,
    setFilter: setCustomerFilter,
  } = useBiExcelFilters(customerRows, CUSTOMER_FILTER_KEYS, customerFilterValue);

  const customerFooter = useMemo(() => {
    const ready = visibleCustomers.filter((row) => row.delta_status === "ready");
    return {
      total: visibleCustomers.reduce((sum, row) => sum + Number(row.outstanding_total || 0), 0),
      computed: ready.reduce((sum, row) => sum + Number(row.computed_open || 0), 0),
      diff: ready.reduce((sum, row) => sum + Number(row.open_delta || 0), 0),
      diffReady: ready.length,
    };
  }, [visibleCustomers]);

  const loadCustomers = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setLoadingCustomers(true);
    setError("");
    try {
      const session = await resolveAuthSession(supabase);
      const response = await fetch("/api/customers/visible?includeOutstanding=1", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to load customers.");
      }
      setCustomers(Array.isArray(payload.customers) ? payload.customers : []);
      setDeltaByCode({});
      deltaStartedRef.current = new Set();
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

    const code = String(customer.customer_code || "");
    setLoadingCompare(true);
    setError("");
    setMessage("");
    setLedger(null);
    deltaStartedRef.current.add(code);
    setDeltaByCode((current) => ({
      ...current,
      [code]: { ...(current[code] || {}), status: "loading" },
    }));

    try {
      const session = await resolveAuthSession(supabase);
      const { ledger: nextLedger, totals } = await fetchCustomerCompareTotals(customer, session.access_token);

      setSelectedCustomer(customer);
      setLedger(nextLedger);
      setDeltaByCode((current) => ({
        ...current,
        [code]: {
          status: "ready",
          open_delta: Number(totals.open_delta || 0),
          computed_open: Number(totals.computed_open || 0),
          tally_open: Number(totals.tally_open || 0),
        },
      }));
      const gaps = Number(totals.discrepancy_count || 0);
      setMessage(
        gaps
          ? `${gaps} outstanding gap(s) for ${customer.customer_code}.`
          : `No outstanding gaps for ${customer.customer_code}.`,
      );
    } catch (err) {
      setError(err.message || "Unable to load comparison.");
      setLedger(null);
      setDeltaByCode((current) => ({
        ...current,
        [code]: { status: "error", open_delta: null },
      }));
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

  useEffect(() => {
    if (!customers.length || loadingCustomers) return undefined;
    const runId = ++diffRunIdRef.current;
    let cancelled = false;
    const claimed = new Set();

    const queue = [...customers]
      .map((row) => ({
        code: String(row.customer_code || "").trim(),
        outstanding: customerOutstandingTotal(row),
        row,
      }))
      .filter((item) => item.code)
      .sort((a, b) => b.outstanding - a.outstanding);

    setDeltaByCode((current) => {
      const next = { ...current };
      queue.forEach(({ code }) => {
        if (next[code]?.status !== "ready") next[code] = { status: "pending" };
      });
      return next;
    });

    async function runQueue() {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      let session;
      try {
        session = await resolveAuthSession(supabase);
      } catch {
        return;
      }
      let cursor = 0;

      async function worker() {
        while (!cancelled && runId === diffRunIdRef.current) {
          const index = cursor;
          cursor += 1;
          if (index >= queue.length) return;
          const { code, row: customer } = queue[index];
          if (claimed.has(code) || deltaStartedRef.current.has(code)) continue;
          if (deltaByCodeRef.current[code]?.status === "ready") {
            deltaStartedRef.current.add(code);
            continue;
          }
          claimed.add(code);
          deltaStartedRef.current.add(code);

          setDeltaByCode((current) => {
            if (current[code]?.status === "ready") return current;
            return { ...current, [code]: { ...(current[code] || {}), status: "loading" } };
          });

          try {
            const { totals } = await fetchCustomerCompareTotals(customer, session.access_token);
            if (cancelled || runId !== diffRunIdRef.current) return;
            setDeltaByCode((current) => ({
              ...current,
              [code]: {
                status: "ready",
                open_delta: Number(totals.open_delta || 0),
                computed_open: Number(totals.computed_open || 0),
                tally_open: Number(totals.tally_open || 0),
              },
            }));
          } catch {
            if (cancelled || runId !== diffRunIdRef.current) return;
            deltaStartedRef.current.delete(code);
            setDeltaByCode((current) => ({
              ...current,
              [code]: { status: "error", open_delta: null },
            }));
          }
        }
      }

      await Promise.all(
        Array.from({ length: Math.min(DIFF_LOAD_CONCURRENCY, queue.length) }, () => worker()),
      );
    }

    void runQueue();
    return () => {
      cancelled = true;
      claimed.forEach((code) => {
        if (deltaByCodeRef.current[code]?.status !== "ready") {
          deltaStartedRef.current.delete(code);
        }
      });
    };
  }, [customers, loadingCustomers]);

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
                  href={settlementHref(selectedCustomer.customer_code)}
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
              <h2>{t("customer")}</h2>
              <span>
                {loadingCustomers
                  ? "Loading customers..."
                  : `${visibleCustomers.length.toLocaleString()} of ${customers.length.toLocaleString()} visible${
                    customerFooter.diffReady
                      ? ` · ${customerFooter.diffReady.toLocaleString()} differences loaded`
                      : ""
                  }`}
              </span>
            </div>
            <div className="moduleFilterRow">
              <input
                className="moduleInput"
                value={customerSearch}
                onChange={(event) => setCustomerSearch(event.target.value)}
                placeholder={t("search")}
              />
            </div>
            <ExportableTable filename="outstanding-compare-customers" sheetName="Customers" className="moduleTableWrap moduleBiTableWrap">
              <table className="moduleTable moduleBiTable moduleStackedHeaderTable">
                <thead>
                  <tr>
                    {CUSTOMER_COLUMNS.map((column) => (
                      <th
                        key={`label-${column.key}`}
                        className={column.className || undefined}
                        data-column-filter-label={t(column.labelKey)}
                      >
                        {t(column.labelKey)}
                      </th>
                    ))}
                    <th data-column-filter-label={t("compare")}>{t("compare")}</th>
                  </tr>
                  <tr className="moduleTableColumnFilterRow">
                    {CUSTOMER_COLUMNS.map((column) => (
                      <th
                        key={`filter-${column.key}`}
                        className={column.className || undefined}
                        data-column-filter-label={t(column.labelKey)}
                      >
                        <ExcelColumnFilter
                          label={t(column.labelKey)}
                          options={customerFilterOptions[column.key] || []}
                          selected={customerFilters[column.key]}
                          onChange={(selected) => setCustomerFilter(column.key, selected)}
                        />
                      </th>
                    ))}
                    <th data-column-filter-label={t("compare")} />
                  </tr>
                </thead>
                <tbody>
                  {visibleCustomers.map((customer) => {
                    const active = selectedCustomer?.customer_code === customer.customer_code;
                    return (
                      <tr key={customer.customer_code}>
                        <td>
                          {active ? <strong>{customer.customer_code || "—"}</strong> : (customer.customer_code || "—")}
                        </td>
                        <td>
                          <Link
                            href={settlementHref(customer.customer_code)}
                            className="moduleInlineButton"
                          >
                            {customer.customer_name || "—"}
                          </Link>
                        </td>
                        <td>{customer.salesman_name || "—"}</td>
                        <td className={outstandingCellClass(customer.outstanding_total)}>
                          {formatMoney(customer.outstanding_total)}
                        </td>
                        <td className={`moduleBiTotalCol ${
                          customer.delta_status === "ready"
                            ? outstandingCellClass(customer.computed_open)
                            : ""
                        }`.trim()}>
                          <strong>
                            {customer.delta_status === "ready"
                              ? formatMoney(customer.computed_open)
                              : customer.delta_status === "loading"
                                ? t("deltaLoading")
                                : t("deltaPending")}
                          </strong>
                        </td>
                        <td className={customer.delta_status === "ready" ? deltaClass(customer.open_delta) : ""}>
                          {customer.delta_status === "ready"
                            ? formatDelta(customer.open_delta)
                            : customer.delta_status === "loading"
                              ? t("deltaLoading")
                              : t("deltaPending")}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="moduleInlineButton moduleActionButton"
                            onClick={() => void loadCompare(customer)}
                            disabled={loadingCompare && active}
                          >
                            {t("compare")}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {!visibleCustomers.length && !loadingCustomers ? (
                    <tr>
                      <td colSpan={7}>{t("noCustomers")}</td>
                    </tr>
                  ) : null}
                </tbody>
                <tfoot>
                  <tr className="moduleBiTotalRow">
                    <td colSpan={3}><strong>{t("total")}</strong></td>
                    <td>
                      <strong>{formatMoney(customerFooter.total)}</strong>
                    </td>
                    <td className="moduleBiTotalCol">
                      <strong>
                        {customerFooter.diffReady ? formatMoney(customerFooter.computed) : t("deltaPending")}
                      </strong>
                    </td>
                    <td className={deltaClass(customerFooter.diff)}>
                      <strong>
                        {customerFooter.diffReady ? formatDelta(customerFooter.diff) : t("deltaPending")}
                      </strong>
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </ExportableTable>
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
