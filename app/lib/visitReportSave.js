const STOCK_CHECK_LIMIT = 80;

export function slimVisitStockChecks(stockChecks = [], limit = STOCK_CHECK_LIMIT) {
  const list = Array.isArray(stockChecks) ? stockChecks : [];
  const mapped = list.map((item) => ({
    itemCode: String(item?.itemCode || "").trim(),
    itemName: String(item?.itemName || "").trim(),
    status: String(item?.status || "").trim(),
  }));
  const withStatus = mapped.filter((item) => item.status);
  const source = withStatus.length ? withStatus : mapped;
  return source.slice(0, Math.max(0, Number(limit) || STOCK_CHECK_LIMIT));
}
