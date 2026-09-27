import { buildPaymentBehavior } from "./paymentBehavior.js";
import {
  fetchCustomerHistoryCached,
  fetchOutstandingCached,
  fetchSalesScopeCached,
} from "./mobileDataCache.js";

export const AVG_DAYS_TO_PAY_WHATSAPP_LABEL = "Avg days to pay";
export const AVG_DAYS_TO_PAY_6M_WHATSAPP_LABEL = "6-month avg";

function toFiniteDays(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Normalize local customer/queue fields into the WhatsApp avg-days payload.
 * Prefer already-loaded row values so offline-first saves never wait on history.
 */
export function resolveLocalAvgDaysToPay(source = {}) {
  if (source == null) return null;
  if (typeof source === "number" || typeof source === "string") {
    const lifetimeOnly = toFiniteDays(source);
    return lifetimeOnly == null ? null : { avgDaysToPay: lifetimeOnly, avgDaysToPay6m: null };
  }

  const lifetime = toFiniteDays(
    source.avgDaysToPay ?? source.avg_days_to_pay,
  );
  const sixMonth = toFiniteDays(
    source.avgDaysToPay6m ?? source.avg_days_to_pay_6m,
  );
  if (lifetime == null && sixMonth == null) return null;
  return {
    avgDaysToPay: lifetime,
    avgDaysToPay6m: sixMonth,
  };
}

/**
 * Blank line above the avg-days line. The GPS block that follows starts with its own
 * blank line, which provides the gap below.
 * Accepts a number (lifetime only) or `{ avgDaysToPay, avgDaysToPay6m }`.
 */
export function formatAvgDaysToPayWhatsappLines(avgDaysToPay, labels = {}) {
  let lifetime = avgDaysToPay;
  let sixMonth = labels.avgDaysToPay6m;
  if (avgDaysToPay != null && typeof avgDaysToPay === "object") {
    lifetime = avgDaysToPay.avgDaysToPay;
    sixMonth = avgDaysToPay.avgDaysToPay6m ?? sixMonth;
  }

  const lines = [];
  const lifetimeValue = toFiniteDays(lifetime);
  const sixValue = toFiniteDays(sixMonth);
  const label = labels.avgDaysToPay || AVG_DAYS_TO_PAY_WHATSAPP_LABEL;
  const sixLabel = labels.avgDaysToPay6mLabel || AVG_DAYS_TO_PAY_6M_WHATSAPP_LABEL;

  if (lifetimeValue != null) {
    if (!lines.length) lines.push("");
    lines.push(`${label}: ${Math.round(lifetimeValue)}`);
  }
  if (sixValue != null) {
    if (!lines.length) lines.push("");
    lines.push(`${sixLabel}: ${Math.round(sixValue)}`);
  }
  return lines;
}

export async function loadCustomerAvgDaysToPay({
  accessToken = "",
  customerCode = "",
  customerName = "",
  scope = null,
} = {}) {
  const code = String(customerCode || "").trim();
  const token = String(accessToken || "").trim();
  if (!code || !token) return null;

  try {
    let resolvedScope = scope;
    if (!resolvedScope) {
      try {
        const scopeResult = await fetchSalesScopeCached();
        resolvedScope = scopeResult?.scope || null;
      } catch {
        resolvedScope = null;
      }
    }

    const historyResult = await fetchCustomerHistoryCached(token, resolvedScope, code, {
      customerName,
    });
    const history = historyResult?.data || {};

    let outstandingCustomer = null;
    let outstandingInvoices = [];
    try {
      const outstandingResult = await fetchOutstandingCached(token, code, customerName);
      const outstanding = outstandingResult?.data || {};
      outstandingCustomer = outstanding.customer || null;
      outstandingInvoices = Array.isArray(outstanding.customerInvoices)
        ? outstanding.customerInvoices
        : [];
    } catch {
      // Outstanding is optional — paid receipts alone can still yield avg days.
    }

    const behavior = buildPaymentBehavior({
      transactions: Array.isArray(history.transactions) ? history.transactions : [],
      receipts: Array.isArray(history.receipts) ? history.receipts : [],
      outstandingCustomer,
      outstandingInvoices,
    });

    if (behavior?.avgDaysToPay == null && behavior?.avgDaysToPay6m == null) {
      return null;
    }

    return {
      avgDaysToPay: behavior?.avgDaysToPay ?? null,
      avgDaysToPay6m: behavior?.avgDaysToPay6m ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Prefetch avg days when a visit form opens so save can stay offline-first
 * and still include the figure in WhatsApp when history is already warm.
 */
export function prefetchCustomerAvgDaysForVisit(options = {}) {
  return loadCustomerAvgDaysToPay(options);
}

export async function awaitAvgDaysPrefetch(promise, timeoutMs = 1500) {
  if (!promise || typeof promise.then !== "function") return null;
  const timeout = Math.max(0, Number(timeoutMs) || 0);
  try {
    if (timeout <= 0) return await promise;
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        setTimeout(() => resolve(null), timeout);
      }),
    ]);
  } catch {
    return null;
  }
}
