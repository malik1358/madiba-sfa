"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import MostVisitedPages from "../../components/MostVisitedPages";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { getSupabaseClient } from "../../lib/supabase";
import { fetchSalesScope } from "../../lib/salesScope";
import { PRICE_CACHE_KEY } from "../../lib/priceApiConfig";
import { loadPricePayload } from "../../lib/pricePayload";
import { addPdfBuildFooter } from "../../lib/buildInfo";
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
import { sortBucketLabels, toNumber as parseOutstandingNumber, visibleOutstandingBucketLabels } from "../../lib/outstanding";
import { usePopupMessages } from "../../hooks/usePopupMessages";
import { useNearestCustomerSuggestions } from "../../hooks/useNearestCustomerSuggestions";
import NearestCustomerSuggestions from "../../components/NearestCustomerSuggestions";
import { buildOrderPdfFileName, saveOrShareOrderPdf } from "../../lib/orderPdfExport";

const PRICE_CACHE_API = "/api/pricing/cache";
const CUSTOMER_HISTORY_API = "/api/customer-history";
const OUTSTANDING_API = "/api/outstanding";

const TEXT = {
  title: { en: "New Order", ar: "طلب جديد" },
  subtitle: { en: "Create, save draft, and submit customer orders", ar: "إنشاء طلبات العملاء وحفظها وإرسالها" },
  dashboard: { en: "← Dashboard", ar: "← الرئيسية" },
  loading: { en: "Loading order workspace...", ar: "جاري تحميل مساحة الطلبات..." },
};

function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatReceivableMoney(value) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

async function waitForAccessToken(supabase, attempts = 8, delayMs = 250) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session?.access_token) {
      return session.access_token;
    }

    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return null;
}

