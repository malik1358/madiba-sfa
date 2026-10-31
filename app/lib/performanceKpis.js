import { currentMonthDateRange } from "./salesInvoices.js";
import {
  isCashSalesVoucher,
  isCreditNoteReceiptType,
  isCreditNoteTransaction,
  matchPaymentsFifo,
} from "./paymentBehavior.js";
import { applySalesmanSpellingAliasesToUpper } from "./salesmanSpellingAliases.js";
import { isKsaOrderDay, KSA_TIMEZONE } from "./workdayActivity.js";

export function isMissingSchemaColumn(error) {
  const message = String(error?.message || error?.details || error?.hint || "").toLowerCase();
  const code = String(error?.code || "").toUpperCase();
  return code === "42703"
    || code === "PGRST204"
    || (message.includes("column") && message.includes("does not exist"))
    || (message.includes("could not find") && message.includes("column"))
    || message.includes("schema cache");
}

export const PERFORMANCE_KPI_KEYS = [
  "officeSupplies",
  "localItemSales",
  "otherSales",
  "collection",
  "cashCollection",
  "newCustomers",
  "repeatCustomers",
  "newSkusToRepeatCustomers",
  "repeatCustomerSkuCount",
];

export const PERFORMANCE_DISPLAY_KPI_KEYS = [
  "officeSupplies",
  "localItemSales",
  "otherSales",
  "totalSales",
  "collection",
  "cashCollection",
  "totalCashCollected",
  "newCustomers",
  "repeatCustomers",
  "newSkusToRepeatCustomers",
  "avgSkusPerRepeatCustomer",
];

export const INFORMATION_ONLY_KPI_KEYS = new Set([
  "cashCollection",
  "totalCashCollected",
  "avgSkusPerRepeatCustomer",
]);

const SALES_PACE_KPI_KEYS = new Set([
  "officeSupplies",
  "localItemSales",
  "otherSales",
  "totalSales",
]);

/** Collection KPIs pace off the receipt register (not sales history). */
const COLLECTION_PACE_KPI_KEYS = new Set([
  "collection",
  "cashCollection",
  "totalCashCollected",
]);

export const PERFORMANCE_KPI_LABELS = {
  officeSupplies: "Sales of office supplies",
  localItemSales: "Local item sales",
  otherSales: "Others",
  totalSales: "Total sales",
  collection: "Collection",
  cashCollection: "Cash collection (info)",
  totalCashCollected: "Total cash collected",
  newCustomers: "New customers",
  repeatCustomers: "Repeat customers",
  newSkusToRepeatCustomers: "New SKUs to repeat customers",
  avgSkusPerRepeatCustomer: "Avg SKUs / repeat customer (info)",
  repeatCustomerSkuCount: "Repeat customer SKU placements",
};

const MONEY_KPI_KEYS = new Set([
  "officeSupplies",
  "localItemSales",
  "otherSales",
  "totalSales",
  "collection",
  "cashCollection",
  "totalCashCollected",
  "sales",
]);
const TARGET_FIELD_ALIASES = {
  officeSupplies: ["officeSupplies", "office_supplies_sales_target", "office_supplies_target"],
  localItemSales: ["localItemSales", "local_item_sales_target"],
  otherSales: ["otherSales", "other_sales_target"],
};

function firstPresentNumber(row, keys) {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
    const value = row[key];
    if (value == null || value === "") continue;
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }
  return null;
}

export function isOfficeSuppliesSale(row = {}) {
  const text = [row.category, row.item_name, row.item_category, row.group]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
  if (!text) return false;
  const compact = text.replace(/[^a-z0-9\u0600-\u06ff]+/g, "");
  return (
    /\boffice\b/.test(text)
    || /stationer/.test(text)
    || /officesuppl/.test(compact)
    || text.includes("قرطاس")
    || text.includes("مكتبي")
  );
}

export function isLocalItemSale(row = {}) {
  const origin = String(row?.local_import || "").trim().toLowerCase();
  return /\blocal\b/.test(origin) && !/\bimport(?:ed)?\b/.test(origin);
}

export function netKpiSalesAmount(row = {}) {
  const amount = Number(row?.sales_amount || 0);
  if (!Number.isFinite(amount)) return 0;
  return isCreditNoteTransaction(row) ? -Math.abs(amount) : amount;
}

export function splitSalesActuals(rows = []) {
  return (rows || []).reduce((totals, row) => {
    const amount = netKpiSalesAmount(row);
    if (amount === 0) return totals;
    if (isOfficeSuppliesSale(row)) totals.officeSupplies += amount;
    else if (isLocalItemSale(row)) totals.localItemSales += amount;
    else totals.otherSales += amount;
    return totals;
  }, { officeSupplies: 0, localItemSales: 0, otherSales: 0 });
}

