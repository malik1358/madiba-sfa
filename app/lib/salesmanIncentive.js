import {
  isCashSalesVoucher,
  isCreditNoteTransaction,
  matchPaymentsFifo,
} from "./paymentBehavior.js";
import { isOfficeSuppliesSale, normalizeSalesmanCode } from "./performanceKpis.js";
import { ECOM_SALESMAN_TOKENS } from "./salesmanTeamMom.js";
import { amountInclVatFromExcl, vatRateForProduct } from "./regionalPricing.js";
import { parseOutstandingSheetDate, toNumber } from "./outstanding.js";
import { currentMonthDateRange } from "./salesInvoices.js";

/** Day buckets measured from invoice date to receipt date. */
export const INCENTIVE_FAST_DAYS = 35;
export const INCENTIVE_SLOW_DAYS = 60;
/** Cash deals (RC / DC / JC vouchers) must be collected inside this window. */
export const INCENTIVE_CASH_DAYS = 3;

/** Scheme rates. Collection rates apply to the net (ex-VAT) value collected. */
export const INCENTIVE_RATES = {
  cashFast: 0.002,
  officeSuppliesFast: 0.0025,
  electronicsFast: 0.004,
  electronicsSlow: 0.002,
  otherFast: 0.01,
  otherSlow: 0.005,
  salesGrowth: 0.005,
};

export const INCENTIVE_TIER_KEYS = [
  "cashFast",
  "officeSuppliesFast",
  "electronicsFast",
  "electronicsSlow",
  "otherFast",
  "otherSlow",
  "late",
];

export const INCENTIVE_TIER_LABELS = {
  cashFast: { en: "Cash ≤3d", ar: "نقدي ≤3 أيام" },
  officeSuppliesFast: { en: "Office ≤35d", ar: "قرطاسية ≤35 يوم" },
  electronicsFast: { en: "Electronics ≤35d", ar: "إلكترونيات ≤35 يوم" },
  electronicsSlow: { en: "Electronics 36-60d", ar: "إلكترونيات 36-60 يوم" },
  otherFast: { en: "Other ≤35d", ar: "أخرى ≤35 يوم" },
  otherSlow: { en: "Other 36-60d", ar: "أخرى 36-60 يوم" },
  late: { en: "Late (no incentive)", ar: "متأخر (بدون حافز)" },
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_KEY = /^\d{4}-\d{2}$/;
const LATE_TIER = { key: "late", rate: 0 };

function dateOnly(value) {
  return parseOutstandingSheetDate(value) || String(value || "").slice(0, 10);
}

function round2(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100) / 100;
}

function invoiceKey(invoiceDate, voucherNumber) {
  return `${dateOnly(invoiceDate)}::${String(voucherNumber || "").trim()}`;
}

function emptyTierBase() {
  return INCENTIVE_TIER_KEYS.reduce((carry, key) => {
    carry[key] = 0;
    return carry;
  }, {});
}

export function parseIncentiveMonth(value, fallbackIso = "") {
  const text = String(value || "").trim().slice(0, 7);
  if (MONTH_KEY.test(text)) return text;
  const fallback = String(fallbackIso || "").trim().slice(0, 7);
  if (MONTH_KEY.test(fallback)) return fallback;
  throw new Error("Invalid month. Use YYYY-MM.");
}

export function shiftIncentiveMonth(month, offset = -1) {
  const key = String(month || "").slice(0, 7);
  if (!MONTH_KEY.test(key)) return "";
  const year = Number(key.slice(0, 4));
  const index = Number(key.slice(5, 7)) - 1 + Number(offset || 0);
  const shifted = new Date(Date.UTC(year, index, 1));
  return shifted.toISOString().slice(0, 7);
}

export function incentiveMonthRange(month) {
  const key = parseIncentiveMonth(month);
  return currentMonthDateRange(`${key}-01`);
}

export function isElectronicsSale(row = {}) {
  const text = [row.category, row.item_category, row.group]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
  if (!text) return false;
  return /electronic/.test(text)
    || /electrical/.test(text)
    || text.includes("إلكترون")
    || text.includes("الكترون")
    || text.includes("كهربائ");
}

/** Incentive category class for one sales line. Office supplies wins over electronics. */
export function classifyIncentiveCategory(row = {}) {
  if (isOfficeSuppliesSale(row)) return "officeSupplies";
  if (isElectronicsSale(row)) return "electronics";
  return "other";
}

