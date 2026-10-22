export function buildCustomerHistoryApiUrl(
  customerHistoryApi,
  customerCode,
  customerName = "",
  { fullHistory = false, scope = "", refresh = false, waitReceipts = false } = {},
) {
  const [baseUrl, existingQuery = ""] = String(customerHistoryApi || "").split("?", 2);
  const params = new URLSearchParams(existingQuery);
  params.set("customerCode", String(customerCode || "").trim());

  const nameValue = String(customerName || "").trim();
  if (nameValue) {
    params.set("customerName", nameValue);
  }

  if (fullHistory) {
    params.set("fullHistory", "1");
  }

  const normalizedScope = String(scope || "").trim();
  if (normalizedScope) {
    params.set("scope", normalizedScope);
  }

  if (refresh) {
    params.set("refresh", "1");
  }

  if (waitReceipts) {
    params.set("waitReceipts", "1");
  }

  const query = params.toString();
  return query ? `${baseUrl}?${query}` : baseUrl;
}

export function buildSettlementCustomerHistoryUrl(
  customerHistoryApi,
  customerCode,
  customerName = "",
  { refresh = false } = {},
) {
  return buildCustomerHistoryApiUrl(customerHistoryApi, customerCode, customerName, {
    fullHistory: true,
    scope: "settlement",
    refresh,
    // Order PDF and New Order draw Paid/Open immediately. They cannot use the
    // audit screen's "receipts arrive later" response, or every bill looks open.
    waitReceipts: true,
  });
}
