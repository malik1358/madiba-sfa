"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import MostVisitedPages from "../../components/MostVisitedPages";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { getSupabaseClient } from "../../lib/supabase";
import { addPdfBuildFooter } from "../../lib/buildInfo";
import { fetchSalesScope } from "../../lib/salesScope";
import { sortBucketLabels, toNumber as parseOutstandingNumber } from "../../lib/outstanding";
import { formatComparisonDiff } from "../../lib/invoiceOrderCompare";
import { usePopupMessages } from "../../hooks/usePopupMessages";

const TEXT = {
  title: { en: "Pending Orders", ar: "الطلبات المعلقة" },
  subtitleTeam: { en: "Orders queue across the team", ar: "قائمة الطلبات على مستوى الفريق" },
  subtitleMine: { en: "Orders queue in your account", ar: "قائمة الطلبات في حسابك" },
  dashboard: { en: "← Dashboard", ar: "← الرئيسية" },
  loading: { en: "Loading old pending orders...", ar: "جاري تحميل الطلبات المعلقة القديمة..." },
};

const PENDING_STATUSES = ["DRAFT", "PENDING", "SUBMITTED"];
const INVOICE_STATUS_PENDING_CREDIT = "Pending for credit approval";
const INVOICE_STATUS_REJECTED = "Rejected by management";
const INVOICE_STATUS_MADE = "Invoice made";
const OUTSTANDING_API = "/api/outstanding";
const EMPTY_FILTERS = {
  orderId: "",
  customer: "",
  salesman: "",
  status: "",
  invoiceStatus: "",
  uploadedAt: "",
  timeToMake: "",
  created: "",
  lastUpdated: "",
  age: "",
};

function includesFilter(value, filter) {
  const query = String(filter || "").trim().toLowerCase();
  if (!query) return true;
  return String(value ?? "").toLowerCase().includes(query);
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatReceivableMoney(value) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-GB");
}