/**
 * Scheme tier for one collected chunk.
 * Cash deals (RC / DC / JC vouchers) only earn 0.20%, and only within 3 days.
 * No category rate applies to a cash deal.
 * Office supplies: 0.25% within 35 days.
 * Electronics: 0.40% within 35 days, 0.20% within 60 days.
 * Other categories: 1% within 35 days, 0.5% within 60 days.
 */
export function collectionIncentiveTier(days, { category = "other", cashDeal = false } = {}) {
  if (days == null || days === "") return { ...LATE_TIER };
  const value = Number(days);
  if (!Number.isFinite(value) || value < 0) return { ...LATE_TIER };

  if (cashDeal) {
    return value <= INCENTIVE_CASH_DAYS
      ? { key: "cashFast", rate: INCENTIVE_RATES.cashFast }
      : { ...LATE_TIER };
  }
  if (category === "officeSupplies") {
    return value <= INCENTIVE_FAST_DAYS
      ? { key: "officeSuppliesFast", rate: INCENTIVE_RATES.officeSuppliesFast }
      : { ...LATE_TIER };
  }
  if (category === "electronics") {
    if (value <= INCENTIVE_FAST_DAYS) return { key: "electronicsFast", rate: INCENTIVE_RATES.electronicsFast };
    if (value <= INCENTIVE_SLOW_DAYS) return { key: "electronicsSlow", rate: INCENTIVE_RATES.electronicsSlow };
    return { ...LATE_TIER };
  }
  if (value <= INCENTIVE_FAST_DAYS) return { key: "otherFast", rate: INCENTIVE_RATES.otherFast };
  if (value <= INCENTIVE_SLOW_DAYS) return { key: "otherSlow", rate: INCENTIVE_RATES.otherSlow };
  return { ...LATE_TIER };
}

/**
 * Per-invoice category split with both VAT bases and the cash-deal flag.
 * Keys match the invoice keys produced by `matchPaymentsFifo` allocations.
 */
export function buildInvoiceCategoryProfiles(transactions = []) {
  const map = new Map();

  (Array.isArray(transactions) ? transactions : []).forEach((row) => {
    if (isCreditNoteTransaction(row)) return;
    const invoiceDate = dateOnly(row?.transaction_date);
    if (!ISO_DATE.test(invoiceDate)) return;
    const amountExclVat = toNumber(row?.sales_amount);
    if (amountExclVat <= 0) return;

    const voucher = String(row?.voucher_number || row?.reference || "").trim();
    const key = invoiceKey(invoiceDate, voucher);
    const current = map.get(key) || {
      invoice_date: invoiceDate,
      voucher_number: voucher,
      is_cash: isCashSalesVoucher(voucher),
      salesman_code: "",
      salesman_name: "",
      office_excl: 0,
      electronics_excl: 0,
      other_excl: 0,
      total_excl: 0,
      total_incl: 0,
    };

    const vatRate = vatRateForProduct({
      category: row?.category,
      item_name: row?.item_name,
      item_code: row?.item_code,
    });
    const category = classifyIncentiveCategory(row);
    if (category === "officeSupplies") current.office_excl += amountExclVat;
    else if (category === "electronics") current.electronics_excl += amountExclVat;
    else current.other_excl += amountExclVat;
    current.total_excl += amountExclVat;
    current.total_incl += amountInclVatFromExcl(amountExclVat, vatRate);

    if (!current.salesman_code) {
      current.salesman_code = normalizeSalesmanCode(row?.salesman_code);
      current.salesman_name = String(row?.salesman_name || "").trim();
    }
    map.set(key, current);
  });

  return map;
}

/**
 * Collection incentive rows for one customer.
 * Receipts are FIFO-settled against that customer's invoices, then each settled
 * chunk is split by category using the invoice's own item mix. Cash-deal
 * invoices are not split — the whole chunk takes the cash rate.
 * Incentive base is the net (ex-VAT) share of the VAT-inclusive cash collected.
 */
