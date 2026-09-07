"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import MostVisitedPages from "../../components/MostVisitedPages";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { getSupabaseClient } from "../../lib/supabase";
import { fetchSalesScope } from "../../lib/salesScope";
import { listLocalProspectsAsCustomers } from "../../lib/offlineProspects";
import { PRICE_CACHE_KEY } from "../../lib/priceApiConfig";
import { evaluateOrderSchemes, formatSchemeDetail, lookupSchemeApplication } from "../../lib/orderSchemes";
import { isBuildingMaterialItem, loadPricePayload, pickCatalogCategory } from "../../lib/pricePayload";
import {
  buildEffectivePriceList,
  formatDiscountDetail,
  formatDiscountPercent,
  formatMoneyAmount,
  getPricedOrderLine,
  lookupDiscountRate,
  summarizePricedLines,
  normalizePaymentType,
  pricingRegionLabel,
  regionPriceMapFor,
  resolveOrderPricingRegion,
} from "../../lib/regionalPricing";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import ExportableTable from "../../components/ExportableTable";
import { useOrder } from "../customer-audit/hooks/useOrder";
import { getPrice, isDoNotUseItem } from "../customer-audit/lib/helpers";
import { qtyFormat } from "../customer-audit/lib/format";
import { useAnalytics } from "../customer-audit/hooks/useAnalytics";
import { useQuickOrder } from "../customer-audit/hooks/useQuickOrder";
import CustomerHeader from "../customer-audit/components/CustomerHeader";
import MonthlyPerformance from "../customer-audit/components/MonthlyPerformance";
import CategoryPerformance from "../customer-audit/components/CategoryPerformance";
import QuickOrder from "../customer-audit/components/QuickOrder";
import TransactionHistory from "../customer-audit/components/TransactionHistory";
import { DEFAULT_OUTSTANDING_BUCKET_LABELS, resolveOutstandingBucketLabels, sortBucketLabels, toNumber as parseOutstandingNumber, visibleOutstandingBucketLabels } from "../../lib/outstanding";
import { evaluateCreditApproval } from "../../lib/creditApproval";
import { usePopupMessages } from "../../hooks/usePopupMessages";
import { useAppPopup } from "../../components/AppPopupProvider";
import { useNearestCustomerSuggestions } from "../../hooks/useNearestCustomerSuggestions";
import NearestCustomerSuggestions from "../../components/NearestCustomerSuggestions";
import { buildOrderPdfFileName, saveOrShareOrderPdf } from "../../lib/orderPdfExport";
import { createOrderPdfDocument, formatHistoryChange, resolveLiveOrderPdfSnapshot } from "../../lib/orderPdfDocument";
import { buildOrderWhatsappSummary } from "../../lib/orderWhatsapp";
import { isNativeMobilePlatform } from "../../lib/whatsappShare";
import { isExcludedNewOrderCustomer } from "../../lib/buildingMaterialCustomerFilter";
import { processOfflineQueue } from "../../lib/offlineApi";
import { isQueuedPendingOrderId } from "../../lib/queuedSalesOrders";
import { formatSalesOrderNumber } from "../../lib/salesOrderNumber";

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

function OrderTotalsPanel({ totals, actions, remark }) {
  const cashLabel = totals.cashDiscountTotal > 0
    ? formatMoneyAmount(totals.cashDiscountTotal)
    : "None";
  const valueLabel = totals.valueDiscountTotal > 0
    ? formatMoneyAmount(totals.valueDiscountTotal)
    : "None";
  const schemeLabel = totals.schemeDiscountTotal > 0
    ? formatMoneyAmount(totals.schemeDiscountTotal)
    : "None";

  return (
    <>
      <div className="moduleOrderTotals">
        <div>
          <span>Before discount</span>
          <strong>{formatMoneyAmount(totals.wholesaleTotal)}</strong>
        </div>
        <div>
          <span>Cash discount</span>
          <strong>{cashLabel}</strong>
        </div>
        <div>
          <span>Value discount (SKU ≥ 5,000)</span>
          <strong>{valueLabel}</strong>
        </div>
        <div>
          <span>Scheme discount</span>
          <strong>{schemeLabel}</strong>
        </div>
        <div className="moduleOrderTotalsExcl">
          <span>Amount without VAT</span>
          <strong>{formatMoneyAmount(totals.amountExclVat)}</strong>
        </div>
        <div>
          <span>VAT 15%</span>
          <strong>{formatMoneyAmount(totals.vatAmount)}</strong>
        </div>
        <div className="moduleOrderTotalsIncl">
          <span>Amount after VAT</span>
          <strong>{formatMoneyAmount(totals.amountInclVat)}</strong>
        </div>
      </div>
      {actions}
      {remark}
    </>
  );
}

