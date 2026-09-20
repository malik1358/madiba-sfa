"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import ExportableTable from "../../components/ExportableTable";
import ExcelColumnFilter from "../../components/ExcelColumnFilter";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { getSupabaseClient } from "../../lib/supabase";
import {
  fetchPendingOrdersCached,
  fetchSalesScopeCached,
  readPendingOrdersInvoiceMeta,
  writePendingOrdersInvoiceMeta,
} from "../../lib/mobileDataCache";
import {
  isQueuedPendingOrderId,
  listQueuedPendingOrders,
  mergeServerAndQueuedOrders,
} from "../../lib/queuedSalesOrders";
import { processOfflineQueue } from "../../lib/offlineApi";
import { formatSalesOrderNumber } from "../../lib/salesOrderNumber";
import { findOutstandingForCustomer, sortBucketLabels } from "../../lib/outstanding";
import { evaluateCreditApproval } from "../../lib/creditApproval";
import { formatComparisonDiff } from "../../lib/invoiceOrderCompare";
import { usePopupMessages } from "../../hooks/usePopupMessages";
import { useUnsavedEntryGuard } from "../../hooks/useUnsavedEntryGuard";
import { buildOrderPdfFileName, saveOrShareOrderPdf } from "../../lib/orderPdfExport";
import {
  buildOrderPdfSnapshotFromSavedOrder,
  createOrderPdfDocument,
  resolveLiveOrderPdfSnapshot,
} from "../../lib/orderPdfDocument";
import { buildTallyOrderExportRows, unitMapFromItems } from "../../lib/tallyItemUnits";
import { PENDING_ORDER_STATUSES } from "../../lib/pendingOrdersQuery";
import { formatKsaDateTime } from "../../lib/workdayActivity";
import { canManageOrderInvoice, isInvoiceMakerRole } from "../../lib/moduleAccess";
import {
  ORDER_REJECTION_REASONS,
  ORDER_STATUS_INVOICE_MADE,
  ORDER_STATUS_PENDING_APPROVAL,
  ORDER_STATUS_PENDING_CREDIT,
  ORDER_STATUS_PENDING_INVOICE_CREATION,
  ORDER_STATUS_QUOTATION_WAITING_PAYMENT,
  ORDER_STATUS_PENDING_WITH_SALESMAN,
  ORDER_STATUS_REJECTED,
  ORDER_STATUS_STOCK_UNAVAILABLE,
  ORDER_STATUS_WAITING_CREDIT_APPLICATION,
  ORDER_STATUS_WAITING_STOCK_TRANSFER,
  ORDER_STATUS_WAITING_OVERDUE_COLLECTION,
  canApprovePendingOrders,
  displayInvoiceStatus,
  isPendingForApprovalStatus,
  shouldAutoMarkPendingApproval,
  shouldAutoMarkPendingInvoiceCreation,
  shouldAutoRejectLegacyUninvoicedOrder,
  shouldShowPendingApprovalActions,
} from "../../lib/orderApproval";
import { matchesExcelColumnFilter, pruneExcelFilterSelection, rowMatchesOtherExcelFilters } from "../../lib/excelColumnFilter";
import {
  formatPendingDuration,
  pendingOrderTimeToMakeBucket,
  pendingOrderTimeToMakeSeconds,
  shouldRunTimeToMakeClock,
} from "../../lib/pendingOrderTimeToMake";
import { amountInclVat } from "../../lib/invoiceAmountFromPdf";
import { useAppPopup } from "../../components/AppPopupProvider";

const TEXT = {
  title: { en: "Pending Orders", ar: "الطلبات المعلقة" },
  subtitleTeam: { en: "Orders queue across the team", ar: "قائمة الطلبات على مستوى الفريق" },
  subtitleMine: { en: "Orders queue in your account", ar: "قائمة الطلبات في حسابك" },
  dashboard: { en: "← Dashboard", ar: "← الرئيسية" },
  loading: { en: "Loading old pending orders...", ar: "جاري تحميل الطلبات المعلقة القديمة..." },
  cacheRefreshing: { en: "Showing saved data. Refreshing in background...", ar: "عرض البيانات المحفوظة. جاري التحديث في الخلفية..." },
  cacheOffline: { en: "Offline — showing last saved pending orders.", ar: "غير متصل — عرض آخر الطلبات المحفوظة." },
  onDevice: { en: "On this device", ar: "على هذا الجهاز" },
  syncFailed: { en: "Sync failed", ar: "فشل المزامنة" },
};

const PENDING_STATUSES = PENDING_ORDER_STATUSES;
const INVOICE_STATUS_PENDING_APPROVAL = ORDER_STATUS_PENDING_APPROVAL;
const INVOICE_STATUS_PENDING_CREDIT = ORDER_STATUS_PENDING_CREDIT;
const INVOICE_STATUS_PENDING_INVOICE_CREATION = ORDER_STATUS_PENDING_INVOICE_CREATION;
const INVOICE_STATUS_WAITING_CREDIT_APPLICATION = ORDER_STATUS_WAITING_CREDIT_APPLICATION;
const INVOICE_STATUS_QUOTATION_WAITING_PAYMENT = ORDER_STATUS_QUOTATION_WAITING_PAYMENT;
const INVOICE_STATUS_PENDING_WITH_SALESMAN = ORDER_STATUS_PENDING_WITH_SALESMAN;
const INVOICE_STATUS_REJECTED = ORDER_STATUS_REJECTED;
const INVOICE_STATUS_STOCK_UNAVAILABLE = ORDER_STATUS_STOCK_UNAVAILABLE;
const INVOICE_STATUS_WAITING_STOCK_TRANSFER = ORDER_STATUS_WAITING_STOCK_TRANSFER;
const INVOICE_STATUS_WAITING_OVERDUE_COLLECTION = ORDER_STATUS_WAITING_OVERDUE_COLLECTION;
const INVOICE_STATUS_MADE = ORDER_STATUS_INVOICE_MADE;
const OUTSTANDING_API = "/api/outstanding";
const EMPTY_FILTERS = {
  orderId: [],
  customer: [],
  salesman: [],
  status: [],
  invoiceStatus: [],
  uploadedAt: [],
  timeToMake: [],
  created: [],
  lastUpdated: [],
  age: [],
  orderValue: [],
  invoiceValue: [],
  currentOutstanding: [],
};

function displayOrDash(value) {
  const text = String(value ?? "").trim();
  return text || "-";
}

