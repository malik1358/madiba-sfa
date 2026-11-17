export const PRICE_CODE_ALIASES = {
  // Photocopy paper rebrands / replacements
  A005425: ["A004555", "A000057", "A003234"],
  // MADIBA vinyl gloves: old 100 pcs/box codes → current 70 pcs/box codes
  A006297: ["A003946"],
  A006298: ["A003947"],
  A006299: ["A003948"],
  A006300: ["A003949"],
  // Soap / returns history: old code is the same product
  A003928: ["A003927"],
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

/** Preferred live code for a replacement family (target of PRICE_CODE_ALIASES). */
export function resolveCanonicalItemCode(itemCode) {
  const code = normalizeItemCode(itemCode);
  if (!code) return "";
  for (const [targetCode, sourceCodes] of Object.entries(PRICE_CODE_ALIASES)) {
    const target = normalizeItemCode(targetCode);
    const family = [target, ...(sourceCodes || []).map(normalizeItemCode)].filter(Boolean);
    if (family.includes(code)) return target;
  }
  return code;
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
