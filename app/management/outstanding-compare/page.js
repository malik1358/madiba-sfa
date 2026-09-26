"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import ExportableTable from "../../components/ExportableTable";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import BiExcelHead, { useBiExcelFilters } from "../business-dashboard/BiExcelHead";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { resolveAuthSession } from "../../lib/authSession";
import {
  buildCustomerOutstandingReconcileRow,
  buildPaymentSettlementLedger,
} from "../../lib/paymentBehavior.js";
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
  code: { en: "Code", ar: "الكود" },
  customer: { en: "Customer", ar: "العميل" },
  days0To30: { en: "0–30", ar: "0–30" },
  days30To60: { en: "30–60", ar: "30–60" },
  days61To90: { en: "61–90", ar: "61–90" },
  daysAbove90: { en: ">90", ar: ">90" },
  totalOutstanding: { en: "Total outstanding", ar: "إجمالي المستحق" },
  compare: { en: "Compare", ar: "قارن" },
  total: { en: "Total", ar: "الإجمالي" },
  noCustomers: { en: "No matching customers.", ar: "لا يوجد عملاء مطابقون." },
  diffTitle: { en: "Tally vs SFA — differences only", ar: "تالي مقابل النظام — الفروق فقط" },
  diffHint: {
    en: "Scans the customers listed below (use search to narrow) and keeps only customers where SFA outstanding differs from Tally or any invoice has a gap. Click a customer name for Invoices & Settlement.",
    ar: "يفحص العملاء المعروضين أدناه (استخدم البحث للتضييق) ويعرض فقط العملاء الذين يختلف مستحقهم في النظام عن تالي أو لديهم فاتورة بفرق. اضغط اسم العميل لعرض الفواتير والتسوية.",
  },
  scan: { en: "Scan customers", ar: "فحص العملاء" },
  stop: { en: "Stop", ar: "إيقاف" },
  tallyOutstanding: { en: "Tally Outstanding", ar: "مستحق تالي" },
  sfaOutstanding: { en: "SFA Outstanding", ar: "مستحق النظام" },
  difference: { en: "Difference (SFA − Tally)", ar: "الفرق (النظام − تالي)" },
  invoiceGaps: { en: "Invoice gaps", ar: "فواتير بفروق" },
  unmatchedReceipts: { en: "Unapplied receipts", ar: "تحصيلات غير مطبقة" },
  unmatchedCn: { en: "Unapplied CN", ar: "إشعارات دائن غير مطبقة" },
  noDifferences: { en: "No differences found in scanned customers.", ar: "لا توجد فروق في العملاء المفحوصين." },
  notScanned: { en: "Click Scan to build the difference report.", ar: "اضغط فحص لإنشاء تقرير الفروق." },
  failed: { en: "failed", ar: "فشل" },
};

const SCAN_CONCURRENCY = 4;

