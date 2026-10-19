export const PRICE_CODE_ALIASES = {
  A005425: ["A004555", "A000057", "A003234"],
};

export function normalizeItemCode(value) {
  return String(value || "").trim().toUpperCase();
}

export function getRelatedItemCodes(itemCode) {
  const code = normalizeItemCode(itemCode);
  const related = new Set(code ? [code] : []);

  Object.entries(PRICE_CODE_ALIASES).forEach(([targetCode, sourceCodes]) => {
    const family = [normalizeItemCode(targetCode), ...(sourceCodes || []).map(normalizeItemCode)].filter(Boolean);
    if (!family.includes(code)) return;
    family.forEach((entry) => related.add(entry));
  });

  return [...related];
}

export function lookupPositiveRate(rateMap, itemCode, fallback = 0) {
  const codes = getRelatedItemCodes(itemCode);
  for (const code of codes) {
    const rate = Number(rateMap?.[code] ?? rateMap?.[String(code || "").trim()] ?? 0);
    if (Number.isFinite(rate) && rate > 0) return rate;
  }

  const fallbackRate = Number(fallback || 0);
  return Number.isFinite(fallbackRate) && fallbackRate > 0 ? fallbackRate : 0;
}

export function applyPriceCodeAliases(priceMap) {
  const next = { ...(priceMap || {}) };

  Object.entries(PRICE_CODE_ALIASES).forEach(([targetCode, sourceCodes]) => {
    const family = [normalizeItemCode(targetCode), ...(sourceCodes || []).map(normalizeItemCode)].filter(Boolean);
    const donor = family.find((code) => Number(next[code] || 0) > 0);
    if (!donor) return;

    const rate = Number(next[donor]);
    family.forEach((code) => {
      if (!(Number(next[code] || 0) > 0)) next[code] = rate;
    });
  });

  return next;
}
