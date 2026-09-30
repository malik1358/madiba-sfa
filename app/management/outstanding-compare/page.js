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
import {
  BILL_MISMATCH_DAY_INCOMPLETE,
  BILL_MISMATCH_LABELS,
  BILL_MISMATCH_MISSING,
  BILL_MISMATCH_OTHER_CUSTOMER,
  BILL_MISMATCH_REVERSED,
  summarizeOutstandingBillMismatches,
} from "../../lib/outstandingReconcile.js";
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
  branchIssue: { en: "Branch issue", ar: "مشكلة تخصيص الفاتورة" },
  branchIssueTitle: {
    en: "Customer total matches, but invoice balances differ. Review the invoice allocation with the customer’s requested adjustment.",
    ar: "إجمالي العميل متطابق لكن أرصدة الفواتير مختلفة. راجع تخصيص الفاتورة حسب طلب العميل.",
  },
  total: { en: "Total", ar: "الإجمالي" },
  noCustomers: { en: "No matching customers.", ar: "لا يوجد عملاء مطابقون." },
  deltaLoading: { en: "…", ar: "…" },
  deltaPending: { en: "—", ar: "—" },
  differencesOnly: { en: "Show differences only", ar: "عرض الفروق فقط" },
  noDifferences: { en: "No differences found in checked customers yet.", ar: "لا توجد فروق في العملاء الذين تم فحصهم حتى الآن." },
  recalculate: { en: "Recalculate", ar: "إعادة الحساب" },
  recalculating: { en: "Recalculating…", ar: "جاري إعادة الحساب…" },
  mismatchTitle: { en: "Tally bills not matched to a sales invoice", ar: "فواتير تالي غير المطابقة لفاتورة مبيعات" },
  mismatchHint: {
    en: "Each bill below opened its own row because its Ref. No. matched no sales invoice for that customer. Grouped by cause so the source of the problem is clear.",
    ar: "كل فاتورة أدناه ظهرت كسطر مستقل لأن رقم المرجع لم يطابق أي فاتورة مبيعات لهذا العميل. مجمعة حسب السبب.",
  },
  billRef: { en: "Bill ref", ar: "مرجع الفاتورة" },
  billDate: { en: "Bill date", ar: "تاريخ الفاتورة" },
  pending: { en: "Pending", ar: "المستحق" },
  invoiceDays: { en: "Invoice days", ar: "عمر الفاتورة" },
  cause: { en: "Cause", ar: "السبب" },
  detail: { en: "Detail", ar: "التفاصيل" },
  allCauses: { en: "All causes", ar: "كل الأسباب" },
  noMismatches: { en: "Every Tally bill matched a sales invoice.", ar: "كل فواتير تالي طابقت فواتير المبيعات." },
  sameAmountAs: { en: "Same amount as", ar: "نفس مبلغ" },
  coverageTitle: { en: "Sales days that look incomplete", ar: "أيام مبيعات تبدو غير مكتملة" },
  coverageHint: {
    en: "A sales upload replaces every stored row for the dates in the file, so a partial export deletes the rest of that day. These dates kept far fewer salesmen than the days around them. Re-upload a full sales export for them, then press Recalculate.",
    ar: "رفع المبيعات يستبدل كل سطور التواريخ الموجودة في الملف، لذلك الملف الجزئي يحذف باقي اليوم. أعد رفع ملف مبيعات كامل لهذه التواريخ ثم اضغط إعادة الحساب.",
  },
  coverageDate: { en: "Date", ar: "التاريخ" },
  coverageSalesmen: { en: "Salesmen kept", ar: "المندوبون المتبقون" },
  coverageExpected: { en: "Usual salesmen", ar: "المعتاد" },
  coverageLines: { en: "Sales lines", ar: "سطور المبيعات" },
  coverageVouchers: { en: "Vouchers", ar: "الفواتير" },
  coverageMissing: { en: "Salesmen missing that day", ar: "المندوبون المفقودون" },
  coverageNone: { en: "Every sales day looks complete.", ar: "كل أيام المبيعات تبدو مكتملة." },
};

