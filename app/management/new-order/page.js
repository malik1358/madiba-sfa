"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { getSupabaseClient } from "../../lib/supabase";
import { fetchSalesScope } from "../../lib/salesScope";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { useOrder } from "../customer-audit/hooks/useOrder";
import { getPrice, isDoNotUseItem } from "../customer-audit/lib/helpers";
import { qtyFormat } from "../customer-audit/lib/format";
import { calculateGrandTotal } from "../customer-audit/lib/orderHelpers";
import { useAnalytics } from "../customer-audit/hooks/useAnalytics";
import { useQuickOrder } from "../customer-audit/hooks/useQuickOrder";
import CustomerHeader from "../customer-audit/components/CustomerHeader";
import MonthlyPerformance from "../customer-audit/components/MonthlyPerformance";
import CategoryPerformance from "../customer-audit/components/CategoryPerformance";
import QuickOrder from "../customer-audit/components/QuickOrder";
import TransactionHistory from "../customer-audit/components/TransactionHistory";

const PRICE_API =
  "https://script.google.com/macros/s/AKfycbzXPREoz0tUgern-5LhpEPBMY_ed2hO1fgYpIVfzG2-BU9HbjOklKCBFVMtsw64Uff5/exec";

const TEXT = {
  title: { en: "New Order", ar: "طلب جديد" },
  subtitle: { en: "Create, save draft, and submit customer orders", ar: "إنشاء طلبات العملاء وحفظها وإرسالها" },
  dashboard: { en: "← Dashboard", ar: "← الرئيسية" },
  loading: { en: "Loading order workspace...", ar: "جاري تحميل مساحة الطلبات..." },
};

