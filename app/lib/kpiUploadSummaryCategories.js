import { isBuildingMaterialSale } from "./buildingMaterialCustomerFilter.js";
import { achievementPercent, normalizeSalesmanCode } from "./performanceKpis.js";
import { isElectronicsSale } from "./salesmanIncentive.js";
import { compareKpiEstimateToPriorMonth } from "./kpiTargetsTable.js";
import { normalizeCode } from "./outstanding.js";

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
}) {
  const labelPrefix = metric === "collection" ? "Collection" : "Sales";
  const estimate = estimateFromParentShare(actual, parentActual, parentEstimate);
  const achievement = achievementPercent(estimate, parentTarget);
  return {
    key: categoryRowKey(metric, categoryKey),
    label: `${labelPrefix} — ${KPI_UPLOAD_SUMMARY_CATEGORY_LABELS[categoryKey] || categoryKey}`,
    kind: "categorySplit",
    metric,
    categoryKey,
    formatKey: metric === "collection" ? "collection" : "totalSales",
    totalFiltered: {
      actual: roundMoney(actual),
      target: 0,
      achievement: null,
      statusLabel: "Category split · no target",
      statusTone: "neutral",
    },
    paceEstimate: {
      estimate,
      target: Number(parentTarget) > 0 ? Number(parentTarget) : 0,
      achievement: Number(parentTarget) > 0 ? achievement : null,
    },
    vsLastMonth: compareKpiEstimateToPriorMonth(estimate, priorActual),
  };
}

/**
 * Build Sales/Collection category detail rows from pre-aggregated buckets.
 * Building material + Non-building = parent; Electronics + Rest = Non-building.
 */
export function buildKpiUploadSummaryCategoryRows({
  salesBuckets = null,
  priorSalesBuckets = null,
  collectionBuckets = null,
  priorCollectionBuckets = null,
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
    })
  ));
  return { salesRows, collectionRows, sales, collection };
}

/**
 * Insert category detail rows after Total sales and Collection in the email table.
 */
export function insertKpiUploadSummaryCategoryRows(rows = [], categoryRows = {}) {
  const salesRows = Array.isArray(categoryRows?.salesRows) ? categoryRows.salesRows : [];
  const collectionRows = Array.isArray(categoryRows?.collectionRows) ? categoryRows.collectionRows : [];
  if (!salesRows.length && !collectionRows.length) return [...(rows || [])];

  const next = [];
  (rows || []).forEach((row) => {
    next.push(row);
    if (row?.key === "totalSales" && salesRows.length) next.push(...salesRows);
    if (row?.key === "collection" && collectionRows.length) next.push(...collectionRows);
  });
  return next;
}
