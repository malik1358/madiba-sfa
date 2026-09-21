import { buildPaymentSettlementLedger } from "./paymentBehavior.js";

export async function resolveTrustedAvgDaysToPayForCustomer({
  request,
  authHeader,
  customerCode,
  customerName = "",
}) {
  const origin = new URL(request.url).origin;
  const historyQuery = new URLSearchParams({
    customerCode: String(customerCode || ""),
    customerName: String(customerName || ""),
    fullHistory: "1",
    scope: "settlement",
  });

  const [historyResponse, outstandingResponse] = await Promise.all([
    fetch(`${origin}/api/customer-history?${historyQuery.toString()}`, {
      method: "GET",
      headers: { authorization: authHeader },
      cache: "no-store",
    }),
    fetch(`${origin}/api/outstanding?customerCode=${encodeURIComponent(customerCode || "")}&customerName=${encodeURIComponent(customerName || "")}`, {
      method: "GET",
      headers: { authorization: authHeader },
      cache: "no-store",
    }).catch(() => null),
  ]);

  const historyPayload = await historyResponse.json().catch(() => ({}));
  if (!historyResponse.ok || !historyPayload.success) {
    throw new Error(historyPayload.error || "Unable to validate customer payment average.");
  }

  const outstandingPayload = outstandingResponse
    ? await outstandingResponse.json().catch(() => ({}))
    : {};

  const settlement = buildPaymentSettlementLedger({
    transactions: Array.isArray(historyPayload.transactions) ? historyPayload.transactions : [],
    receipts: Array.isArray(historyPayload.receipts) ? historyPayload.receipts : [],
    outstandingCustomer: outstandingPayload?.success ? (outstandingPayload.customer || null) : null,
    outstandingInvoices: outstandingPayload?.success && Array.isArray(outstandingPayload.customerInvoices)
      ? outstandingPayload.customerInvoices
      : [],
  });

  return settlement?.summary?.avgDaysToPay ?? null;
}