function formatHistoryChange(change) {
  if (!change) return "";

  const baseLabel = `${change.item_code || "-"} ${change.item_name || ""}`.trim();
  if (change.type === "ADDED") {
    return `${baseLabel}: added ${change.after_quantity || 0} qty at ${formatMoney(change.after_rate || 0)}`;
  }
  if (change.type === "REMOVED") {
    return `${baseLabel}: removed ${change.before_quantity || 0} qty`;
  }

  const parts = [];
  if (Number(change.before_quantity || 0) !== Number(change.after_quantity || 0)) {
    parts.push(`qty ${change.before_quantity || 0} -> ${change.after_quantity || 0}`);
  }
  if (Number(change.before_rate || 0) !== Number(change.after_rate || 0)) {
    parts.push(`rate ${formatMoney(change.before_rate || 0)} -> ${formatMoney(change.after_rate || 0)}`);
  }
  return `${baseLabel}: ${parts.join(", ")}`;
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

function normalizeCategoryKey(value) {
  return normalizeText(value).replace(/\s+/g, " ").toLowerCase();
}

function normalizeCategoryLabel(value) {
  const text = normalizeText(value).replace(/\s+/g, " ");
  if (!text) return "Unclassified";

  return text
    .split(" ")
    .map((word) => (word.toUpperCase() === "POS"
      ? "POS"
      : `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`))
    .join(" ");
}

function isPlaceholderValue(value) {
  const text = normalizeText(value).toUpperCase();
  if (!text) return true;
  if (/^REAL_(?:ITEM_NAME|CATEGORY)_FOR_[A-Z0-9/._-]+$/.test(text)) return true;
  return [
    "PUT_REAL_ITEM_NAME_HERE",
    "PUT_REAL_CATEGORY_HERE",
    "TO_MAP",
    "TBD",
    "TODO",
  ].includes(text);
}

function hasMeaningfulValue(value) {
  const text = normalizeText(value);
  if (!text) return false;
  if (isPlaceholderValue(text)) return false;
  return !["UNCLASSIFIED", "N/A", "NA", "-"] .includes(text.toUpperCase());
}

function hasMeaningfulItemName(value, itemCode = "") {
  const text = normalizeText(value);
  if (!text) return false;
  if (isPlaceholderValue(text)) return false;
  if (looksLikeItemCode(text)) return false;
  if (normalizeCode(text) === normalizeCode(itemCode)) return false;
  return true;
}

function hasCurrentItemName(value, itemCode = "") {
  return hasMeaningfulItemName(value, itemCode) && !isDoNotUseItem(value);
}

const MISSING_CATEGORY = "Missing Category";

async function fetchItemCategoryLookup(supabase, scope) {
  const pageSize = 1000;
  let from = 0;
  const lookup = new Map();

  while (true) {
    let query = supabase
      .from("active_sales")
      .select("id,item_code,item_name,category,salesman_code,transaction_date")
      .order("transaction_date", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + pageSize - 1);

    if (!scope.hasAllAccess) {
      query = query.in("salesman_code", scope.visibleSalesmanCodes);
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = data || [];
    rows.forEach((row) => {
      const code = normalizeCode(row.item_code);
      if (!code) return;

      const current = lookup.get(code) || { item_name: "", category: "" };
      const nextName = normalizeText(row.item_name);
      const nextCategory = normalizeText(row.category);

      if (!hasCurrentItemName(current.item_name, code) && hasCurrentItemName(nextName, code)) {
        current.item_name = nextName;
      }

      if (!hasMeaningfulValue(current.category) && hasMeaningfulValue(nextCategory)) {
        current.category = nextCategory;
      }

      lookup.set(code, current);
    });

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return lookup;
}

async function fetchVisibleCustomers(token) {
  const response = await fetch("/api/customers/visible", {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || "Unable to load visible customers.");
  }

  return payload.customers || [];
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

function normalizeHeaderCell(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ");
}

function findHeaderIndex(rows, aliases, maxRows = 5) {
  if (!Array.isArray(rows) || rows.length === 0) return -1;
  const normalizedAliases = aliases.map((alias) => normalizeHeaderCell(alias));
  const limit = Math.min(maxRows, rows.length);

  for (let r = 0; r < limit; r += 1) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;

    for (let c = 0; c < row.length; c += 1) {
      const cell = normalizeHeaderCell(row[c]);
      if (!cell) continue;
      if (normalizedAliases.includes(cell)) {
        return c;
      }
    }
  }

  return -1;
}

function hasDataAtIndex(rows, index, maxRows = 50) {
  if (!Array.isArray(rows) || index < 0) return false;
  const limit = Math.min(rows.length, maxRows);

  for (let r = 0; r < limit; r += 1) {
    const row = rows[r];
    if (!Array.isArray(row) || row.length <= index) continue;
    if (String(row[index] ?? "").trim() !== "") return true;
  }

  return false;
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
        const headerCodeIndex = findHeaderIndex(value, [
          "item code",
          "item_code",
          "code",
          "sku",
          "stock code",
        ]);
        const headerNameIndex = findHeaderIndex(value, [
          "item name",
          "item",
          "item description",
          "description",
          "product name",
        ]);
        const headerCategoryIndex = findHeaderIndex(value, [
          "item category",
          "category",
          "product category",
          "item group",
          "group",
        ]);
        const headerRateIndex = findHeaderIndex(value, [
          "rate",
          "price",
          "selling rate",
          "unit price",
        ]);

        const codeColumnIndex = sheetColumnIndex("B");
        const nameColumnIndex = sheetColumnIndex("C");
        const categoryColumnIndex = sheetColumnIndex("CO");
        const rateColumnIndex = sheetColumnIndex("D");

        const itemCodeIndex = hasDataAtIndex(value, codeColumnIndex) ? codeColumnIndex : headerCodeIndex;
        const itemNameIndex = hasDataAtIndex(value, nameColumnIndex) ? nameColumnIndex : headerNameIndex;
        const categoryIndex = hasDataAtIndex(value, categoryColumnIndex) ? categoryColumnIndex : headerCategoryIndex;
        const rateIndex = hasDataAtIndex(value, rateColumnIndex) ? rateColumnIndex : headerRateIndex;

        value.forEach((row) => {
          const isHeaderRow = Array.isArray(row)
            && row.some((cell) => {
              const header = normalizeHeaderCell(cell);
              return ["item code", "item name", "item", "rate", "price", "category", "item category"].includes(header);
            });
          if (isHeaderRow) return;

          const explicitCode = itemCodeIndex >= 0 ? normalizeCode(sheetCell(row, itemCodeIndex)) : "";
          const codeCandidates = row.filter((cell) => looksLikeItemCode(cell)).map((cell) => normalizeCode(cell));
          const code = explicitCode || codeCandidates.find(Boolean) || "";
          const codeCellIndex = explicitCode
            ? itemCodeIndex
            : row.findIndex((cell) => normalizeCode(cell) === code);

          const explicitName = itemNameIndex >= 0 ? normalizeText(sheetCell(row, itemNameIndex)) : "";
          const nameCandidate = explicitName || row
            .map((cell, index) => ({ cell, index }))
            .filter(({ cell, index }) => index !== codeCellIndex && looksLikeItemName(cell))
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
      const code = readAny(value, ["item_code", "itemCode", "code", "B", "Item Code", "ITEM CODE", "sku", "SKU"]);
      const name = readAny(value, ["item_name", "itemName", "name", "C", "Item Name", "ITEM NAME", "description", "Description"]);
      const category = readAny(value, ["category", "item_category", "CO", "Category", "ITEM CATEGORY", "Item Category", "group", "Group", "item_group", "Item Group"]);
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
  const router = useRouter();
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  usePopupMessages({ message, error });
  const [customers, setCustomers] = useState([]);
  const [itemsMaster, setItemsMaster] = useState([]);
  const [priceSheetItems, setPriceSheetItems] = useState([]);
  const [historyCategoryLookup, setHistoryCategoryLookup] = useState(new Map());
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
  const [outstandingUploadFile, setOutstandingUploadFile] = useState(null);
  const [outstandingUploading, setOutstandingUploading] = useState(false);
  const [outstandingLoading, setOutstandingLoading] = useState(false);
  const [outstandingInfo, setOutstandingInfo] = useState({
    uploadedAt: "",
    fileName: "",
    bucketLabels: [],
    customer: null,
    customerInvoices: [],
    needsInvoiceRowsReupload: false,
    rowsCount: 0,
  });
  const [accessScope, setAccessScope] = useState(null);
  const [prefilledCustomer, setPrefilledCustomer] = useState(null);
  const [editOrderId, setEditOrderId] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const customerCode = String(params.get("customer_code") || "").trim();
    const customerName = String(params.get("customer_name") || "").trim();
    const salesmanCode = String(params.get("salesman_code") || "").trim();
    const orderId = String(params.get("order_id") || "").trim();

    if (!customerCode || !customerName) {
      setPrefilledCustomer(null);
    } else {
      setPrefilledCustomer({
        customer_code: customerCode,
        customer_name: customerName,
        current_salesman_code: salesmanCode,
      });
    }

    setEditOrderId(orderId);
  }, []);

  const mergedItemsMaster = useMemo(() => {
    const itemMap = new Map();

    (itemsMaster || []).forEach((item) => {
      const code = normalizeCode(item.item_code);
      if (!code) return;
      const historyFallback = historyCategoryLookup.get(code) || {};

      itemMap.set(code, {
        ...item,
        item_code: code,
        item_name: String(historyFallback.item_name || item.item_name || code).trim(),
        category: String(item.category || historyFallback.category || "Unclassified").trim() || "Unclassified",
        source: "ITEM_MASTER",
      });
    });

    (priceSheetItems || []).forEach((sheetItem) => {
      const code = normalizeCode(sheetItem.item_code);
      if (!code) return;

      const existing = itemMap.get(code);
      if (!existing) {
        const historyFallback = historyCategoryLookup.get(code) || {};
        const historyName = normalizeText(historyFallback.item_name);
        const sheetName = normalizeText(sheetItem.item_name);
        const historyCategory = normalizeText(historyFallback.category);
        const sheetCategory = normalizeText(sheetItem.category);
        const nextName = hasCurrentItemName(historyName, code)
          ? historyName
          : (hasCurrentItemName(sheetName, code) ? sheetName : code);
        const nextCategory = hasMeaningfulValue(sheetCategory)
          ? sheetCategory
          : (hasMeaningfulValue(historyCategory) ? historyCategory : MISSING_CATEGORY);

        itemMap.set(code, {
          item_code: code,
          item_name: nextName,
          category: nextCategory,
          source: "PRICE_SHEET_ONLY",
        });
        return;
      }

      const existingName = normalizeText(existing.item_name);
      const sheetName = normalizeText(sheetItem.item_name);
      const existingCategory = normalizeText(existing.category);
      const sheetCategory = normalizeText(sheetItem.category);
      const historyFallback = historyCategoryLookup.get(code) || {};
      const historyName = normalizeText(historyFallback.item_name);

      const nextName = hasCurrentItemName(historyName, code)
        ? historyName
        : (hasCurrentItemName(sheetName, code)
          ? sheetName
          : (hasCurrentItemName(existingName, code) ? existingName : code));
      const nextCategory = hasMeaningfulValue(sheetCategory)
        ? sheetCategory
        : (hasMeaningfulValue(existingCategory) ? existingCategory : (historyFallback.category || "Unclassified"));

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
      const historyFallback = historyCategoryLookup.get(code) || {};

      const fallbackName = hasCurrentItemName(historyFallback.item_name, code)
        ? historyFallback.item_name
        : "";
      const fallbackCategory = historyFallback.category || "";

      itemMap.set(code, {
        item_code: code,
        item_name: fallbackName || code,
        category: hasMeaningfulValue(fallbackCategory) ? fallbackCategory : MISSING_CATEGORY,
        source: "PRICE_MAP_ONLY",
      });
    });

    return Array.from(itemMap.values())
      .filter((item) => !isDoNotUseItem(item.item_name))
      .sort((a, b) => String(a.item_name || "").localeCompare(String(b.item_name || "")));
  }, [historyCategoryLookup, itemsMaster, priceSheetItems, priceList]);

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
      ...new Set(
        mergedItemsMaster
          .map((item) => normalizeCategoryLabel(normalizeText(item.category) || "Unclassified"))
          .filter(Boolean)
      ).values(),
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

  const customerNameSuggestions = useMemo(
    () => customerSearch.trim() ? filteredCustomers.slice(0, 10) : [],
    [customerSearch, filteredCustomers]
  );

  const {
    suggestions: nearestCustomerSuggestions,
    loading: nearestCustomersLoading,
    locationUnavailable: nearestCustomersUnavailable,
    refresh: refreshNearestCustomers,
  } = useNearestCustomerSuggestions(customers);

  const filteredItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();

    return mergedItemsMaster.filter((item) => {
      if (categoryFilter !== "ALL" && normalizeCategoryLabel(normalizeText(item.category) || "Unclassified") !== categoryFilter) return false;

      return !q || (
        String(item.item_code || "").toLowerCase().includes(q) ||
        String(item.item_name || "").toLowerCase().includes(q) ||
        String(item.category || "").toLowerCase().includes(q)
      );
    });
  }, [mergedItemsMaster, categoryFilter, itemSearch]);

  const groupedItems = useMemo(() => {
    const map = new Map();

    filteredItems.forEach((item) => {
      const category = normalizeCategoryLabel(normalizeText(item.category) || "Unclassified");
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

  const visibleOutstandingBuckets = useMemo(
    () => visibleOutstandingBucketLabels(
      outstandingInfo.bucketLabels,
      outstandingInfo.customer?.buckets
    ),
    [outstandingInfo.bucketLabels, outstandingInfo.customer]
  );

  const canUploadOutstanding = useMemo(() => {
    const role = String(accessScope?.role || "").toLowerCase();
    return ["admin", "manager", "invoice-maker", "invoice_maker"].includes(role);
  }, [accessScope]);

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

  function selectCustomer(customerCode, customerName = "") {
    setSelectedCustomerCode(customerCode);
    if (customerName) setCustomerSearch(customerName);
    setError("");
    setMessage("");
    setLastSavedOrder(null);
    setShowTransactions(false);
    setAuditExpandedCategories({});
  }

  const orderAnalytics = useMemo(
    () => (analytics ? { ...analytics, items: analytics.items || mergedItemsMaster } : null),
    [analytics, mergedItemsMaster],
  );

  const {
    draftOrderId,
    orderItems,
    orderSummary,
    orderQuantities,
    savingOrder,
    submittingOrder,
    orderHistory,
    loadedOrderStatus,
    updateQty,
    increaseQty,
    decreaseQty,
    saveDraft,
    submitOrder,
  } = useOrder({
    analytics: orderAnalytics,
    quickOrderAllItems,
    catalogItems: mergedItemsMaster,
    selectedCustomer,
    priceList,
    setError,
    setMessage,
    accessScope,
    editOrderId,
    language,
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
        history: orderHistory,
        outstanding: {
          bucketLabels: Array.isArray(outstandingInfo?.bucketLabels) ? outstandingInfo.bucketLabels : [],
          customer: outstandingInfo?.customer || null,
          customerInvoices: Array.isArray(outstandingInfo?.customerInvoices) ? outstandingInfo.customerInvoices : [],
        },
      };
    },
    [
      orderHistory,
      orderItems,
      orderSummary.itemCount,
      orderSummary.totalQuantity,
      outstandingInfo,
      priceList,
      selectedCustomer,
      visibleOutstandingBuckets,
    ]
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
          { key: "item_code", label: "Item Code", width: 78, align: "left" },
          { key: "item_name", label: "Item Name", width: 215, align: "left" },
          { key: "quantity", label: "Qty", width: 50, align: "right" },
          { key: "rate", label: "Rate (Excl. VAT)", width: 82, align: "right" },
          { key: "lineTotal", label: "Line Total", width: 90, align: "right" },
        ];

        const orderSummaryColumns = [
          { label: "Items", value: String(snapshot.itemCount), align: "left" },
          { label: "Total Qty", value: qtyFormat(snapshot.totalQuantity), align: "left" },
          { label: "Subtotal", value: formatMoney(subtotal), align: "left" },
          { label: "VAT 15%", value: formatMoney(vatAmount), align: "left" },
          { label: "Total Incl. VAT", value: formatMoney(totalWithVat), align: "left" },
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

        const orderSummaryY = marginTop + 172;
        const orderSummaryHeight = 40;
        const orderSummaryColWidth = contentWidth / orderSummaryColumns.length;
        doc.roundedRect(marginX, orderSummaryY, contentWidth, orderSummaryHeight, 5, 5);
        doc.setFont(undefined, "bold");
        orderSummaryColumns.forEach((col, index) => {
          const colX = marginX + index * orderSummaryColWidth;
          doc.text(col.label, colX + 8, orderSummaryY + 16);
        });
        doc.setFont(undefined, "normal");
        orderSummaryColumns.forEach((col, index) => {
          const colX = marginX + index * orderSummaryColWidth;
          doc.text(col.value, colX + 8, orderSummaryY + 32);
        });

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
        const summaryBoxHeight = 68;
        const summaryX = pageWidth - marginX - summaryBoxWidth;
        const bottomMargin = 52;
        let cursorY = y + 16;

        function ensureSpace(requiredHeight) {
          if (cursorY + requiredHeight > pageHeight - bottomMargin) {
            doc.addPage();
            cursorY = marginTop;
          }
        }

        const outstandingCustomer = snapshot.outstanding?.customer || null;
        const outstandingBuckets = Array.isArray(snapshot.outstanding?.bucketLabels) ? snapshot.outstanding.bucketLabels : [];
        const outstandingInvoices = Array.isArray(snapshot.outstanding?.customerInvoices) ? snapshot.outstanding.customerInvoices : [];

        function formatOutstandingValue(value, digits = 0, withCurrency = true) {
          const number = parseOutstandingNumber(value);
          if (number === 0) return "";
          if (withCurrency) return formatReceivableMoney(number);
          return number.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
        }

        const bucketRows = outstandingCustomer && outstandingBuckets.length > 0
          ? [
              ...outstandingBuckets.map((label) => ({
                label: `${label} days`,
                value: formatOutstandingValue(outstandingCustomer?.buckets?.[label], 0, true),
              })),
              { label: "Open invoices", value: formatOutstandingValue(outstandingCustomer?.open_invoices, 0, false) },
              { label: "Total outstanding", value: formatOutstandingValue(outstandingCustomer?.total_outstanding, 0, true) },
            ]
          : [];
        const outstandingBlockHeight = bucketRows.length > 0
          ? 14 + 10 + bucketRows.length * 18
          : 0;

        ensureSpace(Math.max(summaryBoxHeight, outstandingBlockHeight) + 16);
        const sectionY = cursorY;

        if (bucketRows.length > 0) {
          doc.setFont(undefined, "bold");
          doc.text("Outstanding Details", marginX, sectionY);
          doc.setFont(undefined, "normal");

          let bucketY = sectionY + 14;
          const labelW = 220;
          const valueW = 120;

          bucketRows.forEach((row, index) => {
            const rowH = 18;
            doc.rect(marginX, bucketY, labelW, rowH);
            doc.rect(marginX + labelW, bucketY, valueW, rowH);
            doc.text(row.label, marginX + 6, bucketY + 12);
            if (index === bucketRows.length - 1) {
              doc.setFont(undefined, "bold");
            }
            doc.text(row.value, marginX + labelW + valueW - 6, bucketY + 12, { align: "right" });
            if (index === bucketRows.length - 1) {
              doc.setFont(undefined, "normal");
            }
            bucketY += rowH;
          });

          cursorY = bucketY;
        }

        doc.roundedRect(summaryX, sectionY, summaryBoxWidth, summaryBoxHeight, 4, 4);
        doc.setFont(undefined, "normal");
        doc.text("Subtotal (Excl. VAT)", summaryX + 10, sectionY + 18);
        doc.text(formatMoney(subtotal), summaryX + summaryBoxWidth - 10, sectionY + 18, { align: "right" });
        doc.text("VAT @ 15%", summaryX + 10, sectionY + 34);
        doc.text(formatMoney(vatAmount), summaryX + summaryBoxWidth - 10, sectionY + 34, { align: "right" });
        doc.setFont(undefined, "bold");
        doc.text("Total (Incl. VAT)", summaryX + 10, sectionY + 54);
        doc.text(formatMoney(totalWithVat), summaryX + summaryBoxWidth - 10, sectionY + 54, { align: "right" });
        doc.setFont(undefined, "normal");

        cursorY = Math.max(cursorY, sectionY + summaryBoxHeight) + 24;

        if (outstandingCustomer && outstandingInvoices.length > 0) {
          ensureSpace(30);
          doc.setFont(undefined, "bold");
          doc.text("Outstanding Invoice Rows", marginX, cursorY);
          doc.setFont(undefined, "normal");

          const invoiceCols = [
            { label: "Date", width: 72 },
            { label: "Ref. No.", width: 90 },
            { label: "Pending Amount", width: 92 },
            { label: "Due Date", width: 72 },
            { label: "Overdue Days", width: 62 },
            { label: "Invoice Day", width: 62 },
            { label: "Salesman", width: 65 },
          ];
          const rowH = 18;
          let rowY = cursorY + 8;

          function drawInvoiceHeader(atY) {
            let colX = marginX;
            doc.setFont(undefined, "bold");
            doc.setFontSize(9);
            invoiceCols.forEach((col) => {
              doc.rect(colX, atY, col.width, rowH);
              doc.text(col.label, colX + 4, atY + 12);
              colX += col.width;
            });
            doc.setFont(undefined, "normal");
            return atY + rowH;
          }

          rowY = drawInvoiceHeader(rowY);

          outstandingInvoices.slice(0, 12).forEach((invoice) => {
            if (rowY > pageHeight - bottomMargin) {
              doc.addPage();
              rowY = drawInvoiceHeader(marginTop);
            }

            const values = [
              String(invoice?.invoice_date || "-"),
              String(invoice?.ref_no || "-"),
              formatOutstandingValue(invoice?.pending_amount ?? invoice?.amount, 0, false),
              String(invoice?.due_date || "-"),
              formatOutstandingValue(invoice?.overdue_days, 0, false),
              formatOutstandingValue(invoice?.invoice_day, 0, false),
              String(invoice?.salesman || "-"),
            ];

            let valueX = marginX;
            values.forEach((value, idx) => {
              const width = invoiceCols[idx].width;
              doc.rect(valueX, rowY, width, rowH);
              const rightAligned = idx === 2 || idx === 4 || idx === 5;
              if (rightAligned) doc.text(String(value), valueX + width - 4, rowY + 12, { align: "right" });
              else doc.text(String(value), valueX + 4, rowY + 12);
              valueX += width;
            });

            rowY += rowH;
          });

          doc.setFontSize(10);
          cursorY = rowY + 16;
        }

        if (Array.isArray(snapshot.history) && snapshot.history.length > 0) {
          ensureSpace(24);
          doc.setFont(undefined, "bold");
          doc.text("Change History", marginX, cursorY);
          cursorY += 18;
          doc.setFont(undefined, "normal");

          snapshot.history.slice(-6).forEach((entry) => {
            const when = entry.changedAt || entry.savedAt || entry.saved_at || entry.timestamp || "";
            const label = `${when ? new Date(when).toLocaleString("en-GB") : "-"} • ${entry.action || "UPDATED"}`;
            const lines = [label, ...(Array.isArray(entry.changes) ? entry.changes.map(formatHistoryChange) : [])].filter(Boolean);
            const entryHeight = lines.reduce((sum, line) => {
              const wrapped = doc.splitTextToSize(line, pageWidth - marginX * 2 - 16);
              return sum + Math.max(12, wrapped.length * 10);
            }, 4);

            ensureSpace(entryHeight);
            lines.forEach((line) => {
              const wrapped = doc.splitTextToSize(line, pageWidth - marginX * 2 - 16);
              wrapped.forEach((part, index) => {
                doc.text(part, marginX + 8, cursorY + index * 10);
              });
              cursorY += Math.max(12, wrapped.length * 10);
            });
            cursorY += 4;
          });
        }

        doc.setFontSize(9);
        ensureSpace(20);
        doc.text("Note: Item rates are exclusive of VAT. VAT is applied at 15% on subtotal.", marginX, pageHeight - 28);
        addPdfBuildFooter(doc);

        const fileName = buildOrderPdfFileName({
          orderId: snapshot.orderId,
          customerCode: snapshot.customerCode,
          savedAtIso: snapshot.savedAtIso,
        });
        const shareResult = await saveOrShareOrderPdf(doc, fileName, {
          title: `Order #${snapshot.orderId}`,
          text: `${snapshot.statusLabel} order for ${snapshot.customerName || snapshot.customerCode}`,
          dialogTitle: "Save or share order PDF",
        });
        return shareResult;
      } catch (error) {
        if (error?.name === "AbortError" || String(error?.message || "").toLowerCase().includes("cancel")) {
          return { method: "cancelled" };
        }
        setError("Order saved, but PDF could not be prepared. Please try Save / Share PDF again.");
        return { method: "error" };
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
    setMessage(`Draft order #${orderId} saved. Choose an app to save or share the PDF.`);
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
    const shareResult = await downloadOrderPdf(snapshot);
    if (shareResult?.method === "cancelled") {
      setMessage(`Order #${orderId} submitted. Tap Save / Share PDF to send it later.`);
      return;
    }
    setMessage(`Order #${orderId} submitted. Choose WhatsApp, Drive, Files, or another app to save or share the PDF.`);
  }, [buildOrderSnapshot, downloadOrderPdf, draftOrderId, submitOrder]);

  const shareText = useMemo(() => {
    if (!lastSavedOrder) return "";
    return `Order #${lastSavedOrder.orderId} (${lastSavedOrder.statusLabel}) for ${lastSavedOrder.customerName} - ${formatMoney(lastSavedOrder.grandTotal)}. PDF downloaded and ready to attach.`;
  }, [lastSavedOrder]);

  const fetchOutstandingForCustomer = useCallback(async (customer) => {
    if (!customer) {
      setOutstandingInfo({
        uploadedAt: "",
        fileName: "",
        bucketLabels: [],
        customer: null,
        customerInvoices: [],
        needsInvoiceRowsReupload: false,
        rowsCount: 0,
      });
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase) return;

    setOutstandingLoading(true);

    try {
      const accessToken = await waitForAccessToken(supabase);
      if (!accessToken) throw new Error("Please login again.");

      const response = await fetch(
        `${OUTSTANDING_API}?customerCode=${encodeURIComponent(customer.customer_code || "")}&customerName=${encodeURIComponent(customer.customer_name || "")}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to load outstanding data.");
      }

      setOutstandingInfo({
        uploadedAt: String(payload.uploadedAt || ""),
        fileName: String(payload.fileName || ""),
        bucketLabels: sortBucketLabels(payload.bucketLabels || []),
        customer: payload.customer || null,
        customerInvoices: Array.isArray(payload.customerInvoices) ? payload.customerInvoices : [],
        needsInvoiceRowsReupload: Boolean(payload.needsInvoiceRowsReupload),
        rowsCount: Number(payload.rowsCount || 0),
      });
    } catch (err) {
      setOutstandingInfo({
        uploadedAt: "",
        fileName: "",
        bucketLabels: [],
        customer: null,
        customerInvoices: [],
        needsInvoiceRowsReupload: false,
        rowsCount: 0,
      });
      setError(err.message || "Unable to load outstanding data.");
    } finally {
      setOutstandingLoading(false);
    }
  }, [setError]);

  const handleOutstandingUpload = useCallback(async () => {
    if (!outstandingUploadFile) {
      setError("Please select outstanding Excel file first.");
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }

    setOutstandingUploading(true);
    setError("");
    setMessage("");

    try {
      const accessToken = await waitForAccessToken(supabase);
      if (!accessToken) throw new Error("Please login again.");

      const formData = new FormData();
      formData.append("file", outstandingUploadFile);

      const response = await fetch(OUTSTANDING_API, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: formData,
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to upload outstanding file.");
      }

      setMessage(`Outstanding file uploaded. Replaced with ${payload.rowsCount || 0} customer row(s).`);
      setOutstandingUploadFile(null);
      await fetchOutstandingForCustomer(selectedCustomer);
    } catch (err) {
      setError(err.message || "Unable to upload outstanding file.");
    } finally {
      setOutstandingUploading(false);
    }
  }, [fetchOutstandingForCustomer, outstandingUploadFile, selectedCustomer, setError, setMessage]);

  const emailShareUrl = useMemo(() => {
    if (!lastSavedOrder) return "#";
    const subject = `Order #${lastSavedOrder.orderId} - ${lastSavedOrder.customerName}`;
    const body = `${shareText}\n\nUse Save / Share PDF in the app to attach the order PDF.`;
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
        const accessToken = await waitForAccessToken(supabase);

        if (!accessToken) {
          throw new Error("Please login again.");
        }

        const scope = await fetchSalesScope();
        setAccessScope(scope);

        let draftsQuery = supabase
          .from("sales_orders")
          .select("id,customer_code,customer_name,updated_at,status")
          .eq("status", "DRAFT")
          .order("updated_at", { ascending: false });

        if (!scope.hasAllAccess) {
          draftsQuery = draftsQuery.in("created_by", scope.visibleUserIds);
        }

        const [loadedCustomers, itemsRes, draftsRes] = await Promise.all([
          fetchVisibleCustomers(accessToken),
          supabase
            .from("items_master")
            .select("item_code,item_name,category")
            .order("item_name"),
          draftsQuery,
        ]);

        if (itemsRes.error) throw itemsRes.error;
        if (draftsRes.error) throw draftsRes.error;

        const mergedCustomers = prefilledCustomer && !loadedCustomers.some((customer) => customer.customer_code === prefilledCustomer.customer_code)
          ? [prefilledCustomer, ...loadedCustomers]
          : loadedCustomers;

        setCustomers(mergedCustomers);
        setItemsMaster(itemsRes.data || []);
        setPreviousDrafts(draftsRes.data || []);

        fetchItemCategoryLookup(supabase, scope)
          .then((categories) => setHistoryCategoryLookup(categories || new Map()))
          .catch(() => setHistoryCategoryLookup(new Map()));
      } catch (err) {
        setError(err.message || "Unable to load new order data.");
      } finally {
        setLoading(false);
      }
    }

    async function loadPrices() {
      try {
        const parsed = await loadPricePayload(PRICE_CACHE_API, PRICE_CACHE_KEY);
        setPriceList(parsed.priceMap || {});
        setPriceSheetItems(parsed.sheetItems || []);
      } catch {
        // Keep previously loaded prices if fresh and cached sources are unavailable.
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
        const accessToken = await waitForAccessToken(supabase);
        if (!accessToken) {
          throw new Error("Please login again.");
        }

        async function loadHistory(refresh = false) {
          const response = await fetch(
            `${CUSTOMER_HISTORY_API}?customerCode=${encodeURIComponent(selectedCustomer.customer_code)}${refresh ? "&refresh=1" : ""}`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            }
          );

          const payload = await response.json().catch(() => ({}));
          if (!response.ok || !payload.success) {
            throw new Error(payload.error || "Unable to load customer details history.");
          }

          return payload;
        }

        let payload = await loadHistory(false);
        if (!Array.isArray(payload.transactions) || payload.transactions.length === 0) {
          payload = await loadHistory(true);
        }

        setTransactions(Array.isArray(payload.transactions) ? payload.transactions : []);
        setPeerTransactions(Array.isArray(payload.peerTransactions) ? payload.peerTransactions : []);
      } catch (err) {
        setTransactions([]);
        setPeerTransactions([]);
        setError(err.message || "Unable to load customer details history.");
      } finally {
        setLoadingCustomerHistory(false);
      }
    }

    loadCustomerHistory();
  }, [accessScope, selectedCustomer, setError]);

  useEffect(() => {
    fetchOutstandingForCustomer(selectedCustomer);
  }, [fetchOutstandingForCustomer, selectedCustomer]);

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
          <div className="moduleHeaderMeta"><AppLanguageSwitch language={language} setLanguage={setLanguage} /><MostVisitedPages /><Link href="/" className="moduleBackLink">{t("dashboard")}</Link></div>
        </div>

        <section className="moduleSection">
          <div className="moduleSectionHeader">
            <h2>Outstanding Customerwise</h2>
            <span>
              {outstandingInfo.uploadedAt
                ? `Uploaded ${new Date(outstandingInfo.uploadedAt).toLocaleString("en-GB")}`
                : "No outstanding upload yet"}
            </span>
          </div>

          {canUploadOutstanding && (
            <div className="moduleFormGrid">
              <label>
                Upload Outstanding Excel (.xlsx/.xls)
                <input
                  className="moduleInput"
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(event) => setOutstandingUploadFile(event.target.files?.[0] || null)}
                />
              </label>
              <div className="moduleFieldFull">
                <button
                  type="button"
                  className="modulePrimaryButton"
                  onClick={handleOutstandingUpload}
                  disabled={outstandingUploading || !outstandingUploadFile}
                >
                  {outstandingUploading ? "Uploading outstanding..." : "Upload & Replace Outstanding Data"}
                </button>
              </div>
            </div>
          )}

          {!selectedCustomer && <div className="moduleHint">Select a customer to view outstanding details.</div>}

          {selectedCustomer && outstandingLoading && <div className="moduleLoading">Loading outstanding details...</div>}

          {selectedCustomer && !outstandingLoading && outstandingInfo.customer && (
            <>
              <div className="moduleTableWrap" style={{ marginTop: "10px" }}>
                <table className="moduleTable">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      {visibleOutstandingBuckets.map((label) => (
                        <th key={`bucket-head-${label}`}>{label} days</th>
                      ))}
                      <th>Open Invoices</th>
                      <th>Total Outstanding</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>{selectedCustomer.customer_code} - {selectedCustomer.customer_name}</td>
                      {visibleOutstandingBuckets.map((label) => (
                        <td key={`bucket-val-${label}`}>{parseOutstandingNumber(outstandingInfo.customer?.buckets?.[label]).toLocaleString("en-US", { maximumFractionDigits: 0 })}</td>
                      ))}
                      <td>{parseOutstandingNumber(outstandingInfo.customer?.open_invoices).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                      <td>{parseOutstandingNumber(outstandingInfo.customer?.total_outstanding).toLocaleString("en-US", { maximumFractionDigits: 0 })}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="moduleTableWrap" style={{ marginTop: "10px" }}>
                <table className="moduleTable">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Ref. No.</th>
                      <th>Pending Amount</th>
                      <th>Due Date</th>
                      <th>Overdue Days</th>
                      <th>Invoice Day</th>
                      <th>Salesman</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(outstandingInfo.customerInvoices || []).map((invoice, index) => (
                      <tr key={`${invoice.ref_no || "no-ref"}-${invoice.due_date || "no-due"}-${index}`}>
                        <td>{invoice.invoice_date || "-"}</td>
                        <td>{invoice.ref_no || "-"}</td>
                        <td>{parseOutstandingNumber(invoice.pending_amount).toLocaleString("en-US", { maximumFractionDigits: 0 })}</td>
                        <td>{invoice.due_date || "-"}</td>
                        <td>{parseOutstandingNumber(invoice.overdue_days).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                        <td>{parseOutstandingNumber(invoice.invoice_day).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                        <td>{invoice.salesman || "-"}</td>
                      </tr>
                    ))}
                    {(!Array.isArray(outstandingInfo.customerInvoices) || outstandingInfo.customerInvoices.length === 0) && (
                      <tr>
                        <td colSpan={7}>
                          {outstandingInfo.needsInvoiceRowsReupload
                            ? "Invoice-level rows are missing in current dataset. Re-upload the outstanding file once to include Ref No and invoice row details."
                            : "No invoice-level rows found for this customer in the latest upload."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {selectedCustomer && !outstandingLoading && !outstandingInfo.customer && (
            <div className="moduleHint">No outstanding row found for this customer in latest upload.</div>
          )}
        </section>

        <section className="moduleSection">
          <div className="moduleSectionHeader">
            <h2>Customer Search</h2>
            {editOrderId && <span>Editing order #{editOrderId}</span>}
          </div>
          <NearestCustomerSuggestions
            suggestions={nearestCustomerSuggestions}
            loading={nearestCustomersLoading}
            locationUnavailable={nearestCustomersUnavailable}
            onSelect={(customer) => selectCustomer(customer.customer_code, customer.customer_name)}
            onRefresh={refreshNearestCustomers}
            actionLabel="Select"
          />
          <div className="moduleFilterRow">
            <div className="moduleCustomerSearch">
              <input
                className="moduleInput"
                type="text"
                placeholder="Search customer by code or name"
                value={customerSearch}
                onChange={(event) => setCustomerSearch(event.target.value)}
                autoComplete="off"
              />
              {customerNameSuggestions.length > 0 && (
                <div className="moduleCustomerSuggestions">
                  {customerNameSuggestions.map((customer) => (
                    <button
                      type="button"
                      key={`name-suggest-${customer.customer_code}`}
                      onClick={() => selectCustomer(customer.customer_code, customer.customer_name)}
                    >
                      <strong>{customer.customer_name || "Unnamed customer"}</strong>
                      <span>{customer.customer_code || "-"}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <select
              className="moduleInput"
              value={selectedCustomerCode}
              onChange={(event) => selectCustomer(event.target.value)}
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
                <div className="moduleLoading">Loading customer details sections...</div>
              </section>
            )}

            {!loadingCustomerHistory && analytics && (
              <>
                <CustomerHeader customer={selectedCustomer} analytics={analytics} />
                <MonthlyPerformance analytics={analytics} />
                <CategoryPerformance
                  analytics={analytics}
                  itemCatalog={mergedItemsMaster}
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

                {Array.isArray(orderHistory) && orderHistory.length > 0 && (
                  <section className="moduleSection">
                    <div className="moduleSectionHeader">
                      <h2>Order Change History</h2>
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
                            <tr key={`${entry.changedAt || entry.savedAt || entry.saved_at || index}-${index}`}>
                              <td>{entry.changedAt ? new Date(entry.changedAt).toLocaleString("en-GB") : entry.savedAt || entry.saved_at || "-"}</td>
                              <td>{entry.action || "UPDATED"}</td>
                              <td>
                                {(Array.isArray(entry.changes) ? entry.changes : []).map((change, changeIndex) => (
                                  <div key={`${change.item_code || index}-${changeIndex}`}>{formatHistoryChange(change)}</div>
                                ))}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
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
                    {groupedItems.map((group) => {
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
                            group.items.map((item) => {
                              const qty = Number(orderQuantities[item.item_code] || 0);
                              const price = getPrice(priceList, item.item_code);
                              const nameIsCode = normalizeCode(item.item_name) === normalizeCode(item.item_code);
                              const hasSourceBadge = item.source === "PRICE_SHEET_ONLY";
                              const hasDoNotUseBadge = isDoNotUseItem(item.item_name);
                              const showMetaLine = !nameIsCode || hasSourceBadge || hasDoNotUseBadge;

                              return (
                                <tr key={item.item_code} className="moduleItemRow">
                                  <td>{item.category || "Unclassified"}</td>
                                  <td>
                                    <strong>
                                      {nameIsCode ? item.item_code : item.item_name}
                                    </strong>
                                    {showMetaLine && (
                                      <div className="moduleCode">
                                        {!nameIsCode ? item.item_code : ""}
                                        {hasSourceBadge ? " • Price Sheet" : ""}
                                        {hasDoNotUseBadge ? " • Do Not Use" : ""}
                                      </div>
                                    )}
                                  </td>
                                  <td>{price ? formatMoney(price) : "NOT FOUND"}</td>
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
                                  <td>{formatMoney(price * qty)}</td>
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

            <section className="moduleSection">
              <div className="moduleOrderBar">
                <div>
                  <span>Current Order</span>
                  <strong>{formatMoney(calculateGrandTotal(orderItems, priceList))}</strong>
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
                    className="modulePrimaryButton"
                    disabled={downloadingPdf || !lastSavedOrder}
                    onClick={() => downloadOrderPdf(lastSavedOrder)}
                  >
                    {downloadingPdf ? "Preparing PDF..." : "Save / Share PDF"}
                  </button>
                  <a className="moduleShareLink" href={emailShareUrl}>Share order details via Email</a>
                </div>

                <p className="moduleReviewNote">
                  After save or submit, Android opens a share menu so you can send the PDF to WhatsApp, save to Files/Drive, or another app.
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
                        onClick={() => {
                          const params = new URLSearchParams();
                          if (draft.id) params.set("order_id", String(draft.id));
                          if (draft.customer_code) params.set("customer_code", String(draft.customer_code));
                          if (draft.customer_name) params.set("customer_name", String(draft.customer_name));
                          if (draft.salesman_code) params.set("salesman_code", String(draft.salesman_code));
                          router.push(`/management/new-order?${params.toString()}`);
                        }}
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