const CUSTOMER_FILTER_KEYS = ["code", "name", "d0", "d30", "d61", "d90", "total"];

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
  const [scanRows, setScanRows] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0, failed: 0 });
  const stopScanRef = useRef(false);

  const canAccess = access.canAccess("outstandingCompare")
    || access.canAccess("paymentSettlement")
    || access.canAccess("customerAudit");

  const customerRows = useMemo(() => {
    const needle = String(customerSearch || "").trim().toLowerCase();
    const rows = customers
      .map((row) => ({
        ...row,
        outstanding_total: customerOutstandingTotal(row),
      }))
      .filter((row) => {
        if (!needle) return true;
        const code = String(row.customer_code || "").toLowerCase();
        const name = String(row.customer_name || "").toLowerCase();
        return code.includes(needle) || name.includes(needle);
      })
      .sort((a, b) => {
        const byOutstanding = Number(b.outstanding_total || 0) - Number(a.outstanding_total || 0);
        if (Math.abs(byOutstanding) > 0.009) return byOutstanding;
        return String(a.customer_code || "").localeCompare(String(b.customer_code || ""));
      });
    return rows;
  }, [customerSearch, customers]);

  const customerFilterValue = useCallback((row, key) => {
    if (key === "code") return String(row.customer_code || "—");
    if (key === "name") return String(row.customer_name || "—");
    if (key === "d0") return formatMoney(row.outstanding_0_30);
    if (key === "d30") return formatMoney(row.outstanding_30_60);
    if (key === "d61") return formatMoney(row.outstanding_61_90);
    if (key === "d90") return formatMoney(row.outstanding_above_90);
    return formatMoney(row.outstanding_total);
  }, []);

  const {
    filters: customerFilters,
    options: customerFilterOptions,
    visibleRows: visibleCustomers,
    setFilter: setCustomerFilter,
  } = useBiExcelFilters(customerRows, CUSTOMER_FILTER_KEYS, customerFilterValue);

  const customerFooter = useMemo(() => ({
    d0: visibleCustomers.reduce((sum, row) => sum + Number(row.outstanding_0_30 || 0), 0),
    d30: visibleCustomers.reduce((sum, row) => sum + Number(row.outstanding_30_60 || 0), 0),
    d61: visibleCustomers.reduce((sum, row) => sum + Number(row.outstanding_61_90 || 0), 0),
    d90: visibleCustomers.reduce((sum, row) => sum + Number(row.outstanding_above_90 || 0), 0),
    total: visibleCustomers.reduce((sum, row) => sum + Number(row.outstanding_total || 0), 0),
  }), [visibleCustomers]);

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

  const scanDifferences = useCallback(async (list) => {
    const supabase = getSupabaseClient();
    if (!supabase || !list.length) return;

    stopScanRef.current = false;
    setScanning(true);
    setScanRows([]);
    setScanProgress({ done: 0, total: list.length, failed: 0 });
    setError("");

    try {
      const session = await resolveAuthSession(supabase);
      const headers = { Authorization: `Bearer ${session.access_token}` };
      const found = [];
      let cursor = 0;
      let done = 0;
      let failed = 0;

      const worker = async () => {
        while (!stopScanRef.current && cursor < list.length) {
          const customer = list[cursor];
          cursor += 1;
          try {
            const code = encodeURIComponent(customer.customer_code || "");
            const name = encodeURIComponent(customer.customer_name || "");
            const [historyResponse, outstandingResponse] = await Promise.all([
              fetch(`/api/customer-history?customerCode=${code}&customerName=${name}&fullHistory=1&scope=settlement&lite=1`, { headers }),
              fetch(`/api/outstanding?customerCode=${code}&customerName=${name}`, { headers }),
            ]);
            const historyPayload = await historyResponse.json().catch(() => ({}));
            const outstandingPayload = await outstandingResponse.json().catch(() => ({}));
            if (!historyResponse.ok || !historyPayload.success) {
              throw new Error(historyPayload.error || "history failed");
            }
            const customerLedger = buildPaymentSettlementLedger({
              transactions: Array.isArray(historyPayload.transactions) ? historyPayload.transactions : [],
              receipts: Array.isArray(historyPayload.receipts) ? historyPayload.receipts : [],
              outstandingCustomer: outstandingPayload?.customer || null,
              outstandingInvoices: Array.isArray(outstandingPayload?.customerInvoices)
                ? outstandingPayload.customerInvoices
                : [],
            });
            const row = buildCustomerOutstandingReconcileRow({
              customer,
              ledger: customerLedger,
              tallyOutstanding: customerOutstandingTotal(customer),
            });
            if (row.has_difference) {
              found.push(row);
              setScanRows([...found].sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference)));
            }
          } catch {
            failed += 1;
          }
          done += 1;
          setScanProgress({ done, total: list.length, failed });
        }
      };

      await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, list.length) }, worker));
      setMessage(`${found.length} customer(s) with Tally vs SFA differences.`);
    } catch (err) {
      setError(err.message || "Unable to scan customers.");
    } finally {
      setScanning(false);
    }
  }, []);

  const scanFooter = useMemo(() => {
    const rows = scanRows || [];
    return {
      tally: rows.reduce((sum, row) => sum + row.tally_outstanding, 0),
      sfa: rows.reduce((sum, row) => sum + row.sfa_outstanding, 0),
      difference: rows.reduce((sum, row) => sum + row.difference, 0),
      gaps: rows.reduce((sum, row) => sum + row.invoice_gap_count, 0),
      receipts: rows.reduce((sum, row) => sum + row.unmatched_receipt_amount, 0),
      cn: rows.reduce((sum, row) => sum + row.unmatched_credit_note_amount, 0),
    };
  }, [scanRows]);

  useEffect(() => () => {
    stopScanRef.current = true;
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
              <h2>{t("diffTitle")}</h2>
              <span>
                {scanProgress.total
                  ? `${formatCount(scanProgress.done)} / ${formatCount(scanProgress.total)}`
                    + (scanProgress.failed ? ` · ${formatCount(scanProgress.failed)} ${t("failed")}` : "")
                  : ""}
              </span>
            </div>
            <p className="moduleHint">{t("diffHint")}</p>
            <div className="moduleFilterRow">
              {scanning ? (
                <button
                  type="button"
                  className="moduleInlineButton moduleActionButton"
                  onClick={() => { stopScanRef.current = true; }}
                >
                  {t("stop")}
                </button>
              ) : (
                <button
                  type="button"
                  className="moduleInlineButton moduleActionButton"
                  onClick={() => void scanDifferences(visibleCustomers)}
                  disabled={loadingCustomers || !visibleCustomers.length}
                >
                  {`${t("scan")} (${formatCount(visibleCustomers.length)})`}
                </button>
              )}
            </div>
            <ExportableTable filename="tally-vs-sfa-outstanding-differences" sheetName="Differences" className="moduleTableWrap moduleBiTableWrap">
              <table className="moduleTable moduleBiTable">
                <thead>
                  <tr>
                    <th>{t("code")}</th>
                    <th>{t("customer")}</th>
                    <th>{t("tallyOutstanding")}</th>
                    <th>{t("sfaOutstanding")}</th>
                    <th className="moduleBiTotalCol">{t("difference")}</th>
                    <th>{t("invoiceGaps")}</th>
                    <th>{t("unmatchedReceipts")}</th>
                    <th>{t("unmatchedCn")}</th>
                    <th>{t("compare")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(scanRows || []).map((row) => (
                    <tr key={`diff-${row.customer_code}`}>
                      <td>{row.customer_code || "—"}</td>
                      <td>
                        <Link href={settlementHref(row.customer_code)} className="moduleInlineButton">
                          {row.customer_name || row.customer_code || "—"}
                        </Link>
                      </td>
                      <td>{formatMoney(row.tally_outstanding)}</td>
                      <td>{formatMoney(row.sfa_outstanding)}</td>
                      <td className={`moduleBiTotalCol ${deltaClass(row.difference)}`.trim()}>
                        <strong>{formatDelta(row.difference)}</strong>
                      </td>
                      <td>{formatCount(row.invoice_gap_count)}</td>
                      <td>{formatMoney(row.unmatched_receipt_amount)}</td>
                      <td>{formatMoney(row.unmatched_credit_note_amount)}</td>
                      <td>
                        <button
                          type="button"
                          className="moduleInlineButton moduleActionButton"
                          onClick={() => {
                            const match = customers.find((c) => String(c.customer_code || "").toUpperCase() === row.customer_code);
                            void loadCompare(match || row);
                          }}
                          disabled={loadingCompare}
                        >
                          {t("compare")}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {scanRows && !scanRows.length && !scanning ? (
                    <tr><td colSpan={9}>{t("noDifferences")}</td></tr>
                  ) : null}
                  {!scanRows && !scanning ? (
                    <tr><td colSpan={9}>{t("notScanned")}</td></tr>
                  ) : null}
                </tbody>
                <tfoot>
                  <tr className="moduleBiTotalRow">
                    <td colSpan={2}><strong>{t("total")}</strong></td>
                    <td><strong>{formatMoney(scanFooter.tally)}</strong></td>
                    <td><strong>{formatMoney(scanFooter.sfa)}</strong></td>
                    <td className={`moduleBiTotalCol ${deltaClass(scanFooter.difference)}`.trim()}>
                      <strong>{formatDelta(scanFooter.difference)}</strong>
                    </td>
                    <td><strong>{formatCount(scanFooter.gaps)}</strong></td>
                    <td><strong>{formatMoney(scanFooter.receipts)}</strong></td>
                    <td><strong>{formatMoney(scanFooter.cn)}</strong></td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </ExportableTable>
          </section>

          <section className="moduleSection">
            <div className="moduleSectionHeader">
              <h2>{t("customer")}</h2>
              <span>
                {loadingCustomers
                  ? "Loading customers..."
                  : `${visibleCustomers.length.toLocaleString()} of ${customers.length.toLocaleString()} visible`}
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
              <table className="moduleTable moduleBiTable">
                <thead>
                  <tr>
                    <BiExcelHead
                      label={t("code")}
                      filterKey="code"
                      options={customerFilterOptions}
                      filters={customerFilters}
                      onChange={setCustomerFilter}
                    />
                    <BiExcelHead
                      label={t("customer")}
                      filterKey="name"
                      options={customerFilterOptions}
                      filters={customerFilters}
                      onChange={setCustomerFilter}
                    />
                    <BiExcelHead
                      label={t("days0To30")}
                      filterKey="d0"
                      options={customerFilterOptions}
                      filters={customerFilters}
                      onChange={setCustomerFilter}
                    />
                    <BiExcelHead
                      label={t("days30To60")}
                      filterKey="d30"
                      options={customerFilterOptions}
                      filters={customerFilters}
                      onChange={setCustomerFilter}
                    />
                    <BiExcelHead
                      label={t("days61To90")}
                      filterKey="d61"
                      options={customerFilterOptions}
                      filters={customerFilters}
                      onChange={setCustomerFilter}
                    />
                    <BiExcelHead
                      label={t("daysAbove90")}
                      filterKey="d90"
                      options={customerFilterOptions}
                      filters={customerFilters}
                      onChange={setCustomerFilter}
                    />
                    <BiExcelHead
                      label={t("totalOutstanding")}
                      filterKey="total"
                      options={customerFilterOptions}
                      filters={customerFilters}
                      onChange={setCustomerFilter}
                      className="moduleBiTotalCol"
                    />
                    <th>{t("compare")}</th>
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
                        <td className={outstandingCellClass(customer.outstanding_0_30)}>
                          {formatMoney(customer.outstanding_0_30)}
                        </td>
                        <td className={outstandingCellClass(customer.outstanding_30_60)}>
                          {formatMoney(customer.outstanding_30_60)}
                        </td>
                        <td className={outstandingCellClass(customer.outstanding_61_90)}>
                          {formatMoney(customer.outstanding_61_90)}
                        </td>
                        <td className={outstandingCellClass(customer.outstanding_above_90)}>
                          {formatMoney(customer.outstanding_above_90)}
                        </td>
                        <td className={`moduleBiTotalCol ${outstandingCellClass(customer.outstanding_total)}`.trim()}>
                          <strong>{formatMoney(customer.outstanding_total)}</strong>
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
                      <td colSpan={8}>{t("noCustomers")}</td>
                    </tr>
                  ) : null}
                </tbody>
                <tfoot>
                  <tr className="moduleBiTotalRow">
                    <td colSpan={2}><strong>{t("total")}</strong></td>
                    <td><strong>{formatMoney(customerFooter.d0)}</strong></td>
                    <td><strong>{formatMoney(customerFooter.d30)}</strong></td>
                    <td><strong>{formatMoney(customerFooter.d61)}</strong></td>
                    <td><strong>{formatMoney(customerFooter.d90)}</strong></td>
                    <td className="moduleBiTotalCol">
                      <strong>{formatMoney(customerFooter.total)}</strong>
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
