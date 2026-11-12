import { isBuildingMaterialSale } from "./buildingMaterialCustomerFilter.js";
import { achievementPercent, normalizeSalesmanCode } from "./performanceKpis.js";
import { isElectronicsSale } from "./salesmanIncentive.js";
import { compareKpiEstimateToPriorMonth } from "./kpiTargetsTable.js";
import { normalizeCode } from "./outstanding.js";
import { receivableDays } from "./receivableDays.js";
import { addDaysToDateKey } from "./scheduleDateWindow.js";
import { previousMonthKey } from "./categoryGrowth.js";

/** Exclusive leaf buckets; Non-building = electronics + rest. */
export const KPI_UPLOAD_SUMMARY_CATEGORY_KEYS = [
  "buildingMaterial",
  "nonBuilding",
  "electronics",
  "rest",
];

export const KPI_UPLOAD_SUMMARY_CATEGORY_LABELS = {
  buildingMaterial: "Building material",
  nonBuilding: "Non-building",
  electronics: "Electronics",
  rest: "Rest",
};

export const KPI_UPLOAD_SUMMARY_CATEGORY_PARENTS = {
  sales: "totalSales",
  collection: "collection",
};

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function emptyKpiUploadSummaryCategoryBuckets() {
  return {
    buildingMaterial: 0,
    electronics: 0,
    rest: 0,
  };
}

/**
 * Classify one sales line into an exclusive leaf bucket.
 * Building material wins over electronics when both match.
 */
export function classifyKpiUploadSummaryCategory(row = {}) {
  if (isBuildingMaterialSale(row)) return "buildingMaterial";
  if (isElectronicsSale(row)) return "electronics";
  return "rest";
}

export function withKpiUploadSummaryNonBuilding(buckets = {}) {
  const buildingMaterial = roundMoney(buckets.buildingMaterial);
  const electronics = roundMoney(buckets.electronics);
  const rest = roundMoney(buckets.rest);
  return {
    buildingMaterial,
    electronics,
    rest,
    nonBuilding: roundMoney(electronics + rest),
  };
}

/**
 * Scale leaf buckets so Building material + Non-building equals `total`.
 * Keeps Electronics / Rest proportions inside Non-building.
 */
export function scaleKpiUploadSummaryCategoryBuckets(buckets = {}, total = 0) {
  const raw = withKpiUploadSummaryNonBuilding(buckets);
  const target = roundMoney(total);
  const sum = roundMoney(raw.buildingMaterial + raw.nonBuilding);
  if (!(sum > 0) || !Number.isFinite(target)) {
    return withKpiUploadSummaryNonBuilding(emptyKpiUploadSummaryCategoryBuckets());
  }
  const factor = target / sum;
  const scaled = withKpiUploadSummaryNonBuilding({
    buildingMaterial: raw.buildingMaterial * factor,
    electronics: raw.electronics * factor,
    rest: raw.rest * factor,
  });
  const drift = roundMoney(target - (scaled.buildingMaterial + scaled.nonBuilding));
  if (drift !== 0) {
    if (scaled.nonBuilding !== 0 || scaled.rest !== 0 || scaled.electronics !== 0) {
      scaled.rest = roundMoney(scaled.rest + drift);
      scaled.nonBuilding = roundMoney(scaled.electronics + scaled.rest);
    } else {
      scaled.buildingMaterial = roundMoney(scaled.buildingMaterial + drift);
    }
  }
  return scaled;
}

export function addToKpiUploadSummaryCategoryBucket(buckets, categoryKey, amount) {
  const key = categoryKey === "buildingMaterial" || categoryKey === "electronics" || categoryKey === "rest"
    ? categoryKey
    : "rest";
  const next = { ...emptyKpiUploadSummaryCategoryBuckets(), ...buckets };
  next[key] = roundMoney(Number(next[key] || 0) + Number(amount || 0));
  return next;
}

/**
 * Sum sales amounts from BI cube facts into leaf category buckets.
 * Optional salesmanCodes limits to the KPI Targets roster.
 */
