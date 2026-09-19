import { buildPaymentBehavior } from "./paymentBehavior.js";
import {
  fetchCustomerHistoryCached,
  fetchOutstandingCached,
  fetchSalesScopeCached,
} from "./mobileDataCache.js";

export const AVG_DAYS_TO_PAY_WHATSAPP_LABEL = "Avg days to pay";

/**
 * Blank line above the avg-days line. The GPS block that follows starts with its own
 * blank line, which provides the gap below.
 */
export function formatAvgDaysToPayWhatsappLines(avgDaysToPay, labels = {}) {
  if (avgDaysToPay == null || avgDaysToPay === "") return [];
  const value = Number(avgDaysToPay);
  if (!Number.isFinite(value)) return [];
  const label = labels.avgDaysToPay || AVG_DAYS_TO_PAY_WHATSAPP_LABEL;
  return ["", `${label}: ${Math.round(value)}`];
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

    return behavior?.avgDaysToPay ?? null;
  } catch {
    return null;
  }
}