function formatDuration(secondsValue) {
  const seconds = Number(secondsValue || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return "-";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${remainingSeconds}s`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

function daysOld(fromDate) {
  if (!fromDate) return 0;
  const then = new Date(fromDate).getTime();
  const now = Date.now();
  return Math.max(0, Math.floor((now - then) / (1000 * 60 * 60 * 24)));
}

function isInvoiceMakerRole(role) {
  const normalized = String(role || "").toLowerCase();
  return normalized === "invoice_maker" || normalized === "invoice-maker";
}

function invoiceStatusText(meta) {
  if (!meta) return "-";
  if (meta.status) return meta.status;
  if (meta.invoiceUploadedAt) return INVOICE_STATUS_MADE;
  return "-";
}

function InvoiceComparisonPanel({ meta, backfillingComparisons }) {
  if (!meta?.invoiceFilePath) return null;

  if (backfillingComparisons && !meta?.comparisonCheckedAt) {
    return <div className="moduleHint" style={{ marginTop: "10px" }}>Checking uploaded invoice against order...</div>;
  }

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [orders, setOrders] = useState([]);
  const [userRole, setUserRole] = useState("");
  const [activeOrderId, setActiveOrderId] = useState(null);
  const [orderLines, setOrderLines] = useState([]);
  const [orderHistory, setOrderHistory] = useState([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [invoiceMetaByOrder, setInvoiceMetaByOrder] = useState({});
  const [statusDraftByOrder, setStatusDraftByOrder] = useState({});
  const [openStartedAtByOrder, setOpenStartedAtByOrder] = useState({});

  usePopupMessages({ error });
  const [selectedInvoiceFile, setSelectedInvoiceFile] = useState(null);
  const [uploadingInvoice, setUploadingInvoice] = useState(false);
  const [savingInvoiceStatus, setSavingInvoiceStatus] = useState(false);
  const [outstandingInfoByOrder, setOutstandingInfoByOrder] = useState({});
  const [columnFilters, setColumnFilters] = useState(EMPTY_FILTERS);
  const [backfillingComparisons, setBackfillingComparisons] = useState(false);

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

  async function loadInvoiceMeta(orderIds) {
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      setInvoiceMetaByOrder({});
      return;
    }

    try {
      const token = await getAuthToken();
      const response = await fetch(`/api/order-invoice?orderIds=${encodeURIComponent(orderIds.join(","))}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to load invoice status.");
      }

      const items = payload.items && typeof payload.items === "object" ? payload.items : {};
      setInvoiceMetaByOrder(items);
      setStatusDraftByOrder((current) => {
        const next = { ...current };
        Object.entries(items).forEach(([orderId, meta]) => {
          if (!next[orderId]) {
            next[orderId] = String(meta?.status || "");
          }
        });
        return next;
      });

      await backfillInvoiceComparisons(items);
    } catch (err) {
      setError(err.message || "Unable to load invoice status.");
    }
  }

  async function backfillInvoiceComparisons(items) {
    const pendingIds = Object.entries(items || {})
      .filter(([, meta]) => meta?.invoiceFilePath && !meta?.comparisonCheckedAt)
      .map(([orderId]) => orderId);

    if (pendingIds.length === 0) return;

    setBackfillingComparisons(true);
    try {
      const token = await getAuthToken();
      for (let index = 0; index < pendingIds.length; index += 15) {
        const chunk = pendingIds.slice(index, index + 15);
        const response = await fetch("/api/order-invoice", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            mode: "backfill-comparisons",
            orderIds: chunk,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success) continue;

        setInvoiceMetaByOrder((current) => ({
          ...current,
          ...(payload.items || {}),
        }));
      }
    } catch {
      // Keep queue usable even if historical comparison backfill fails.
    } finally {
      setBackfillingComparisons(false);
    }
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

      setStatusDraftByOrder((current) => {
        const existing = current[orderId];
        if (existing) return current;
        return {
          ...current,
          [orderId]: String(invoiceMetaByOrder?.[orderId]?.status || ""),
        };
      });

      if (invoiceMetaByOrder?.[orderId]?.invoiceFilePath) {
        await refreshInvoiceComparison(orderId);
      }

      if (isInvoiceMakerRole(userRole)) {
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
    async function load() {
      const supabase = getSupabaseClient();
      if (!supabase) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.user) {
          throw new Error("Please login again.");
        }

        const scope = await fetchSalesScope();
        const role = String(scope?.role || "").toLowerCase();
        setUserRole(role);

        const query = supabase
          .from("sales_orders")
          .select("id,customer_code,customer_name,salesman_code,created_by,created_at,updated_at,status")
          .in("status", PENDING_STATUSES)
          .order("updated_at", { ascending: false })
          .limit(500);

        const { data, error: ordersError } = await query;
        if (ordersError) throw ordersError;

        const visibleOrders = (data || []).filter((order) => {
          if (scope?.hasAllAccess) return true;

          const createdByVisible = (scope?.visibleUserIds || []).includes(order.created_by);
          const salesmanVisible = (scope?.visibleSalesmanCodes || []).includes(String(order.salesman_code || "").trim().toUpperCase());

          return createdByVisible || salesmanVisible;
        });

        setOrders(visibleOrders);
        await loadInvoiceMeta(visibleOrders.map((order) => order.id));
      } catch (err) {
        setError(err.message || "Unable to load pending orders.");
      } finally {
        setLoading(false);
      }
    }

    load();
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

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const meta = invoiceMetaByOrder?.[order.id] || null;
      const age = daysOld(order.updated_at || order.created_at);

      return includesFilter(order.id, columnFilters.orderId)
        && includesFilter(order.customer_name || order.customer_code, columnFilters.customer)
        && includesFilter(order.salesman_code, columnFilters.salesman)
        && includesFilter(order.status, columnFilters.status)
        && includesFilter(invoiceStatusText(meta), columnFilters.invoiceStatus)
        && includesFilter(formatDateTime(meta?.invoiceUploadedAt), columnFilters.uploadedAt)
        && includesFilter(formatDuration(meta?.invoiceBuildSeconds), columnFilters.timeToMake)
        && includesFilter(formatDateTime(order.created_at), columnFilters.created)
        && includesFilter(formatDateTime(order.updated_at), columnFilters.lastUpdated)
        && includesFilter(age, columnFilters.age);
    });
  }, [columnFilters, invoiceMetaByOrder, orders]);

  async function regenerateOrderPdf() {
    if (!activeOrder) {
      setError("Open an order first to regenerate PDF.");
      return;
    }

    if (orderLines.length === 0) {
      setError("This order has no line items to generate PDF.");
      return;
    }

    setDownloadingPdf(true);
    setError("");

    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const vatRate = 0.15;
      const subtotal = orderLines.reduce((sum, line) => sum + Number(line.line_value || 0), 0);
      const vatAmount = subtotal * vatRate;
      const grandTotal = subtotal + vatAmount;

      doc.setFont(undefined, "bold");
      doc.setFontSize(18);
      doc.text("MADIBA SFA", 40, 44);
      doc.setFontSize(12);
      doc.text("SALES ORDER", 40, 64);

      doc.setFont(undefined, "normal");
      doc.setFontSize(10);
      doc.text(`Order ID: ${activeOrder.id}`, 40, 86);
      doc.text(`Status: ${activeOrder.status || "-"}`, 40, 102);
      doc.text(`Customer: ${activeOrder.customer_code || "-"} - ${activeOrder.customer_name || "-"}`, 40, 118);
      doc.text(`Salesman: ${activeOrder.salesman_code || "-"}`, 40, 134);
      doc.text(`Created: ${formatDateTime(activeOrder.created_at)}`, 40, 150);
      doc.text(`Last Updated: ${formatDateTime(activeOrder.updated_at)}`, 40, 166);

      doc.setFont(undefined, "bold");
      doc.rect(40, 186, 515, 24);
      doc.text("Item Code", 46, 202);
      doc.text("Item Name", 124, 202);
      doc.text("Qty", 346, 202);
      doc.text("Rate", 396, 202);
      doc.text("Line Total", 476, 202);
      doc.setFont(undefined, "normal");

      let y = 210;
      orderLines.forEach((line) => {
        const codeLines = doc.splitTextToSize(String(line.item_code || "-"), 72);
        const nameLines = doc.splitTextToSize(String(line.item_name || "-"), 214);
        const qtyLines = doc.splitTextToSize(String(Number(line.quantity || 0)), 42);
        const rateLines = doc.splitTextToSize(formatMoney(line.rate), 72);
        const totalLines = doc.splitTextToSize(formatMoney(line.line_value), 77);
        const lineCount = Math.max(
          codeLines.length,
          nameLines.length,
          qtyLines.length,
          rateLines.length,
          totalLines.length,
          1
        );
        const rowHeight = Math.max(22, lineCount * 12 + 8);

        if (y + rowHeight > 760) {
          doc.addPage();
          y = 40;
          doc.setFont(undefined, "bold");
          doc.rect(40, y, 515, 24);
          doc.text("Item Code", 46, y + 16);
          doc.text("Item Name", 124, y + 16);
          doc.text("Qty", 346, y + 16);
          doc.text("Rate", 396, y + 16);
          doc.text("Line Total", 476, y + 16);
          doc.setFont(undefined, "normal");
          y += 24;
        }

        doc.rect(40, y, 80, rowHeight);
        doc.rect(120, y, 220, rowHeight);
        doc.rect(340, y, 50, rowHeight);
        doc.rect(390, y, 80, rowHeight);
        doc.rect(470, y, 85, rowHeight);

        codeLines.forEach((codeLine, idx) => {
          doc.text(codeLine, 46, y + 14 + idx * 12);
        });
        nameLines.forEach((nameLine, idx) => {
          doc.text(nameLine, 124, y + 14 + idx * 12);
        });
        qtyLines.forEach((qtyLine, idx) => {
          doc.text(qtyLine, 386, y + 14 + idx * 12, { align: "right" });
        });
        rateLines.forEach((rateLine, idx) => {
          doc.text(rateLine, 464, y + 14 + idx * 12, { align: "right" });
        });
        totalLines.forEach((totalLine, idx) => {
          doc.text(totalLine, 548, y + 14 + idx * 12, { align: "right" });
        });

        y += rowHeight;
      });

      const summaryY = Math.min(y + 20, 740);
      doc.roundedRect(350, summaryY, 205, 70, 4, 4);
      doc.text("Subtotal (Excl. VAT)", 360, summaryY + 18);
      doc.text(formatMoney(subtotal), 546, summaryY + 18, { align: "right" });
      doc.text("VAT @ 15%", 360, summaryY + 36);
      doc.text(formatMoney(vatAmount), 546, summaryY + 36, { align: "right" });
      doc.setFont(undefined, "bold");
      doc.text("Total (Incl. VAT)", 360, summaryY + 54);
      doc.text(formatMoney(grandTotal), 546, summaryY + 54, { align: "right" });
      doc.setFont(undefined, "normal");

      if (orderHistory.length > 0) {
        let historyY = Math.min(summaryY + 96, 650);
        if (historyY > 650) {
          doc.addPage();
          historyY = 40;
        }

        doc.setFont(undefined, "bold");
        doc.text("Order Change History", 40, historyY);
        historyY += 14;
        doc.setFont(undefined, "normal");

        orderHistory.slice(-8).forEach((entry) => {
          const header = `${entry.changedAt ? new Date(entry.changedAt).toLocaleString("en-GB") : "-"} • ${entry.action || "UPDATED"}`;
          const wrappedHeader = doc.splitTextToSize(header, 515);
          wrappedHeader.forEach((line, index) => doc.text(line, 40, historyY + index * 10));
          historyY += Math.max(12, wrappedHeader.length * 10);

          (Array.isArray(entry.changes) ? entry.changes : []).forEach((change) => {
            const changeText = `${change.item_code || "-"}: ${change.type || "UPDATED"} ${Number(change.before_quantity || 0)} -> ${Number(change.after_quantity || 0)} | ${formatMoney(change.before_rate || 0)} -> ${formatMoney(change.after_rate || 0)}`;
            const wrappedChange = doc.splitTextToSize(changeText, 505);
            wrappedChange.forEach((line, index) => doc.text(line, 48, historyY + index * 10));
            historyY += Math.max(12, wrappedChange.length * 10);
          });

          historyY += 6;
        });
      }

      const outstandingInfo = outstandingInfoByOrder?.[activeOrder.id] || null;
      const outstandingCustomer = outstandingInfo?.customer;
      const outstandingBuckets = sortBucketLabels(outstandingInfo?.bucketLabels || []);

      if (outstandingCustomer && outstandingBuckets.length > 0) {
        let outstandingY = Math.min(y + 18, 730);
        if (outstandingY > 680) {
          doc.addPage();
          outstandingY = 40;
        }

        doc.setFont(undefined, "bold");
        doc.text("Outstanding Buckets", 40, outstandingY);
        doc.setFont(undefined, "normal");

        let rowY = outstandingY + 10;
        const leftX = 40;
        const labelW = 220;
        const valueW = 120;

        const bucketRows = [
          ...outstandingBuckets.map((label) => ({
            label: `${label} days`,
            value: formatReceivableMoney(parseOutstandingNumber(outstandingCustomer?.buckets?.[label])),
          })),
          { label: "Open invoices", value: String(parseOutstandingNumber(outstandingCustomer?.open_invoices)) },
          { label: "Total outstanding", value: formatReceivableMoney(parseOutstandingNumber(outstandingCustomer?.total_outstanding)) },
        ];

        bucketRows.forEach((row, index) => {
          const rowH = 18;
          doc.rect(leftX, rowY, labelW, rowH);
          doc.rect(leftX + labelW, rowY, valueW, rowH);
          doc.text(row.label, leftX + 6, rowY + 12);
          if (index === bucketRows.length - 1) {
            doc.setFont(undefined, "bold");
          }
          doc.text(row.value, leftX + labelW + valueW - 6, rowY + 12, { align: "right" });
          if (index === bucketRows.length - 1) {
            doc.setFont(undefined, "normal");
          }
          rowY += rowH;
        });
      }

      addPdfBuildFooter(doc);

      const safeCustomer = String(activeOrder.customer_code || "customer").replace(/[^a-zA-Z0-9_-]/g, "_");
      const safeDate = String(activeOrder.updated_at || activeOrder.created_at || new Date().toISOString())
        .slice(0, 19)
        .replace(/[:T]/g, "-");
      doc.save(`order-${activeOrder.id}-${safeCustomer}-${safeDate}.pdf`);
    } catch {
      setError("Unable to regenerate PDF for this order.");
    } finally {
      setDownloadingPdf(false);
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
        "Order ID": order.id,
        Customer: order.customer_name || order.customer_code || "-",
        "Customer Code": order.customer_code || "-",
        Salesman: order.salesman_code || "-",
        Status: order.status || "-",
        "Invoice Status": invoiceStatusText(invoiceMetaByOrder?.[order.id]),
        "Invoice Uploaded At": formatDateTime(invoiceMetaByOrder?.[order.id]?.invoiceUploadedAt),
        "Invoice Build Time": formatDuration(invoiceMetaByOrder?.[order.id]?.invoiceBuildSeconds),
        Created: formatDateTime(order.created_at),
        "Last Updated": formatDateTime(order.updated_at),
        "Age (days)": daysOld(order.updated_at || order.created_at),
      }));

      workbook.Sheets.PendingOrders = XLSX.utils.json_to_sheet(queueRows);
      workbook.SheetNames.push("PendingOrders");

      if (activeOrder && Array.isArray(orderLines) && orderLines.length > 0) {
        const lineRows = orderLines.map((line) => ({
          "Order ID": activeOrder.id,
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

  async function saveInvoiceStatus(orderId) {
    const status = String(statusDraftByOrder?.[orderId] || "").trim();
    if (!status) {
      setError("Choose invoice status first.");
      return;
    }

    setSavingInvoiceStatus(true);
    setError("");

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

      setInvoiceMetaByOrder((current) => ({
        ...current,
        [orderId]: payload.item || { orderId, status },
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
            <div className="moduleHeaderMeta"><AppLanguageSwitch language={language} setLanguage={setLanguage} /><MostVisitedPages /><Link href="/" className="moduleBackLink">{t("dashboard")}</Link></div>
          </div>

          <div className="moduleMetricGrid">
            <section className="moduleMetricCard"><span>Total pending</span><strong>{summary.total}</strong></section>
            <section className="moduleMetricCard"><span>Old pending</span><strong>{summary.oldPending}</strong></section>
            <section className="moduleMetricCard"><span>Updated today</span><strong>{summary.updatedToday}</strong></section>
            <section className="moduleMetricCard"><span>Older than 7 days</span><strong>{summary.olderThan7}</strong></section>
            <section className="moduleMetricCard"><span>Older than 30 days</span><strong>{summary.olderThan30}</strong></section>
          </div>

          <section className="moduleSection">
            <div className="moduleSectionHeader">
              <h2>Pending Order Queue</h2>
              <span>{filteredOrders.length} shown / {summary.total} order(s)</span>
            </div>

            {backfillingComparisons ? (
              <div className="moduleHint" style={{ marginBottom: "10px" }}>
                Comparing past uploaded invoices with orders...
              </div>
            ) : null}

            <div className="moduleTableWrap">
              <table className="moduleTable">
                <thead>
                  <tr>
                    <th>Order ID</th>
                    <th>Customer</th>
                    <th>Salesman</th>
                    <th>Status</th>
                    <th>Invoice Status</th>
                    <th>Uploaded At</th>
                    <th>Time to Make</th>
                    <th>Created</th>
                    <th>Last Updated</th>
                    <th>Age (days)</th>
                    <th>Action</th>
                  </tr>
                  <tr>
                    {[
                      ["orderId", "Filter ID"],
                      ["customer", "Filter customer"],
                      ["salesman", "Filter salesman"],
                      ["status", "Filter status"],
                      ["invoiceStatus", "Filter invoice status"],
                      ["uploadedAt", "Filter uploaded"],
                      ["timeToMake", "Filter time"],
                      ["created", "Filter created"],
                      ["lastUpdated", "Filter updated"],
                      ["age", "Filter age"],
                    ].map(([key, placeholder]) => (
                      <th key={key}>
                        <input
                          className="moduleInput"
                          type="text"
                          value={columnFilters[key]}
                          placeholder={placeholder}
                          onChange={(event) => setColumnFilters((current) => ({
                            ...current,
                            [key]: event.target.value,
                          }))}
                        />
                      </th>
                    ))}
                    <th>
                      <button
                        type="button"
                        className="moduleInlineButton"
                        onClick={() => setColumnFilters(EMPTY_FILTERS)}
                      >
                        Clear
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((order) => {
                    const age = daysOld(order.updated_at || order.created_at);
                    const meta = invoiceMetaByOrder?.[order.id] || null;

                    return (
                      <Fragment key={order.id}>
                        <tr>
                          <td>{order.id}</td>
                          <td>{order.customer_name || order.customer_code || "-"}</td>
                          <td>{order.salesman_code || "-"}</td>
                          <td>{order.status || "-"}</td>
                          <td>{invoiceStatusText(meta)}</td>
                          <td>{formatDateTime(meta?.invoiceUploadedAt)}</td>
                          <td>{formatDuration(meta?.invoiceBuildSeconds)}</td>
                          <td>{formatDateTime(order.created_at)}</td>
                          <td>{formatDateTime(order.updated_at)}</td>
                          <td>{age}</td>
                          <td>
                            <button
                              type="button"
                              className="moduleInlineButton"
                              onClick={() => openOrder(order.id)}
                              disabled={loadingLines && activeOrderId === order.id}
                            >
                              {activeOrderId === order.id ? "Close" : "Open"}
                            </button>
                          </td>
                        </tr>

                        {activeOrderId === order.id && (
                          <tr>
                            <td colSpan={11}>
                              <div style={{ marginTop: "8px", marginBottom: "8px" }}>
                                <div className="moduleSectionHeader">
                                  <h2>Order #{order.id} Details</h2>
                                  <span>{loadingLines ? "Loading..." : `${orderLines.length} line(s)`}</span>
                                </div>

                                <div className="moduleTableWrap">
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
                                </div>

                                <div className="moduleHint" style={{ marginTop: "10px" }}>
                                  <strong>Invoice status:</strong> {invoiceStatusText(meta)}
                                  {meta?.invoiceFileUrl ? (
                                    <span> | <a href={meta.invoiceFileUrl} target="_blank" rel="noreferrer">View uploaded invoice</a></span>
                                  ) : null}
                                  <span> | <strong>Uploaded at:</strong> {formatDateTime(meta?.invoiceUploadedAt)}</span>
                                  <span> | <strong>Time to make:</strong> {formatDuration(meta?.invoiceBuildSeconds)}</span>
                                </div>

                                <InvoiceComparisonPanel meta={meta} backfillingComparisons={backfillingComparisons} />

                                {isInvoiceMaker && (
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
                                          <option value={INVOICE_STATUS_PENDING_CREDIT}>{INVOICE_STATUS_PENDING_CREDIT}</option>
                                          <option value={INVOICE_STATUS_REJECTED}>{INVOICE_STATUS_REJECTED}</option>
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
                                    onClick={regenerateOrderPdf}
                                    disabled={downloadingPdf || loadingLines || orderLines.length === 0}
                                  >
                                    {downloadingPdf ? "Generating PDF..." : "Regenerate PDF"}
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
                                    <div className="moduleTableWrap">
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
                                              <td>{entry.changedAt ? new Date(entry.changedAt).toLocaleString("en-GB") : "-"}</td>
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
                                    </div>
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
                      <td colSpan={11}>{orders.length === 0 ? "No pending orders found." : "No orders match the current filters."}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </main>
    </MorningAttendanceGate>
  );
}