export function sumSalesCategoryBucketsFromFacts(facts = [], {
  month = "",
  salesmanCodes = null,
} = {}) {
  const monthKey = String(month || "").slice(0, 7);
  const codeSet = salesmanCodes instanceof Set
    ? salesmanCodes
    : (Array.isArray(salesmanCodes)
      ? new Set([...salesmanCodes].map(normalizeSalesmanCode).filter(Boolean))
      : null);
  let buckets = emptyKpiUploadSummaryCategoryBuckets();
  (facts || []).forEach((fact) => {
    const factMonth = String(fact?.month || fact?.m || "").slice(0, 7);
    if (monthKey && factMonth !== monthKey) return;
    const code = normalizeSalesmanCode(fact?.salesman_code || fact?.sc);
    if (codeSet && codeSet.size && !codeSet.has(code)) return;
    const row = {
      category: fact?.category || fact?.c,
      item_code: fact?.item_code || fact?.ic,
      item_name: fact?.item_name || fact?.iname,
    };
    const amount = Number(fact?.sales_amount || fact?.s || 0);
    if (!Number.isFinite(amount) || amount === 0) return;
    buckets = addToKpiUploadSummaryCategoryBucket(
      buckets,
      classifyKpiUploadSummaryCategory(row),
      amount,
    );
  });
  return withKpiUploadSummaryNonBuilding(buckets);
}

/**
 * Per-customer leaf category weights from cube facts (absolute amounts).
 * Prefers `month`; falls back to all months when that customer has no rows in-month.
 */
export function buildCustomerCategoryMixFromFacts(facts = [], {
  month = "",
  salesmanCodes = null,
} = {}) {
  const monthKey = String(month || "").slice(0, 7);
  const codeSet = salesmanCodes instanceof Set
    ? salesmanCodes
    : (Array.isArray(salesmanCodes)
      ? new Set([...salesmanCodes].map(normalizeSalesmanCode).filter(Boolean))
      : null);
  const byCustomerMonth = new Map();
  const byCustomerAll = new Map();

  const touch = (map, customerCode, categoryKey, amount) => {
    const key = normalizeCode(customerCode);
    if (!key) return;
    const current = map.get(key) || emptyKpiUploadSummaryCategoryBuckets();
    map.set(key, addToKpiUploadSummaryCategoryBucket(current, categoryKey, amount));
  };

  (facts || []).forEach((fact) => {
    const code = normalizeSalesmanCode(fact?.salesman_code || fact?.sc);
    if (codeSet && codeSet.size && !codeSet.has(code)) return;
    const customer = fact?.customer_code || fact?.cc;
    const amount = Number(fact?.sales_amount || fact?.s || 0);
    if (!Number.isFinite(amount) || amount === 0) return;
    const row = {
      category: fact?.category || fact?.c,
      item_code: fact?.item_code || fact?.ic,
      item_name: fact?.item_name || fact?.iname,
    };
    const categoryKey = classifyKpiUploadSummaryCategory(row);
    touch(byCustomerAll, customer, categoryKey, amount);
    const factMonth = String(fact?.month || fact?.m || "").slice(0, 7);
    if (monthKey && factMonth === monthKey) {
      touch(byCustomerMonth, customer, categoryKey, amount);
    }
  });

  const mix = new Map();
  const customers = new Set([...byCustomerAll.keys(), ...byCustomerMonth.keys()]);
  customers.forEach((customer) => {
    const preferred = byCustomerMonth.get(customer);
    const fallback = byCustomerAll.get(customer);
    const chosen = preferred && (preferred.buildingMaterial + preferred.electronics + preferred.rest) !== 0
      ? preferred
      : fallback;
    mix.set(customer, withKpiUploadSummaryNonBuilding(chosen || emptyKpiUploadSummaryCategoryBuckets()));
  });
  return mix;
}

/**
 * Allocate receipt amounts by each customer's sales category mix.
 * Receipts with no mix go into Rest.
 */
export function allocateReceiptsToCategoryBuckets(receipts = [], customerMix = new Map()) {
  let buckets = emptyKpiUploadSummaryCategoryBuckets();
  (receipts || []).forEach((receipt) => {
    const amount = Number(receipt?.amount || 0);
    if (!(amount > 0)) return;
    const customer = normalizeCode(receipt?.customer_code);
    const mix = customerMix.get(customer);
    const leafTotal = mix
      ? Number(mix.buildingMaterial || 0) + Number(mix.electronics || 0) + Number(mix.rest || 0)
      : 0;
    if (!mix || !(leafTotal > 0)) {
      buckets = addToKpiUploadSummaryCategoryBucket(buckets, "rest", amount);
      return;
    }
    buckets = addToKpiUploadSummaryCategoryBucket(
      buckets,
      "buildingMaterial",
      amount * (Number(mix.buildingMaterial || 0) / leafTotal),
    );
    buckets = addToKpiUploadSummaryCategoryBucket(
      buckets,
      "electronics",
      amount * (Number(mix.electronics || 0) / leafTotal),
    );
    buckets = addToKpiUploadSummaryCategoryBucket(
      buckets,
      "rest",
      amount * (Number(mix.rest || 0) / leafTotal),
    );
  });
  return withKpiUploadSummaryNonBuilding(buckets);
}