export function buildCustomerIncentiveRows({
  customerCode = "",
  customerName = "",
  transactions = [],
  receipts = [],
  fromDate = "",
  toDate = "",
} = {}) {
  const from = dateOnly(fromDate);
  const to = dateOnly(toDate);
  const profiles = buildInvoiceCategoryProfiles(transactions);
  const { allocations } = matchPaymentsFifo(transactions, receipts);

  return (allocations || [])
    .filter((allocation) => {
      const receiptDate = dateOnly(allocation?.receipt_date);
      if (!ISO_DATE.test(receiptDate)) return false;
      if (from && receiptDate < from) return false;
      if (to && receiptDate > to) return false;
      return true;
    })
    .map((allocation) => {
      const profile = profiles.get(invoiceKey(allocation.invoice_date, allocation.voucher_number));
      const collected = toNumber(allocation.amount);
      const totalIncl = toNumber(profile?.total_incl);
      const isCash = profile
        ? Boolean(profile.is_cash)
        : isCashSalesVoucher(allocation.voucher_number);
      const days = Number(allocation.days);

      const bases = { cash: 0, officeSupplies: 0, electronics: 0, other: 0 };
      if (totalIncl <= 0) {
        bases[isCash ? "cash" : "other"] = collected;
      } else if (isCash) {
        bases.cash = (collected * toNumber(profile.total_excl)) / totalIncl;
      } else {
        bases.officeSupplies = (collected * toNumber(profile.office_excl)) / totalIncl;
        bases.electronics = (collected * toNumber(profile.electronics_excl)) / totalIncl;
        bases.other = (collected * toNumber(profile.other_excl)) / totalIncl;
      }

      const tiers = {
        cash: collectionIncentiveTier(days, { cashDeal: true }),
        officeSupplies: collectionIncentiveTier(days, { category: "officeSupplies" }),
        electronics: collectionIncentiveTier(days, { category: "electronics" }),
        other: collectionIncentiveTier(days, { category: "other" }),
      };

      const parts = ["cash", "officeSupplies", "electronics", "other"]
        .map((name) => ({
          base: bases[name],
          tier: tiers[name].key,
          incentive: bases[name] * tiers[name].rate,
        }))
        .filter((part) => part.base > 0);
      const primary = parts.reduce((best, part) => (best && best.base >= part.base ? best : part), null);

      return {
        customer_code: customerCode,
        customer_name: customerName,
        salesman_code: profile?.salesman_code || "",
        salesman_name: profile?.salesman_name || "",
        invoice_date: dateOnly(allocation.invoice_date),
        voucher_number: String(allocation.voucher_number || ""),
        receipt_date: dateOnly(allocation.receipt_date),
        vch_no: String(allocation.vch_no || ""),
        days,
        is_cash: isCash,
        collected_amount: round2(collected),
        cash_base: round2(bases.cash),
        office_base: round2(bases.officeSupplies),
        electronics_base: round2(bases.electronics),
        other_base: round2(bases.other),
        base: round2(bases.cash + bases.officeSupplies + bases.electronics + bases.other),
        cash_tier: tiers.cash.key,
        office_tier: tiers.officeSupplies.key,
        electronics_tier: tiers.electronics.key,
        other_tier: tiers.other.key,
        cash_incentive: round2(bases.cash * tiers.cash.rate),
        office_incentive: round2(bases.officeSupplies * tiers.officeSupplies.rate),
        electronics_incentive: round2(bases.electronics * tiers.electronics.rate),
        other_incentive: round2(bases.other * tiers.other.rate),
        incentive: round2(parts.reduce((total, part) => total + part.incentive, 0)),
        primary_tier: primary ? primary.tier : "late",
      };
    })
    .filter((row) => row.base > 0);
}

/** Net sales (sales minus credit notes / returns, ex-VAT) per salesman per month. */
export function buildMonthlyNetSalesBySalesman(transactions = [], target = new Map()) {
  (Array.isArray(transactions) ? transactions : []).forEach((row) => {
    const date = dateOnly(row?.transaction_date);
    if (!ISO_DATE.test(date)) return;
    const month = date.slice(0, 7);
    const code = normalizeSalesmanCode(row?.salesman_code);
    if (!code) return;
    const amount = toNumber(row?.sales_amount);
    if (!amount) return;
    const signed = isCreditNoteTransaction(row) ? -Math.abs(amount) : amount;

    const byMonth = target.get(code) || new Map();
    byMonth.set(month, toNumber(byMonth.get(month)) + signed);
    target.set(code, byMonth);
  });
  return target;
}

export function computeGrowthIncentive(currentMonthSales, benchmarkSales, { hasHistory = true } = {}) {
  const current = toNumber(currentMonthSales);
  const benchmark = toNumber(benchmarkSales);
  const delta = current - benchmark;
  return {
    currentMonthSales: round2(current),
    benchmarkSales: round2(benchmark),
    salesDelta: hasHistory ? round2(delta) : 0,
    growthIncentive: hasHistory && delta > 0 ? round2(delta * INCENTIVE_RATES.salesGrowth) : 0,
  };
}

/**
 * Best net-sales month before the report month, across all loaded history.
 * The current month is never its own benchmark. `hasHistory` is false in a
 * salesman's very first month, when there is nothing to compare against.
 */