function uniqueColumnValues(values) {
  const seen = new Set();
  const unique = [];
  values.forEach((value) => {
    const text = displayOrDash(value);
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(text);
  });
  return unique.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

function matchesColumnFilter(value, filter) {
  return matchesExcelColumnFilter(value, filter);
}

function formatCurrentOutstanding(value) {
  if (value == null) return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return number.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function orderCurrentOutstanding(order, outstandingDataset) {
  if (!outstandingDataset) return null;
  const row = findOutstandingForCustomer(
    outstandingDataset,
    order?.customer_code,
    order?.customer_name,
  );
  return row ? Number(row.total_outstanding || 0) : 0;
}

function pendingOrderFilterValues(order, meta, approvalRequired = null, outstandingAmount = null) {
  const invoiceStatus = invoiceStatusText(meta, order, approvalRequired);
  return {
    orderId: displayOrDash(formatSalesOrderNumber(order) || order.id),
    customer: displayOrDash(order.customer_name || order.customer_code),
    salesman: displayOrDash(order.salesman_code),
    status: displayOrDash(order.status),
    invoiceStatus: displayOrDash(invoiceStatus),
    uploadedAt: displayOrDash(formatDateTime(meta?.invoiceUploadedAt)),
    timeToMake: pendingOrderTimeToMakeBucket(
      pendingOrderTimeToMakeSeconds(order, meta, Date.now(), invoiceStatus),
    ),
    created: displayOrDash(formatDateTime(order.created_at)),
    lastUpdated: displayOrDash(formatDateTime(order.updated_at)),
    age: String(daysOld(order.updated_at || order.created_at)),
    orderValue: formatMoneyInclVat(orderValueInclVat(order)),
    invoiceValue: formatMoneyInclVat(invoiceMadeInclVat(meta)),
    currentOutstanding: formatCurrentOutstanding(outstandingAmount),
  };
}

const HEADING_FILTERS = [
  { key: "orderId", label: "Order Number" },
  { key: "customer", label: "Customer" },
  { key: "salesman", label: "Salesman" },
  { key: "status", label: "Status" },
  { key: "invoiceStatus", label: "Invoice Status" },
  { key: "uploadedAt", label: "Uploaded At" },
  { key: "timeToMake", label: "Time to Make" },
  { key: "created", label: "Order created" },
  { key: "lastUpdated", label: "Last Updated" },
  { key: "age", label: "Age (days)" },
  { key: "orderValue", label: "Order value (incl. VAT)" },
  { key: "invoiceValue", label: "Invoice made (incl. VAT)" },
  { key: "currentOutstanding", label: "Current outstanding" },
];
const HEADING_FILTER_KEYS = HEADING_FILTERS.map(({ key }) => key);

function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function moneyExclVat(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function orderValueInclVat(order) {
  return amountInclVat(moneyExclVat(order?.total_value));
}

function invoiceMadeInclVat(meta) {
  return amountInclVat(moneyExclVat(meta?.invoiceAmountExclVat));
}

function formatMoneyInclVat(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "-";
  return number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateTime(value) {
  return formatKsaDateTime(value);
}

const durationTick = {
  now: Date.now(),
  listeners: new Set(),
  timer: null,
};

function subscribeDurationTick(listener) {
  durationTick.listeners.add(listener);
  if (!durationTick.timer) {
    durationTick.now = Date.now();
    durationTick.timer = setInterval(() => {
      durationTick.now = Date.now();
      durationTick.listeners.forEach((fn) => fn());
    }, 5000);
  }
  return () => {
    durationTick.listeners.delete(listener);
    if (durationTick.listeners.size === 0 && durationTick.timer) {
      clearInterval(durationTick.timer);
      durationTick.timer = null;
    }
  };
}

function TimeToMakeClock({ order, meta, approvalRequired = null }) {
  const invoiceStatus = invoiceStatusText(meta, order, approvalRequired);
  const live = shouldRunTimeToMakeClock(invoiceStatus);
  const nowMs = useSyncExternalStore(
    live ? subscribeDurationTick : () => () => {},
    () => (live ? durationTick.now : 0),
    () => 0,
  );
  return formatPendingDuration(
    pendingOrderTimeToMakeSeconds(order, meta, live ? durationTick.now : nowMs, invoiceStatus),
  );
}

function daysOld(fromDate) {
  if (!fromDate) return 0;
  const then = new Date(fromDate).getTime();
  const now = Date.now();
  return Math.max(0, Math.floor((now - then) / (1000 * 60 * 60 * 24)));
}

/** Tri-state: true / false when evaluated, null when credit check has not run yet. */
function creditApprovalRequiredFlag(creditApprovalByOrder, orderId) {
  const evaluation = creditApprovalByOrder?.[orderId];
  if (!evaluation || typeof evaluation.required !== "boolean") return null;
  return evaluation.required;
}

function invoiceStatusText(meta, order = null, approvalRequired = null) {
  if (order?.queuedLocally) {
    return order.syncStatus === "failed" ? "Sync failed" : "On this device";
  }
  if (!meta && approvalRequired == null && String(order?.status || "").trim().toUpperCase() !== "SUBMITTED") {
    return "-";
  }
  return displayInvoiceStatus(meta, { approvalRequired, order });
}

function InvoiceComparisonPanel({ meta }) {
  if (!meta?.invoiceFilePath) return null;

  if (!meta?.comparisonCheckedAt) {
    return <div className="moduleHint" style={{ marginTop: "10px" }}>Invoice comparison pending.</div>;
  }

  const diffs = Array.isArray(meta.comparisonDiffs) ? meta.comparisonDiffs : [];
  if (diffs.length === 0) {
    return (
      <div className="moduleHint" style={{ marginTop: "10px", color: "#166534" }}>
        Invoice matches the order for item, quantity, and price.
      </div>
    );
  }

  return (
    <div style={{ marginTop: "10px" }}>
      <strong>Invoice vs order differences</strong>
      <ul style={{ margin: "8px 0 0", paddingInlineStart: "18px" }}>
        {diffs.map((diff, index) => (
          <li key={`${diff.item_code || "item"}-${diff.type || "diff"}-${index}`}>
            {formatComparisonDiff(diff)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function PendingOrdersPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const { showPopup } = useAppPopup();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [offlineHint, setOfflineHint] = useState(false);
  const [error, setError] = useState("");
  const [orders, setOrders] = useState([]);
  const ordersRef = useRef(orders);
  ordersRef.current = orders;
  const [userRole, setUserRole] = useState("");
  const [activeOrderId, setActiveOrderId] = useState(null);
  const [orderLines, setOrderLines] = useState([]);
  const [orderHistory, setOrderHistory] = useState([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [downloadingPdfOrderId, setDownloadingPdfOrderId] = useState("");
  const [downloadingTallyExcelOrderId, setDownloadingTallyExcelOrderId] = useState("");
  const [invoiceMetaByOrder, setInvoiceMetaByOrder] = useState({});
  const [statusDraftByOrder, setStatusDraftByOrder] = useState({});
  const [rejectReasonByOrder, setRejectReasonByOrder] = useState({});
  const [openStartedAtByOrder, setOpenStartedAtByOrder] = useState({});
  const [approvingOrderId, setApprovingOrderId] = useState("");

  usePopupMessages({ error });
  const [selectedInvoiceFile, setSelectedInvoiceFile] = useState(null);
  const [uploadingInvoice, setUploadingInvoice] = useState(false);
  const [savingInvoiceStatus, setSavingInvoiceStatus] = useState(false);
  const [outstandingInfoByOrder, setOutstandingInfoByOrder] = useState({});
  const [outstandingDataset, setOutstandingDataset] = useState(null);
  const [creditApprovalByOrder, setCreditApprovalByOrder] = useState({});
  const [columnFilters, setColumnFilters] = useState(EMPTY_FILTERS);
  useUnsavedEntryGuard(Boolean(selectedInvoiceFile) || Object.values(statusDraftByOrder || {}).some((value) => String(value || "").trim()));

  const startOfTodayIso = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return start.toISOString();
  }, []);

  async function getAuthToken() {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error("Supabase is not configured.");

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error("Please login again.");
    }

    return session.access_token;
  }

  async function persistInvoiceStatus(orderId, status) {
    const token = await getAuthToken();
    const response = await fetch("/api/order-invoice", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        mode: "set-status",
        orderId,
        status,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success) {
      throw new Error(payload.error || "Unable to save invoice status.");
    }
    const item = payload.item || { orderId, status };
    setInvoiceMetaByOrder((current) => ({
      ...current,
      [orderId]: item,
    }));
    setStatusDraftByOrder((current) => ({
      ...current,
      [orderId]: String(item.status || status || ""),
    }));
    return item;
  }

  async function ensurePendingApprovalStatus(orderId, evaluation, meta = null, order = null) {
    const approvalRequired = typeof evaluation?.required === "boolean" ? evaluation.required : null;
    if (shouldAutoMarkPendingApproval({
      approvalRequired: approvalRequired === true,
      meta,
      order,
    })) {
      try {
        return await persistInvoiceStatus(orderId, INVOICE_STATUS_PENDING_APPROVAL);
      } catch (err) {
        console.warn(err.message || "Unable to mark order pending for approval.");
        const fallback = {
          ...(meta || { orderId }),
          status: INVOICE_STATUS_PENDING_APPROVAL,
        };
        setInvoiceMetaByOrder((current) => ({
          ...current,
          [orderId]: fallback,
        }));
        setStatusDraftByOrder((current) => ({
          ...current,
          [orderId]: INVOICE_STATUS_PENDING_APPROVAL,
        }));
        return fallback;
      }
    }

    if (shouldAutoMarkPendingInvoiceCreation({
      approvalRequired,
      meta,
      order,
    })) {
      try {
        return await persistInvoiceStatus(orderId, INVOICE_STATUS_PENDING_INVOICE_CREATION);
      } catch (err) {
        console.warn(err.message || "Unable to mark order pending for invoice creation.");
        const fallback = {
          ...(meta || { orderId }),
          status: INVOICE_STATUS_PENDING_INVOICE_CREATION,
        };
        setInvoiceMetaByOrder((current) => ({
          ...current,
          [orderId]: fallback,
        }));
        setStatusDraftByOrder((current) => ({
          ...current,
          [orderId]: INVOICE_STATUS_PENDING_INVOICE_CREATION,
        }));
        return fallback;
      }
    }

    return meta;
  }

  async function markSubmittedOrdersInvoiceQueue(orderList, metaByOrder = {}) {
    const source = (orderList || []).filter((order) => !isQueuedPendingOrderId(order?.id));
    const approvalRequiredFor = (orderId) => {
      const evaluation = creditApprovalByOrder?.[orderId];
      if (!evaluation || typeof evaluation.required !== "boolean") return null;
      return evaluation.required;
    };
    const legacyRejectIds = source
      .filter((order) => shouldAutoRejectLegacyUninvoicedOrder(order, metaByOrder?.[order.id] || null))
      .map((order) => String(order.id));
    const legacyRejectSet = new Set(legacyRejectIds);
    const approvalIds = source
      .filter((order) => !legacyRejectSet.has(String(order.id)))
      .filter((order) => shouldAutoMarkPendingApproval({
        order,
        meta: metaByOrder?.[order.id] || null,
        approvalRequired: approvalRequiredFor(order.id) === true,
      }))
      .map((order) => String(order.id));
    const invoiceIds = source
      .filter((order) => !legacyRejectSet.has(String(order.id)))
      .filter((order) => !approvalIds.includes(String(order.id)))
      .filter((order) => shouldAutoMarkPendingInvoiceCreation({
        order,
        meta: metaByOrder?.[order.id] || null,
        approvalRequired: approvalRequiredFor(order.id),
      }))
      .map((order) => String(order.id));

    if (legacyRejectIds.length === 0 && approvalIds.length === 0 && invoiceIds.length === 0) {
      return metaByOrder;
    }

    try {
      const token = await getAuthToken();
      let nextMeta = { ...metaByOrder };

      async function postMark(mode, orderIds) {
        if (orderIds.length === 0) return;
        for (let index = 0; index < orderIds.length; index += 500) {
          const chunk = orderIds.slice(index, index + 500);
          const response = await fetch("/api/order-invoice", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ mode, orderIds: chunk }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok || !payload.success) {
            throw new Error(payload.error || "Unable to update pending invoice statuses.");
          }
          const items = payload.items && typeof payload.items === "object" ? payload.items : {};
          nextMeta = { ...nextMeta, ...items };
          setInvoiceMetaByOrder((current) => ({
            ...current,
            ...items,
          }));
          setStatusDraftByOrder((current) => {
            const next = { ...current };
            Object.entries(items).forEach(([orderId, meta]) => {
              next[orderId] = String(meta?.status || "");
            });
            return next;
          });
        }
      }

      await postMark("mark-legacy-uninvoiced-rejected", legacyRejectIds);
      await postMark("mark-pending-approvals", approvalIds);
      await postMark("mark-pending-invoice-creation", invoiceIds);
      return nextMeta;
    } catch (err) {
      console.warn(err.message || "Unable to mark submitted order invoice statuses.");
      return metaByOrder;
    }
  }

  async function postApprovalAction(orderId, mode, extra = {}) {
    const token = await getAuthToken();
    const response = await fetch("/api/order-invoice", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        mode,
        orderId,
        ...extra,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success) {
      throw new Error(payload.error || "Unable to update order approval.");
    }
    const item = payload.item || { orderId };
    setInvoiceMetaByOrder((current) => ({
      ...current,
      [orderId]: item,
    }));
    setStatusDraftByOrder((current) => ({
      ...current,
      [orderId]: String(item.status || ""),
    }));
    if (mode === "reject-order") {
      setRejectReasonByOrder((current) => {
        const next = { ...current };
        delete next[orderId];
        return next;
      });
    }
    return item;
  }

  async function ensureOrderMarkedPendingForApproval(orderId) {
    const meta = invoiceMetaByOrder?.[orderId] || null;
    const order = ordersRef.current.find((entry) => String(entry.id) === String(orderId)) || null;
    if (isPendingForApprovalStatus(meta?.status)) {
      if (String(meta.status || "") !== INVOICE_STATUS_PENDING_APPROVAL) {
        return persistInvoiceStatus(orderId, INVOICE_STATUS_PENDING_APPROVAL);
      }
      return meta;
    }
    const evaluation = creditApprovalByOrder?.[orderId];
    if (
      evaluation?.required
      || shouldAutoMarkPendingApproval({ approvalRequired: true, meta, order })
    ) {
      return persistInvoiceStatus(orderId, INVOICE_STATUS_PENDING_APPROVAL);
    }
    throw new Error("Order is not pending for approval.");
  }

  async function approvePendingOrder(orderId) {
    setApprovingOrderId(orderId);
    setError("");
    try {
      await ensureOrderMarkedPendingForApproval(orderId);
      await postApprovalAction(orderId, "approve-order");
      await showPopup({
        variant: "success",
        message: "Order approved. Status set to Pending for invoice creation.",
      });
    } catch (err) {
      setError(err.message || "Unable to approve order.");
    } finally {
      setApprovingOrderId("");
    }
  }

  async function rejectPendingOrder(orderId) {
    const reason = String(rejectReasonByOrder?.[orderId] || "").trim();
    if (!reason) {
      setError("Select a rejection reason first.");
      return;
    }

    setApprovingOrderId(orderId);
    setError("");
    try {
      await ensureOrderMarkedPendingForApproval(orderId);
      await postApprovalAction(orderId, "reject-order", { rejectionReason: reason });
      await showPopup({
        variant: "success",
        message: `Order rejected (${reason}).`,
      });
    } catch (err) {
      setError(err.message || "Unable to reject order.");
    } finally {
      setApprovingOrderId("");
    }
  }

  async function loadInvoiceMeta(orderIds, userId = "", orderList = null) {
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return;
    }

    try {
      const token = await getAuthToken();
      const uniqueIds = [...new Set(orderIds.map((id) => String(id || "").trim()).filter(Boolean))];
      const items = {};

      for (let index = 0; index < uniqueIds.length; index += 100) {
        const chunk = uniqueIds.slice(index, index + 100);
        const response = await fetch(`/api/order-invoice?orderIds=${encodeURIComponent(chunk.join(","))}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || "Unable to load invoice status.");
        }

        Object.assign(items, payload.items && typeof payload.items === "object" ? payload.items : {});
      }

      setInvoiceMetaByOrder((current) => {
        const next = { ...current, ...items };
        if (userId) {
          void writePendingOrdersInvoiceMeta(userId, next);
        }
        return next;
      });
      setStatusDraftByOrder((current) => {
        const next = { ...current };
        Object.entries(items).forEach(([orderId, meta]) => {
          if (!next[orderId]) {
            next[orderId] = String(meta?.status || "");
          }
        });
        return next;
      });

      const sourceOrders = Array.isArray(orderList) ? orderList : (ordersRef.current || []);
      const mergedMeta = { ...(invoiceMetaByOrder || {}), ...items };
      await markSubmittedOrdersInvoiceQueue(sourceOrders, mergedMeta);
      await hydrateCreditApprovalsForRecentOrders(sourceOrders, mergedMeta, token);
    } catch (err) {
      console.warn(err.message || "Unable to load invoice status.");
    }
  }

  async function hydrateCreditApprovalsForRecentOrders(orderList, metaByOrder = {}, token = "") {
    const accessToken = token || await getAuthToken().catch(() => "");
    if (!accessToken) return metaByOrder;

    const candidates = (orderList || [])
      .filter((order) => !isQueuedPendingOrderId(order?.id))
      .filter((order) => String(order?.status || "").trim().toUpperCase() === "SUBMITTED")
      .filter((order) => {
        const updated = String(order?.updated_at || order?.created_at || "");
        return updated && updated >= startOfTodayIso;
      })
      .filter((order) => {
        const meta = metaByOrder?.[order.id] || null;
        if (meta?.approvedAt || meta?.invoiceFilePath || meta?.invoiceUploadedAt) return false;
        const status = String(meta?.status || "").trim().toLowerCase();
        return !status
          || status === "invoice not uploaded"
          || status === INVOICE_STATUS_PENDING_INVOICE_CREATION.toLowerCase()
          || status === INVOICE_STATUS_PENDING_CREDIT.toLowerCase();
      })
      .slice(0, 25);

    if (candidates.length === 0) return metaByOrder;

    let nextMeta = { ...metaByOrder };
    const evaluations = {};

    for (const order of candidates) {
      try {
        const [outstandingResponse, documentsResponse] = await Promise.all([
          fetch(
            `${OUTSTANDING_API}?customerCode=${encodeURIComponent(order?.customer_code || "")}&customerName=${encodeURIComponent(order?.customer_name || "")}`,
            { headers: { Authorization: `Bearer ${accessToken}` } },
          ),
          fetch(
            `/api/customer-documents?customerCode=${encodeURIComponent(order?.customer_code || "")}`,
            { headers: { Authorization: `Bearer ${accessToken}` } },
          ),
        ]);
        const outstandingPayload = await outstandingResponse.json().catch(() => ({}));
        const documentsPayload = await documentsResponse.json().catch(() => ({}));
        const outstandingCustomer = outstandingResponse.ok && outstandingPayload.success
          ? outstandingPayload.customer
          : null;
        const evaluation = evaluateCreditApproval({
          outstanding: outstandingCustomer || {},
          orderValue: Number(order?.total_value || 0),
          creditApplication: documentsResponse.ok && documentsPayload.success
            ? documentsPayload.compliance?.creditApplication
            : { present: false },
          paymentType: order?.payment_type || outstandingCustomer?.payment_type || "credit",
        });
        evaluations[order.id] = evaluation;
        const updatedMeta = await ensurePendingApprovalStatus(
          order.id,
          evaluation,
          nextMeta?.[order.id] || null,
          order,
        );
        if (updatedMeta) {
          nextMeta = { ...nextMeta, [order.id]: updatedMeta };
        }
      } catch {
        // Keep queue usable if a single credit hydrate fails.
      }
    }

    if (Object.keys(evaluations).length > 0) {
      setCreditApprovalByOrder((current) => ({ ...current, ...evaluations }));
    }

    return markSubmittedOrdersInvoiceQueue(
      candidates,
      nextMeta,
    );
  }

  async function refreshInvoiceComparison(orderId) {
    if (!orderId) return null;

    try {
      const token = await getAuthToken();
      const response = await fetch(`/api/order-invoice?orderId=${encodeURIComponent(orderId)}&compare=1`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) return null;

      const item = payload.item || null;
      if (item) {
        setInvoiceMetaByOrder((current) => ({
          ...current,
          [orderId]: item,
        }));
      }
      return item;
    } catch {
      return null;
    }
  }

  async function openOrder(orderId) {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }

    if (activeOrderId === orderId) {
      setActiveOrderId(null);
      setOrderLines([]);
      setOrderHistory([]);
      setSelectedInvoiceFile(null);
      return;
    }

    setLoadingLines(true);
    setError("");

    try {
      if (isQueuedPendingOrderId(orderId)) {
        const queuedOrder = orders.find((entry) => entry.id === orderId) || null;
        setActiveOrderId(orderId);
        setOrderLines(Array.isArray(queuedOrder?.queuedLines) ? queuedOrder.queuedLines : []);
        setOrderHistory([]);
        return;
      }

      const { data, error: linesError } = await supabase
        .from("sales_order_items")
        .select("id,item_code,item_name,category,quantity,rate,line_value")
        .eq("order_id", orderId)
        .order("item_name");

      if (linesError) throw linesError;

      const token = await getAuthToken();
      const historyResponse = await fetch(`/api/order-history?orderId=${encodeURIComponent(orderId)}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const historyPayload = await historyResponse.json().catch(() => ({}));

      const currentOrder = orders.find((entry) => entry.id === orderId) || null;
      const outstandingResponse = await fetch(
        `${OUTSTANDING_API}?customerCode=${encodeURIComponent(currentOrder?.customer_code || "")}&customerName=${encodeURIComponent(currentOrder?.customer_name || "")}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      const outstandingPayload = await outstandingResponse.json().catch(() => ({}));

      setActiveOrderId(orderId);
      setOrderLines(data || []);
      const openedOrderValue = (data || []).reduce((sum, line) => {
        const lineValue = Number(line.line_value);
        if (Number.isFinite(lineValue) && lineValue > 0) return sum + lineValue;
        const fallback = Number(line.quantity || 0) * Number(line.rate || 0);
        return sum + (Number.isFinite(fallback) ? fallback : 0);
      }, 0);
      if (openedOrderValue > 0) {
        setOrders((current) => (current || []).map((row) => (
          String(row.id) === String(orderId)
            ? { ...row, total_value: Math.round(openedOrderValue * 100) / 100 }
            : row
        )));
      }
      setOrderHistory(historyResponse.ok && historyPayload.success && Array.isArray(historyPayload.history) ? historyPayload.history : []);
      setSelectedInvoiceFile(null);

      if (outstandingResponse.ok && outstandingPayload.success) {
        setOutstandingInfoByOrder((current) => ({
          ...current,
          [orderId]: {
            uploadedAt: String(outstandingPayload.uploadedAt || ""),
            bucketLabels: sortBucketLabels(outstandingPayload.bucketLabels || []),
            customer: outstandingPayload.customer || null,
          },
        }));
      }

      try {
        const documentsResponse = await fetch(
          `/api/customer-documents?customerCode=${encodeURIComponent(currentOrder?.customer_code || "")}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const documentsPayload = await documentsResponse.json().catch(() => ({}));
        const outstandingCustomer = outstandingResponse.ok && outstandingPayload.success
          ? outstandingPayload.customer
          : null;
        const orderValue = (data || []).reduce((sum, line) => sum + Number(line.line_value || 0), 0);
        const evaluation = evaluateCreditApproval({
          outstanding: outstandingCustomer || {},
          orderValue,
          creditApplication: documentsResponse.ok && documentsPayload.success
            ? documentsPayload.compliance?.creditApplication
            : { present: false },
          paymentType: currentOrder?.payment_type || outstandingCustomer?.payment_type || "credit",
        });
        setCreditApprovalByOrder((current) => ({
          ...current,
          [orderId]: evaluation,
        }));
        await ensurePendingApprovalStatus(
          orderId,
          evaluation,
          invoiceMetaByOrder?.[orderId] || null,
          currentOrder,
        );
      } catch {
        const fallbackEvaluation = evaluateCreditApproval({
          outstanding: {},
          orderValue: (data || []).reduce((sum, line) => sum + Number(line.line_value || 0), 0),
          creditApplication: { present: false },
        });
        setCreditApprovalByOrder((current) => ({
          ...current,
          [orderId]: fallbackEvaluation,
        }));
        await ensurePendingApprovalStatus(
          orderId,
          fallbackEvaluation,
          invoiceMetaByOrder?.[orderId] || null,
          currentOrder,
        );
      }

      setStatusDraftByOrder((current) => {
        const existing = current[orderId];
        if (existing) return current;
        return {
          ...current,
          [orderId]: String(invoiceMetaByOrder?.[orderId]?.status || ""),
        };
      });

      try {
        if (invoiceMetaByOrder?.[orderId]?.invoiceFilePath) {
          const metaResponse = await fetch(`/api/order-invoice?orderId=${encodeURIComponent(orderId)}`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
          const metaPayload = await metaResponse.json().catch(() => ({}));
          const latestMeta = (metaResponse.ok && metaPayload.success && metaPayload.item)
            ? metaPayload.item
            : invoiceMetaByOrder?.[orderId];
          if (metaResponse.ok && metaPayload.success && metaPayload.item) {
            setInvoiceMetaByOrder((current) => ({
              ...current,
              [orderId]: metaPayload.item,
            }));
          }
          if (!latestMeta?.comparisonCheckedAt) {
            await refreshInvoiceComparison(orderId);
          }
        }
      } catch {
        // Keep the order open even if invoice metadata refresh fails.
      }

      if (canManageOrderInvoice(userRole)) {
        setOpenStartedAtByOrder((current) => {
          if (current[orderId]) return current;
          return { ...current, [orderId]: new Date().toISOString() };
        });
      }
    } catch (err) {
      setError(err.message || "Unable to open order details.");
      setActiveOrderId(null);
      setOrderLines([]);
      setOrderHistory([]);
    } finally {
      setLoadingLines(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const supabase = getSupabaseClient();
      if (!supabase) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");
      setOfflineHint(false);

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.user) {
          throw new Error("Please login again.");
        }

        const cachedInvoiceMeta = await readPendingOrdersInvoiceMeta(session.user.id);
        if (Object.keys(cachedInvoiceMeta).length > 0) {
          setInvoiceMetaByOrder(cachedInvoiceMeta);
        }

        const scopeResult = await fetchSalesScopeCached();
        if (cancelled) return;

        const scope = scopeResult.scope;
        const role = String(scope?.role || "").toLowerCase();
        setUserRole(role);

        async function loadOutstandingSummary(token) {
          try {
            const response = await fetch(`${OUTSTANDING_API}?summary=1`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.success) return;
            if (cancelled) return;
            setOutstandingDataset({
              rows: Array.isArray(payload.customers) ? payload.customers : [],
            });
          } catch {
            // Queue still works without outstanding amounts.
          }
        }

        void loadOutstandingSummary(session.access_token);

        async function applyOrders(serverOrders) {
          const queued = await listQueuedPendingOrders();
          const merged = mergeServerAndQueuedOrders(serverOrders, queued);
          ordersRef.current = merged;
          setOrders(merged);
          const serverIds = merged
            .filter((order) => !isQueuedPendingOrderId(order.id))
            .map((order) => order.id);
          void loadInvoiceMeta(serverIds, session.user.id, merged);
          return merged;
        }

        const ordersResult = await fetchPendingOrdersCached(session.user.id, scope, {
          revalidate: true,
          onUpdate: (freshOrders) => {
            if (cancelled) return;
            void applyOrders(Array.isArray(freshOrders) ? freshOrders : []);
            setRefreshing(false);
            setOfflineHint(false);
          },
        });

        if (cancelled) return;

        const visibleOrders = Array.isArray(ordersResult.data) ? ordersResult.data : [];
        await applyOrders(visibleOrders);
        setLoading(false);

        if (ordersResult.fromCache) {
          setRefreshing(Boolean(ordersResult.stale));
          setOfflineHint(Boolean(ordersResult.offline));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || "Unable to load pending orders.");
          setLoading(false);
        }
      }
    }

    load();

    function onQueueChanged() {
      void listQueuedPendingOrders().then((queued) => {
        if (cancelled) return;
        setOrders((current) => mergeServerAndQueuedOrders(
          (current || []).filter((order) => !isQueuedPendingOrderId(order.id)),
          queued,
        ));
      }).catch(() => {});
    }

    function onPendingChanged() {
      void load();
    }

    window.addEventListener("madiba-offline-queue-changed", onQueueChanged);
    window.addEventListener("madiba-pending-orders-changed", onPendingChanged);

    return () => {
      cancelled = true;
      window.removeEventListener("madiba-offline-queue-changed", onQueueChanged);
      window.removeEventListener("madiba-pending-orders-changed", onPendingChanged);
    };
  }, []);

  const summary = useMemo(() => {
    const oldPending = orders.filter((order) => {
      const marker = order.updated_at || order.created_at;
      return Boolean(marker) && marker < startOfTodayIso;
    }).length;
    const updatedToday = Math.max(0, orders.length - oldPending);
    const olderThan7 = orders.filter((order) => daysOld(order.updated_at || order.created_at) >= 7).length;
    const olderThan30 = orders.filter((order) => daysOld(order.updated_at || order.created_at) >= 30).length;

    return {
      total: orders.length,
      oldPending,
      updatedToday,
      olderThan7,
      olderThan30,
    };
  }, [orders, startOfTodayIso]);

  const activeOrder = useMemo(
    () => orders.find((order) => order.id === activeOrderId) || null,
    [orders, activeOrderId]
  );

  // Precompute outstanding + filter cell values once per data change so heading
  // filters stay O(columns × orders) with cheap string compares — not repeated
  // outstanding customer scans (which froze the page with large datasets).
  const outstandingAmountByOrderId = useMemo(() => {
    const amounts = new Map();
    (orders || []).forEach((order) => {
      amounts.set(order.id, orderCurrentOutstanding(order, outstandingDataset));
    });
    return amounts;
  }, [orders, outstandingDataset]);

  const orderFilterRows = useMemo(() => (
    (orders || []).map((order) => ({
      order,
      values: pendingOrderFilterValues(
        order,
        invoiceMetaByOrder?.[order.id] || null,
        creditApprovalRequiredFlag(creditApprovalByOrder, order.id),
        outstandingAmountByOrderId.get(order.id),
      ),
    }))
  ), [creditApprovalByOrder, invoiceMetaByOrder, orders, outstandingAmountByOrderId]);

  const columnFilterOptions = useMemo(() => {
    const options = {};
    HEADING_FILTER_KEYS.forEach((key) => {
      const matching = orderFilterRows.filter(({ values }) => (
        rowMatchesOtherExcelFilters(values, columnFilters, key, HEADING_FILTER_KEYS, matchesColumnFilter)
      ));
      options[key] = uniqueColumnValues(matching.map(({ values }) => values[key]));
    });
    return options;
  }, [columnFilters, orderFilterRows]);

  const effectiveColumnFilters = useMemo(() => {
    const next = { ...columnFilters };
    HEADING_FILTER_KEYS.forEach((key) => {
      next[key] = pruneExcelFilterSelection(columnFilters[key], columnFilterOptions[key] || []);
    });
    return next;
  }, [columnFilterOptions, columnFilters]);

  const filteredOrderRows = useMemo(() => (
    orderFilterRows.filter(({ values }) => (
      HEADING_FILTER_KEYS.every((key) => matchesColumnFilter(values[key], effectiveColumnFilters[key]))
    ))
  ), [effectiveColumnFilters, orderFilterRows]);

  const filteredOrders = useMemo(
    () => filteredOrderRows.map(({ order }) => order),
    [filteredOrderRows],
  );

  const filteredValueTotals = useMemo(() => {
    const seenCustomers = new Set();
    return filteredOrderRows.reduce((totals, { order }) => {
      totals.orderValue += orderValueInclVat(order) || 0;
      totals.invoiceValue += invoiceMadeInclVat(invoiceMetaByOrder?.[order.id]) || 0;
      const outstanding = outstandingAmountByOrderId.get(order.id);
      const customerKey = [
        String(order?.customer_code || "").trim().toUpperCase(),
        String(order?.customer_name || "").trim().toUpperCase(),
      ].join("|");
      if (!seenCustomers.has(customerKey)) {
        seenCustomers.add(customerKey);
        totals.currentOutstanding += Number(outstanding || 0);
      }
      return totals;
    }, { orderValue: 0, invoiceValue: 0, currentOutstanding: 0 });
  }, [filteredOrderRows, invoiceMetaByOrder, outstandingAmountByOrderId]);

  async function loadOrderPdfSource(orderId) {
    const order = orders.find((entry) => entry.id === orderId) || null;
    if (!order) {
      throw new Error("Order not found.");
    }

    if (isQueuedPendingOrderId(orderId)) {
      const lines = Array.isArray(order.queuedLines) ? order.queuedLines : [];
      return { order, lines, history: [] };
    }

    if (activeOrderId === orderId && Array.isArray(orderLines) && orderLines.length > 0) {
      return { order, lines: orderLines, history: orderHistory };
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      throw new Error("Supabase is not configured.");
    }

    const { data, error: linesError } = await supabase
      .from("sales_order_items")
      .select("id,item_code,item_name,category,quantity,rate,line_value")
      .eq("order_id", orderId)
      .order("item_name");

    if (linesError) throw linesError;

    const token = await getAuthToken();
    const historyResponse = await fetch(`/api/order-history?orderId=${encodeURIComponent(orderId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const historyPayload = await historyResponse.json().catch(() => ({}));
    const history = historyResponse.ok && historyPayload.success && Array.isArray(historyPayload.history)
      ? historyPayload.history
      : [];

    return { order, lines: data || [], history };
  }

  async function generateOrderPdf(orderId) {
    if (!orderId || downloadingPdfOrderId) return;

    setDownloadingPdfOrderId(String(orderId));
    setError("");

    try {
      const { order, lines, history } = await loadOrderPdfSource(orderId);
      if (!lines.length) {
        setError("This order has no line items to generate PDF.");
        return;
      }

      const token = await getAuthToken();
      if (token && isQueuedPendingOrderId(order.id)) {
        await processOfflineQueue(async () => token).catch(() => undefined);
      }

      // Refresh outstanding/receipts and reload the price catalog so cash/value/scheme
      // discount columns can be reconstructed from the saved payment type + region.
      const snapshot = buildOrderPdfSnapshotFromSavedOrder({
        order,
        lines,
        history,
        outstanding: outstandingInfoByOrder?.[order.id] || null,
        creditApprovalRemark: creditApprovalByOrder?.[order.id]?.remark || "",
      });

      const { snapshot: liveSnapshot, analytics } = await resolveLiveOrderPdfSnapshot(snapshot, {
        accessToken: token,
      }, {
        processQueue: token
          ? () => processOfflineQueue(async () => token)
          : undefined,
      });

      if (liveSnapshot?.outstanding) {
        setOutstandingInfoByOrder((current) => ({
          ...current,
          [order.id]: {
            uploadedAt: String(current?.[order.id]?.uploadedAt || ""),
            bucketLabels: Array.isArray(liveSnapshot.outstanding.bucketLabels)
              ? liveSnapshot.outstanding.bucketLabels
              : (current?.[order.id]?.bucketLabels || []),
            customer: liveSnapshot.outstanding.customer || current?.[order.id]?.customer || null,
            customerInvoices: Array.isArray(liveSnapshot.outstanding.customerInvoices)
              ? liveSnapshot.outstanding.customerInvoices
              : (current?.[order.id]?.customerInvoices || []),
          },
        }));
      }

      let creditEvaluation = creditApprovalByOrder?.[order.id] || null;
      try {
        const documentsResponse = await fetch(
          `/api/customer-documents?customerCode=${encodeURIComponent(order.customer_code || "")}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const documentsPayload = await documentsResponse.json().catch(() => ({}));
        creditEvaluation = evaluateCreditApproval({
          outstanding: liveSnapshot.outstanding?.customer || {},
          orderValue: liveSnapshot.totals?.amountExclVat || liveSnapshot.grandTotal || 0,
          creditApplication: documentsResponse.ok && documentsPayload.success
            ? documentsPayload.compliance?.creditApplication
            : { present: false },
        });
        setCreditApprovalByOrder((current) => ({
          ...current,
          [order.id]: creditEvaluation,
        }));
      } catch {
        creditEvaluation = creditEvaluation || evaluateCreditApproval({
          outstanding: liveSnapshot.outstanding?.customer || {},
          orderValue: liveSnapshot.totals?.amountExclVat || liveSnapshot.grandTotal || 0,
          creditApplication: { present: false },
        });
      }

      const doc = await createOrderPdfDocument({
        ...liveSnapshot,
        creditApprovalRemark: creditEvaluation?.remark || liveSnapshot.creditApprovalRemark,
      }, { analytics });

      const orderNumber = formatSalesOrderNumber(liveSnapshot) || "order";
      const fileName = buildOrderPdfFileName({
        orderId: orderNumber,
        customerCode: liveSnapshot.customerCode || order.customer_code,
        savedAtIso: new Date().toISOString(),
      });
      await saveOrShareOrderPdf(doc, fileName, {
        title: `Order #${orderNumber}`,
        text: `Sales order for ${order.customer_name || order.customer_code || "customer"}`,
        dialogTitle: "Save order PDF",
        forceDownload: true,
      });
    } catch (error) {
      if (error?.name === "AbortError" || String(error?.message || "").toLowerCase().includes("cancel")) {
        return;
      }
      setError(error?.message || "Unable to prepare PDF for this order.");
    } finally {
      setDownloadingPdfOrderId("");
    }
  }

  async function loadTallyUnitMap(lines, token) {
    const codes = [...new Set(
      (lines || [])
        .map((line) => String(line?.item_code || "").trim().toUpperCase())
        .filter(Boolean),
    )];
    if (!codes.length || !token) return {};

    try {
      const response = await fetch(
        `/api/tally-item-units?codes=${encodeURIComponent(codes.join(","))}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload.success && payload.units) {
        return payload.units;
      }
    } catch {
      // Fall back to CTN defaults when unit master is unavailable.
    }

    try {
      const supabase = getSupabaseClient();
      if (!supabase) return {};
      const { data, error: unitsError } = await supabase
        .from("items_master")
        .select("item_code,tally_unit,tally_item_name")
        .in("item_code", codes);
      if (unitsError || !data) return {};
      return unitMapFromItems(data);
    } catch {
      return {};
    }
  }

  async function generateOrderTallyExcel(orderId) {
    if (!orderId || downloadingTallyExcelOrderId) return;

    setDownloadingTallyExcelOrderId(String(orderId));
    setError("");

    try {
      const { order, lines, history } = await loadOrderPdfSource(orderId);
      if (!lines.length) {
        setError("This order has no line items to generate Tally Excel.");
        return;
      }

      const token = await getAuthToken();
      if (token && isQueuedPendingOrderId(order.id)) {
        await processOfflineQueue(async () => token).catch(() => undefined);
      }

      const snapshot = buildOrderPdfSnapshotFromSavedOrder({
        order,
        lines,
        history,
        outstanding: outstandingInfoByOrder?.[order.id] || null,
        creditApprovalRemark: creditApprovalByOrder?.[order.id]?.remark || "",
      });

      const unitMap = await loadTallyUnitMap(lines, token);
      const orderNumber = formatSalesOrderNumber(snapshot) || formatSalesOrderNumber(order) || order.id;
      const exportRows = buildTallyOrderExportRows({
        order,
        lines: Array.isArray(snapshot.lines) && snapshot.lines.length ? snapshot.lines : lines,
        unitMap,
        orderNumber,
        pricingRegion: snapshot.pricingRegion,
        paymentType: snapshot.paymentType,
        exportDate: new Date(),
      });

      if (!exportRows.length) {
        setError("Unable to build Tally Excel rows for this order.");
        return;
      }

      const XLSX = await import("xlsx");
      const sheet = XLSX.utils.json_to_sheet(exportRows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, "TallyImport");
      const safeOrder = String(orderNumber).replace(/[^\w.-]+/g, "_");
      XLSX.writeFile(workbook, `tally-order-${safeOrder}.xlsx`);
    } catch (error) {
      setError(error?.message || "Unable to prepare Tally Excel for this order.");
    } finally {
      setDownloadingTallyExcelOrderId("");
    }
  }

  async function exportQueueToExcel() {
    try {
      const XLSX = await import("xlsx");
      const workbook = {
        Sheets: {},
        SheetNames: [],
      };

      const queueRows = orders.map((order) => ({
        "Order Number": formatSalesOrderNumber(order) || order.id,
        Customer: order.customer_name || order.customer_code || "-",
        "Customer Code": order.customer_code || "-",
        Salesman: order.salesman_code || "-",
        Status: order.status || "-",
        "Invoice Status": invoiceStatusText(
          invoiceMetaByOrder?.[order.id],
          order,
          creditApprovalRequiredFlag(creditApprovalByOrder, order.id),
        ),
        "Invoice Uploaded At": formatDateTime(invoiceMetaByOrder?.[order.id]?.invoiceUploadedAt),
        "Invoice Build Time": formatPendingDuration(pendingOrderTimeToMakeSeconds(
          order,
          invoiceMetaByOrder?.[order.id],
          Date.now(),
          invoiceStatusText(invoiceMetaByOrder?.[order.id], order),
        )),
        "Order created": formatDateTime(order.created_at),
        "Last Updated": formatDateTime(order.updated_at),
        "Age (days)": daysOld(order.updated_at || order.created_at),
        "Order value (incl. VAT)": formatMoneyInclVat(orderValueInclVat(order)),
        "Invoice made (incl. VAT)": formatMoneyInclVat(invoiceMadeInclVat(invoiceMetaByOrder?.[order.id])),
        "Current outstanding": formatCurrentOutstanding(outstandingAmountByOrderId.get(order.id)),
      }));

      workbook.Sheets.PendingOrders = XLSX.utils.json_to_sheet(queueRows);
      workbook.SheetNames.push("PendingOrders");

      if (activeOrder && Array.isArray(orderLines) && orderLines.length > 0) {
        const lineRows = orderLines.map((line) => ({
          "Order Number": formatSalesOrderNumber(activeOrder) || activeOrder.id,
          "Item Code": line.item_code || "-",
          "Item Name": line.item_name || "-",
          Category: line.category || "-",
          Quantity: Number(line.quantity || 0),
          Rate: Number(line.rate || 0),
          "Line Total": Number(line.line_value || 0),
        }));

        workbook.Sheets.OrderLines = XLSX.utils.json_to_sheet(lineRows);
        workbook.SheetNames.push("OrderLines");
      }

      XLSX.writeFile(workbook, `pending-orders-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.xlsx`);
    } catch {
      setError("Unable to export pending orders to Excel.");
    }
  }

  async function saveInvoiceStatus(orderId, nextStatus = null) {
    const status = String(
      nextStatus != null && nextStatus !== ""
        ? nextStatus
        : (statusDraftByOrder?.[orderId] || ""),
    ).trim();
    if (!status) {
      setError("Choose invoice status first.");
      return;
    }

    setSavingInvoiceStatus(true);
    setError("");
    setStatusDraftByOrder((current) => ({
      ...current,
      [orderId]: status,
    }));

    try {
      const token = await getAuthToken();
      const response = await fetch("/api/order-invoice", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          mode: "set-status",
          orderId,
          status,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to save invoice status.");
      }

      const item = payload.item || { orderId, status };
      setInvoiceMetaByOrder((current) => ({
        ...current,
        [orderId]: item,
      }));
      setStatusDraftByOrder((current) => ({
        ...current,
        [orderId]: String(item.status || status || ""),
      }));
    } catch (err) {
      setError(err.message || "Unable to save invoice status.");
    } finally {
      setSavingInvoiceStatus(false);
    }
  }

  async function uploadInvoicePdf(orderId) {
    if (!selectedInvoiceFile) {
      setError("Select a PDF invoice first.");
      return;
    }

    setUploadingInvoice(true);
    setError("");

    try {
      const token = await getAuthToken();
      const form = new FormData();
      form.append("mode", "upload");
      form.append("orderId", String(orderId));
      form.append("startedAt", String(openStartedAtByOrder?.[orderId] || new Date().toISOString()));
      form.append("file", selectedInvoiceFile);

      const response = await fetch("/api/order-invoice", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: form,
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to upload invoice PDF.");
      }

      const item = payload.item || { orderId };
      setInvoiceMetaByOrder((current) => ({
        ...current,
        [orderId]: item,
      }));
      setStatusDraftByOrder((current) => ({
        ...current,
        [orderId]: String(item.status || INVOICE_STATUS_MADE),
      }));
      setSelectedInvoiceFile(null);
    } catch (err) {
      setError(err.message || "Unable to upload invoice PDF.");
    } finally {
      setUploadingInvoice(false);
    }
  }

  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Pending Orders unavailable"
        message="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to view pending orders."
      />
    );
  }

  if (loading) {
    return (
      <main className="modulePage" dir={dir}>
        <div className="moduleShell">
          <div className="moduleLoading">{t("loading")}</div>
        </div>
      </main>
    );
  }

  const isInvoiceMaker = isInvoiceMakerRole(userRole);
  const canManageInvoice = canManageOrderInvoice(userRole);
  const canApproveOrders = canApprovePendingOrders(userRole);

  return (
    <MorningAttendanceGate>
      <main className="modulePage" dir={dir}>
        <div className="moduleShell">
          <div className="moduleHeader">
            <div>
              <p className="moduleEyebrow">MADIBA SFA</p>
              <h1>{t("title")}</h1>
              <p className="moduleSubtitle">
                {userRole === "admin" || userRole === "manager" || isInvoiceMaker ? t("subtitleTeam") : t("subtitleMine")}
              </p>
            </div>
            <div className="moduleHeaderMeta"><AppLanguageSwitch language={language} setLanguage={setLanguage} /><Link href="/" className="moduleBackLink">{t("dashboard")}</Link></div>
          </div>

          <div className="moduleMetricGrid">
            <section className="moduleMetricCard"><span>Total pending</span><strong>{summary.total}</strong></section>
            <section className="moduleMetricCard"><span>Old pending</span><strong>{summary.oldPending}</strong></section>
            <section className="moduleMetricCard"><span>Updated today</span><strong>{summary.updatedToday}</strong></section>
            <section className="moduleMetricCard"><span>Older than 7 days</span><strong>{summary.olderThan7}</strong></section>
            <section className="moduleMetricCard"><span>Older than 30 days</span><strong>{summary.olderThan30}</strong></section>
          </div>

          {offlineHint ? <div className="moduleHint">{t("cacheOffline")}</div> : null}
          {refreshing ? <div className="moduleHint">{t("cacheRefreshing")}</div> : null}

          <section className="moduleSection">
            <div className="moduleSectionHeader">
              <h2>Pending Order Queue</h2>
              <span>{filteredOrders.length} shown / {summary.total} order(s)</span>
            </div>

            <ExportableTable filename="pending-orders" sheetName="Pending Orders" className="moduleTableWrap">
              <table className="moduleTable">
                <thead>
                  <tr>
                    {HEADING_FILTERS.map(({ key, label }) => (
                      <th key={key} data-column-filter-label={label}>
                        <div className="moduleTableHeadingFilter">
                          <span>{label}</span>
                          <ExcelColumnFilter
                            label={label}
                            options={columnFilterOptions[key] || []}
                            selected={effectiveColumnFilters[key]}
                            onChange={(next) => setColumnFilters((current) => ({
                              ...current,
                              [key]: next,
                            }))}
                          />
                        </div>
                      </th>
                    ))}
                    <th data-column-filter-label="Action">
                      <div className="moduleTableHeadingFilter">
                        <span>Action</span>
                        <button
                          type="button"
                          className="moduleInlineButton"
                          onClick={() => setColumnFilters(EMPTY_FILTERS)}
                        >
                          Clear
                        </button>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((order) => {
                    const age = daysOld(order.updated_at || order.created_at);
                    const meta = invoiceMetaByOrder?.[order.id] || null;
                    const approvalRequired = creditApprovalRequiredFlag(creditApprovalByOrder, order.id);
                    const pendingApproval = shouldShowPendingApprovalActions(
                      order,
                      meta,
                      { approvalRequired },
                    );
                    const busyApproval = approvingOrderId === order.id;

                    return (
                      <Fragment key={order.id}>
                        <tr>
                          <td>{formatSalesOrderNumber(order) || order.id}</td>
                          <td>{order.customer_name || order.customer_code || "-"}</td>
                          <td>{order.salesman_code || "-"}</td>
                          <td>{order.status || "-"}</td>
                          <td>{invoiceStatusText(meta, order, approvalRequired)}</td>
                          <td>{formatDateTime(meta?.invoiceUploadedAt)}</td>
                          <td><TimeToMakeClock order={order} meta={meta} approvalRequired={approvalRequired} /></td>
                          <td>{formatDateTime(order.created_at)}</td>
                          <td>{formatDateTime(order.updated_at)}</td>
                          <td>{age}</td>
                          <td style={{ textAlign: "right" }}>{formatMoneyInclVat(orderValueInclVat(order))}</td>
                          <td style={{ textAlign: "right" }}>{formatMoneyInclVat(invoiceMadeInclVat(meta))}</td>
                          <td style={{ textAlign: "right" }}>{formatCurrentOutstanding(outstandingAmountByOrderId.get(order.id))}</td>
                          <td>
                            <div className="moduleActionRow" style={{ flexWrap: "wrap", gap: "6px" }}>
                              <button
                                type="button"
                                className="moduleInlineButton"
                                onClick={() => openOrder(order.id)}
                                disabled={loadingLines && activeOrderId === order.id}
                              >
                                {activeOrderId === order.id ? "Close" : "Open"}
                              </button>
                              <button
                                type="button"
                                className="moduleInlineButton"
                                onClick={() => generateOrderPdf(order.id)}
                                disabled={Boolean(downloadingPdfOrderId) || Boolean(downloadingTallyExcelOrderId)}
                                title="Download PDF with live receipt and outstanding; keeps saved item, qty, and price"
                              >
                                {String(downloadingPdfOrderId) === String(order.id)
                                  ? "Preparing PDF..."
                                  : "Generate PDF"}
                              </button>
                              <button
                                type="button"
                                className="moduleInlineButton"
                                onClick={() => generateOrderTallyExcel(order.id)}
                                disabled={Boolean(downloadingPdfOrderId) || Boolean(downloadingTallyExcelOrderId)}
                                title="Download Tally import Excel for this order"
                              >
                                {String(downloadingTallyExcelOrderId) === String(order.id)
                                  ? "Preparing Excel..."
                                  : "Generate Excel"}
                              </button>
                              {canManageInvoice ? (
                                <select
                                  className="moduleInput"
                                  style={{ minWidth: "190px" }}
                                  value={statusDraftByOrder?.[order.id] || ""}
                                  onChange={(event) => {
                                    const next = event.target.value;
                                    if (!next) {
                                      setStatusDraftByOrder((current) => ({
                                        ...current,
                                        [order.id]: "",
                                      }));
                                      return;
                                    }
                                    void saveInvoiceStatus(order.id, next);
                                  }}
                                  disabled={savingInvoiceStatus || busyApproval}
                                  aria-label="Change invoice status"
                                >
                                  <option value="">Invoice status...</option>
                                  <option value={INVOICE_STATUS_PENDING_APPROVAL}>{INVOICE_STATUS_PENDING_APPROVAL}</option>
                                  <option value={INVOICE_STATUS_PENDING_INVOICE_CREATION}>{INVOICE_STATUS_PENDING_INVOICE_CREATION}</option>
                                  <option value={INVOICE_STATUS_PENDING_CREDIT}>{INVOICE_STATUS_PENDING_CREDIT}</option>
                                  <option value={INVOICE_STATUS_WAITING_CREDIT_APPLICATION}>{INVOICE_STATUS_WAITING_CREDIT_APPLICATION}</option>
                                  <option value={INVOICE_STATUS_QUOTATION_WAITING_PAYMENT}>{INVOICE_STATUS_QUOTATION_WAITING_PAYMENT}</option>
                                  <option value={INVOICE_STATUS_PENDING_WITH_SALESMAN}>{INVOICE_STATUS_PENDING_WITH_SALESMAN}</option>
                                  <option value={INVOICE_STATUS_REJECTED}>{INVOICE_STATUS_REJECTED}</option>
                                  <option value={INVOICE_STATUS_STOCK_UNAVAILABLE}>{INVOICE_STATUS_STOCK_UNAVAILABLE}</option>
                                  <option value={INVOICE_STATUS_WAITING_STOCK_TRANSFER}>{INVOICE_STATUS_WAITING_STOCK_TRANSFER}</option>
                                  <option value={INVOICE_STATUS_WAITING_OVERDUE_COLLECTION}>{INVOICE_STATUS_WAITING_OVERDUE_COLLECTION}</option>
                                  <option value={INVOICE_STATUS_MADE} disabled={!meta?.invoiceFilePath}>{INVOICE_STATUS_MADE}</option>
                                </select>
                              ) : null}
                              {canApproveOrders && pendingApproval ? (
                                <>
                                  <button
                                    type="button"
                                    className="modulePrimaryButton"
                                    onClick={() => approvePendingOrder(order.id)}
                                    disabled={busyApproval}
                                  >
                                    {busyApproval ? "Working..." : "Approve"}
                                  </button>
                                  <select
                                    className="moduleInput"
                                    style={{ minWidth: "160px" }}
                                    value={rejectReasonByOrder?.[order.id] || ""}
                                    onChange={(event) => setRejectReasonByOrder((current) => ({
                                      ...current,
                                      [order.id]: event.target.value,
                                    }))}
                                    aria-label="Rejection reason"
                                  >
                                    <option value="">Reject reason...</option>
                                    {ORDER_REJECTION_REASONS.map((reason) => (
                                      <option key={reason} value={reason}>{reason}</option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    className="moduleInlineButton"
                                    style={{ borderColor: "#9b1c1c", color: "#9b1c1c" }}
                                    onClick={() => rejectPendingOrder(order.id)}
                                    disabled={busyApproval || !rejectReasonByOrder?.[order.id]}
                                  >
                                    Reject
                                  </button>
                                </>
                              ) : null}
                            </div>
                          </td>
                        </tr>

                        {activeOrderId === order.id && (
                          <tr>
                            <td colSpan={14}>
                              <div style={{ marginTop: "8px", marginBottom: "8px" }}>
                                <div className="moduleSectionHeader">
                                  <h2>Order #{formatSalesOrderNumber(order) || order.id} Details</h2>
                                  <span>
                                    {loadingLines
                                      ? "Loading..."
                                      : `${orderLines.length} line(s) | Created ${formatDateTime(order.created_at)}`}
                                  </span>
                                </div>

                                <ExportableTable filename={`pending-order-lines-${order.id}`} sheetName="Order Lines" className="moduleTableWrap">
                                  <table className="moduleTable">
                                    <thead>
                                      <tr>
                                        <th>Item Code</th>
                                        <th>Item Name</th>
                                        <th>Category</th>
                                        <th>Qty</th>
                                        <th>Rate</th>
                                        <th>Line Total</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {orderLines.map((line) => (
                                        <tr key={line.id}>
                                          <td>{line.item_code || "-"}</td>
                                          <td>{line.item_name || "-"}</td>
                                          <td>{line.category || "-"}</td>
                                          <td>{Number(line.quantity || 0)}</td>
                                          <td>{formatMoney(line.rate)}</td>
                                          <td>{formatMoney(line.line_value)}</td>
                                        </tr>
                                      ))}
                                      {!loadingLines && orderLines.length === 0 && (
                                        <tr>
                                          <td colSpan={6}>No line items found for this order.</td>
                                        </tr>
                                      )}
                                    </tbody>
                                  </table>
                                </ExportableTable>

                                {creditApprovalByOrder?.[order.id]?.remark ? (
                                  <div
                                    className="moduleHint"
                                    style={{
                                      marginTop: "8px",
                                      fontWeight: 700,
                                      color: creditApprovalByOrder[order.id].required ? "#9b1c1c" : undefined,
                                    }}
                                  >
                                    {creditApprovalByOrder[order.id].remark}
                                  </div>
                                ) : null}

                                <div className="moduleHint" style={{ marginTop: "10px" }}>
                                  <strong>Order created:</strong> {formatDateTime(order.created_at)}
                                  <span> | <strong>Invoice status:</strong> {invoiceStatusText(meta, order, approvalRequired)}</span>
                                  {meta?.rejectionReason ? (
                                    <span> | <strong>Rejection reason:</strong> {meta.rejectionReason}</span>
                                  ) : null}
                                  {meta?.invoiceFileUrl ? (
                                    <span> | <a href={meta.invoiceFileUrl} target="_blank" rel="noreferrer">View uploaded invoice</a></span>
                                  ) : null}
                                  <span> | <strong>Uploaded at:</strong> {formatDateTime(meta?.invoiceUploadedAt)}</span>
                                  <span> | <strong>Time to make:</strong> <TimeToMakeClock order={order} meta={meta} approvalRequired={approvalRequired} /></span>
                                </div>

                                {meta?.prospectLinkedCustomerCode ? (
                                  <div className="moduleHint" style={{ marginTop: "8px" }}>
                                    <strong>Prospect linked:</strong> {meta.prospectLinkedCustomerCode}
                                    {meta.prospectLinkedCustomerName ? ` - ${meta.prospectLinkedCustomerName}` : ""}
                                    {meta.prospectGpsCopied ? " | GPS copied to customer" : ""}
                                  </div>
                                ) : null}

                                <InvoiceComparisonPanel meta={meta} />

                                {canApproveOrders && pendingApproval ? (
                                  <div className="moduleActionRow" style={{ marginTop: "12px", flexWrap: "wrap", gap: "8px" }}>
                                    <button
                                      type="button"
                                      className="modulePrimaryButton"
                                      onClick={() => approvePendingOrder(order.id)}
                                      disabled={busyApproval}
                                    >
                                      {busyApproval ? "Working..." : "Approve order"}
                                    </button>
                                    <label style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: "200px" }}>
                                      Rejection reason
                                      <select
                                        className="moduleInput"
                                        value={rejectReasonByOrder?.[order.id] || ""}
                                        onChange={(event) => setRejectReasonByOrder((current) => ({
                                          ...current,
                                          [order.id]: event.target.value,
                                        }))}
                                      >
                                        <option value="">Select reason</option>
                                        {ORDER_REJECTION_REASONS.map((reason) => (
                                          <option key={reason} value={reason}>{reason}</option>
                                        ))}
                                      </select>
                                    </label>
                                    <button
                                      type="button"
                                      className="moduleInlineButton"
                                      style={{ borderColor: "#9b1c1c", color: "#9b1c1c", alignSelf: "flex-end" }}
                                      onClick={() => rejectPendingOrder(order.id)}
                                      disabled={busyApproval || !rejectReasonByOrder?.[order.id]}
                                    >
                                      Reject order
                                    </button>
                                  </div>
                                ) : null}

                                {canManageInvoice && (
                                  <div style={{ marginTop: "12px" }}>
                                    <div className="moduleFormGrid">
                                      <label>
                                        Invoice Status
                                        <select
                                          className="moduleInput"
                                          value={statusDraftByOrder?.[order.id] || ""}
                                          onChange={(event) => setStatusDraftByOrder((current) => ({ ...current, [order.id]: event.target.value }))}
                                        >
                                          <option value="">Select status</option>
                                          <option value={INVOICE_STATUS_PENDING_APPROVAL}>{INVOICE_STATUS_PENDING_APPROVAL}</option>
                                          <option value={INVOICE_STATUS_PENDING_INVOICE_CREATION}>{INVOICE_STATUS_PENDING_INVOICE_CREATION}</option>
                                          <option value={INVOICE_STATUS_PENDING_CREDIT}>{INVOICE_STATUS_PENDING_CREDIT}</option>
                                          <option value={INVOICE_STATUS_WAITING_CREDIT_APPLICATION}>{INVOICE_STATUS_WAITING_CREDIT_APPLICATION}</option>
                                          <option value={INVOICE_STATUS_QUOTATION_WAITING_PAYMENT}>{INVOICE_STATUS_QUOTATION_WAITING_PAYMENT}</option>
                                          <option value={INVOICE_STATUS_PENDING_WITH_SALESMAN}>{INVOICE_STATUS_PENDING_WITH_SALESMAN}</option>
                                          <option value={INVOICE_STATUS_REJECTED}>{INVOICE_STATUS_REJECTED}</option>
                                          <option value={INVOICE_STATUS_STOCK_UNAVAILABLE}>{INVOICE_STATUS_STOCK_UNAVAILABLE}</option>
                                          <option value={INVOICE_STATUS_WAITING_STOCK_TRANSFER}>{INVOICE_STATUS_WAITING_STOCK_TRANSFER}</option>
                                          <option value={INVOICE_STATUS_WAITING_OVERDUE_COLLECTION}>{INVOICE_STATUS_WAITING_OVERDUE_COLLECTION}</option>
                                          <option value={INVOICE_STATUS_MADE} disabled={!meta?.invoiceFilePath}>{INVOICE_STATUS_MADE}</option>
                                        </select>
                                      </label>

                                      <label>
                                        Upload PDF Invoice
                                        <input
                                          className="moduleInput"
                                          type="file"
                                          accept="application/pdf,.pdf"
                                          onChange={(event) => setSelectedInvoiceFile(event.target.files?.[0] || null)}
                                        />
                                      </label>
                                    </div>

                                    <div className="moduleActionRow" style={{ marginTop: "10px" }}>
                                      <button
                                        type="button"
                                        className="modulePrimaryButton"
                                        onClick={() => saveInvoiceStatus(order.id)}
                                        disabled={savingInvoiceStatus || !statusDraftByOrder?.[order.id]}
                                      >
                                        {savingInvoiceStatus ? "Saving status..." : "Save Invoice Status"}
                                      </button>

                                      <button
                                        type="button"
                                        className="moduleInlineButton"
                                        onClick={() => uploadInvoicePdf(order.id)}
                                        disabled={uploadingInvoice || !selectedInvoiceFile}
                                      >
                                        {uploadingInvoice ? "Uploading..." : "Upload Invoice PDF"}
                                      </button>
                                    </div>
                                  </div>
                                )}

                                <div className="moduleActionRow" style={{ marginTop: "10px" }}>
                                  <button
                                    type="button"
                                    className="modulePrimaryButton"
                                    onClick={() => generateOrderPdf(order.id)}
                                    disabled={Boolean(downloadingPdfOrderId) || Boolean(downloadingTallyExcelOrderId) || loadingLines || orderLines.length === 0}
                                  >
                                    {String(downloadingPdfOrderId) === String(order.id)
                                      ? "Preparing PDF..."
                                      : "Generate / Download PDF"}
                                  </button>
                                  <button
                                    type="button"
                                    className="moduleInlineButton"
                                    onClick={() => generateOrderTallyExcel(order.id)}
                                    disabled={Boolean(downloadingPdfOrderId) || Boolean(downloadingTallyExcelOrderId) || loadingLines || orderLines.length === 0}
                                    title="Download Tally import Excel for this order"
                                  >
                                    {String(downloadingTallyExcelOrderId) === String(order.id)
                                      ? "Preparing Excel..."
                                      : "Generate Excel"}
                                  </button>
                                  <button type="button" className="moduleInlineButton" onClick={exportQueueToExcel} disabled={orders.length === 0}>
                                    Export Excel
                                  </button>
                                  {!isInvoiceMaker && (
                                    <Link
                                      href={`/management/new-order?order_id=${encodeURIComponent(order.id)}&customer_code=${encodeURIComponent(order.customer_code || "")}&customer_name=${encodeURIComponent(order.customer_name || "")}&salesman_code=${encodeURIComponent(order.salesman_code || "")}`}
                                      className="moduleInlineButton"
                                    >
                                      Edit Order
                                    </Link>
                                  )}
                                  {!isInvoiceMaker && <Link href="/management/new-order" className="moduleInlineButton">Open Order Workflow</Link>}
                                  {!isInvoiceMaker && <Link href="/management/customer-audit" className="moduleInlineButton">Go to Customer Details</Link>}
                                </div>

                                {orderHistory.length > 0 && (
                                  <div style={{ marginTop: "14px" }}>
                                    <div className="moduleSectionHeader">
                                      <h2>Change History</h2>
                                      <span>{orderHistory.length} event(s)</span>
                                    </div>
                                    <ExportableTable filename={`pending-order-history-${order.id}`} sheetName="History" className="moduleTableWrap">
                                      <table className="moduleTable">
                                        <thead>
                                          <tr>
                                            <th>When</th>
                                            <th>Action</th>
                                            <th>Details</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {orderHistory.slice().reverse().map((entry, index) => (
                                            <tr key={`${entry.changedAt || index}-${index}`}>
                                              <td>{formatKsaDateTime(entry.changedAt)}</td>
                                              <td>{entry.action || "UPDATED"}</td>
                                              <td>
                                                {(Array.isArray(entry.changes) ? entry.changes : []).map((change, changeIndex) => (
                                                  <div key={`${change.item_code || index}-${changeIndex}`}>
                                                    {change.item_code || "-"}: {change.type || "UPDATED"} {Number(change.before_quantity || 0)} → {Number(change.after_quantity || 0)}
                                                  </div>
                                                ))}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </ExportableTable>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}

                  {filteredOrders.length === 0 && (
                    <tr>
                      <td colSpan={14}>{orders.length === 0 ? "No pending orders found." : "No orders match the current filters."}</td>
                    </tr>
                  )}
                </tbody>
                {filteredOrders.length > 0 ? (
                  <tfoot>
                    <tr className="modulePendingOrdersTotalRow">
                      <td colSpan={10}>Total ({filteredOrders.length} order{filteredOrders.length === 1 ? "" : "s"})</td>
                      <td style={{ textAlign: "right" }}>{filteredValueTotals.orderValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td style={{ textAlign: "right" }}>{filteredValueTotals.invoiceValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td style={{ textAlign: "right" }}>{formatCurrentOutstanding(filteredValueTotals.currentOutstanding)}</td>
                      <td />
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </ExportableTable>
          </section>
        </div>
      </main>
    </MorningAttendanceGate>
  );
}