function estimateFromParentShare(categoryActual, parentActual, parentEstimate) {
  if (parentEstimate == null || parentEstimate === "") return null;
  const parent = Number(parentActual || 0);
  const shareBase = Number(categoryActual || 0);
  if (!Number.isFinite(Number(parentEstimate))) return null;
  if (!(Math.abs(parent) > 0)) {
    return roundMoney(parentEstimate);
  }
  return roundMoney(Number(parentEstimate) * (shareBase / parent));
}

/**
 * Prefer 6-month avg days to pay, else lifetime.
 */
export function pickCustomerAvgDaysToPay(row = {}) {
  const six = Number(row?.avg_days_to_pay_6m ?? row?.avgDaysToPay6m);
  if (Number.isFinite(six) && six >= 0) return six;
  const lifetime = Number(row?.avg_days_to_pay ?? row?.avgDaysToPay);
  if (Number.isFinite(lifetime) && lifetime >= 0) return lifetime;
  return null;
}

export function resolveExpectedPayDate(invoiceDate, avgDays) {
  const date = String(invoiceDate || "").slice(0, 10);
  const days = Number(avgDays);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(days) || days < 0) return "";
  return addDaysToDateKey(date, Math.round(days));
}

/**
 * Open invoice counts toward this month's expected remaining when its historical
 * pay day is on/before month-end — including overdue (expected pay already passed).
 */