function PaymentTypeControl({ paymentType, onChange, pricingRegion }) {
  return (
    <div className="moduleFilterRow" style={{ marginTop: "12px" }}>
      <label>
        Payment Type
        <select
          className="moduleInput"
          value={paymentType}
          onChange={(event) => onChange(normalizePaymentType(event.target.value))}
        >
          <option value="credit">Credit</option>
          <option value="cash">Cash</option>
        </select>
      </label>
      <div className="moduleHint" style={{ alignSelf: "end", paddingBottom: "8px" }}>
        {pricingRegionLabel(pricingRegion)} prices
        {paymentType === "cash" ? " • cash discount applied when published" : ""}
        {" • value discount applies when a SKU exceeds 5,000 SAR"}
      </div>
    </div>
  );
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
  const response = await fetch("/api/customers/visible?excludeBuildingMaterial=1", {
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
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  usePopupMessages({ message, error });
  const { showPopup } = useAppPopup();
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
  const [regionPriceMaps, setRegionPriceMaps] = useState({});
  const [cashDiscountMap, setCashDiscountMap] = useState({});
  const [valueDiscountMap, setValueDiscountMap] = useState({});
  const [schemes, setSchemes] = useState([]);
  const [paymentType, setPaymentType] = useState("credit");
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
  const [customerDocumentCompliance, setCustomerDocumentCompliance] = useState(null);
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
    const excludedCodes = new Set();

    (itemsMaster || []).forEach((item) => {
      const code = normalizeCode(item.item_code);
      if (!code) return;
      const historyFallback = historyCategoryLookup.get(code) || {};
      const nextItem = {
        ...item,
        item_code: code,
        item_name: String(historyFallback.item_name || item.item_name || code).trim(),
        category: pickCatalogCategory(historyFallback.category, item.category) || "Unclassified",
        source: "ITEM_MASTER",
      };

      if (isBuildingMaterialItem(nextItem)) {
        excludedCodes.add(code);
        return;
      }

      itemMap.set(code, nextItem);
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
        const nextCategory = pickCatalogCategory(sheetCategory, historyCategory) || MISSING_CATEGORY;
        const nextItem = {
          item_code: code,
          item_name: nextName,
          category: nextCategory,
          source: "PRICE_SHEET_ONLY",
        };

        if (isBuildingMaterialItem(nextItem)) {
          excludedCodes.add(code);
          return;
        }

        itemMap.set(code, nextItem);
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
      const nextCategory = pickCatalogCategory(sheetCategory, historyFallback.category, existingCategory) || "Unclassified";
      const nextItem = {
        ...existing,
        item_name: nextName,
        category: nextCategory,
        source: existing.source === "PRICE_SHEET_ONLY" || hasMeaningfulValue(sheetCategory) ? "PRICE_SHEET" : existing.source,
      };

      if (isBuildingMaterialItem(nextItem)) {
        excludedCodes.add(code);
        itemMap.delete(code);
        return;
      }

      itemMap.set(code, nextItem);
    });

    Object.keys(priceList || {}).forEach((rawCode) => {
      const code = normalizeCode(rawCode);
      if (!code || itemMap.has(code) || excludedCodes.has(code)) return;
      const historyFallback = historyCategoryLookup.get(code) || {};

      const fallbackName = hasCurrentItemName(historyFallback.item_name, code)
        ? historyFallback.item_name
        : "";
      const fallbackCategory = historyFallback.category || "";

      itemMap.set(code, {
        item_code: code,
        item_name: fallbackName || code,
        category: pickCatalogCategory(fallbackCategory) || MISSING_CATEGORY,
        source: "PRICE_MAP_ONLY",
      });
    });

    return Array.from(itemMap.values())
      .filter((item) => !isDoNotUseItem(item.item_name) && !isBuildingMaterialItem(item))
      .sort((a, b) => String(a.item_name || "").localeCompare(String(b.item_name || "")));
  }, [historyCategoryLookup, itemsMaster, priceSheetItems, priceList]);

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.customer_code === selectedCustomerCode) || null,
    [customers, selectedCustomerCode]
  );

  const pricingRegion = useMemo(
    () => resolveOrderPricingRegion({
      currentUserRegion: accessScope?.pricingRegion,
      customerSalesmanCode: selectedCustomer?.current_salesman_code,
      pricingRegionBySalesmanCode: accessScope?.pricingRegionBySalesmanCode || {},
    }),
    [accessScope, selectedCustomer]
  );

  const regionPriceList = useMemo(
    () => regionPriceMapFor(regionPriceMaps, pricingRegion, priceList),
    [priceList, pricingRegion, regionPriceMaps]
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
      if (isExcludedNewOrderCustomer(customer)) return false;
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

  const visibleOutstandingBuckets = useMemo(() => {
    const resolved = resolveOutstandingBucketLabels(
      outstandingInfo.bucketLabels,
      outstandingInfo.customer?.buckets
    );
    const baseLabels = resolved.length ? resolved : DEFAULT_OUTSTANDING_BUCKET_LABELS;
    return visibleOutstandingBucketLabels(baseLabels, outstandingInfo.customer?.buckets);
  }, [outstandingInfo.bucketLabels, outstandingInfo.customer]);

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
    priceList: regionPriceList,
    paymentType,
    setPaymentType,
    cashDiscountMap,
    valueDiscountMap,
    schemes,
    pricingRegion,
    setError,
    setMessage,
    accessScope,
    editOrderId,
    language,
    userRole: accessScope?.role || "",
  });

  const schemeApplications = useMemo(
    () => evaluateOrderSchemes(orderQuantities || {}, schemes),
    [orderQuantities, schemes],
  );

  const displayPriceList = useMemo(
    () => buildEffectivePriceList({
      wholesaleMap: regionPriceList,
      cashDiscountMap,
      valueDiscountMap,
      paymentType,
      quantities: orderQuantities || {},
      schemeApplications,
    }),
    [cashDiscountMap, orderQuantities, paymentType, regionPriceList, schemeApplications, valueDiscountMap]
  );

  const pricedOrderLines = useMemo(
    () => (orderItems || []).map((item) => {
      const quantity = Number(item.order_quantity || 0);
      const wholesaleRate = Number(getPrice(regionPriceList, item.item_code) || 0);
      const cashDiscount = lookupDiscountRate(cashDiscountMap, item.item_code);
      const valueDiscount = lookupDiscountRate(valueDiscountMap, item.item_code);
      const scheme = lookupSchemeApplication(schemeApplications, item.item_code);
      const priced = getPricedOrderLine({
        wholesaleRate,
        quantity,
        paymentType,
        cashDiscountRate: cashDiscount,
        valueDiscountRate: valueDiscount,
        schemeUnitDiscount: scheme.unitDiscount,
        schemeDiscountedQty: scheme.discountedQty,
      });
      return {
        ...priced,
        item_code: item.item_code,
        item_name: item.item_name,
        category: item.category || "Unclassified",
        cashDiscount,
        valueDiscount,
        schemeDetail: formatSchemeDetail(scheme),
        cashApplied: priced.applied.cash,
        valueApplied: priced.applied.value,
        schemeApplied: priced.applied.scheme,
        lineTotal: priced.lineValue,
      };
    }),
    [cashDiscountMap, orderItems, paymentType, regionPriceList, schemeApplications, valueDiscountMap]
  );

  const orderTotals = useMemo(
    () => summarizePricedLines(pricedOrderLines),
    [pricedOrderLines]
  );

  const orderGrandTotal = orderTotals.amountExclVat;

  const creditApproval = useMemo(
    () => evaluateCreditApproval({
      outstanding: outstandingInfo.customer || {},
      orderValue: orderGrandTotal,
      creditApplication: customerDocumentCompliance?.creditApplication || { present: false },
      paymentType,
    }),
    [customerDocumentCompliance, orderGrandTotal, outstandingInfo.customer, paymentType]
  );

  const buildOrderSnapshot = useCallback(
    (orderId, statusLabel, orderNumber = "") => {
      if (!selectedCustomer || orderItems.length === 0) return null;

      const savedAtIso = new Date().toISOString();
      const lines = pricedOrderLines;
      const totals = summarizePricedLines(lines);

      return {
        orderId,
        orderNumber: formatSalesOrderNumber({ id: orderId, orderNumber }),
        statusLabel,
        savedAtIso,
        customerCode: selectedCustomer.customer_code,
        customerName: selectedCustomer.customer_name,
        salesmanCode: selectedCustomer.current_salesman_code,
        paymentType: normalizePaymentType(paymentType),
        pricingRegion,
        itemCount: orderSummary.itemCount,
        totalQuantity: orderSummary.totalQuantity,
        grandTotal: totals.amountExclVat,
        totals,
        lines,
        history: orderHistory,
        creditApprovalRemark: creditApproval.remark,
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
      creditApproval.remark,
      pricedOrderLines,
      paymentType,
      pricingRegion,
      selectedCustomer,
      visibleOutstandingBuckets,
    ]
  );

  const downloadOrderPdf = useCallback(
    async (snapshot, options = {}) => {
      if (!snapshot) return null;

      setDownloadingPdf(true);
      try {
        const supabase = getSupabaseClient();
        const accessToken = supabase ? await waitForAccessToken(supabase) : "";
        const { snapshot: liveSnapshot, analytics: monthlyAnalytics } = await resolveLiveOrderPdfSnapshot(snapshot, {
          accessToken,
          analyticsFallback: analytics,
          skipOutstanding: Boolean(options.fast),
          skipHistory: Boolean(options.fast),
          skipPricing: Boolean(options.fast),
        }, {
          processQueue: accessToken
            ? () => processOfflineQueue(async () => accessToken)
            : undefined,
          attempts: options.fast ? 2 : 8,
          delayMs: options.fast ? 150 : 400,
        });
        const orderNumber = formatSalesOrderNumber(liveSnapshot);
        const doc = await createOrderPdfDocument(liveSnapshot, { analytics: monthlyAnalytics });

        const fileName = buildOrderPdfFileName({
          orderId: orderNumber || "syncing",
          customerCode: liveSnapshot.customerCode || snapshot.customerCode,
          savedAtIso: new Date().toISOString(),
        });
        const summaryText = buildOrderWhatsappSummary(liveSnapshot, language);

        if (options.returnFileOnly) {
          const blob = doc.output("blob");
          return {
            method: "prepared",
            file: new File([blob], fileName, { type: "application/pdf" }),
            fileName,
            summaryText,
            snapshot: liveSnapshot,
          };
        }

        const shareResult = await saveOrShareOrderPdf(doc, fileName, {
          title: `Order #${orderNumber}`,
          text: summaryText,
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
    [analytics, language, setError]
  );

  const presentOrderWhatsappShare = useCallback(async (snapshot, { savedMessage, queued = false } = {}) => {
    if (!snapshot) return;

    setMessage("");
    setLastSavedOrder(snapshot);

    const prepared = await downloadOrderPdf(snapshot, { returnFileOnly: true, fast: true });
    if (prepared?.snapshot) {
      setLastSavedOrder(prepared.snapshot);
    }
    if (!prepared?.file) {
      showPopup({
        message: language === "ar"
          ? "تم حفظ الطلب، لكن تعذر تجهيز PDF. حاول Share PDF مرة أخرى."
          : "Order saved, but PDF could not be prepared. Tap Share PDF to try again.",
        variant: "warning",
      });
      return;
    }

    const isNative = await isNativeMobilePlatform();
    showPopup({
      message: savedMessage,
      variant: "success",
      whatsappText: prepared.summaryText,
      whatsappFile: prepared.file,
      autoShareWhatsapp: isNative || queued,
    });
  }, [downloadOrderPdf, language, showPopup]);

  const handleSaveDraft = useCallback(async () => {
    const saved = await saveDraft({ silent: true });
    if (!saved?.orderId) return;

    const snapshot = buildOrderSnapshot(saved.orderId, "Draft Saved", saved.orderNumber);
    if (!snapshot) return;

    const queued = isQueuedPendingOrderId(saved.orderId);
    const orderNumber = formatSalesOrderNumber({ id: saved.orderId, orderNumber: saved.orderNumber })
      || (queued ? (language === "ar" ? "على الجهاز" : "on this device") : "—");
    const savedMessage = queued
      ? (language === "ar"
        ? `تم حفظ مسودة الطلب #${orderNumber} على الجهاز وسيتم المزامنة تلقائياً.`
        : `Draft order #${orderNumber} saved on device and will sync automatically.`)
      : (language === "ar"
        ? `تم حفظ مسودة الطلب #${orderNumber}.`
        : `Draft order #${orderNumber} saved.`);

    await presentOrderWhatsappShare(snapshot, { savedMessage, queued });
  }, [buildOrderSnapshot, language, presentOrderWhatsappShare, saveDraft]);

  const handleSubmitOrder = useCallback(async () => {
    const saved = await submitOrder({ silent: true });
    if (!saved?.orderId) return;

    const snapshot = buildOrderSnapshot(saved.orderId, "Submitted", saved.orderNumber);
    if (!snapshot) return;

    const queued = isQueuedPendingOrderId(saved.orderId);
    const orderNumber = formatSalesOrderNumber({ id: saved.orderId, orderNumber: saved.orderNumber })
      || (queued ? (language === "ar" ? "على الجهاز" : "on this device") : "—");
    const savedMessage = queued
      ? (language === "ar"
        ? `تم حفظ الطلب #${orderNumber} على الجهاز وسيتم الإرسال عند عودة الاتصال.`
        : `Order #${orderNumber} saved on device and will submit when back online.`)
      : (language === "ar"
        ? `تم إرسال الطلب #${orderNumber}.`
        : `Order #${orderNumber} submitted.`);

    await presentOrderWhatsappShare(snapshot, { savedMessage, queued });
  }, [buildOrderSnapshot, language, presentOrderWhatsappShare, submitOrder]);

  const shareText = useMemo(() => {
    if (!lastSavedOrder) return "";
    return `Order #${formatSalesOrderNumber(lastSavedOrder) || "—"} (${lastSavedOrder.statusLabel}) for ${lastSavedOrder.customerName} - ${formatMoney(lastSavedOrder.grandTotal)}. PDF downloaded and ready to attach.`;
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

  const fetchCustomerDocuments = useCallback(async (customer) => {
    if (!customer?.customer_code) {
      setCustomerDocumentCompliance(null);
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase) return;

    try {
      const accessToken = await waitForAccessToken(supabase);
      if (!accessToken) return;

      const response = await fetch(
        `/api/customer-documents?customerCode=${encodeURIComponent(customer.customer_code)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        setCustomerDocumentCompliance(null);
        return;
      }
      setCustomerDocumentCompliance(payload.compliance || null);
    } catch {
      setCustomerDocumentCompliance(null);
    }
  }, []);

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
    const subject = `Order #${formatSalesOrderNumber(lastSavedOrder) || "—"} - ${lastSavedOrder.customerName}`;
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

        const scope = await fetchSalesScope({ forceRefresh: true });
        setAccessScope(scope);

        const [loadedCustomers, itemsRes, localProspects] = await Promise.all([
          fetchVisibleCustomers(accessToken).catch(() => []),
          supabase
            .from("items_master")
            .select("item_code,item_name,category")
            .order("item_name"),
          listLocalProspectsAsCustomers().catch(() => []),
        ]);

        if (itemsRes.error) throw itemsRes.error;

        const visibleCustomers = (loadedCustomers || []).filter((customer) => !isExcludedNewOrderCustomer(customer));
        const allowPrefilled = Boolean(prefilledCustomer)
          && (!isExcludedNewOrderCustomer(prefilledCustomer) || Boolean(editOrderId));
        const withLocalProspects = [
          ...(Array.isArray(localProspects) ? localProspects : []),
          ...visibleCustomers,
        ].filter((customer, index, rows) => {
          const code = String(customer?.customer_code || "").trim().toUpperCase();
          if (!code) return false;
          return rows.findIndex((row) => String(row?.customer_code || "").trim().toUpperCase() === code) === index;
        });
        const mergedCustomers = allowPrefilled && !withLocalProspects.some((customer) => customer.customer_code === prefilledCustomer.customer_code)
          ? [prefilledCustomer, ...withLocalProspects]
          : withLocalProspects;

        setCustomers(mergedCustomers);
        setItemsMaster((itemsRes.data || []).filter((item) => !isBuildingMaterialItem(item)));

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
        setRegionPriceMaps(parsed.regionPriceMaps || {});
        setCashDiscountMap(parsed.cashDiscountMap || {});
        setValueDiscountMap(parsed.valueDiscountMap || {});
        setSchemes(parsed.schemes || []);
        setPriceSheetItems(parsed.sheetItems || []);
      } catch {
        // Keep previously loaded prices if fresh and cached sources are unavailable.
      }
    }

    loadFoundation();
    loadPrices();
  }, [editOrderId, prefilledCustomer]);

  useEffect(() => {
    if (!prefilledCustomer?.customer_code) return;
    if (isExcludedNewOrderCustomer(prefilledCustomer) && !editOrderId) return;

    setSelectedCustomerCode(prefilledCustomer.customer_code);
    setMessage(`Prospect ${prefilledCustomer.customer_name} is ready for order creation.`);
  }, [editOrderId, prefilledCustomer]);

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

  useEffect(() => {
    fetchCustomerDocuments(selectedCustomer);
  }, [fetchCustomerDocuments, selectedCustomer]);

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

          {selectedCustomer && !outstandingLoading && (
            <>
              <ExportableTable filename="order-outstanding-buckets" sheetName="Outstanding" className="moduleTableWrap" style={{ marginTop: "10px" }}>
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
              </ExportableTable>

              <ExportableTable filename="order-outstanding-invoices" sheetName="Invoices" className="moduleTableWrap" style={{ marginTop: "10px" }}>
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
              </ExportableTable>
            </>
          )}

          {selectedCustomer && !outstandingLoading && !outstandingInfo.customer && (
            <div className="moduleHint">No outstanding row found for this customer in latest upload. Showing zeros.</div>
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

          <PaymentTypeControl
            paymentType={paymentType}
            onChange={setPaymentType}
            pricingRegion={pricingRegion}
          />

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
                  priceList={regionPriceList}
                  cashDiscountMap={cashDiscountMap}
                  valueDiscountMap={valueDiscountMap}
                  paymentType={paymentType}
                  schemeApplications={schemeApplications}
                />
                <QuickOrder
                  quickOrderSuggestions={quickOrderSuggestions}
                  orderQuantities={orderQuantities}
                  decreaseOrderQty={decreaseQty}
                  increaseOrderQty={increaseQty}
                  changeOrderQty={updateQty}
                  priceList={regionPriceList}
                  cashDiscountMap={cashDiscountMap}
                  valueDiscountMap={valueDiscountMap}
                  paymentType={paymentType}
                  schemeApplications={schemeApplications}
                />

                {Array.isArray(orderHistory) && orderHistory.length > 0 && (
                  <section className="moduleSection">
                    <div className="moduleSectionHeader">
                      <h2>Order Change History</h2>
                      <span>{orderHistory.length} event(s)</span>
                    </div>
                    <ExportableTable filename="order-change-history" sheetName="History" className="moduleTableWrap">
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
                    </ExportableTable>
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

              <ExportableTable filename="new-order-items" sheetName="Order Items" className="moduleTableWrap">
                <table className="moduleTable moduleOrderTable">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Item</th>
                      <th>Price</th>
                      <th>Cash Discount</th>
                      <th>Value Discount</th>
                      <th>Scheme</th>
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
                            <td colSpan={8}>
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
                              const wholesale = getPrice(regionPriceList, item.item_code);
                              const cashDiscount = lookupDiscountRate(cashDiscountMap, item.item_code);
                              const valueDiscount = lookupDiscountRate(valueDiscountMap, item.item_code);
                              const scheme = lookupSchemeApplication(schemeApplications, item.item_code);
                              const priced = getPricedOrderLine({
                                wholesaleRate: wholesale,
                                quantity: qty,
                                paymentType,
                                cashDiscountRate: cashDiscount,
                                valueDiscountRate: valueDiscount,
                                schemeUnitDiscount: scheme.unitDiscount,
                                schemeDiscountedQty: scheme.discountedQty,
                              });
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
                                  <td>
                                    {wholesale ? formatMoney(wholesale) : "NOT FOUND"}
                                    {wholesale && qty > 0 && priced.rate !== wholesale ? (
                                      <div className="moduleCode">Net {formatMoney(priced.rate)}</div>
                                    ) : null}
                                  </td>
                                  <td>{formatDiscountDetail(cashDiscount, priced.applied.cash, priced.cashDiscountAmount)}</td>
                                  <td>{formatDiscountDetail(valueDiscount, priced.applied.value, priced.valueDiscountAmount)}</td>
                                  <td>{formatSchemeDetail(scheme)}</td>
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
                                  <td>{formatMoney(priced.lineValue)}</td>
                                </tr>
                              );
                            })}
                        </Fragment>
                      );
                    })}
                    {groupedItems.length === 0 && (
                      <tr>
                        <td colSpan={8}>No items found for this filter.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </ExportableTable>
            </section>

            <section className="moduleSection">
              <PaymentTypeControl
                paymentType={paymentType}
                onChange={setPaymentType}
                pricingRegion={pricingRegion}
              />
              <OrderTotalsPanel
                totals={orderTotals}
                actions={(
                  <div className="moduleOrderBar">
                    <div>
                      <span>Current Order after VAT</span>
                      <strong>{formatMoneyAmount(orderTotals.amountInclVat)}</strong>
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
                )}
                remark={(
                  <div
                    className="moduleHint"
                    style={{
                      marginTop: "10px",
                      fontWeight: 700,
                      color: creditApproval.required ? "#9b1c1c" : undefined,
                    }}
                  >
                    {creditApproval.remark}
                  </div>
                )}
              />
            </section>

            {!loadingCustomerHistory && analytics && (
              <TransactionHistory
                transactions={transactions}
                showTransactions={showTransactions}
                setShowTransactions={setShowTransactions}
                analytics={analytics}
              />
            )}

            {lastSavedOrder && (
              <section className="moduleSection moduleReviewSection">
                <div className="moduleSectionHeader">
                  <h2>Saved Order Review</h2>
                  <span>{lastSavedOrder.statusLabel}</span>
                </div>

                <div className="moduleReviewMeta">
                  <div>
                    <span>Order Number</span>
                    <strong>#{formatSalesOrderNumber(lastSavedOrder) || "—"}</strong>
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
                    <span>Amount without VAT</span>
                    <strong>{formatMoneyAmount(lastSavedOrder.totals?.amountExclVat ?? lastSavedOrder.grandTotal)}</strong>
                  </div>
                  <div>
                    <span>Amount after VAT</span>
                    <strong>{formatMoneyAmount(lastSavedOrder.totals?.amountInclVat ?? lastSavedOrder.grandTotal * 1.15)}</strong>
                  </div>
                  <div>
                    <span>Payment</span>
                    <strong>{String(lastSavedOrder.paymentType || "credit").toUpperCase()}</strong>
                  </div>
                  <div>
                    <span>Region</span>
                    <strong>{pricingRegionLabel(lastSavedOrder.pricingRegion)}</strong>
                  </div>
                </div>

                {lastSavedOrder.totals ? <OrderTotalsPanel totals={lastSavedOrder.totals} /> : null}

                {lastSavedOrder.creditApprovalRemark ? (
                  <div
                    className="moduleHint"
                    style={{
                      marginTop: "10px",
                      fontWeight: 700,
                      color: /approval required/i.test(lastSavedOrder.creditApprovalRemark) ? "#9b1c1c" : undefined,
                    }}
                  >
                    {lastSavedOrder.creditApprovalRemark}
                  </div>
                ) : null}

                <ExportableTable filename="saved-order-lines" sheetName="Saved Order" className="moduleTableWrap">
                  <table className="moduleTable">
                    <thead>
                      <tr>
                        <th>Item Code</th>
                        <th>Item Name</th>
                        <th>Qty</th>
                        <th>Rate</th>
                        <th>Cash Discount</th>
                        <th>Value Discount</th>
                        <th>Scheme</th>
                        <th>Without VAT</th>
                        <th>VAT 15%</th>
                        <th>After VAT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lastSavedOrder.lines.map((line) => (
                        <tr key={`${lastSavedOrder.orderId}-${line.item_code}`}>
                          <td>{line.item_code}</td>
                          <td>{line.item_name}</td>
                          <td>{line.quantity}</td>
                          <td>{formatMoney(line.rate)}</td>
                          <td>{formatDiscountDetail(line.cashDiscount, line.cashApplied, line.cashDiscountAmount)}</td>
                          <td>{formatDiscountDetail(line.valueDiscount, line.valueApplied, line.valueDiscountAmount)}</td>
                          <td>{line.schemeDetail || formatSchemeDetail({ schemeAmount: line.schemeDiscountAmount })}</td>
                          <td>{formatMoneyAmount(line.lineValue || line.lineTotal)}</td>
                          <td>{formatMoneyAmount(line.vatAmount)}</td>
                          <td>{formatMoneyAmount(line.lineTotalInclVat)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ExportableTable>

                <div className="moduleReviewActions">
                  <button
                    type="button"
                    className="modulePrimaryButton"
                    disabled={downloadingPdf || !lastSavedOrder}
                    onClick={() => {
                      void presentOrderWhatsappShare(lastSavedOrder, {
                        savedMessage: language === "ar"
                          ? `PDF للطلب #${formatSalesOrderNumber(lastSavedOrder) || "—"} جاهز للمشاركة.`
                          : `Order #${formatSalesOrderNumber(lastSavedOrder) || "—"} PDF is ready to share.`,
                      });
                    }}
                  >
                    {downloadingPdf ? "Preparing PDF..." : "Share PDF on WhatsApp"}
                  </button>
                  <a className="moduleShareLink" href={emailShareUrl}>Share order details via Email</a>
                </div>

                <p className="moduleReviewNote">
                  After save or submit, the app opens WhatsApp sharing with the order PDF attached, same as collection visits.
                </p>
              </section>
            )}
          </>
        )}

      </div>
    </main>
    </MorningAttendanceGate>
  );
}