export function resolvePeakMonthlySales(byMonth, currentMonthKey) {
  const entries = byMonth instanceof Map ? [...byMonth.entries()] : Object.entries(byMonth || {});
  let peakMonth = "";
  let peakSales = 0;
  let hasHistory = false;
  entries.forEach(([month, amount]) => {
    const key = String(month || "").slice(0, 7);
    if (!MONTH_KEY.test(key) || key >= currentMonthKey) return;
    hasHistory = true;
    const value = toNumber(amount);
    if (!peakMonth || value > peakSales) {
      peakMonth = key;
      peakSales = value;
    }
  });
  // A salesman whose every past month was negative still gets a zero floor.
  return {
    peakMonth: peakSales > 0 ? peakMonth : "",
    peakSales: Math.max(0, peakSales),
    hasHistory,
  };
}

/** TRENDYOL / NOON are ecom channels, not salesmen, so they earn no incentive. */
export function isExcludedIncentiveSalesman({ salesman_code: code, salesman_name: name } = {}) {
  return [code, name].some((value) => {
    const token = String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
    return Boolean(token) && ECOM_SALESMAN_TOKENS.has(token);
  });
}

function emptySalesmanSummary(code = "", name = "") {
  return {
    salesman_code: code,
    salesman_name: name || "",
    collected_amount: 0,
    cash_base: 0,
    office_base: 0,
    electronics_base: 0,
    other_base: 0,
    base: 0,
    tier_base: emptyTierBase(),
    tier_incentive: emptyTierBase(),
    eligible_base: 0,
    late_base: 0,
    collection_incentive: 0,
    current_month_sales: 0,
    has_sales_history: false,
    peak_month: "",
    peak_month_sales: 0,
    sales_delta: 0,
    growth_incentive: 0,
    total_incentive: 0,
    receipt_count: 0,
  };
}

function addRowToSummary(summary, row) {
  summary.collected_amount += row.collected_amount;
  summary.cash_base += row.cash_base;
  summary.office_base += row.office_base;
  summary.electronics_base += row.electronics_base;
  summary.other_base += row.other_base;
  summary.base += row.base;
  summary.collection_incentive += row.incentive;
  summary.receipt_count += 1;
  summary.tier_base[row.cash_tier] += row.cash_base;
  summary.tier_base[row.office_tier] += row.office_base;
  summary.tier_base[row.electronics_tier] += row.electronics_base;
  summary.tier_base[row.other_tier] += row.other_base;
  summary.tier_incentive[row.cash_tier] += row.cash_incentive;
  summary.tier_incentive[row.office_tier] += row.office_incentive;
  summary.tier_incentive[row.electronics_tier] += row.electronics_incentive;
  summary.tier_incentive[row.other_tier] += row.other_incentive;
}

function roundSummary(summary) {
  const tierBase = INCENTIVE_TIER_KEYS.reduce((carry, key) => {
    carry[key] = round2(summary.tier_base[key]);
    return carry;
  }, {});
  const tierIncentive = INCENTIVE_TIER_KEYS.reduce((carry, key) => {
    carry[key] = round2(summary.tier_incentive[key]);
    return carry;
  }, {});

  return {
    ...summary,
    collected_amount: round2(summary.collected_amount),
    cash_base: round2(summary.cash_base),
    office_base: round2(summary.office_base),
    electronics_base: round2(summary.electronics_base),
    other_base: round2(summary.other_base),
    base: round2(summary.base),
    tier_base: tierBase,
    tier_incentive: tierIncentive,
    eligible_base: round2(
      INCENTIVE_TIER_KEYS
        .filter((key) => key !== "late")
        .reduce((total, key) => total + tierBase[key], 0),
    ),
    late_base: tierBase.late,
    current_month_sales: round2(summary.current_month_sales),
    peak_month_sales: round2(summary.peak_month_sales),
    sales_delta: round2(summary.sales_delta),
    growth_incentive: round2(summary.growth_incentive),
    collection_incentive: round2(summary.collection_incentive),
    total_incentive: round2(summary.collection_incentive + summary.growth_incentive),
  };
}

/**
 * Full incentive report for a month.
 *
 * @param {object} options
 * @param {string} options.month YYYY-MM
 * @param {Array} options.customers `{ customerCode, customerName, transactions, receipts }`
 * @param {Array<string>|null} options.salesmanCodes Restrict output to these codes.
 * @param {Map|null} options.monthlySalesBySalesman All-history `code -> month -> net sales`.
 *   Falls back to the (shorter) span derivable from `customers`.
 */
