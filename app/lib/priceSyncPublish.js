/**
 * Price sync may only publish rates that came from the Google Sheet / Apps Script
 * feed (or the costing-sheet CSV enrichment of that same workbook). Historical
 * active_sales rates must never fill gaps for codes missing from the sheet.
 */

function toPositiveNumber(value) {
  const cleaned = String(value ?? "")
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "")
    .trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Keep only finite positive prices. Drops zeros and blanks so catalogue cards
 * cannot appear for unpublished codes.
 */
export function keepPositivePublishedPrices(priceMap) {
  const next = {};
  Object.entries(priceMap || {}).forEach(([rawCode, rate]) => {
    const code = String(rawCode || "").trim().toUpperCase();
    if (!code) return;
    const positive = toPositiveNumber(rate);
    if (positive > 0) next[code] = positive;
  });
  return next;
}

/**
 * Keep only finite positive rates in each regional map. Does not invent codes;
 * callers must feed maps that already came from the sheet/Apps Script payload.
 */
export function keepPositiveRegionPriceMaps(regionPriceMaps) {
  const source = regionPriceMaps && typeof regionPriceMaps === "object" ? regionPriceMaps : {};
  const next = {};

  Object.entries(source).forEach(([region, map]) => {
    const regionKey = String(region || "").trim().toLowerCase();
    if (!regionKey) return;
    next[regionKey] = keepPositivePublishedPrices(map);
  });

  return next;
}

function addPositiveCodesFromMap(target, priceMap) {
  Object.entries(priceMap || {}).forEach(([rawCode, rate]) => {
    const code = String(rawCode || "").trim().toUpperCase();
    if (!code) return;
    if (toPositiveNumber(rate) > 0) target.add(code);
  });
}

/**
 * Codes that the raw Apps Script / sheet payload actually priced (positive only).
 * Used as a hard allow-list so aliases or stale parsers cannot publish extra SKUs.
 */
export function collectSourcePricedCodes(payload) {
  const codes = new Set();
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return codes;

  addPositiveCodesFromMap(codes, payload.priceMap || payload.prices);
  const regionMaps = payload.regionPriceMaps || payload.priceMaps || payload.pricesByRegion || {};
  Object.values(regionMaps).forEach((map) => addPositiveCodesFromMap(codes, map));
  const retailMaps = payload.retailRegionPriceMaps || {};
  Object.values(retailMaps).forEach((map) => addPositiveCodesFromMap(codes, map));
  return codes;
}

export function retainOnlySourcePricedCodes(priceMap, allowedCodes) {
  if (!(allowedCodes instanceof Set) || allowedCodes.size === 0) {
    return keepPositivePublishedPrices(priceMap);
  }
  const next = {};
  Object.entries(keepPositivePublishedPrices(priceMap)).forEach(([code, rate]) => {
    if (allowedCodes.has(code)) next[code] = rate;
  });
  return next;
}

export function retainOnlySourceRegionPriceMaps(regionPriceMaps, allowedCodes) {
  const source = regionPriceMaps && typeof regionPriceMaps === "object" ? regionPriceMaps : {};
  const next = {};
  Object.entries(source).forEach(([region, map]) => {
    const regionKey = String(region || "").trim().toLowerCase();
    if (!regionKey) return;
    next[regionKey] = retainOnlySourcePricedCodes(map, allowedCodes);
  });
  return next;
}