function formatMoney(value) {
  return `SAR ${Number(value || 0).toFixed(2)}`;
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function toNumber(value) {
  const cleaned = String(value ?? "")
    .replace(/,/g, "")
    .trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readAny(source, keys) {
  if (!source || typeof source !== "object") return "";
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function normalizeText(value) {
  return String(value || "").trim();
}

function hasMeaningfulValue(value) {
  const text = normalizeText(value);
  if (!text) return false;
  return !["UNCLASSIFIED", "N/A", "NA", "-"] .includes(text.toUpperCase());
}

function isRowLike(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  return [
    "item_code",
    "itemCode",
    "code",
    "item_name",
    "itemName",
    "name",
    "category",
    "CO",
    "rate",
    "price",
    "C",
  ].some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function sheetCell(row, index) {
  if (!Array.isArray(row)) return "";
  return row[index] ?? "";
}

function sheetColumnIndex(columnName) {
  const name = String(columnName || "").trim().toUpperCase();
  let index = 0;

  for (let i = 0; i < name.length; i += 1) {
    const charCode = name.charCodeAt(i);
    if (charCode < 65 || charCode > 90) return -1;
    index = (index * 26) + (charCode - 64);
  }

  return index > 0 ? index - 1 : -1;
}

function looksLikeItemCode(value) {
  const text = normalizeCode(value);
  return /^[A-Z][A-Z0-9]{4,12}$/.test(text);
}

function looksLikeItemName(value) {
  const text = normalizeText(value);
  if (!text) return false;
  if (looksLikeItemCode(text)) return false;
  if (/^\d+(\.\d+)?$/.test(text)) return false;
  return text.length >= 3;
}

function scoreSheetName(value) {
  const text = normalizeText(value);
  if (!text) return -1;
  if (looksLikeItemCode(text)) return -1;
  if (/^\d+(\.\d+)?$/.test(text)) return -1;
  return text.length;
}

function parsePricePayload(payload) {
  const priceMap = {};
  const sheetItems = [];
  const seen = new Set();

  function upsertSheetItem(rawCode, rawName, rawCategory) {
    const code = normalizeCode(rawCode);
    if (!code) return;

    const name = String(rawName || "").trim();
    const category = String(rawCategory || "").trim();
    const key = `${code}::${name}::${category}`;
    if (seen.has(key)) return;

    seen.add(key);
    sheetItems.push({
      item_code: code,
      item_name: name || code,
      category: category || "Unclassified",
      source: "PRICE_SHEET",
    });
  }

  function addRate(rawCode, rawRate) {
    const code = normalizeCode(rawCode);
    if (!code) return;
    const rate = toNumber(rawRate);
    priceMap[code] = rate;
  }

  function walk(value) {
    if (!value) return;

    if (Array.isArray(value)) {
      if (value.length && Array.isArray(value[0])) {
        const itemCodeIndex = sheetColumnIndex("B");
        const itemNameIndex = sheetColumnIndex("C");
        const categoryIndex = sheetColumnIndex("CO");
        const rateIndex = sheetColumnIndex("D");

        value.forEach((row) => {
          const explicitCode = itemCodeIndex >= 0 ? normalizeCode(sheetCell(row, itemCodeIndex)) : "";
          const codeCandidates = row.filter((cell) => looksLikeItemCode(cell)).map((cell) => normalizeCode(cell));
          const code = explicitCode || codeCandidates.find(Boolean) || "";

          const explicitName = itemNameIndex >= 0 ? normalizeText(sheetCell(row, itemNameIndex)) : "";
          const nameCandidate = explicitName || row
            .map((cell, index) => ({ cell, index }))
            .filter(({ cell, index }) => index !== itemCodeIndex && looksLikeItemName(cell))
            .sort((a, b) => scoreSheetName(b.cell) - scoreSheetName(a.cell))[0]?.cell || "";
          const name = normalizeText(nameCandidate) && normalizeCode(nameCandidate) !== code ? normalizeText(nameCandidate) : "";

          const explicitCategory = categoryIndex >= 0 ? normalizeText(sheetCell(row, categoryIndex)) : "";
          const categoryCandidate = explicitCategory || row.find((cell) => /electronics|fridge|freezer|air conditioner|ac|window/i.test(String(cell || ""))) || "";
          const category = normalizeText(categoryCandidate);
          const rate = sheetCell(row, rateIndex) || row.find((cell) => Number.isFinite(Number(String(cell).replace(/,/g, "")))) || "";

          if (!code && !name) return;

          if (code) {
            addRate(code, rate);
            upsertSheetItem(code, name || code, category || "Unclassified");
          }
        });
      }

      value.forEach((entry) => walk(entry));
      return;
    }

    if (typeof value !== "object") return;

    if (isRowLike(value)) {
      const code = readAny(value, ["item_code", "itemCode", "code", "B", "Item Code", "ITEM CODE"]);
      const name = readAny(value, ["item_name", "itemName", "name", "C", "Item Name", "ITEM NAME"]);
      const category = readAny(value, ["category", "CO", "Category", "ITEM CATEGORY", "Item Category"]);
      const rate = readAny(value, ["rate", "price", "RATE", "Price", "D", "Selling Rate"]);

      if (code) {
        addRate(code, rate);
        upsertSheetItem(code, name, category);
      }
    }

    Object.entries(value).forEach(([key, entry]) => {
      if (["priceMap", "prices", "data", "rows", "result", "items", "sheetData", "values"].includes(key)) {
        walk(entry);
        return;
      }

      if (typeof entry === "object") {
        walk(entry);
      }
    });
  }

  if (Array.isArray(payload)) {
    walk(payload);

    return { priceMap, sheetItems };
  }

  if (payload && typeof payload === "object") {
    walk(payload);

    // If the payload is a direct code -> rate map, keep those rates too.
    Object.entries(payload).forEach(([key, value]) => {
      if (typeof value !== "object" || value === null) {
        addRate(key, value);
      }
    });
  }

  return { priceMap, sheetItems };
}

export default function NewOrderPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [customers, setCustomers] = useState([]);
  const [itemsMaster, setItemsMaster] = useState([]);
  const [priceSheetItems, setPriceSheetItems] = useState([]);
  const [selectedCustomerCode, setSelectedCustomerCode] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [expandedItemCategories, setExpandedItemCategories] = useState({});
  const [auditExpandedCategories, setAuditExpandedCategories] = useState({});
  const [showTransactions, setShowTransactions] = useState(false);
  const [loadingCustomerHistory, setLoadingCustomerHistory] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [peerTransactions, setPeerTransactions] = useState([]);
  const [priceList, setPriceList] = useState({});
  const [previousDrafts, setPreviousDrafts] = useState([]);
  const [lastSavedOrder, setLastSavedOrder] = useState(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [accessScope, setAccessScope] = useState(null);
  const [prefilledCustomer, setPrefilledCustomer] = useState(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const customerCode = String(params.get("customer_code") || "").trim();
    const customerName = String(params.get("customer_name") || "").trim();
    const salesmanCode = String(params.get("salesman_code") || "").trim();

    if (!customerCode || !customerName) {
      setPrefilledCustomer(null);
      return;
    }

    setPrefilledCustomer({
      customer_code: customerCode,
      customer_name: customerName,
      current_salesman_code: salesmanCode,
    });
  }, []);

  const mergedItemsMaster = useMemo(() => {
    const itemMap = new Map();

    (itemsMaster || []).forEach((item) => {
      const code = normalizeCode(item.item_code);
      if (!code) return;

      itemMap.set(code, {
        ...item,
        item_code: code,
        item_name: String(item.item_name || code).trim(),
        category: String(item.category || "Unclassified").trim() || "Unclassified",
        source: "ITEM_MASTER",
      });
    });

    (priceSheetItems || []).forEach((sheetItem) => {
      const code = normalizeCode(sheetItem.item_code);
      if (!code) return;

      const existing = itemMap.get(code);
      if (!existing) {
        itemMap.set(code, {
          item_code: code,
          item_name: normalizeText(sheetItem.item_name) || code,
          category: normalizeText(sheetItem.category) || "Unclassified",
          source: "PRICE_SHEET_ONLY",
        });
        return;
      }

      const existingName = normalizeText(existing.item_name);
      const sheetName = normalizeText(sheetItem.item_name);
      const existingCategory = normalizeText(existing.category);
      const sheetCategory = normalizeText(sheetItem.category);

      const nextName = hasMeaningfulValue(existingName) ? existingName : (sheetName || code);
      const nextCategory = hasMeaningfulValue(sheetCategory)
        ? sheetCategory
        : (hasMeaningfulValue(existingCategory) ? existingCategory : "Unclassified");

      itemMap.set(code, {
        ...existing,
        item_name: nextName,
        category: nextCategory,
        source: existing.source === "PRICE_SHEET_ONLY" || hasMeaningfulValue(sheetCategory) ? "PRICE_SHEET" : existing.source,
      });
    });

    Object.keys(priceList || {}).forEach((rawCode) => {
      const code = normalizeCode(rawCode);
      if (!code || itemMap.has(code)) return;

      itemMap.set(code, {
        item_code: code,
        item_name: code,
        category: "Unclassified",
        source: "PRICE_MAP_ONLY",
      });
    });

    return Array.from(itemMap.values()).sort((a, b) => String(a.item_name || "").localeCompare(String(b.item_name || "")));
  }, [itemsMaster, priceSheetItems, priceList]);

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.customer_code === selectedCustomerCode) || null,
    [customers, selectedCustomerCode]
  );

  const analytics = useAnalytics(transactions);
  const quickOrderSuggestions = useQuickOrder({
    analytics,
    transactions,
    peerTransactions,
    itemMaster: mergedItemsMaster,
  });

  const quickOrderAllItems = useMemo(
    () => [
      ...quickOrderSuggestions.newItems,
      ...quickOrderSuggestions.notBoughtRecently,
      ...quickOrderSuggestions.buyingLess,
    ],
    [quickOrderSuggestions]
  );

  const categories = useMemo(
    () => [
      "ALL",
      ...new Set(mergedItemsMaster.map((item) => item.category).filter(Boolean)).values(),
    ],
    [mergedItemsMaster]
  );

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    return customers.filter((customer) => {
      if (!q) return true;
      return (
        String(customer.customer_code || "").toLowerCase().includes(q) ||
        String(customer.customer_name || "").toLowerCase().includes(q)
      );
    });
  }, [customers, customerSearch]);

  const filteredItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    return mergedItemsMaster.filter((item) => {
      if (categoryFilter !== "ALL" && item.category !== categoryFilter) return false;
      if (!q) return true;

      return (
        String(item.item_code || "").toLowerCase().includes(q) ||
        String(item.item_name || "").toLowerCase().includes(q) ||
        String(item.category || "").toLowerCase().includes(q)
      );
    });
  }, [mergedItemsMaster, categoryFilter, itemSearch]);

  const groupedItems = useMemo(() => {
    const map = new Map();

    filteredItems.forEach((item) => {
      const category = item.category || "Unclassified";
      const current = map.get(category) || [];
      current.push(item);
      map.set(category, current);
    });

    return Array.from(map.entries())
      .map(([category, items]) => ({
        category,
        items,
      }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }, [filteredItems]);

  const priceSheetOnlyItems = useMemo(
    () => mergedItemsMaster.filter((item) => item.source === "PRICE_SHEET_ONLY" || item.source === "PRICE_MAP_ONLY"),
    [mergedItemsMaster]
  );

  function toggleItemCategory(category) {
    setExpandedItemCategories((current) => ({
      ...current,
      [category]: !current[category],
    }));
  }

  function toggleAuditCategory(category) {
    setAuditExpandedCategories((current) => ({
      ...current,
      [category]: !current[category],
    }));
  }

  const analyticsLike = useMemo(() => ({ items: mergedItemsMaster }), [mergedItemsMaster]);

  const {
    draftOrderId,
    orderItems,
    orderSummary,
    orderQuantities,
    savingOrder,
    submittingOrder,
    updateQty,
    increaseQty,
    decreaseQty,
    saveDraft,
    submitOrder,
  } = useOrder({
    analytics: analyticsLike,
    quickOrderAllItems,
    selectedCustomer,
    priceList,
    setError,
    setMessage,
    accessScope,
  });

  const buildOrderSnapshot = useCallback(
    (orderId, statusLabel) => {
      if (!selectedCustomer || orderItems.length === 0) return null;

      const savedAtIso = new Date().toISOString();
      const lines = orderItems.map((item) => {
        const quantity = Number(item.order_quantity || 0);
        const rate = Number(getPrice(priceList, item.item_code) || 0);

        return {
          item_code: item.item_code,
          item_name: item.item_name,
          category: item.category || "Unclassified",
          quantity,
          rate,
          lineTotal: quantity * rate,
        };
      });

      return {
        orderId,
        statusLabel,
        savedAtIso,
        customerCode: selectedCustomer.customer_code,
        customerName: selectedCustomer.customer_name,
        salesmanCode: selectedCustomer.current_salesman_code,
        itemCount: orderSummary.itemCount,
        totalQuantity: orderSummary.totalQuantity,
        grandTotal: calculateGrandTotal(orderItems, priceList),
        lines,
      };
    },
    [orderItems, orderSummary.itemCount, orderSummary.totalQuantity, priceList, selectedCustomer]
  );

  const downloadOrderPdf = useCallback(
    async (snapshot) => {
      if (!snapshot) return;

      setDownloadingPdf(true);
      try {
        const { jsPDF } = await import("jspdf");
        const doc = new jsPDF({ unit: "pt", format: "a4" });

        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const marginX = 40;
        const marginTop = 38;
        const contentWidth = pageWidth - marginX * 2;
        const tableStartX = marginX;
        const vatRate = 0.15;
        const subtotal = Number(snapshot.grandTotal || 0);
        const vatAmount = subtotal * vatRate;
        const totalWithVat = subtotal + vatAmount;

        const columns = [
          { key: "item_code", label: "Item Code", width: 88, align: "left" },
          { key: "item_name", label: "Item Name", width: 222, align: "left" },
          { key: "quantity", label: "Qty", width: 60, align: "right" },
          { key: "rate", label: "Rate (Excl. VAT)", width: 96, align: "right" },
          { key: "lineTotal", label: "Line Total", width: 89, align: "right" },
        ];

        function drawCellText(text, x, y, width, align = "left") {
          if (align === "right") {
            doc.text(text, x + width - 6, y, { align: "right" });
            return;
          }
          doc.text(text, x + 6, y);
        }

        function drawTableHeader(startY) {
          let colX = tableStartX;
          doc.setFillColor(239, 244, 245);
          doc.rect(tableStartX, startY, contentWidth, 24, "F");
          doc.setFont(undefined, "bold");
          doc.setFontSize(10);

          columns.forEach((column) => {
            doc.rect(colX, startY, column.width, 24);
            drawCellText(column.label, colX, startY + 15, column.width, column.align);
            colX += column.width;
          });

          doc.setFont(undefined, "normal");
          return startY + 24;
        }

        doc.setDrawColor(72, 110, 120);
        doc.setLineWidth(1);
        doc.roundedRect(marginX, marginTop, contentWidth, 92, 6, 6);

        doc.setFontSize(18);
        doc.setFont(undefined, "bold");
        doc.text("MADIBA SFA", marginX + 12, marginTop + 24);
        doc.setFontSize(12);
        doc.text("SALES ORDER", marginX + 12, marginTop + 44);

        doc.setFont(undefined, "normal");
        doc.setFontSize(10);
        doc.text(`Order ID: ${snapshot.orderId}`, marginX + 12, marginTop + 64);
        doc.text(`Status: ${snapshot.statusLabel}`, marginX + 12, marginTop + 78);

        const rightColX = marginX + contentWidth - 210;
        doc.text(`Date: ${new Date(snapshot.savedAtIso).toLocaleString("en-GB")}`, rightColX, marginTop + 64);
        doc.text(`Salesman: ${snapshot.salesmanCode || "-"}`, rightColX, marginTop + 78);

        doc.setLineWidth(0.8);
        doc.roundedRect(marginX, marginTop + 104, contentWidth, 56, 5, 5);
        doc.setFont(undefined, "bold");
        doc.text("Customer", marginX + 12, marginTop + 124);
        doc.setFont(undefined, "normal");
        const customerText = `${snapshot.customerCode} - ${snapshot.customerName}`;
        const customerLines = doc.splitTextToSize(customerText, contentWidth - 24);
        const customerLine1 = Array.isArray(customerLines) ? customerLines[0] : customerText;
        const customerLine2 = Array.isArray(customerLines) && customerLines.length > 1 ? customerLines[1] : "";
        doc.text(customerLine1, marginX + 12, marginTop + 140);
        if (customerLine2) {
          doc.text(customerLine2, marginX + 12, marginTop + 152);
        }

        doc.roundedRect(marginX, marginTop + 172, contentWidth, 40, 5, 5);
        doc.setFont(undefined, "bold");
        doc.text("Items", marginX + 12, marginTop + 188);
        doc.text("Total Qty", marginX + 145, marginTop + 188);
        doc.text("Subtotal", marginX + 282, marginTop + 188);
        doc.text("VAT 15%", marginX + 398, marginTop + 188);
        doc.text("Total Incl. VAT", marginX + 475, marginTop + 188);
        doc.setFont(undefined, "normal");
        doc.text(String(snapshot.itemCount), marginX + 12, marginTop + 202);
        doc.text(qtyFormat(snapshot.totalQuantity), marginX + 145, marginTop + 202);
        doc.text(formatMoney(subtotal), marginX + 282, marginTop + 202);
        doc.text(formatMoney(vatAmount), marginX + 398, marginTop + 202);
        doc.text(formatMoney(totalWithVat), marginX + 475, marginTop + 202);

        let y = drawTableHeader(marginTop + 226);
        doc.setFontSize(10);

        snapshot.lines.forEach((line) => {
          const rowValues = {
            item_code: String(line.item_code || "-"),
            item_name: String(line.item_name || "-"),
            quantity: String(line.quantity),
            rate: formatMoney(line.rate),
            lineTotal: formatMoney(line.lineTotal),
          };

          const itemNameCol = columns.find((column) => column.key === "item_name");
          const wrappedName = doc.splitTextToSize(rowValues.item_name, (itemNameCol?.width || 200) - 12);
          const wrappedLines = Array.isArray(wrappedName) ? wrappedName : [rowValues.item_name];
          const rowHeight = Math.max(24, wrappedLines.length * 12 + 8);

          if (y + rowHeight > pageHeight - 110) {
            doc.addPage();
            y = drawTableHeader(marginTop);
          }

          let colX = tableStartX;
          columns.forEach((column) => {
            doc.rect(colX, y, column.width, rowHeight);

            if (column.key === "item_name") {
              wrappedLines.forEach((nameLine, index) => {
                drawCellText(nameLine, colX, y + 14 + index * 12, column.width, column.align);
              });
            } else {
              drawCellText(rowValues[column.key], colX, y + 15, column.width, column.align);
            }

            colX += column.width;
          });

          y += rowHeight;
        });

        const summaryBoxWidth = 220;
        const summaryX = pageWidth - marginX - summaryBoxWidth;
        const summaryY = Math.min(y + 16, pageHeight - 88);
        doc.roundedRect(summaryX, summaryY, summaryBoxWidth, 68, 4, 4);
        doc.setFont(undefined, "normal");
        doc.text("Subtotal (Excl. VAT)", summaryX + 10, summaryY + 18);
        doc.text(formatMoney(subtotal), summaryX + summaryBoxWidth - 10, summaryY + 18, { align: "right" });
        doc.text("VAT @ 15%", summaryX + 10, summaryY + 34);
        doc.text(formatMoney(vatAmount), summaryX + summaryBoxWidth - 10, summaryY + 34, { align: "right" });
        doc.setFont(undefined, "bold");
        doc.text("Total (Incl. VAT)", summaryX + 10, summaryY + 54);
        doc.text(formatMoney(totalWithVat), summaryX + summaryBoxWidth - 10, summaryY + 54, { align: "right" });
        doc.setFont(undefined, "normal");

        doc.setFontSize(9);
        doc.text("Note: Item rates are exclusive of VAT. VAT is applied at 15% on subtotal.", marginX, pageHeight - 28);

        const safeCustomer = String(snapshot.customerCode || "customer").replace(/[^a-zA-Z0-9_-]/g, "_");
        const safeDate = snapshot.savedAtIso.slice(0, 19).replace(/[:T]/g, "-");
        const fileName = `order-${snapshot.orderId}-${safeCustomer}-${safeDate}.pdf`;
        doc.save(fileName);
      } catch {
        setError("Order saved, but PDF generation failed. Please try again.");
      } finally {
        setDownloadingPdf(false);
      }
    },
    [setError]
  );

  const handleSaveDraft = useCallback(async () => {
    const orderId = await saveDraft();
    if (!orderId) return;

    const snapshot = buildOrderSnapshot(orderId, "Draft Saved");
    if (!snapshot) return;

    setLastSavedOrder(snapshot);
    setPreviousDrafts((current) => {
      const next = current.filter((draft) => draft.id !== orderId);
      return [
        {
          id: orderId,
          customer_code: snapshot.customerCode,
          customer_name: snapshot.customerName,
          updated_at: snapshot.savedAtIso,
          status: "DRAFT",
        },
        ...next,
      ].slice(0, 25);
    });

    await downloadOrderPdf(snapshot);
    setMessage(`Draft order #${orderId} saved. PDF downloaded automatically.`);
  }, [buildOrderSnapshot, downloadOrderPdf, saveDraft]);

  const handleSubmitOrder = useCallback(async () => {
    const pendingSnapshot = buildOrderSnapshot(draftOrderId || "pending", "Submitted");
    const orderId = await submitOrder();
    if (!orderId || !pendingSnapshot) return;

    const snapshot = {
      ...pendingSnapshot,
      orderId,
      savedAtIso: new Date().toISOString(),
      statusLabel: "Submitted",
    };

    setLastSavedOrder(snapshot);
    await downloadOrderPdf(snapshot);
    setMessage(`Order #${orderId} submitted. PDF downloaded automatically.`);
  }, [buildOrderSnapshot, downloadOrderPdf, draftOrderId, submitOrder]);

  const shareText = useMemo(() => {
    if (!lastSavedOrder) return "";
    return `Order #${lastSavedOrder.orderId} (${lastSavedOrder.statusLabel}) for ${lastSavedOrder.customerName} - ${formatMoney(lastSavedOrder.grandTotal)}. PDF downloaded and ready to attach.`;
  }, [lastSavedOrder]);

  const whatsappShareUrl = useMemo(
    () => (shareText ? `https://wa.me/?text=${encodeURIComponent(shareText)}` : "#"),
    [shareText]
  );

  const emailShareUrl = useMemo(() => {
    if (!lastSavedOrder) return "#";
    const subject = `Order #${lastSavedOrder.orderId} - ${lastSavedOrder.customerName}`;
    const body = `${shareText}\n\nPlease attach the downloaded PDF from your device before sending.`;
    return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }, [lastSavedOrder, shareText]);

  useEffect(() => {
    async function loadFoundation() {
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
        setAccessScope(scope);

        let customersQuery = supabase
          .from("customers")
          .select("customer_code,customer_name,current_salesman_code")
          .eq("is_active", true)
          .order("customer_name");

        if (!scope.hasAllAccess) {
          customersQuery = customersQuery.in("current_salesman_code", scope.visibleSalesmanCodes);
        }

        let draftsQuery = supabase
          .from("sales_orders")
          .select("id,customer_code,customer_name,updated_at,status")
          .eq("status", "DRAFT")
          .order("updated_at", { ascending: false })
          .limit(25);

        if (!scope.hasAllAccess) {
          draftsQuery = draftsQuery.in("created_by", scope.visibleUserIds);
        }

        const [customersRes, itemsRes, draftsRes] = await Promise.all([
          customersQuery,
          supabase
            .from("items_master")
            .select("item_code,item_name,category")
            .order("item_name"),
          draftsQuery,
        ]);

        if (customersRes.error) throw customersRes.error;
        if (itemsRes.error) throw itemsRes.error;
        if (draftsRes.error) throw draftsRes.error;

        const loadedCustomers = customersRes.data || [];
        const mergedCustomers = prefilledCustomer && !loadedCustomers.some((customer) => customer.customer_code === prefilledCustomer.customer_code)
          ? [prefilledCustomer, ...loadedCustomers]
          : loadedCustomers;

        setCustomers(mergedCustomers);
        setItemsMaster(itemsRes.data || []);
        setPreviousDrafts(draftsRes.data || []);
      } catch (err) {
        setError(err.message || "Unable to load new order data.");
      } finally {
        setLoading(false);
      }
    }

    async function loadPrices() {
      try {
        const response = await fetch(PRICE_API);
        const data = await response.json();
        const parsed = parsePricePayload(data || {});
        setPriceList(parsed.priceMap);
        setPriceSheetItems(parsed.sheetItems);
      } catch {
        setPriceList({});
        setPriceSheetItems([]);
      }
    }

    loadFoundation();
    loadPrices();
  }, [prefilledCustomer]);

  useEffect(() => {
    if (!prefilledCustomer?.customer_code) return;

    setSelectedCustomerCode(prefilledCustomer.customer_code);
    setMessage(`Prospect ${prefilledCustomer.customer_name} is ready for order creation.`);
  }, [prefilledCustomer]);

  useEffect(() => {
    async function loadCustomerHistory() {
      if (!selectedCustomer) {
        setTransactions([]);
        setPeerTransactions([]);
        setShowTransactions(false);
        setAuditExpandedCategories({});
        return;
      }

      const supabase = getSupabaseClient();
      if (!supabase) return;

      setLoadingCustomerHistory(true);
      setShowTransactions(false);
      setAuditExpandedCategories({});

      try {
        const { data: settings, error: settingsError } = await supabase
          .from("system_settings")
          .select("setting_value")
          .eq("setting_key", "active_sales_batch_id")
          .single();

        if (settingsError) throw settingsError;

        const activeBatchId = Number(settings?.setting_value || 0);
        if (!activeBatchId) {
          setTransactions([]);
          setPeerTransactions([]);
          return;
        }

        let peersQuery = supabase
          .from("sales_raw")
          .select("customer_code,item_code,item_name,category,sales_amount,transaction_date")
          .eq("import_batch_id", activeBatchId);

        if (!accessScope?.hasAllAccess) {
          peersQuery = peersQuery.in("salesman_code", accessScope?.visibleSalesmanCodes || []);
        }

        const [transactionsRes, peersRes] = await Promise.all([
          supabase
            .from("sales_raw")
            .select(
              "id,transaction_date,voucher_number,reference,customer_code,customer_name,salesman_code,salesman_name,item_code,item_name,category,quantity,sales_amount,rate,first_purchase_date,abc_class"
            )
            .eq("import_batch_id", activeBatchId)
            .eq("customer_code", selectedCustomer.customer_code)
            .order("transaction_date", { ascending: false })
            .order("id", { ascending: false }),
          peersQuery,
        ]);

        if (transactionsRes.error) throw transactionsRes.error;
        if (peersRes.error) throw peersRes.error;

        setTransactions(transactionsRes.data || []);
        setPeerTransactions(peersRes.data || []);
      } catch (err) {
        setTransactions([]);
        setPeerTransactions([]);
        setError(err.message || "Unable to load customer audit history.");
      } finally {
        setLoadingCustomerHistory(false);
      }
    }

    loadCustomerHistory();
  }, [accessScope, selectedCustomer, setError]);

  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="New Order unavailable"
        message="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to create orders."
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
          <div className="moduleHeaderMeta"><AppLanguageSwitch language={language} setLanguage={setLanguage} /><Link href="/" className="moduleBackLink">{t("dashboard")}</Link></div>
        </div>

        {error && <div className="moduleError">{error}</div>}
        {message && <div className="moduleSuccess">{message}</div>}

        <section className="moduleSection">
          <div className="moduleSectionHeader">
            <h2>Customer Search</h2>
          </div>
          <div className="moduleFilterRow">
            <input
              className="moduleInput"
              type="text"
              placeholder="Search customer by code or name"
              value={customerSearch}
              onChange={(event) => setCustomerSearch(event.target.value)}
            />
            <select
              className="moduleInput"
              value={selectedCustomerCode}
              onChange={(event) => {
                setSelectedCustomerCode(event.target.value);
                setError("");
                setMessage("");
                setLastSavedOrder(null);
                setShowTransactions(false);
                setAuditExpandedCategories({});
              }}
            >
              <option value="">Select customer</option>
              {filteredCustomers.map((customer) => (
                <option key={customer.customer_code} value={customer.customer_code}>
                  {customer.customer_code} - {customer.customer_name}
                </option>
              ))}
            </select>
          </div>

          {!selectedCustomer && (
            <div className="moduleHint">Select a customer to start building an order.</div>
          )}
        </section>

        {selectedCustomer && (
          <>
            {loadingCustomerHistory && (
              <section className="moduleSection">
                <div className="moduleLoading">Loading customer audit sections...</div>
              </section>
            )}

            {!loadingCustomerHistory && analytics && (
              <>
                <CustomerHeader customer={selectedCustomer} analytics={analytics} />
                <MonthlyPerformance analytics={analytics} />
                <CategoryPerformance
                  analytics={analytics}
                  expandedCategories={auditExpandedCategories}
                  toggleCategory={toggleAuditCategory}
                  orderQuantities={orderQuantities}
                  decreaseOrderQty={decreaseQty}
                  increaseOrderQty={increaseQty}
                  changeOrderQty={updateQty}
                  priceList={priceList}
                />
                <QuickOrder
                  quickOrderSuggestions={quickOrderSuggestions}
                  orderQuantities={orderQuantities}
                  decreaseOrderQty={decreaseQty}
                  increaseOrderQty={increaseQty}
                  changeOrderQty={updateQty}
                  priceList={priceList}
                />
                <TransactionHistory
                  transactions={transactions}
                  showTransactions={showTransactions}
                  setShowTransactions={setShowTransactions}
                  analytics={analytics}
                />
              </>
            )}

            {!loadingCustomerHistory && !analytics && (
              <section className="moduleSection">
                <div className="moduleHint">
                  No customer transaction history found for audit sections. You can still create the order using the full item list below.
                </div>
              </section>
            )}

            <section className="moduleSection">
              <div className="moduleSectionHeader">
                <h2>Full Item List</h2>
                <span>
                  {mergedItemsMaster.length} catalog items • {orderSummary.itemCount} selected • {qtyFormat(orderSummary.totalQuantity)} units
                </span>
              </div>

              <div className="moduleFilterRow">
                <input
                  className="moduleInput"
                  type="text"
                  placeholder="Search item code, name, or category"
                  value={itemSearch}
                  onChange={(event) => setItemSearch(event.target.value)}
                />
                <select
                  className="moduleInput"
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                >
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>

              <div className="moduleTableWrap">
                <table className="moduleTable moduleOrderTable">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Item</th>
                      <th>Price</th>
                      <th>Qty</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedItems.slice(0, 40).map((group) => {
                      const isExpanded = Boolean(expandedItemCategories[group.category]);

                      return (
                        <Fragment key={`group-${group.category}`}>
                          <tr className="moduleCategoryRow">
                            <td colSpan={5}>
                              <button
                                type="button"
                                className="moduleCategoryToggle"
                                onClick={() => toggleItemCategory(group.category)}
                                aria-expanded={isExpanded}
                              >
                                <span className="moduleCategorySymbol">{isExpanded ? "−" : "+"}</span>
                                <strong>{group.category}</strong>
                                <small>{group.items.length} items</small>
                              </button>
                            </td>
                          </tr>
                          {isExpanded &&
                            group.items.slice(0, 120).map((item) => {
                              const qty = Number(orderQuantities[item.item_code] || 0);
                              const price = getPrice(priceList, item.item_code);

                              return (
                                <tr key={item.item_code} className="moduleItemRow">
                                  <td>{item.category || "Unclassified"}</td>
                                  <td>
                                    <strong>{item.item_name}</strong>
                                    <div className="moduleCode">
                                      {item.item_code}
                                      {item.source === "PRICE_SHEET_ONLY" ? " • Price Sheet" : ""}
                                      {isDoNotUseItem(item.item_name) ? " • Do Not Use" : ""}
                                    </div>
                                  </td>
                                  <td>{price ? `SAR ${price.toFixed(2)}` : "NOT FOUND"}</td>
                                  <td>
                                    <div className="moduleQtyControl">
                                      <button type="button" onClick={() => decreaseQty(item.item_code)}>−</button>
                                      <input
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={qty || ""}
                                        onChange={(event) => updateQty(item.item_code, event.target.value)}
                                      />
                                      <button type="button" onClick={() => increaseQty(item.item_code)}>+</button>
                                    </div>
                                  </td>
                                  <td>SAR {(price * qty).toFixed(2)}</td>
                                </tr>
                              );
                            })}
                        </Fragment>
                      );
                    })}
                    {groupedItems.length === 0 && (
                      <tr>
                        <td colSpan={5}>No items found for this filter.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {priceSheetOnlyItems.length > 0 && (
              <section className="moduleSection">
                <div className="moduleSectionHeader">
                  <h2>Price Sheet Items</h2>
                  <span>{priceSheetOnlyItems.length} sheet-only item(s)</span>
                </div>
                <div className="moduleTableWrap">
                  <table className="moduleTable">
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th>Item</th>
                        <th>Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {priceSheetOnlyItems.map((item) => (
                        <tr key={`sheet-only-${item.item_code}`}>
                          <td>{item.category || "Unclassified"}</td>
                          <td>
                            <strong>{item.item_name}</strong>
                            <div className="moduleCode">{item.item_code}</div>
                          </td>
                          <td>{priceList[String(item.item_code).trim().toUpperCase()] ? `SAR ${Number(priceList[String(item.item_code).trim().toUpperCase()]).toFixed(2)}` : "NOT FOUND"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <section className="moduleSection">
              <div className="moduleOrderBar">
                <div>
                  <span>Current Order</span>
                  <strong>SAR {calculateGrandTotal(orderItems, priceList).toFixed(2)}</strong>
                </div>
                <div className="moduleOrderActions">
                  <button type="button" onClick={handleSaveDraft} disabled={savingOrder || submittingOrder || downloadingPdf}>
                    {savingOrder ? "Saving..." : draftOrderId ? "Update Draft" : "Save Draft"}
                  </button>
                  <button type="button" onClick={handleSubmitOrder} disabled={savingOrder || submittingOrder || downloadingPdf}>
                    {submittingOrder ? "Submitting..." : "Submit Order"}
                  </button>
                </div>
              </div>
            </section>

            {lastSavedOrder && (
              <section className="moduleSection moduleReviewSection">
                <div className="moduleSectionHeader">
                  <h2>Saved Order Review</h2>
                  <span>{lastSavedOrder.statusLabel}</span>
                </div>

                <div className="moduleReviewMeta">
                  <div>
                    <span>Order ID</span>
                    <strong>#{lastSavedOrder.orderId}</strong>
                  </div>
                  <div>
                    <span>Customer</span>
                    <strong>{lastSavedOrder.customerCode} - {lastSavedOrder.customerName}</strong>
                  </div>
                  <div>
                    <span>Saved At</span>
                    <strong>{new Date(lastSavedOrder.savedAtIso).toLocaleString("en-GB")}</strong>
                  </div>
                  <div>
                    <span>Total</span>
                    <strong>{formatMoney(lastSavedOrder.grandTotal)}</strong>
                  </div>
                </div>

                <div className="moduleTableWrap">
                  <table className="moduleTable">
                    <thead>
                      <tr>
                        <th>Item Code</th>
                        <th>Item Name</th>
                        <th>Qty</th>
                        <th>Rate</th>
                        <th>Line Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lastSavedOrder.lines.map((line) => (
                        <tr key={`${lastSavedOrder.orderId}-${line.item_code}`}>
                          <td>{line.item_code}</td>
                          <td>{line.item_name}</td>
                          <td>{line.quantity}</td>
                          <td>{formatMoney(line.rate)}</td>
                          <td>{formatMoney(line.lineTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="moduleReviewActions">
                  <button
                    type="button"
                    className="moduleInlineButton"
                    disabled={downloadingPdf}
                    onClick={() => downloadOrderPdf(lastSavedOrder)}
                  >
                    {downloadingPdf ? "Preparing PDF..." : "Download PDF Again"}
                  </button>
                  <a className="moduleShareLink" href={emailShareUrl}>Share via Email</a>
                  <a className="moduleShareLink" href={whatsappShareUrl} target="_blank" rel="noreferrer">
                    Share via WhatsApp
                  </a>
                </div>

                <p className="moduleReviewNote">
                  PDF downloads automatically after save/submit. Attach the downloaded file in Email or WhatsApp before sending.
                </p>
              </section>
            )}
          </>
        )}

        <section className="moduleSection">
          <div className="moduleSectionHeader">
            <h2>Previous Drafts</h2>
          </div>
          <div className="moduleTableWrap">
            <table className="moduleTable">
              <thead>
                <tr>
                  <th>Draft ID</th>
                  <th>Customer</th>
                  <th>Updated</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {previousDrafts.map((draft) => (
                  <tr key={draft.id}>
                    <td>{draft.id}</td>
                    <td>{draft.customer_name || draft.customer_code}</td>
                    <td>{draft.updated_at ? new Date(draft.updated_at).toLocaleString("en-GB") : "-"}</td>
                    <td>
                      <button
                        type="button"
                        className="moduleInlineButton"
                        onClick={() => setSelectedCustomerCode(draft.customer_code)}
                      >
                        Open Draft
                      </button>
                    </td>
                  </tr>
                ))}
                {previousDrafts.length === 0 && (
                  <tr>
                    <td colSpan={4}>No draft orders found.</td>
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