export function buildSalesmanIncentiveReport({
  month,
  customers = [],
  salesmanCodes = null,
  monthlySalesBySalesman = null,
} = {}) {
  const monthKey = parseIncentiveMonth(month);
  const range = incentiveMonthRange(monthKey);
  const allowed = Array.isArray(salesmanCodes) && salesmanCodes.length
    ? new Set(salesmanCodes.map((code) => normalizeSalesmanCode(code)).filter(Boolean))
    : null;

  const derivedMonthlySales = new Map();
  const names = new Map();
  let rows = [];

  (Array.isArray(customers) ? customers : []).forEach((customer) => {
    const transactions = Array.isArray(customer?.transactions) ? customer.transactions : [];
    buildMonthlyNetSalesBySalesman(transactions, derivedMonthlySales);
    transactions.forEach((row) => {
      const code = normalizeSalesmanCode(row?.salesman_code);
      const name = String(row?.salesman_name || "").trim();
      if (code && name && !names.has(code)) names.set(code, name);
    });

    rows = rows.concat(buildCustomerIncentiveRows({
      customerCode: customer?.customerCode || "",
      customerName: customer?.customerName || "",
      transactions,
      receipts: Array.isArray(customer?.receipts) ? customer.receipts : [],
      fromDate: range.from,
      toDate: range.to,
    }));
  });

  const monthlySales = monthlySalesBySalesman instanceof Map && monthlySalesBySalesman.size
    ? monthlySalesBySalesman
    : derivedMonthlySales;

  const visibleRows = rows
    .filter((row) => !allowed || allowed.has(row.salesman_code))
    .filter((row) => !isExcludedIncentiveSalesman(row))
    .sort((left, right) => (
      left.receipt_date.localeCompare(right.receipt_date)
      || left.customer_code.localeCompare(right.customer_code)
      || left.invoice_date.localeCompare(right.invoice_date)
    ));

  const summaries = new Map();
  function summaryFor(code) {
    if (!summaries.has(code)) summaries.set(code, emptySalesmanSummary(code, names.get(code)));
    return summaries.get(code);
  }

  visibleRows.forEach((row) => addRowToSummary(summaryFor(row.salesman_code), row));

  monthlySales.forEach((byMonth, code) => {
    if (allowed && !allowed.has(code)) return;
    if (isExcludedIncentiveSalesman({ salesman_code: code, salesman_name: names.get(code) })) return;
    const current = toNumber(byMonth.get(monthKey));
    const { peakMonth, peakSales, hasHistory } = resolvePeakMonthlySales(byMonth, monthKey);
    if (!current && !peakSales && !summaries.has(code)) return;
    const summary = summaryFor(code);
    const growth = computeGrowthIncentive(current, peakSales, { hasHistory });
    summary.has_sales_history = hasHistory;
    summary.current_month_sales = growth.currentMonthSales;
    summary.peak_month = peakMonth;
    summary.peak_month_sales = growth.benchmarkSales;
    summary.sales_delta = growth.salesDelta;
    summary.growth_incentive = growth.growthIncentive;
  });

  const salesmen = [...summaries.values()]
    .map(roundSummary)
    .sort((left, right) => (
      right.total_incentive - left.total_incentive
      || left.salesman_code.localeCompare(right.salesman_code)
    ));

  const totals = salesmen.reduce((carry, summary) => {
    carry.collected_amount += summary.collected_amount;
    carry.cash_base += summary.cash_base;
    carry.office_base += summary.office_base;
    carry.electronics_base += summary.electronics_base;
    carry.other_base += summary.other_base;
    carry.base += summary.base;
    carry.collection_incentive += summary.collection_incentive;
    carry.current_month_sales += summary.current_month_sales;
    carry.peak_month_sales += summary.peak_month_sales;
    carry.sales_delta += summary.sales_delta;
    carry.growth_incentive += summary.growth_incentive;
    carry.receipt_count += summary.receipt_count;
    INCENTIVE_TIER_KEYS.forEach((key) => {
      carry.tier_base[key] += summary.tier_base[key];
      carry.tier_incentive[key] += summary.tier_incentive[key];
    });
    return carry;
  }, emptySalesmanSummary());

  return {
    month: monthKey,
    monthStart: range.from,
    monthEnd: range.to,
    rates: INCENTIVE_RATES,
    tierKeys: INCENTIVE_TIER_KEYS,
    fastDays: INCENTIVE_FAST_DAYS,
    slowDays: INCENTIVE_SLOW_DAYS,
    cashDays: INCENTIVE_CASH_DAYS,
    salesmen,
    rows: visibleRows,
    totals: roundSummary(totals),
  };
}