export function isOpenInvoiceExpectedThisMonth({
  invoiceDate = "",
  avgDays = null,
  monthEnd = "",
} = {}) {
  const expectedPayDate = resolveExpectedPayDate(invoiceDate, avgDays);
  const end = String(monthEnd || "").slice(0, 10);
  if (!expectedPayDate || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return false;
  return expectedPayDate <= end;
}

export function splitAmountByCategoryMix(amount, mix = null) {
  const value = Number(amount || 0);
  if (!(value > 0)) return emptyKpiUploadSummaryCategoryBuckets();
  const leafTotal = mix
    ? Number(mix.buildingMaterial || 0) + Number(mix.electronics || 0) + Number(mix.rest || 0)
    : 0;
  if (!mix || !(leafTotal > 0)) {
    return addToKpiUploadSummaryCategoryBucket(emptyKpiUploadSummaryCategoryBuckets(), "rest", value);
  }
  let buckets = emptyKpiUploadSummaryCategoryBuckets();
  buckets = addToKpiUploadSummaryCategoryBucket(
    buckets,
    "buildingMaterial",
    value * (Number(mix.buildingMaterial || 0) / leafTotal),
  );
  buckets = addToKpiUploadSummaryCategoryBucket(
    buckets,
    "electronics",
    value * (Number(mix.electronics || 0) / leafTotal),
  );
  buckets = addToKpiUploadSummaryCategoryBucket(
    buckets,
    "rest",
    value * (Number(mix.rest || 0) / leafTotal),
  );
  return buckets;
}

function mergeCategoryBuckets(left = {}, right = {}) {
  return withKpiUploadSummaryNonBuilding({
    buildingMaterial: Number(left.buildingMaterial || 0) + Number(right.buildingMaterial || 0),
    electronics: Number(left.electronics || 0) + Number(right.electronics || 0),
    rest: Number(left.rest || 0) + Number(right.rest || 0),
  });
}

/**
 * Outstanding open amounts split by each customer's sales item mix.
 */
export function sumOutstandingCategoryBuckets(invoices = [], customerMix = new Map()) {
  let buckets = emptyKpiUploadSummaryCategoryBuckets();
  (invoices || []).forEach((invoice) => {
    const amount = Number(invoice?.pending_amount ?? invoice?.amount ?? 0);
    if (!(amount > 0)) return;
    const customer = normalizeCode(invoice?.customer_code);
    const mix = customerMix.get(customer);
    buckets = mergeCategoryBuckets(buckets, splitAmountByCategoryMix(amount, mix));
  });
  return withKpiUploadSummaryNonBuilding(buckets);
}

/**
 * Still-open invoices expected to pay this month (incl. overdue) by category mix.
 */
export function sumExpectedCollectionCategoryBuckets(invoices = [], {
  avgDaysByCustomer = new Map(),
  customerMix = new Map(),
  monthEnd = "",
} = {}) {
  let buckets = emptyKpiUploadSummaryCategoryBuckets();
  (invoices || []).forEach((invoice) => {
    const amount = Number(invoice?.pending_amount ?? invoice?.amount ?? 0);
    if (!(amount > 0)) return;
    const customer = normalizeCode(invoice?.customer_code);
    const avgDays = avgDaysByCustomer instanceof Map
      ? avgDaysByCustomer.get(customer)
      : avgDaysByCustomer?.[customer];
    if (!isOpenInvoiceExpectedThisMonth({
      invoiceDate: invoice?.invoice_date,
      avgDays,
      monthEnd,
    })) return;
    const mix = customerMix.get(customer);
    buckets = mergeCategoryBuckets(buckets, splitAmountByCategoryMix(amount, mix));
  });
  return withKpiUploadSummaryNonBuilding(buckets);
}

/**
 * Credit sales by category for a set of YYYY-MM months (uses cube credit_sales_amount).
 */
export function sumCreditSalesCategoryBucketsFromFacts(facts = [], {
  months = null,
  salesmanCodes = null,
} = {}) {
  const monthSet = months instanceof Set
    ? months
    : (Array.isArray(months) ? new Set(months.map((month) => String(month || "").slice(0, 7))) : null);
  const codeSet = salesmanCodes instanceof Set
    ? salesmanCodes
    : (Array.isArray(salesmanCodes)
      ? new Set([...salesmanCodes].map(normalizeSalesmanCode).filter(Boolean))
      : null);
  let buckets = emptyKpiUploadSummaryCategoryBuckets();
  (facts || []).forEach((fact) => {
    const factMonth = String(fact?.month || fact?.m || "").slice(0, 7);
    if (monthSet && monthSet.size && !monthSet.has(factMonth)) return;
    const code = normalizeSalesmanCode(fact?.salesman_code || fact?.sc);
    if (codeSet && codeSet.size && !codeSet.has(code)) return;
    const amount = Number(
      fact?.credit_sales_amount ?? fact?.cra ?? fact?.sales_amount ?? fact?.a ?? fact?.s ?? 0,
    );
    if (!Number.isFinite(amount) || amount === 0) return;
    const row = {
      category: fact?.category || fact?.c,
      item_code: fact?.item_code || fact?.ic,
      item_name: fact?.item_name || fact?.iname,
    };
    buckets = addToKpiUploadSummaryCategoryBucket(
      buckets,
      classifyKpiUploadSummaryCategory(row),
      amount,
    );
  });
  return withKpiUploadSummaryNonBuilding(buckets);
}

export function monthsThroughYtd(monthKey = "") {
  const month = String(monthKey || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return [];
  const year = month.slice(0, 4);
  const endMonth = Number(month.slice(5, 7));
  const out = [];
  for (let index = 1; index <= endMonth; index += 1) {
    out.push(`${year}-${String(index).padStart(2, "0")}`);
  }
  return out;
}

export function trailingMonthsEndingAt(monthKey = "", monthCount = 3) {
  const end = String(monthKey || "").slice(0, 7);
  const count = Math.max(1, Math.floor(Number(monthCount) || 0));
  if (!/^\d{4}-\d{2}$/.test(end)) return [];
  const months = [end];
  let cursor = end;
  for (let index = 1; index < count; index += 1) {
    cursor = previousMonthKey(cursor);
    if (!cursor) break;
    months.unshift(cursor);
  }
  return months;
}

export function buildCategoryReceivableDays({
  outstandingBuckets = {},
  creditSalesBuckets = {},
  days = 0,
} = {}) {
  const outstanding = withKpiUploadSummaryNonBuilding(outstandingBuckets);
  const credit = withKpiUploadSummaryNonBuilding(creditSalesBuckets);
  const result = {};
  KPI_UPLOAD_SUMMARY_CATEGORY_KEYS.forEach((key) => {
    result[key] = receivableDays(outstanding[key], credit[key], days);
  });
  return result;
}

/**
 * Reconstruct prior-month-end outstanding by category:
 * AR_prior ≈ AR_now − credit_sales_this_month + collections_MTD.
 * Floors at zero per leaf; Non-building = electronics + rest.
 */
export function reconstructPriorOutstandingCategoryBuckets({
  currentOutstanding = {},
  creditSalesThisMonth = {},
  collectionMtd = {},
} = {}) {
  const current = withKpiUploadSummaryNonBuilding(currentOutstanding);
  const sales = withKpiUploadSummaryNonBuilding(creditSalesThisMonth);
  const collected = withKpiUploadSummaryNonBuilding(collectionMtd);
  return withKpiUploadSummaryNonBuilding({
    buildingMaterial: Math.max(
      0,
      roundMoney(current.buildingMaterial - sales.buildingMaterial + collected.buildingMaterial),
    ),
    electronics: Math.max(
      0,
      roundMoney(current.electronics - sales.electronics + collected.electronics),
    ),
    rest: Math.max(
      0,
      roundMoney(current.rest - sales.rest + collected.rest),
    ),
  });
}

function categoryRowKey(metric, categoryKey) {
  return `${metric}_${categoryKey}`;
}

function buildOneCategorySummaryRow({
  metric,
  categoryKey,
  actual,
  priorActual,
  parentActual,
  parentEstimate,
  parentTarget = 0,
  expectedRemaining = null,
  estimateOverride = null,
  vsLastMonthOverride = undefined,
  statusLabel = "Category split · no target",
  formatKey = null,
  kind = "categorySplit",
}) {
  const labelPrefix = metric === "collection"
    ? "Collection"
    : (metric === "collectionDays" ? "Avg collection days" : "Sales");
  let estimate = estimateOverride;
  if (estimate == null && metric === "collection" && expectedRemaining != null) {
    estimate = roundMoney(Number(actual || 0) + Number(expectedRemaining || 0));
  }
  if (estimate == null && metric !== "collectionDays") {
    estimate = estimateFromParentShare(actual, parentActual, parentEstimate);
  }
  const achievement = metric === "collectionDays"
    ? null
    : achievementPercent(estimate, parentTarget);
  return {
    key: categoryRowKey(metric, categoryKey),
    label: `${labelPrefix} — ${KPI_UPLOAD_SUMMARY_CATEGORY_LABELS[categoryKey] || categoryKey}`,
    kind,
    metric,
    categoryKey,
    formatKey: formatKey
      || (metric === "collection"
        ? "collection"
        : (metric === "collectionDays" ? "averageCollectionDays" : "totalSales")),
    totalFiltered: {
      actual: metric === "collectionDays" ? actual : roundMoney(actual),
      target: 0,
      achievement: null,
      statusLabel,
      statusTone: "neutral",
    },
    paceEstimate: {
      estimate: metric === "collectionDays" ? null : estimate,
      target: Number(parentTarget) > 0 && metric !== "collectionDays" ? Number(parentTarget) : 0,
      achievement: Number(parentTarget) > 0 && metric !== "collectionDays" ? achievement : null,
    },
    vsLastMonth: vsLastMonthOverride !== undefined
      ? vsLastMonthOverride
      : (metric === "collectionDays"
        ? null
        : compareKpiEstimateToPriorMonth(estimate, priorActual)),
  };
}

/**
 * Build Sales/Collection category detail rows from pre-aggregated buckets.
 * Building material + Non-building = parent; Electronics + Rest = Non-building.
 * Collection month-end estimate = MTD collected + open invoices expected this month
 * (including overdue still open).
 */
export function buildKpiUploadSummaryCategoryRows({
  salesBuckets = null,
  priorSalesBuckets = null,
  collectionBuckets = null,
  priorCollectionBuckets = null,
  expectedCollectionBuckets = null,
  totalSalesActual = 0,
  priorTotalSalesActual = null,
  totalSalesEstimate = null,
  totalSalesTarget = 0,
  collectionActual = 0,
  priorCollectionActual = null,
  collectionEstimate = null,
  collectionTarget = 0,
} = {}) {
  const sales = scaleKpiUploadSummaryCategoryBuckets(
    salesBuckets || emptyKpiUploadSummaryCategoryBuckets(),
    totalSalesActual,
  );
  const priorSales = priorTotalSalesActual == null
    ? withKpiUploadSummaryNonBuilding(priorSalesBuckets || emptyKpiUploadSummaryCategoryBuckets())
    : scaleKpiUploadSummaryCategoryBuckets(
      priorSalesBuckets || emptyKpiUploadSummaryCategoryBuckets(),
      priorTotalSalesActual,
    );
  const collection = scaleKpiUploadSummaryCategoryBuckets(
    collectionBuckets || emptyKpiUploadSummaryCategoryBuckets(),
    collectionActual,
  );
  const priorCollection = priorCollectionActual == null
    ? withKpiUploadSummaryNonBuilding(priorCollectionBuckets || emptyKpiUploadSummaryCategoryBuckets())
    : scaleKpiUploadSummaryCategoryBuckets(
      priorCollectionBuckets || emptyKpiUploadSummaryCategoryBuckets(),
      priorCollectionActual,
    );
  const expectedRemaining = withKpiUploadSummaryNonBuilding(
    expectedCollectionBuckets || emptyKpiUploadSummaryCategoryBuckets(),
  );

  const salesRows = KPI_UPLOAD_SUMMARY_CATEGORY_KEYS.map((categoryKey) => (
    buildOneCategorySummaryRow({
      metric: "sales",
      categoryKey,
      actual: sales[categoryKey],
      priorActual: priorSales[categoryKey],
      parentActual: totalSalesActual,
      parentEstimate: totalSalesEstimate,
      parentTarget: totalSalesTarget,
    })
  ));
  const collectionRows = KPI_UPLOAD_SUMMARY_CATEGORY_KEYS.map((categoryKey) => (
    buildOneCategorySummaryRow({
      metric: "collection",
      categoryKey,
      actual: collection[categoryKey],
      priorActual: priorCollection[categoryKey],
      parentActual: collectionActual,
      parentEstimate: collectionEstimate,
      parentTarget: collectionTarget,
      expectedRemaining: expectedRemaining[categoryKey],
      statusLabel: "MTD + open expected this month",
    })
  ));
  return {
    salesRows,
    collectionRows,
    sales,
    collection,
    expectedRemaining,
  };
}

/**
 * Category DSO children for one Avg collection days parent row.
 * Optional priorDaysByCategory + compareFn fills vs last month (lower-is-better).
 */
export function buildCategoryCollectionDaysRows({
  parentKey = "averageCollectionDays",
  parentLabel = "Avg collection days",
  daysByCategory = {},
  priorDaysByCategory = null,
  compareFn = null,
  month = "",
  statusLabel = "Lower is better · category DSO",
} = {}) {
  return KPI_UPLOAD_SUMMARY_CATEGORY_KEYS
    .filter((categoryKey) => daysByCategory?.[categoryKey] != null)
    .map((categoryKey) => {
      const currentDays = daysByCategory[categoryKey];
      const priorDays = priorDaysByCategory?.[categoryKey];
      const vsLastMonth = typeof compareFn === "function"
        ? compareFn(currentDays, priorDays)
        : null;
      const row = buildOneCategorySummaryRow({
        metric: "collectionDays",
        categoryKey,
        actual: currentDays,
        priorActual: priorDays,
        statusLabel,
        formatKey: parentKey,
        kind: "categoryCollectionDays",
        estimateOverride: null,
        vsLastMonthOverride: vsLastMonth,
      });
      return {
        ...row,
        key: `${parentKey}_${categoryKey}`,
        label: `${parentLabel} — ${KPI_UPLOAD_SUMMARY_CATEGORY_LABELS[categoryKey] || categoryKey}`,
        parentKey,
        month: String(month || "").slice(0, 7),
      };
    });
}

/**
 * Insert category detail rows after Total sales, Collection, and each DSO parent.
 */
export function insertKpiUploadSummaryCategoryRows(rows = [], categoryRows = {}) {
  const salesRows = Array.isArray(categoryRows?.salesRows) ? categoryRows.salesRows : [];
  const collectionRows = Array.isArray(categoryRows?.collectionRows) ? categoryRows.collectionRows : [];
  const collectionDaysByParent = categoryRows?.collectionDaysByParent && typeof categoryRows.collectionDaysByParent === "object"
    ? categoryRows.collectionDaysByParent
    : {};
  const hasDaysChildren = Object.values(collectionDaysByParent).some((list) => Array.isArray(list) && list.length);
  if (!salesRows.length && !collectionRows.length && !hasDaysChildren) return [...(rows || [])];

  const next = [];
  (rows || []).forEach((row) => {
    next.push(row);
    if (row?.key === "totalSales" && salesRows.length) next.push(...salesRows);
    if (row?.key === "collection" && collectionRows.length) next.push(...collectionRows);
    const daysChildren = collectionDaysByParent[row?.key];
    if (Array.isArray(daysChildren) && daysChildren.length) next.push(...daysChildren);
  });
  return next;
}