const MISMATCH_TYPES = [
  BILL_MISMATCH_OTHER_CUSTOMER,
  BILL_MISMATCH_REVERSED,
  BILL_MISMATCH_DAY_INCOMPLETE,
  BILL_MISMATCH_MISSING,
];

function mismatchTypeClass(type) {
  if (type === BILL_MISMATCH_OTHER_CUSTOMER) return "paymentSettleStatus paymentSettleStatus--open";
  if (type === BILL_MISMATCH_REVERSED) return "paymentSettleStatus paymentSettleStatus--partial";
  if (type === BILL_MISMATCH_DAY_INCOMPLETE) return "paymentSettleStatus paymentSettleStatus--open";
  return "paymentSettleStatus";
}

const CUSTOMER_FILTER_KEYS = ["code", "name", "salesman", "total", "computed", "diff"];

/** The rebuild runs well past a minute, so the browser may never see its response. */
const RECALCULATE_POLL_MS = 5000;
const RECALCULATE_POLL_TIMEOUT_MS = 5 * 60 * 1000;

const SAVED_AT_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Riyadh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatSavedAt(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 16).replace("T", " ");
  return SAVED_AT_FORMAT.format(parsed).replace(",", "");
}

function wait(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

const CUSTOMER_COLUMNS = [
  { key: "code", labelKey: "code" },
  { key: "name", labelKey: "customer" },
  { key: "salesman", labelKey: "salesman" },
  { key: "total", labelKey: "totalOutstanding" },
  { key: "computed", labelKey: "computedOutstanding", className: "moduleBiTotalCol" },
  { key: "diff", labelKey: "difference" },
];

const DIFF_TOLERANCE = 0.02;

function hasCompareDifference(row) {
  return row.delta_status === "ready"
    && (Math.abs(Number(row.open_delta || 0)) > DIFF_TOLERANCE || Number(row.gap_count || 0) > 0);
}

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
    fetch(`/api/customer-history?customerCode=${code}&customerName=${name}&fullHistory=1&scope=settlement&lite=1`, { headers }),
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
  const [differencesOnly, setDifferencesOnly] = useState(true);
  const [savedRowsByCode, setSavedRowsByCode] = useState(null);
  const [savedMeta, setSavedMeta] = useState(null);
  const savedMetaRef = useRef(null);
  const [recalculating, setRecalculating] = useState(false);
  const [mismatchRows, setMismatchRows] = useState([]);
  const [coverageGaps, setCoverageGaps] = useState([]);
  const [mismatchType, setMismatchType] = useState("");
  const deltaStartedRef = useRef(new Set());

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
          gap_count: delta?.status === "ready" ? Number(delta.gap_count || 0) : 0,
          delta_status: delta?.status || "pending",
        };
      })
      .filter((row) => {
        if (differencesOnly && !hasCompareDifference(row)) return false;
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
  }, [customerSearch, customers, deltaByCode, differencesOnly]);

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

  const checkedCount = useMemo(
    () => Object.values(deltaByCode).filter((entry) => entry?.status === "ready").length,
    [deltaByCode],
  );

  const mismatchSummary = useMemo(
    () => summarizeOutstandingBillMismatches(mismatchRows),
    [mismatchRows],
  );

  const visibleMismatchRows = useMemo(
    () => (mismatchType ? mismatchRows.filter((row) => row.mismatch_type === mismatchType) : mismatchRows),
    [mismatchRows, mismatchType],
  );

  const mismatchLabel = useMemo(() => translate(language, BILL_MISMATCH_LABELS), [language]);

  const loadCustomers = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setLoadingCustomers(true);
    setError("");
    try {
      const session = await resolveAuthSession(supabase);
      const response = await fetch("/api/customers/visible?includeOutstanding=1&includeInactive=1", {
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
          gap_count: Number(totals.discrepancy_count || 0),
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

  const loadSavedReconcile = useCallback(async ({ silent = false } = {}) => {
    const supabase = getSupabaseClient();
    if (!supabase) return null;
    try {
      const session = await resolveAuthSession(supabase);
      const response = await fetch("/api/outstanding-reconcile", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to load saved reconciliation.");
      }
      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      setSavedRowsByCode(new Map(rows.map((row) => [String(row.customer_code || "").toUpperCase(), row])));
      setMismatchRows(Array.isArray(payload.mismatchRows) ? payload.mismatchRows : []);
      setCoverageGaps(Array.isArray(payload.coverageGaps) ? payload.coverageGaps : []);
      const meta = {
        builtAt: payload.builtAt || "",
        differenceCount: rows.length,
        scannedCount: Number(payload.scannedCount || 0),
      };
      setSavedMeta(meta);
      savedMetaRef.current = meta;
      return meta;
    } catch (err) {
      if (silent) return null;
      setError(err.message || "Unable to load saved reconciliation.");
      setSavedRowsByCode(new Map());
      setMismatchRows([]);
      setCoverageGaps([]);
      setSavedMeta(null);
      savedMetaRef.current = null;
      return null;
    }
  }, []);

  const recalculateOutstanding = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase || recalculating) return;

    setRecalculating(true);
    setError("");
    setMessage("");
    const previousBuiltAt = savedMetaRef.current?.builtAt || "";

    try {
      const session = await resolveAuthSession(supabase);
      let payload = null;
      let postError = null;

      try {
        const response = await fetch("/api/outstanding-reconcile", {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body.success) {
          throw new Error(body.error || "Unable to recalculate outstanding differences.");
        }
        payload = body;
      } catch (err) {
        // The rebuild keeps running on the server even when this response is lost.
        postError = err;
      }

      let meta = await loadSavedReconcile({ silent: Boolean(postError) });
      const deadline = Date.now() + RECALCULATE_POLL_TIMEOUT_MS;
      while (postError && (!meta || meta.builtAt === previousBuiltAt) && Date.now() < deadline) {
        await wait(RECALCULATE_POLL_MS);
        meta = await loadSavedReconcile({ silent: true });
      }

      if (postError && (!meta || meta.builtAt === previousBuiltAt)) {
        throw postError;
      }

      setMessage(
        `Recalculated ${formatCount(payload?.scannedCount ?? meta?.scannedCount ?? 0)} customers; `
        + `${formatCount(payload?.differenceCount ?? meta?.differenceCount ?? 0)} with differences.`,
      );
    } catch (err) {
      setError(err.message || "Unable to recalculate outstanding differences.");
    } finally {
      setRecalculating(false);
    }
  }, [loadSavedReconcile, recalculating]);

  useEffect(() => {
    loadSavedReconcile();
  }, [loadSavedReconcile]);

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
    if (!customers.length || loadingCustomers || !savedRowsByCode) return;
    setDeltaByCode((current) => {
      const next = { ...current };
      customers.forEach((row) => {
        const code = String(row.customer_code || "").trim();
        if (!code || next[code]?.status === "ready") return;
        const saved = savedRowsByCode.get(code.toUpperCase());
        const tally = customerOutstandingTotal(row);
        next[code] = saved
          ? {
            status: "ready",
            open_delta: Number(saved.difference || 0),
            computed_open: Number(saved.sfa_outstanding || 0),
            tally_open: Number(saved.tally_outstanding || 0),
            gap_count: Number(saved.invoice_gap_count || 0),
          }
          // Absent from the saved dataset means the upload reconciled with no gap.
          : {
            status: "ready",
            open_delta: 0,
            computed_open: tally,
            tally_open: tally,
            gap_count: 0,
          };
      });
      return next;
    });
  }, [customers, loadingCustomers, savedRowsByCode]);

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
              <div className="moduleHeaderMeta">
                <span>
                  {loadingCustomers
                    ? "Loading customers..."
                    : `${visibleCustomers.length.toLocaleString()} of ${customers.length.toLocaleString()} visible${
                      checkedCount
                        ? ` · ${checkedCount.toLocaleString()} of ${customers.length.toLocaleString()} checked`
                        : ""
                    }${savedMeta?.builtAt ? ` · saved ${formatSavedAt(savedMeta.builtAt)}` : ""}`}
                </span>
                {access.canAccess("upload") ? (
                  <button
                    type="button"
                    className="moduleInlineButton moduleActionButton"
                    onClick={() => void recalculateOutstanding()}
                    disabled={recalculating}
                  >
                    {recalculating ? t("recalculating") : t("recalculate")}
                  </button>
                ) : null}
              </div>
            </div>
            <div className="moduleFilterRow">
              <input
                className="moduleInput"
                value={customerSearch}
                onChange={(event) => setCustomerSearch(event.target.value)}
                placeholder={t("search")}
              />
              <label className="moduleCollectorCheckbox">
                <input
                  type="checkbox"
                  checked={differencesOnly}
                  onChange={(event) => setDifferencesOnly(event.target.checked)}
                />
                {t("differencesOnly")}
              </label>
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
                    <th data-column-filter-label={t("branchIssue")}>{t("branchIssue")}</th>
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
                    <th data-column-filter-label={t("branchIssue")} />
                  </tr>
                </thead>
                <tbody>
                  {visibleCustomers.map((customer) => {
                    const active = selectedCustomer?.customer_code === customer.customer_code;
                    const hasBranchIssue = customer.delta_status === "ready"
                      && Math.abs(Number(customer.open_delta || 0)) <= DIFF_TOLERANCE
                      && Number(customer.gap_count || 0) > 0;
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
                          {hasBranchIssue ? (
                            <button
                              type="button"
                              className="moduleInlineButton moduleActionButton"
                              onClick={() => void loadCompare(customer)}
                              disabled={loadingCompare}
                              title={t("branchIssueTitle")}
                            >
                              {t("branchIssue")}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                  {!visibleCustomers.length && !loadingCustomers ? (
                    <tr>
                      <td colSpan={7}>{differencesOnly ? t("noDifferences") : t("noCustomers")}</td>
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

          <section className="moduleSection" id="sales-coverage">
            <div className="moduleSectionHeader">
              <h2>{t("coverageTitle")}</h2>
              <div className="moduleHeaderMeta">
                <span>{`${formatCount(coverageGaps.length)} ${t("coverageDate").toLowerCase()}(s)`}</span>
                {access.canAccess("upload") ? (
                  <button
                    type="button"
                    className="moduleInlineButton moduleActionButton"
                    onClick={() => void recalculateOutstanding()}
                    disabled={recalculating}
                  >
                    {recalculating ? t("recalculating") : t("recalculate")}
                  </button>
                ) : null}
              </div>
            </div>
            <p className="moduleHint">{t("coverageHint")}</p>
            <ExportableTable filename="sales-coverage-gaps" sheetName="CoverageGaps" className="moduleTableWrap moduleBiTableWrap">
              <table className="moduleTable moduleBiTable">
                <thead>
                  <tr>
                    <th>{t("coverageDate")}</th>
                    <th>{t("coverageSalesmen")}</th>
                    <th>{t("coverageExpected")}</th>
                    <th>{t("coverageLines")}</th>
                    <th>{t("coverageVouchers")}</th>
                    <th>{t("coverageMissing")}</th>
                  </tr>
                </thead>
                <tbody>
                  {coverageGaps.map((gap) => (
                    <tr key={`coverage-${gap.date}`}>
                      <td>{gap.date}</td>
                      <td className="moduleBiMonthCell--down">
                        <strong>{formatCount(gap.salesmen)}</strong>
                      </td>
                      <td>{formatCount(gap.expected_salesmen)}</td>
                      <td>{formatCount(gap.lines)}</td>
                      <td>{formatCount(gap.vouchers)}</td>
                      <td>
                        <div className="auditSummaryCardMeta">
                          {gap.missing_salesmen?.length ? gap.missing_salesmen.join(", ") : "—"}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!coverageGaps.length ? (
                    <tr>
                      <td colSpan={6}>{t("coverageNone")}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </ExportableTable>
          </section>

          <section className="moduleSection" id="bill-mismatch">
            <div className="moduleSectionHeader">
              <h2>{t("mismatchTitle")}</h2>
              <div className="moduleHeaderMeta">
                <span>
                  {`${formatCount(mismatchSummary.count)} bills · ${formatMoney(mismatchSummary.pending)}`}
                </span>
                {access.canAccess("upload") ? (
                  <button
                    type="button"
                    className="moduleInlineButton moduleActionButton"
                    onClick={() => void recalculateOutstanding()}
                    disabled={recalculating}
                  >
                    {recalculating ? t("recalculating") : t("recalculate")}
                  </button>
                ) : null}
              </div>
            </div>
            <p className="moduleHint">{t("mismatchHint")}</p>
            <div className="auditSummaryGrid">
              {MISMATCH_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  className="auditSummaryCard"
                  onClick={() => setMismatchType((current) => (current === type ? "" : type))}
                  style={{ textAlign: "start", cursor: "pointer", borderWidth: mismatchType === type ? 2 : 1 }}
                >
                  <span>{mismatchLabel(type)}</span>
                  <strong>{formatCount(mismatchSummary.byType?.[type]?.count || 0)}</strong>
                  <em className="auditSummaryCardMeta">
                    {formatMoney(mismatchSummary.byType?.[type]?.pending || 0)}
                  </em>
                </button>
              ))}
            </div>
            <div className="moduleFilterRow">
              <button
                type="button"
                className="moduleInlineButton moduleActionButton"
                onClick={() => setMismatchType("")}
                disabled={!mismatchType}
              >
                {t("allCauses")}
              </button>
            </div>
            <ExportableTable filename="tally-bill-mismatches" sheetName="BillMismatches" className="moduleTableWrap moduleBiTableWrap">
              <table className="moduleTable moduleBiTable">
                <thead>
                  <tr>
                    <th>{t("code")}</th>
                    <th>{t("customer")}</th>
                    <th>{t("salesman")}</th>
                    <th>{t("billRef")}</th>
                    <th>{t("billDate")}</th>
                    <th className="moduleBiTotalCol">{t("pending")}</th>
                    <th>{t("invoiceDays")}</th>
                    <th>{t("cause")}</th>
                    <th>{t("detail")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleMismatchRows.map((row) => (
                    <tr key={`mismatch-${row.customer_code}-${row.bill_ref}`}>
                      <td>{row.customer_code || "—"}</td>
                      <td>
                        <Link href={settlementHref(row.customer_code)} className="moduleInlineButton">
                          {row.customer_name || row.customer_code || "—"}
                        </Link>
                      </td>
                      <td>{row.salesman_name || "—"}</td>
                      <td>{row.bill_ref || "—"}</td>
                      <td>{row.bill_date || "—"}</td>
                      <td className="moduleBiTotalCol moduleBiMonthCell--down">
                        <strong>{formatMoney(row.pending_amount)}</strong>
                      </td>
                      <td>{formatCount(row.invoice_days)}</td>
                      <td>
                        <span className={mismatchTypeClass(row.mismatch_type)}>
                          {mismatchLabel(row.mismatch_type)}
                        </span>
                      </td>
                      <td>
                        <div className="auditSummaryCardMeta">{row.note}</div>
                        {row.same_amount_vouchers?.length ? (
                          <div className="auditSummaryCardMeta">
                            {`${t("sameAmountAs")}: ${row.same_amount_vouchers.join(", ")}`}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  {!visibleMismatchRows.length ? (
                    <tr>
                      <td colSpan={9}>{t("noMismatches")}</td>
                    </tr>
                  ) : null}
                </tbody>
                <tfoot>
                  <tr className="moduleBiTotalRow">
                    <td colSpan={5}><strong>{t("total")}</strong></td>
                    <td className="moduleBiTotalCol">
                      <strong>
                        {formatMoney(visibleMismatchRows.reduce((sum, row) => sum + Number(row.pending_amount || 0), 0))}
                      </strong>
                    </td>
                    <td colSpan={3} />
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