export function normalizeSalesmanCode(value) {
  return applySalesmanSpellingAliasesToUpper(String(value || "").trim()).replace(/\s+/g, " ");
}

export function monthStartDate(reportDate) {
  return currentMonthDateRange(reportDate).from;
}

export function nextIsoDate(iso) {
  const date = String(iso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/** KSA field workday for KPI pace: Friday off, Saturday counts (same as order days). */
export function isKsaWorkday(iso) {
  const date = String(iso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return isKsaOrderDay(date);
}

export function resolveKpiPaceDate(monthDate, todayIso) {
  const month = currentMonthDateRange(monthDate);
  const today = String(todayIso || monthDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return month.from;
  if (today < month.from) return month.from;
  if (today > month.to) return month.to;
  return today;
}

/**
 * Pace for upload-backed KPIs stops at the latest data date in the open month
 * (sales transaction date, or receipt register date). A missing date means no
 * current-month rows are on file yet. Undefined leaves the calendar date unchanged.
 */
export function resolveSalesPaceAsOfDate(reportDate, todayIso, salesAsOfDate) {
  const calendar = resolveKpiPaceDate(reportDate, todayIso);
  if (salesAsOfDate == null) return calendar;
  const salesDate = String(salesAsOfDate).slice(0, 10);
  const month = currentMonthDateRange(reportDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(salesDate)) return month.from;
  if (salesDate < month.from || salesDate > month.to) return month.from;
  return salesDate < calendar ? salesDate : calendar;
}

/** Same clamp as sales pace, for the latest receipt_date in the open month. */
export function resolveReceiptPaceAsOfDate(reportDate, todayIso, receiptAsOfDate) {
  return resolveSalesPaceAsOfDate(reportDate, todayIso, receiptAsOfDate);
}

/** Latest receipt_date within [from, to] across a customer→rows map or flat list. */
export function latestReceiptDateInRange(receiptsByCustomer, from = "", to = "") {
  let latest = "";
  const buckets = receiptsByCustomer instanceof Map
    ? [...receiptsByCustomer.values()]
    : Array.isArray(receiptsByCustomer)
      ? [receiptsByCustomer]
      : Object.values(receiptsByCustomer || {});
  buckets.forEach((rows) => {
    (rows || []).forEach((row) => {
      const date = String(row?.receipt_date || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      if (from && date < from) return;
      if (to && date > to) return;
      if (date > latest) latest = date;
    });
  });
  return latest;
}

export function monthProgressRatio(reportDate) {
  const date = String(reportDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 0;
  const day = Number(date.slice(8, 10));
  const lastDay = Number(currentMonthDateRange(date).to.slice(8, 10));
  if (!day || !lastDay) return 0;
  return Math.min(1, Math.max(0, day / lastDay));
}

export function ksaWorkdayProgressRatio(asOfDate) {
  const date = String(asOfDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 0;
  const { from, to } = currentMonthDateRange(date);
  let workdays = 0;
  let elapsed = 0;
  for (let cursor = from; cursor <= to; cursor = nextIsoDate(cursor)) {
    if (!isKsaWorkday(cursor)) continue;
    workdays += 1;
    if (cursor <= date) elapsed += 1;
  }
  if (!workdays) return 0;
  return Math.min(1, Math.max(0, elapsed / workdays));
}

export function averageCumulativeDayShares(salesRows = []) {
  const months = new Map();
  (salesRows || []).forEach((row) => {
    const date = String(row?.transaction_date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const amount = netKpiSalesAmount(row);
    if (amount === 0) return;
    const month = date.slice(0, 7);
    const day = Number(date.slice(8, 10));
    let bucket = months.get(month);
    if (!bucket) {
      bucket = { total: 0, days: new Map() };
      months.set(month, bucket);
    }
    bucket.total += amount;
    bucket.days.set(day, (bucket.days.get(day) || 0) + amount);
  });

  const curves = [];
  months.forEach((bucket) => {
    if (!(bucket.total > 0) || !bucket.days.size) return;
    const lastDay = Math.max(...bucket.days.keys());
    let cumulative = 0;
    const shares = {};
    for (let day = 1; day <= lastDay; day += 1) {
      cumulative += bucket.days.get(day) || 0;
      shares[day] = cumulative / bucket.total;
    }
    curves.push(shares);
  });

  const result = {};
  for (let day = 1; day <= 31; day += 1) {
    const values = curves.map((curve) => curve[day]).filter((value) => value != null);
    if (values.length) {
      result[day] = values.reduce((sum, value) => sum + value, 0) / values.length;
    }
  }
  // Averaging months can dip later days below earlier ones; cumulative share must not fall.
  let runningMax = 0;
  for (let day = 1; day <= 31; day += 1) {
    const value = result[day];
    if (value == null || !Number.isFinite(Number(value))) continue;
    runningMax = Math.max(runningMax, Number(value));
    result[day] = runningMax;
  }
  return { shares: result, monthCount: curves.length };
}

export function shareForDay(shares, day) {
  const goalDay = Number(day || 0);
  const curve = shares?.shares && typeof shares.shares === "object" ? shares.shares : shares;
  if (!curve || !goalDay) return null;
  for (let cursor = goalDay; cursor >= 1; cursor -= 1) {
    const value = curve[cursor] ?? curve[String(cursor)];
    if (value != null && Number.isFinite(Number(value)) && Number(value) > 0) {
      return Number(value);
    }
  }
  return null;
}

export function pickSalesmanPaceShares(pace, salesmanCode) {
  const code = normalizeSalesmanCode(salesmanCode);
  if (!code || !pace) return null;
  const personal = pace.bySalesman instanceof Map
    ? pace.bySalesman.get(code)
    : pace.bySalesman?.[code];
  if (!personal || typeof personal !== "object") return null;
  return personal.shares && typeof personal.shares === "object" ? personal.shares : personal;
}

export function expectedPacePercent(asOfDate, paceShares = null) {
  const date = String(asOfDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 0;
  // Last calendar day of the month = 100% of the month's pace. Historical
  // curves can walk day 31 back to a day-30 average below 100% and then inflate
  // Estimate at current pace above booked actuals even when sales/receipts are
  // uploaded through month-end.
  const monthEnd = currentMonthDateRange(date).to;
  if (date >= monthEnd) return 100;
  const workday = ksaWorkdayProgressRatio(date) * 100;
  const historical = shareForDay(paceShares, Number(date.slice(8, 10)));
  if (historical != null && historical > 0) {
    return Math.min(100, Math.max(0, historical * 100));
  }
  return workday;
}

export function resolveExpectedPacePercent(key, {
  reportDate,
  todayIso,
  paceShares = null,
  salesAsOfDate,
  receiptAsOfDate,
} = {}) {
  const monthEnd = currentMonthDateRange(reportDate).to;
  const today = String(todayIso || reportDate || "").slice(0, 10);
  const monthIsComplete = /^\d{4}-\d{2}-\d{2}$/.test(today) && today > monthEnd;
  if (monthIsComplete) return 100;
  const salesPace = SALES_PACE_KPI_KEYS.has(key);
  const collectionPace = COLLECTION_PACE_KPI_KEYS.has(key);
  const paceDate = salesPace
    ? resolveSalesPaceAsOfDate(reportDate, today || reportDate, salesAsOfDate)
    : collectionPace
      ? resolveReceiptPaceAsOfDate(reportDate, today || reportDate, receiptAsOfDate)
      : resolveKpiPaceDate(reportDate, today || reportDate);
  return expectedPacePercent(
    paceDate,
    salesPace ? paceShares : null,
  );
}

/** Project month-end value if today's actual holds at the expected pace share. */
export function estimateAtCurrentPace(actual, expectedPercent) {
  const value = Number(actual || 0);
  const expected = Number(expectedPercent);
  if (!Number.isFinite(value) || !Number.isFinite(expected) || !(expected > 0)) return null;
  return value * (100 / expected);
}

/**
 * Project month-end value if today's ahead/behind pace gap (percentage points vs expected)
 * holds through month-end: target × (100 + gap) / 100.
 * Example: target 4,550,000 and 21% behind pace → 4,550,000 × 0.79 = 3,594,500.
 */
export function estimateFromPaceGap(target, paceGap) {
  const goal = Number(target || 0);
  if (!(goal > 0) || paceGap == null || paceGap === "") return null;
  const gap = Number(paceGap);
  if (!Number.isFinite(gap)) return null;
  return goal * ((100 + gap) / 100);
}

/**
 * One salesman's month-end figure for the Estimate at current pace footer.
 * Scales actual by expected pace share (`actual × 100 / expected%`) so leftover
 * matches historical (or workday) share still ahead, not target × ahead/behind gap.
 * Never returns below the current actual; keeps untarged actuals in the sum.
 * `target` / `paceGap` are accepted for call-site compatibility but unused.
 */
export function monthEndPaceEstimate({
  actual = 0,
  target = 0,
  expected = null,
  paceGap = null,
} = {}) {
  const value = Number(actual || 0) || 0;
  const goal = Number(target || 0) || 0;
  if (!(value > 0) && !(goal > 0)) return null;
  const estimate = estimateAtCurrentPace(value, expected);
  if (estimate == null) {
    return value > 0 ? value : null;
  }
  return Math.max(value, Number(estimate) || 0);
}

export function formatKpiTargetInput(value) {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  if (!digits) return "";
  return Number(digits).toLocaleString("en-SA", { maximumFractionDigits: 0 });
}

export function parseKpiTargetInput(value) {
  return String(value ?? "").replace(/[^\d]/g, "");
}

export function achievementPercent(actual, target) {
  const goal = Number(target || 0);
  if (!(goal > 0)) return null;
  return (Number(actual || 0) / goal) * 100;
}

export function kpiStatus({
  actual,
  target,
  reportDate,
  todayIso,
  paceShares = null,
  salesAsOfDate,
  dataAsOfDate,
} = {}) {
  const achievement = achievementPercent(actual, target);
  if (achievement == null) {
    return {
      key: "no_target",
      label: "No target",
      tone: "neutral",
      expected: null,
      gap: null,
    };
  }

  const monthEnd = currentMonthDateRange(reportDate).to;
  const today = String(todayIso || reportDate || "").slice(0, 10);
  const monthIsComplete = /^\d{4}-\d{2}-\d{2}$/.test(today) && today > monthEnd;
  const asOf = dataAsOfDate !== undefined ? dataAsOfDate : salesAsOfDate;
  const paceDate = paceShares == null && asOf === undefined
    ? resolveKpiPaceDate(reportDate, today || reportDate)
    : resolveSalesPaceAsOfDate(reportDate, today || reportDate, asOf);
  const expected = monthIsComplete ? 100 : expectedPacePercent(paceDate, paceShares);
  const gap = achievement - expected;

  if (achievement >= 100) {
    return {
      key: "achieved",
      label: "Achieved",
      tone: "green",
      expected,
      gap,
    };
  }
  if (gap >= 1) {
    return {
      key: "ahead",
      label: `${gap.toFixed(1)}% ahead of pace`,
      tone: "orange",
      expected,
      gap,
    };
  }
  if (gap > -1) {
    return {
      key: "on_pace",
      label: "On pace",
      tone: "orange",
      expected,
      gap,
    };
  }
  return {
    key: "behind",
    label: `${Math.abs(gap).toFixed(1)}% behind pace`,
    tone: "red",
    expected,
    gap,
  };
}

export function emptyPerformanceActuals() {
  return {
    officeSupplies: 0,
    localItemSales: 0,
    otherSales: 0,
    totalSales: 0,
    collection: 0,
    cashCollection: 0,
    totalCashCollected: 0,
    newCustomers: 0,
    repeatCustomers: 0,
    newSkusToRepeatCustomers: 0,
    repeatCustomerSkuCount: 0,
    avgSkusPerRepeatCustomer: 0,
  };
}

export function emptyPerformanceTargets() {
  return {
    officeSupplies: 0,
    localItemSales: 0,
    otherSales: 0,
    totalSales: 0,
    collection: 0,
    cashCollection: 0,
    totalCashCollected: 0,
    newCustomers: 0,
    repeatCustomers: 0,
    newSkusToRepeatCustomers: 0,
    avgSkusPerRepeatCustomer: 0,
  };
}

export function withTotalSales(values = {}) {
  const officeSupplies = Number(values.officeSupplies || 0) || 0;
  const localItemSales = Number(values.localItemSales || 0) || 0;
  const otherSales = Number(values.otherSales || 0) || 0;
  return {
    ...values,
    officeSupplies,
    localItemSales,
    otherSales,
    totalSales: officeSupplies + localItemSales + otherSales,
  };
}

export function withDerivedKpiActuals(values = {}) {
  const withSales = withTotalSales(values);
  const collection = Number(withSales.collection || 0) || 0;
  const cashCollection = Number(withSales.cashCollection || 0) || 0;
  const repeatCustomers = Number(withSales.repeatCustomers || 0) || 0;
  const repeatCustomerSkuCount = Number(withSales.repeatCustomerSkuCount || 0) || 0;
  return {
    ...withSales,
    totalCashCollected: Math.round((collection + cashCollection) * 100) / 100,
    avgSkusPerRepeatCustomer: averageSkusPerRepeatCustomer(repeatCustomerSkuCount, repeatCustomers),
  };
}

export function normalizePerformanceTargets(row = {}) {
  const splitOffice = firstPresentNumber(row, TARGET_FIELD_ALIASES.officeSupplies);
  const splitLocal = firstPresentNumber(row, TARGET_FIELD_ALIASES.localItemSales);
  const splitOther = firstPresentNumber(row, TARGET_FIELD_ALIASES.otherSales);
  const hasSplitSales = splitOffice != null || splitLocal != null || splitOther != null;
  const officeSupplies = hasSplitSales ? (splitOffice || 0) : 0;
  const localItemSales = hasSplitSales ? (splitLocal || 0) : 0;
  const otherSales = hasSplitSales ? (splitOther || 0) : 0;
  const splitTotal = officeSupplies + localItemSales + otherSales;

  return {
    officeSupplies,
    localItemSales,
    otherSales,
    totalSales: splitTotal > 0 ? splitTotal : (Number(row.totalSales ?? row.sales ?? row.sales_target ?? 0) || 0),
    collection: Number(row.collection ?? row.collection_target ?? 0) || 0,
    newCustomers: Number(
      row.newCustomers ?? row.new_customers_target ?? row.new_buying_customers_target ?? 0,
    ) || 0,
    repeatCustomers: Number(
      row.repeatCustomers ?? row.repeat_customers_target ?? row.existing_customers_buying_target ?? 0,
    ) || 0,
    newSkusToRepeatCustomers: Number(
      row.newSkusToRepeatCustomers
      ?? row.new_skus_to_repeat_customers_target
      ?? row.new_skus_to_repeat_customers
      ?? 0,
    ) || 0,
  };
}

export function classifyBuyingCustomers(monthCustomerCodes = [], priorCustomerCodes = []) {
  const prior = new Set(
    (priorCustomerCodes || []).map((code) => normalizeSalesmanCode(code)).filter(Boolean),
  );
  const seen = new Set();
  let newCustomers = 0;
  let repeatCustomers = 0;

  (monthCustomerCodes || []).forEach((code) => {
    const normalized = normalizeSalesmanCode(code);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    if (prior.has(normalized)) repeatCustomers += 1;
    else newCustomers += 1;
  });

  return { newCustomers, repeatCustomers };
}

export function normalizeItemCode(value) {
  return String(value || "").trim().toUpperCase();
}

export function averageSkusPerRepeatCustomer(repeatCustomerSkuCount, repeatCustomers) {
  const customers = Number(repeatCustomers || 0) || 0;
  const skuCount = Number(repeatCustomerSkuCount || 0) || 0;
  if (!(customers > 0) || !(skuCount >= 0)) return 0;
  return Math.round((skuCount / customers) * 10) / 10;
}

/**
 * Measure assortment push on repeat buyers only.
 * A "new SKU" is an item code this salesman sold to a repeat customer this month
 * that the customer never bought (positive ordinary sale) before the month.
 */
export function classifyRepeatCustomerSkuExpansion({
  monthSalesRows = [],
  priorCustomerCodes = [],
  priorCustomerItemCodes = {},
} = {}) {
  const priorCustomers = new Set(
    (priorCustomerCodes || []).map((code) => normalizeSalesmanCode(code)).filter(Boolean),
  );
  const priorItemsByCustomer = new Map();
  const registerPriorItems = (code, items) => {
    const customer = normalizeSalesmanCode(code);
    if (!customer) return;
    let bucket = priorItemsByCustomer.get(customer);
    if (!bucket) {
      bucket = new Set();
      priorItemsByCustomer.set(customer, bucket);
    }
    (items instanceof Set ? [...items] : (items || [])).forEach((item) => {
      const itemCode = normalizeItemCode(item);
      if (itemCode) bucket.add(itemCode);
    });
  };

  if (priorCustomerItemCodes instanceof Map) {
    priorCustomerItemCodes.forEach((items, code) => registerPriorItems(code, items));
  } else {
    Object.entries(priorCustomerItemCodes || {}).forEach(([code, items]) => {
      registerPriorItems(code, items);
    });
  }

  const monthSkusByCustomer = new Map();
  (monthSalesRows || []).forEach((row) => {
    if (netKpiSalesAmount(row) <= 0 || isCreditNoteTransaction(row)) return;
    const customer = normalizeSalesmanCode(row.customer_code);
    const itemCode = normalizeItemCode(row.item_code);
    if (!customer || !itemCode || !priorCustomers.has(customer)) return;
    let bucket = monthSkusByCustomer.get(customer);
    if (!bucket) {
      bucket = new Set();
      monthSkusByCustomer.set(customer, bucket);
    }
    bucket.add(itemCode);
  });

  let newSkusToRepeatCustomers = 0;
  let repeatCustomerSkuCount = 0;
  let repeatCustomersWithNewSkus = 0;
  const customerSummaries = [];

  monthSkusByCustomer.forEach((monthSkus, customer) => {
    const priorSkus = priorItemsByCustomer.get(customer) || new Set();
    const newSkus = [...monthSkus].filter((itemCode) => !priorSkus.has(itemCode));
    const monthSkuCount = monthSkus.size;
    const newSkuCount = newSkus.length;
    repeatCustomerSkuCount += monthSkuCount;
    newSkusToRepeatCustomers += newSkuCount;
    if (newSkuCount > 0) repeatCustomersWithNewSkus += 1;
    customerSummaries.push({
      customerCode: customer,
      monthSkuCount,
      newSkuCount,
      newSkuCodes: newSkus,
    });
  });

  const repeatCustomers = monthSkusByCustomer.size;
  return {
    newSkusToRepeatCustomers,
    repeatCustomerSkuCount,
    repeatCustomersWithNewSkus,
    avgSkusPerRepeatCustomer: averageSkusPerRepeatCustomer(repeatCustomerSkuCount, repeatCustomers),
    customerSummaries,
  };
}

export function priorCustomerItemCodesFromSales(rows = []) {
  const byCustomer = new Map();
  (rows || []).forEach((row) => {
    if (netKpiSalesAmount(row) <= 0 || isCreditNoteTransaction(row)) return;
    const customer = normalizeSalesmanCode(row.customer_code);
    const itemCode = normalizeItemCode(row.item_code);
    if (!customer || !itemCode) return;
    let bucket = byCustomer.get(customer);
    if (!bucket) {
      bucket = new Set();
      byCustomer.set(customer, bucket);
    }
    bucket.add(itemCode);
  });
  return byCustomer;
}

export function buyingCustomerCodesFromSales(rows = []) {
  const codes = [];
  (rows || []).forEach((row) => {
    if (netKpiSalesAmount(row) <= 0 || isCreditNoteTransaction(row)) return;
    const code = normalizeSalesmanCode(row.customer_code);
    if (code) codes.push(code);
  });
  return codes;
}

export function sumSalesAmount(rows = []) {
  return (rows || []).reduce((sum, row) => sum + Number(row?.sales_amount || 0), 0);
}

export function sumCollectionAmount(rows = []) {
  return (rows || []).reduce((sum, row) => sum + Number(row?.amount_received || 0), 0);
}

/** Same account: 1084 and 1084C. Leaves names and non-numeric codes unchanged. */
export function collectionAccountKey(value) {
  const raw = normalizeSalesmanCode(value);
  if (!raw) return "";
  const trailingLetter = raw.match(/^(\d{3,6})[A-Z]$/);
  return trailingLetter ? trailingLetter[1] : raw;
}

/**
 * Customer lines from the receipt register. Bank, cash, and charge lines are the
 * other side of the same voucher. Collector "Receivable" accounts are not a customer.
 */
export function isKpiCollectionReceipt(row = {}) {
  if (!normalizeSalesmanCode(row?.customer_code)) return false;
  if (isCreditNoteReceiptType(row?.vch_type)) return false;
  const text = `${row?.particulars || ""} ${row?.customer_name || ""}`;
  if (/receivable/i.test(text)) return false;
  if (/bank|cash|charge/i.test(text)) return false;
  return true;
}

function receiptInKpiWindow(date, fromDate, toDate) {
  const day = String(date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  if (fromDate && day < fromDate) return false;
  if (toDate && day > toDate) return false;
  return true;
}

function receiptPlacementKey(date, voucher) {
  return `${String(date || "").slice(0, 10)}|${String(voucher || "").trim()}`;
}

/**
 * Customer receipt amount in the month that FIFO could not place on an invoice
 * dated on or before that receipt. Asrar Ahmed receipt 1955 (8,580 on 12 Oct)
 * is the day before invoice NFD/2010, so the allocation list is empty.
 */
export function unappliedCollectionReceipts(receipts = [], allocations = [], {
  fromDate = "",
  toDate = "",
} = {}) {
  const placed = new Map();
  (allocations || []).forEach((allocation) => {
    const day = String(allocation?.receipt_date || "").slice(0, 10);
    if (!receiptInKpiWindow(day, fromDate, toDate)) return;
    const key = receiptPlacementKey(day, allocation?.vch_no);
    placed.set(key, (placed.get(key) || 0) + Number(allocation?.amount || 0));
  });

  const byReceipt = new Map();
  (receipts || []).forEach((row) => {
    const day = String(row?.receipt_date || "").slice(0, 10);
    if (!receiptInKpiWindow(day, fromDate, toDate)) return;
    const amount = Number(row?.amount || 0);
    if (!(amount > 0)) return;
    const key = receiptPlacementKey(day, row?.vch_no);
    const current = byReceipt.get(key) || { date: day, voucher: String(row?.vch_no || "").trim(), amount: 0, row };
    current.amount += amount;
    byReceipt.set(key, current);
  });

  const leftovers = [];
  byReceipt.forEach((entry, key) => {
    const rest = Math.round((entry.amount - (placed.get(key) || 0)) * 100) / 100;
    if (rest > 0.009) leftovers.push({ ...entry, amount: rest });
  });
  return leftovers;
}

export function splitCollectionActualsByInvoice(transactions = [], collectionVisits = [], {
  fromDate = "",
  toDate = "",
  receiptRegister = false,
} = {}) {
  const receipts = receiptRegister
    ? (collectionVisits || []).filter(isKpiCollectionReceipt)
    : (collectionVisits || []).map((visit) => ({
      receipt_date: String(visit?.saved_at || "").slice(0, 10),
      amount: Number(visit?.amount_received || 0),
      vch_no: String(visit?.id || ""),
    }));
  const { allocations } = matchPaymentsFifo(transactions, receipts, {
    receiptOnOrAfterInvoice: Boolean(receiptRegister),
  });

  const totals = allocations.reduce((result, allocation) => {
    const receiptDate = String(allocation?.receipt_date || "").slice(0, 10);
    if ((fromDate && receiptDate < fromDate) || (toDate && receiptDate > toDate)) return result;
    if (isCashSalesVoucher(allocation?.voucher_number)) result.cashCollection += Number(allocation.amount || 0);
    else result.collection += Number(allocation.amount || 0);
    return result;
  }, { collection: 0, cashCollection: 0 });
  if (receiptRegister) {
    unappliedCollectionReceipts(receipts, allocations, { fromDate, toDate }).forEach((row) => {
      totals.collection += row.amount;
    });
  }
  return {
    collection: Math.round(totals.collection * 100) / 100,
    cashCollection: Math.round(totals.cashCollection * 100) / 100,
  };
}

export function buildPerformanceKpi(key, {
  actual = 0,
  target = 0,
  reportDate,
  todayIso,
  paceShares = null,
  salesAsOfDate,
  receiptAsOfDate,
} = {}) {
  const achievement = achievementPercent(actual, target);
  const salesPace = SALES_PACE_KPI_KEYS.has(key);
  const collectionPace = COLLECTION_PACE_KPI_KEYS.has(key);
  const status = kpiStatus({
    actual,
    target,
    reportDate,
    todayIso,
    paceShares: salesPace ? paceShares : null,
    dataAsOfDate: salesPace
      ? salesAsOfDate
      : (collectionPace ? receiptAsOfDate : undefined),
  });
  return {
    key,
    label: PERFORMANCE_KPI_LABELS[key] || key,
    actual: Number(actual || 0) || 0,
    target: Number(target || 0) || 0,
    achievement,
    expected: status.expected,
    paceGap: status.gap,
    status,
  };
}

export const TEAM_PERFORMANCE_VIEW = "TEAM";

export function consolidatePerformanceSnapshots(snapshots = [], {
  reportDate,
  salesmanName = "Team",
  todayIso,
  paceShares = null,
  salesAsOfDate,
  receiptAsOfDate,
  teamTargets = null,
} = {}) {
  const rows = (snapshots || []).filter(Boolean);
  const actuals = emptyPerformanceActuals();
  const targets = emptyPerformanceTargets();
  let latestUpdatedAt = null;
  let latestUpdatedByName = "";

  rows.forEach((row) => {
    PERFORMANCE_KPI_KEYS.forEach((key) => {
      actuals[key] += Number(row?.actuals?.[key] || 0);
      targets[key] += Number(row?.targets?.[key] || 0);
    });
    const updatedAt = row?.updatedAt || null;
    if (updatedAt && (!latestUpdatedAt || String(updatedAt) > String(latestUpdatedAt))) {
      latestUpdatedAt = updatedAt;
      latestUpdatedByName = row.updatedByName || "";
    }
  });

  const explicitTargets = normalizePerformanceTargets(teamTargets || {});
  const usesTeamTarget = PERFORMANCE_DISPLAY_KPI_KEYS.some((key) => Number(explicitTargets[key] || 0) > 0);

  return {
    ...buildPerformanceSnapshot({
      reportDate: reportDate || rows[0]?.reportDate,
      salesmanCode: TEAM_PERFORMANCE_VIEW,
      salesmanName,
      actuals,
      targets: usesTeamTarget ? explicitTargets : targets,
      updatedAt: latestUpdatedAt,
      updatedByName: latestUpdatedByName,
      todayIso: todayIso || rows[0]?.todayIso,
      paceShares: paceShares || rows[0]?.paceShares || null,
      salesAsOfDate: salesAsOfDate ?? rows[0]?.salesAsOfDate,
      receiptAsOfDate: receiptAsOfDate ?? rows[0]?.receiptAsOfDate,
    }),
    isTeam: true,
    memberCount: rows.length,
    usesTeamTarget,
  };
}

export function buildPerformanceSnapshot({
  reportDate,
  salesmanCode = "",
  salesmanName = "",
  actuals = emptyPerformanceActuals(),
  targets = emptyPerformanceTargets(),
  updatedAt = null,
  updatedByName = "",
  todayIso,
  paceShares = null,
  salesAsOfDate,
  receiptAsOfDate,
} = {}) {
  const normalizedTargets = normalizePerformanceTargets(targets);
  const normalizedActuals = withDerivedKpiActuals({
    ...emptyPerformanceActuals(),
    ...actuals,
  });
  const kpis = PERFORMANCE_DISPLAY_KPI_KEYS.map((key) => buildPerformanceKpi(key, {
    actual: normalizedActuals[key],
    target: INFORMATION_ONLY_KPI_KEYS.has(key) ? 0 : normalizedTargets[key],
    reportDate,
    todayIso,
    paceShares,
    salesAsOfDate,
    receiptAsOfDate,
  }));
  const componentScored = kpis.filter((kpi) => (
    kpi.key !== "totalSales"
    && kpi.key !== "totalCashCollected"
    && kpi.achievement != null
  ));
  const scored = componentScored.length
    ? componentScored
    : kpis.filter((kpi) => kpi.achievement != null);
  const hasTargets = kpis.some((kpi) => kpi.target > 0);
  const overall = scored.reduce((sum, kpi) => sum + Number(kpi.achievement || 0), 0)
    / Math.max(1, scored.length || 1);

  return {
    reportDate,
    monthStart: reportDate ? monthStartDate(reportDate) : "",
    salesmanCode: normalizeSalesmanCode(salesmanCode),
    salesmanName: String(salesmanName || "").trim(),
    actuals: normalizedActuals,
    targets: normalizedTargets,
    kpis,
    hasTargets,
    overallAchievement: kpis.some((kpi) => kpi.achievement != null) ? overall : null,
    updatedAt: updatedAt || null,
    updatedByName: String(updatedByName || "").trim(),
    published: hasTargets,
    todayIso: todayIso || null,
    paceShares: paceShares || null,
    salesAsOfDate: salesAsOfDate === undefined ? null : salesAsOfDate,
    receiptAsOfDate: receiptAsOfDate === undefined ? null : receiptAsOfDate,
  };
}

export function formatPerformanceKpiValue(key, value) {
  const number = Number(value || 0);
  if (MONEY_KPI_KEYS.has(key)) {
    return number.toLocaleString("en-SA", { maximumFractionDigits: 0 });
  }
  if (key === "avgSkusPerRepeatCustomer") {
    return number.toLocaleString("en-SA", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  }
  return String(Math.round(number));
}

export function formatAchievementPercent(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Number(value).toFixed(1)}%`;
}

export function formatPerformanceUpdatedAt(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const text = String(value).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
  }
  return date.toLocaleDateString("en-GB", {
    timeZone: KSA_TIMEZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function performanceUpdatedStatusLabel(snapshot) {
  if (!snapshot?.hasTargets) return "Targets not set";
  const when = formatPerformanceUpdatedAt(snapshot.updatedAt);
  const who = String(snapshot.updatedByName || "").trim();
  if (when && who) return `Targets updated ${when} by ${who}`;
  if (when) return `Targets updated ${when}`;
  return "Targets published";
}

export function formatPerformanceKpiLine(kpi) {
  const actual = formatPerformanceKpiValue(kpi.key, kpi.actual);
  const target = kpi.target > 0 ? formatPerformanceKpiValue(kpi.key, kpi.target) : "—";
  const achievement = formatAchievementPercent(kpi.achievement);
  return `${kpi.label}: ${actual} / ${target} (${achievement}) — ${kpi.status?.label || "No target"}`;
}
