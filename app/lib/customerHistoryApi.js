export function buildCustomerHistoryApiUrl(
  customerHistoryApi,
  customerCode,
  customerName = "",
  { fullHistory = false, scope = "", refresh = false } = {},
) {
  const params = new URLSearchParams({
    customerCode: String(customerCode || ""),
  });

  const nameValue = String(customerName || "");
  if (nameValue.trim()) {
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

  return `${customerHistoryApi}?${params.toString()}`;
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
  });
}
