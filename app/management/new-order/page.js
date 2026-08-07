"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { getSupabaseClient } from "../../lib/supabase";
import { fetchSalesScope } from "../../lib/salesScope";
import { PRICE_CACHE_KEY } from "../../lib/priceApiConfig";
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
import { sortBucketLabels, toNumber as parseOutstandingNumber } from "../../lib/outstanding";

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
  return `SAR ${Number(value || 0).toFixed(2)}`;
}

function formatAmount(value) {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatCount(value) {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatHistoryChange(change) {
  if (!change) return "";

  const baseLabel = `${change.item_code || "-"} ${change.item_name || ""}`.trim();
  if (change.type === "ADDED") {
    return `${baseLabel}: added ${change.after_quantity || 0} qty at SAR ${Number(change.after_rate || 0).toFixed(2)}`;
  }
  if (change.type === "REMOVED") {
    return `${baseLabel}: removed ${change.before_quantity || 0} qty`;
  }

  const parts = [];
  if (Number(change.before_quantity || 0) !== Number(change.after_quantity || 0)) {
    parts.push(`qty ${change.before_quantity || 0} -> ${change.after_quantity || 0}`);
  }
  if (Number(change.before_rate || 0) !== Number(change.after_rate || 0)) {
    parts.push(`rate SAR ${Number(change.before_rate || 0).toFixed(2)} -> SAR ${Number(change.after_rate || 0).toFixed(2)}`);
  }
  return `${baseLabel}: ${parts.join(", ")}`;
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function toNumber(value) {
  const cleaned = String(value ?? "")
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "")
    .trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizePriceMap(rawMap) {
  const normalized = {};
  if (!rawMap || typeof rawMap !== "object") return normalized;

  Object.entries(rawMap).forEach(([rawCode, rawRate]) => {
    const code = normalizeCode(rawCode);
    if (!code) return;

    const nextRate = toNumber(rawRate);
    const currentRate = toNumber(normalized[code]);

    if (currentRate > 0 && nextRate <= 0) return;
    normalized[code] = nextRate;
  });

  return normalized;
}

function normalizeSheetItems(rawItems) {
  if (!Array.isArray(rawItems)) return [];

  return rawItems
    .map((item) => {
      const code = normalizeCode(item?.item_code);
      if (!code) return null;

      return {
        ...item,
        item_code: code,
        item_name: normalizeText(item?.item_name) || code,
        category: normalizeText(item?.category) || "Unclassified",
      };
    })
    .filter(Boolean);
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
  if (isDoNotUseItem(text)) return false;
  if (looksLikeItemCode(text)) return false;
  if (normalizeCode(text) === normalizeCode(itemCode)) return false;
  return true;
}

function isExcludedItemCode(value) {
  return normalizeCode(value).startsWith("LP");
}

function isExcludedCategory(value) {
  const compact = normalizeText(value).toLowerCase().replace(/[^a-z]/g, "");
  return ["buildingmaterial", "buildingmaterials", "buidingmaterial", "buidingmaterials"].includes(compact);
}

const NEEDS_MAPPING_CATEGORY = "Needs Mapping";

function normalizeCategoryKey(value) {
  return normalizeText(value).replace(/\s+/g, " ").toLowerCase();
}

function normalizeCategoryLabel(value) {
  const text = normalizeText(value).replace(/\s+/g, " ");
  if (!text) return "Unclassified";

  if (normalizeCategoryKey(text) === normalizeCategoryKey(NEEDS_MAPPING_CATEGORY)) {
    return NEEDS_MAPPING_CATEGORY;
  }

  return text
    .split(" ")
    .map((word) => (word.toUpperCase() === "POS"
      ? "POS"
      : `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`))
    .join(" ");
}

function isSameCategory(left, right) {
  return normalizeCategoryKey(left) === normalizeCategoryKey(right);
}

async function fetchItemCategoryLookup(supabase, scope) {
  const pageSize = 1000;
  let from = 0;
  const lookup = new Map();

  while (true) {
    let query = supabase
      .from("sales_raw")
      .select("item_code,item_name,category,transaction_date,id,salesman_code")
      .order("transaction_date", { ascending: false, nullsFirst: false })
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
      if (lookup.has(code)) return;

      lookup.set(code, {
        item_name: normalizeText(row.item_name),
        category: normalizeText(row.category),
      });
    });

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return lookup;
}

async function fetchItemsMasterCatalog(supabase) {
  const { data, error } = await supabase
    .from("items_master")
    .select("item_code,item_name,category")
    .order("item_name");

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function fetchVisibleCustomers(token) {
  const response = await fetch("/api/customers/visible", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const payload = await response.json();
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

function NewOrderPageContent() {
  const searchParams = useSearchParams();
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
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
  const [priceStatus, setPriceStatus] = useState({
    source: "",
    syncedAt: "",
    isStale: false,
  });

  useEffect(() => {
    const customerCode = String(searchParams?.get("customer_code") || "").trim();
    const customerName = String(searchParams?.get("customer_name") || "").trim();
    const salesmanCode = String(searchParams?.get("salesman_code") || "").trim();
    const orderId = String(searchParams?.get("order_id") || "").trim();

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
  }, [searchParams]);

  const mergedItemsMaster = useMemo(() => {
    const itemMap = new Map();

    (itemsMaster || []).forEach((item) => {
      const code = normalizeCode(item.item_code);
      if (!code) return;
      if (isExcludedItemCode(code)) return;

      const itemName = normalizeText(item.item_name);
      const itemCategory = normalizeText(item.category);
      const sheetFallback = (priceSheetItems || []).find((sheetItem) => normalizeCode(sheetItem.item_code) === code) || {};

      const nextName = hasMeaningfulItemName(itemName, code)
        ? itemName
        : (hasMeaningfulItemName(sheetFallback.item_name, code) ? normalizeText(sheetFallback.item_name) : code);
      const nextCategory = hasMeaningfulValue(itemCategory)
        ? itemCategory
        : (hasMeaningfulValue(sheetFallback.category) ? sheetFallback.category : "Unclassified");

      if (isExcludedCategory(nextCategory)) return;

      itemMap.set(code, {
        item_code: code,
        item_name: nextName,
        category: normalizeCategoryLabel(nextCategory),
        source: "ITEMS_MASTER",
      });
    });

    const sheetByCode = new Map();
    (priceSheetItems || []).forEach((sheetItem) => {
      const code = normalizeCode(sheetItem.item_code);
      if (!code) return;

      const candidateName = normalizeText(sheetItem.item_name);
      const candidateCategory = normalizeText(sheetItem.category);
      const existing = sheetByCode.get(code);

      if (!existing) {
        sheetByCode.set(code, {
          item_name: candidateName,
          category: candidateCategory,
        });
        return;
      }

      const existingNameScore = hasMeaningfulItemName(existing.item_name, code) ? 2 : (normalizeText(existing.item_name) ? 1 : 0);
      const candidateNameScore = hasMeaningfulItemName(candidateName, code) ? 2 : (candidateName ? 1 : 0);
      const existingCategoryScore = hasMeaningfulValue(existing.category) ? 1 : 0;
      const candidateCategoryScore = hasMeaningfulValue(candidateCategory) ? 1 : 0;

      if ((candidateNameScore + candidateCategoryScore) > (existingNameScore + existingCategoryScore)) {
        sheetByCode.set(code, {
          item_name: candidateName,
          category: candidateCategory,
        });
      }
    });

    sheetByCode.forEach((sheetItem, code) => {
      if (!code || itemMap.has(code)) return;
      if (isExcludedItemCode(code)) return;

      const price = toNumber(priceList[code]);
      if (price <= 0) return;

      const sheetCategory = normalizeText(sheetItem.category) || "Unclassified";
      if (isExcludedCategory(sheetCategory)) return;

      itemMap.set(code, {
        item_code: code,
        item_name: hasMeaningfulItemName(sheetItem.item_name, code) ? normalizeText(sheetItem.item_name) : code,
        category: normalizeCategoryLabel(sheetCategory),
        source: "PRICE_SHEET_ONLY",
      });
    });

    return Array.from(itemMap.values())
      .sort((a, b) => String(a.item_name || "").localeCompare(String(b.item_name || "")));
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
    () => {
      const keyToLabel = new Map();

      (mergedItemsMaster || []).forEach((item) => {
        const label = normalizeCategoryLabel(item.category);
        const key = normalizeCategoryKey(label);
        if (!key || keyToLabel.has(key)) return;
        keyToLabel.set(key, label);
      });

      return [
        "ALL",
        ...Array.from(keyToLabel.values()).sort((a, b) => a.localeCompare(b)),
      ];
    },
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
    () => filteredCustomers.slice(0, 100),
    [filteredCustomers]
  );

  const filteredItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    const normalizedQueryCode = normalizeCode(itemSearch);
    const includeNeedsMapping = categoryFilter === NEEDS_MAPPING_CATEGORY;

    return mergedItemsMaster.filter((item) => {
      if (categoryFilter !== "ALL" && !isSameCategory(item.category, categoryFilter)) return false;

      const matchesQuery = !q || (
        String(item.item_code || "").toLowerCase().includes(q) ||
        String(item.item_name || "").toLowerCase().includes(q) ||
        String(item.category || "").toLowerCase().includes(q)
      );

      if (item.category === NEEDS_MAPPING_CATEGORY && !includeNeedsMapping) {
        // Keep unresolved rows out of normal browsing, but allow direct code lookup.
        const isExactCodeLookup = normalizedQueryCode && normalizeCode(item.item_code) === normalizedQueryCode;
        if (!isExactCodeLookup) return false;
      }

      return matchesQuery;
    });
  }, [mergedItemsMaster, categoryFilter, itemSearch]);

  const hiddenItemCount = Math.max(0, mergedItemsMaster.length - filteredItems.length);
  const hasActiveFilters = itemSearch.trim().length > 0 || categoryFilter !== "ALL";

  const groupedItems = useMemo(() => {
    const map = new Map();

    filteredItems.forEach((item) => {
      const category = normalizeCategoryLabel(item.category || "Unclassified");
      const categoryKey = normalizeCategoryKey(category);
      const current = map.get(categoryKey) || [];
      current.push(item);
      map.set(categoryKey, current);
    });

    return Array.from(map.entries())
      .map(([categoryKey, items]) => ({
        category: normalizeCategoryLabel(items[0]?.category || categoryKey || "Unclassified"),
        items,
      }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }, [filteredItems]);

  const priceSheetOnlyItems = useMemo(
    () => mergedItemsMaster.filter((item) => {
      if (!(item.source === "PRICE_SHEET_ONLY" || item.source === "PRICE_MAP_ONLY")) return false;

      // Keep this list focused on items that actually have usable mapping metadata.
      if (item.category === NEEDS_MAPPING_CATEGORY && !hasMeaningfulItemName(item.item_name, item.item_code)) {
        return false;
      }

      return true;
    }),
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
    orderHistory,
    loadedOrderStatus,
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
    editOrderId,
  });

  const canUploadOutstanding = useMemo(() => {
    const role = String(accessScope?.role || "").toLowerCase();
    return ["admin", "manager", "invoice-maker", "invoice_maker"].includes(role);
  }, [accessScope]);

  const fetchOutstandingForCustomer = useCallback(async (customer) => {
    if (!customer) {
      setOutstandingInfo({ uploadedAt: "", fileName: "", bucketLabels: [], customer: null, customerInvoices: [], needsInvoiceRowsReupload: false, rowsCount: 0 });
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase) return;

    setOutstandingLoading(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) throw new Error("Please login again.");

      const response = await fetch(
        `${OUTSTANDING_API}?customerCode=${encodeURIComponent(customer.customer_code || "")}&customerName=${encodeURIComponent(customer.customer_name || "")}`,
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
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
      setOutstandingInfo({ uploadedAt: "", fileName: "", bucketLabels: [], customer: null, customerInvoices: [], needsInvoiceRowsReupload: false, rowsCount: 0 });
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
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Please login again.");
      }

      const formData = new FormData();
      formData.append("file", outstandingUploadFile);

      const response = await fetch(OUTSTANDING_API, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
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
        outstanding: outstandingInfo,
      };
    },
    [orderHistory, orderItems, orderSummary.itemCount, orderSummary.totalQuantity, outstandingInfo, priceList, selectedCustomer]
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
          { key: "item_code", label: "Item Code", width: 110, align: "left" },
          { key: "item_name", label: "Item Name", width: 210, align: "left" },
          { key: "quantity", label: "Qty", width: 45, align: "right" },
          { key: "rate", label: "Rate (Excl. VAT)", width: 75, align: "right" },
          { key: "lineTotal", label: "Line Total", width: 75, align: "right" },
        ];

        function formatPdfAmount(value, showZero = true) {
          const amount = Number(value || 0);
          if (!showZero && amount === 0) return "";
          return `SAR ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        }

        function formatPdfCount(value, showZero = true) {
          const count = Number(value || 0);
          if (!showZero && count === 0) return "";
          return count.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
        }

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

        if (Array.isArray(snapshot.history) && snapshot.history.length > 0) {
          let historyY = pageHeight - 110;
          doc.setFont(undefined, "bold");
          doc.text("Change History", marginX, historyY);
          historyY += 14;
          doc.setFont(undefined, "normal");

          snapshot.history.slice(-6).forEach((entry) => {
            const when = entry.changedAt || entry.savedAt || entry.saved_at || entry.timestamp || "";
            const label = `${when ? new Date(when).toLocaleString("en-GB") : "-"} • ${entry.action || "UPDATED"}`;
            const lines = [label, ...(Array.isArray(entry.changes) ? entry.changes.map(formatHistoryChange) : [])].filter(Boolean);

            lines.forEach((line) => {
              const wrapped = doc.splitTextToSize(line, pageWidth - marginX * 2 - 16);
              wrapped.forEach((part, index) => {
                doc.text(part, marginX + 8, historyY + index * 10);
              });
              historyY += Math.max(12, wrapped.length * 10);
            });

            historyY += 4;
          });
        }
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

        const statsTop = marginTop + 172;
        const statsHeight = 40;
        const stats = [
          { label: "Items", value: String(snapshot.itemCount), align: "left" },
          { label: "Total Qty", value: qtyFormat(snapshot.totalQuantity), align: "left" },
          { label: "Subtotal", value: formatMoney(subtotal), align: "right" },
          { label: "VAT 15%", value: formatMoney(vatAmount), align: "right" },
          { label: "Total Incl. VAT", value: formatMoney(totalWithVat), align: "right" },
        ];

        doc.roundedRect(marginX, statsTop, contentWidth, statsHeight, 5, 5);
        const statsWidth = contentWidth / stats.length;
        stats.forEach((stat, index) => {
          const x = marginX + index * statsWidth;

          doc.setFont(undefined, "bold");
          drawCellText(stat.label, x, statsTop + 16, statsWidth, stat.align);

          doc.setFont(undefined, "normal");
          drawCellText(stat.value, x, statsTop + 32, statsWidth, stat.align);
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

          const itemCodeCol = columns.find((column) => column.key === "item_code");
          const itemNameCol = columns.find((column) => column.key === "item_name");
          const codeForWrap = rowValues.item_code.replace(/_/g, " ");
          const nameForWrap = rowValues.item_name.replace(/_/g, " ");
          const wrappedCode = doc.splitTextToSize(codeForWrap, (itemCodeCol?.width || 110) - 12);
          const wrappedName = doc.splitTextToSize(nameForWrap, (itemNameCol?.width || 210) - 12);
          const codeLines = Array.isArray(wrappedCode) ? wrappedCode : [codeForWrap];
          const nameLines = Array.isArray(wrappedName) ? wrappedName : [nameForWrap];
          const lineCount = Math.max(codeLines.length, nameLines.length);
          const rowHeight = Math.max(24, lineCount * 12 + 8);

          if (y + rowHeight > pageHeight - 110) {
            doc.addPage();
            y = drawTableHeader(marginTop);
          }

          let colX = tableStartX;
          columns.forEach((column) => {
            doc.rect(colX, y, column.width, rowHeight);

            if (column.key === "item_code") {
              codeLines.forEach((codeLine, index) => {
                drawCellText(codeLine, colX, y + 14 + index * 12, column.width, column.align);
              });
            } else if (column.key === "item_name") {
              nameLines.forEach((nameLine, index) => {
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

        const outstandingCustomer = snapshot?.outstanding?.customer;
        const outstandingBuckets = sortBucketLabels(snapshot?.outstanding?.bucketLabels || []);
        if (outstandingCustomer && outstandingBuckets.length > 0) {
          let outstandingY = summaryY + 88;
          if (outstandingY > pageHeight - 170) {
            doc.addPage();
            outstandingY = marginTop;
          }

          doc.setFont(undefined, "bold");
          doc.setFontSize(11);
          doc.text("Outstanding Buckets", marginX, outstandingY);
          doc.setFont(undefined, "normal");
          doc.setFontSize(10);

          const tableX = marginX;
          const tableW = Math.min(360, contentWidth);
          const labelW = Math.floor(tableW * 0.6);
          const valueW = tableW - labelW;
          let tableY = outstandingY + 10;

          const rows = [
            ...outstandingBuckets.map((label) => ({
              label: `${label} days`,
              value: formatPdfAmount(parseOutstandingNumber(outstandingCustomer?.buckets?.[label]), false),
            })),
            { label: "Open invoices", value: formatPdfCount(parseOutstandingNumber(outstandingCustomer?.open_invoices), false) },
            { label: "Total outstanding", value: formatPdfAmount(parseOutstandingNumber(outstandingCustomer?.total_outstanding), false) },
          ];

          rows.forEach((row, index) => {
            const rowHeight = 18;
            doc.rect(tableX, tableY, labelW, rowHeight);
            doc.rect(tableX + labelW, tableY, valueW, rowHeight);
            doc.text(row.label, tableX + 6, tableY + 12);
            if (index === rows.length - 1) {
              doc.setFont(undefined, "bold");
            }
            doc.text(row.value, tableX + labelW + valueW - 6, tableY + 12, { align: "right" });
            if (index === rows.length - 1) {
              doc.setFont(undefined, "normal");
            }
            tableY += rowHeight;
          });

          const invoiceRows = Array.isArray(snapshot?.outstanding?.customerInvoices)
            ? snapshot.outstanding.customerInvoices
            : [];

          if (invoiceRows.length > 0) {
            let invoiceY = tableY + 20;
            const invoiceCols = [
              { key: "invoice_date", label: "Date", width: 72, align: "left" },
              { key: "ref_no", label: "Ref No", width: 80, align: "left" },
              { key: "pending_amount", label: "Pending", width: 84, align: "right" },
              { key: "due_date", label: "Due", width: 70, align: "left" },
              { key: "overdue_days", label: "Overdue", width: 64, align: "right" },
              { key: "invoice_day", label: "Inv Day", width: 60, align: "right" },
              { key: "salesman", label: "Salesman", width: 85, align: "left" },
            ];
            const invoiceTableWidth = invoiceCols.reduce((sum, col) => sum + col.width, 0);

            if (invoiceY + 24 > pageHeight - 110) {
              doc.addPage();
              invoiceY = marginTop;
            }

            doc.setFont(undefined, "bold");
            doc.setFontSize(11);
            doc.text("Outstanding Invoices", marginX, invoiceY);
            doc.setFontSize(9);
            doc.setFont(undefined, "normal");
            invoiceY += 8;

            const drawInvoiceHeader = (startY) => {
              let x = marginX;
              doc.setFillColor(239, 244, 245);
              doc.rect(marginX, startY, invoiceTableWidth, 20, "F");
              doc.setFont(undefined, "bold");
              invoiceCols.forEach((col) => {
                doc.rect(x, startY, col.width, 20);
                drawCellText(col.label, x, startY + 13, col.width, col.align);
                x += col.width;
              });
              doc.setFont(undefined, "normal");
              return startY + 20;
            };

            invoiceY = drawInvoiceHeader(invoiceY);

            invoiceRows.slice(0, 12).forEach((invoice) => {
              if (invoiceY + 20 > pageHeight - 110) {
                doc.addPage();
                invoiceY = drawInvoiceHeader(marginTop);
              }

              const displayRow = {
                invoice_date: String(invoice?.invoice_date || "-"),
                ref_no: String(invoice?.ref_no || "-"),
                pending_amount: formatPdfAmount(parseOutstandingNumber(invoice?.pending_amount), false),
                due_date: String(invoice?.due_date || "-"),
                overdue_days: formatPdfCount(parseOutstandingNumber(invoice?.overdue_days), false),
                invoice_day: formatPdfCount(parseOutstandingNumber(invoice?.invoice_day), false),
                salesman: String(invoice?.salesman || "-"),
              };

              let x = marginX;
              invoiceCols.forEach((col) => {
                doc.rect(x, invoiceY, col.width, 20);
                drawCellText(displayRow[col.key], x, invoiceY + 13, col.width, col.align);
                x += col.width;
              });

              invoiceY += 20;
            });

            if (invoiceRows.length > 12) {
              doc.setFontSize(8);
              doc.text(`Showing 12 of ${invoiceRows.length} invoice row(s).`, marginX, invoiceY + 12);
              doc.setFontSize(10);
            }
          }
        }

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

        let draftsQuery = supabase
          .from("sales_orders")
          .select("id,customer_code,customer_name,updated_at,status")
          .eq("status", "DRAFT")
          .order("updated_at", { ascending: false });

        if (!scope.hasAllAccess) {
          draftsQuery = draftsQuery.in("created_by", scope.visibleUserIds);
        }

        const [loadedCustomers, itemsRes, draftsRes] = await Promise.all([
          fetchVisibleCustomers(session.access_token),
          fetchItemsMasterCatalog(supabase),
          draftsQuery,
        ]);

        if (itemsRes.error) throw itemsRes.error;
        if (draftsRes.error) throw draftsRes.error;

        const mergedCustomers = prefilledCustomer && !loadedCustomers.some((customer) => customer.customer_code === prefilledCustomer.customer_code)
          ? [prefilledCustomer, ...loadedCustomers]
          : loadedCustomers;

        setCustomers(mergedCustomers);
        setItemsMaster(itemsRes || []);
        setPreviousDrafts(draftsRes.data || []);
      } catch (err) {
        setError(err.message || "Unable to load new order data.");
      } finally {
        setLoading(false);
      }
    }

    async function loadPrices() {
      try {
        const response = await fetch(PRICE_CACHE_API, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Price API failed with ${response.status}`);
        }

        const data = await response.json();
        const parsed = data && typeof data === "object" && data.priceMap && typeof data.priceMap === "object"
          ? {
              priceMap: normalizePriceMap(data.priceMap),
              sheetItems: normalizeSheetItems(data.sheetItems),
            }
          : parsePricePayload(data || {});
        if (Object.keys(parsed.priceMap || {}).length === 0) {
          throw new Error("Price cache returned no prices");
        }

        setPriceList(normalizePriceMap(parsed.priceMap));
        setPriceSheetItems(normalizeSheetItems(parsed.sheetItems));
        setPriceStatus({
          source: String(data?.source || "api").trim() || "api",
          syncedAt: String(data?.syncedAt || "").trim(),
          isStale: Boolean(data?.isStale),
        });
        window.localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify(parsed));
      } catch {
        try {
          const cached = JSON.parse(window.localStorage.getItem(PRICE_CACHE_KEY) || "null");
          if (cached?.priceMap && Object.keys(cached.priceMap).length > 0) {
            setPriceList(normalizePriceMap(cached.priceMap));
            setPriceSheetItems(normalizeSheetItems(cached.sheetItems));
            setPriceStatus({
              source: "local-cache",
              syncedAt: String(cached?.syncedAt || "").trim(),
              isStale: false,
            });
          }
        } catch {
          // Keep previously loaded prices if cache is unavailable.
        }
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
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) {
          throw new Error("Please login again.");
        }

        const response = await fetch(
          `${CUSTOMER_HISTORY_API}?customerCode=${encodeURIComponent(selectedCustomer.customer_code)}`,
          {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
          }
        );

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || "Unable to load customer audit history.");
        }

        setTransactions(Array.isArray(payload.transactions) ? payload.transactions : []);
        setPeerTransactions(Array.isArray(payload.peerTransactions) ? payload.peerTransactions : []);
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

  useEffect(() => {
    fetchOutstandingForCustomer(selectedCustomer);
  }, [fetchOutstandingForCustomer, selectedCustomer]);

  const visibleOutstandingBuckets = useMemo(
    () => (outstandingInfo.bucketLabels || []).filter(
      (label) => parseOutstandingNumber(outstandingInfo.customer?.buckets?.[label]) !== 0
    ),
    [outstandingInfo.bucketLabels, outstandingInfo.customer]
  );

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

  const priceStatusText = (() => {
    if (!priceStatus.source) return "Price source: unavailable";
    const parts = [`Price source: ${priceStatus.source}`];
    if (priceStatus.syncedAt) {
      const dateText = new Date(priceStatus.syncedAt).toLocaleString("en-GB");
      if (dateText && dateText !== "Invalid Date") {
        parts.push(`Synced: ${dateText}`);
      }
    }
    if (priceStatus.isStale) {
      parts.push("Status: stale");
    }
    return parts.join(" | ");
  })();

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
  <div className="moduleHint">{priceStatusText}</div>

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

          {!selectedCustomer && <div className="moduleHint">Select a customer to view 30-day outstanding buckets.</div>}

          {selectedCustomer && outstandingLoading && <div className="moduleLoading">Loading outstanding buckets...</div>}

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
                        <td key={`bucket-val-${label}`}>{formatAmount(parseOutstandingNumber(outstandingInfo.customer?.buckets?.[label]))}</td>
                      ))}
                      <td>{formatCount(parseOutstandingNumber(outstandingInfo.customer?.open_invoices))}</td>
                      <td>{formatAmount(parseOutstandingNumber(outstandingInfo.customer?.total_outstanding))}</td>
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
                        <td>{formatAmount(parseOutstandingNumber(invoice.pending_amount))}</td>
                        <td>{invoice.due_date || "-"}</td>
                        <td>{formatCount(parseOutstandingNumber(invoice.overdue_days))}</td>
                        <td>{formatCount(parseOutstandingNumber(invoice.invoice_day))}</td>
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
          <div className="moduleFilterRow">
            <input
              className="moduleInput"
              type="text"
              placeholder="Search customer by code or name"
              list="customer-name-suggestions"
              value={customerSearch}
              onChange={(event) => setCustomerSearch(event.target.value)}
            />
            <datalist id="customer-name-suggestions">
              {customerNameSuggestions.map((customer) => (
                <option
                  key={`name-suggest-${customer.customer_code}`}
                  value={customer.customer_name || ""}
                  label={customer.customer_code || ""}
                />
              ))}
            </datalist>
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
                  {filteredItems.length} visible of {mergedItemsMaster.length} catalog items • {orderSummary.itemCount} selected • {qtyFormat(orderSummary.totalQuantity)} units
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

              {hiddenItemCount > 0 && (
                <div className="moduleHint">
                  {hiddenItemCount} item(s) are hidden by current view rules
                  {hasActiveFilters ? " (search/category filters)." : " (mostly unresolved mapping items)."}
                  {hasActiveFilters && (
                    <button
                      type="button"
                      className="moduleInlineButton"
                      onClick={() => {
                        setItemSearch("");
                        setCategoryFilter("ALL");
                      }}
                      style={{ marginLeft: "8px" }}
                    >
                      Reset Filters
                    </button>
                  )}
                </div>
              )}

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
                            <strong>
                              {normalizeCode(item.item_name) === normalizeCode(item.item_code)
                                ? item.item_code
                                : item.item_name}
                            </strong>
                            {normalizeCode(item.item_name) !== normalizeCode(item.item_code) && (
                              <div className="moduleCode">{item.item_code}</div>
                            )}
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

export default function NewOrderPage() {
  return (
    <Suspense fallback={<main className="modulePage"><div className="moduleShell"><div className="moduleLoading">Loading order workspace...</div></div></main>}>
      <NewOrderPageContent />
    </Suspense>
  );
}
