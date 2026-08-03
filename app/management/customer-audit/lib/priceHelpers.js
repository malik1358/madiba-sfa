/**
 * Small utility for price lookup normalization.
 * Keeps the same behaviour used across the page: trim + toUpperCase.
 */
export function getPrice(priceList = {}, itemCode) {
  if (!itemCode) return 0;

  const key = String(itemCode).trim().toUpperCase();

  const value = priceList[key];

  return Number(value || 0);
}
