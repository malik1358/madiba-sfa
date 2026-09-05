import { PRICE_CACHE_KEY as DEFAULT_PRICE_CACHE_KEY } from "./priceApiConfig.js";
import {
  DEFAULT_PRICING_REGION,
  PRICING_REGIONS,
  REGION_PRICE_COLUMNS,
  SCHEME_COLUMNS,
  emptyRegionPriceMaps,
  parseDiscountRate,
  withRegionFallbacks,
} from "./regionalPricing.js";

const PRICE_CODE_ALIASES = {
  A005425: ["A004555", "A000057"],
};

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeText(value) {
  return String(value || "").trim();
}

function looksLikeItemCode(value) {
  return /^[A-Z][A-Z0-9/.-]{3,20}$/i.test(String(value || "").trim());
}

function looksLikeItemName(value) {
  const text = normalizeText(value);
  if (!text) return false;
  if (looksLikeItemCode(text)) return false;
  if (/^\d+(\.\d+)?$/.test(text)) return false;
  return text.length >= 3;
}

function isExcludedItemCode(value) {
  return normalizeCode(value).startsWith("LP");
}

function isExcludedCategory(value) {
  const compact = normalizeText(value).toLowerCase().replace(/[^a-z]/g, "");
  return ["buildingmaterial", "buildingmaterials", "buidingmaterial", "buidingmaterials"].includes(compact);
}

function toNumber(value) {
  const cleaned = String(value ?? "")
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "")
    .trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function applyPriceCodeAliases(priceMap) {
  const next = { ...(priceMap || {}) };

  Object.entries(PRICE_CODE_ALIASES).forEach(([targetCode, sourceCodes]) => {
    const target = normalizeCode(targetCode);
    if (!target) return;

    const currentRate = toNumber(next[target]);
    if (currentRate > 0) return;

    for (const sourceCode of sourceCodes) {
      const source = normalizeCode(sourceCode);
      if (!source) continue;

      const sourceRate = toNumber(next[source]);
      if (sourceRate > 0) {
        next[target] = sourceRate;
        break;
      }
    }
  });

  return next;
}

function applyDiscountCodeAliases(discountMap) {
  return applyPriceCodeAliases(discountMap);
}

function findRegionWholesaleIndex(rows, region, fallbackColumn, maxRows = 5) {
  const regionToken = String(region || "").trim().toLowerCase();
  const otherTokens = PRICING_REGIONS.filter((entry) => entry !== regionToken);
  const fallbackIndex = sheetColumnIndex(fallbackColumn);

  if (!Array.isArray(rows) || rows.length === 0) return fallbackIndex;

  const limit = Math.min(maxRows, rows.length);
  let bestIndex = -1;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!Array.isArray(row)) continue;

    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const header = normalizeHeaderCell(row[columnIndex]);
      if (!header) continue;
      const isWholesale = header.includes("wholesale");
      if (!isWholesale && !header.includes("price")) continue;
      if (otherTokens.some((token) => header.includes(token))) continue;
      if (regionToken && !header.includes(regionToken) && regionToken !== DEFAULT_PRICING_REGION) continue;
      if (regionToken === DEFAULT_PRICING_REGION && otherTokens.some((token) => header.includes(token))) continue;

      const hasRegion = regionToken && header.includes(regionToken);
      const score = (hasRegion ? 2000 : 0) + (isWholesale ? 1500 : 400) + (row.length - columnIndex);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = columnIndex;
      }
    }
  }

  if (bestIndex >= 0) return bestIndex;
  return hasDataAtIndex(rows, fallbackIndex) ? fallbackIndex : bestIndex;
}

function findSchemeIndex(rows, aliases, fallbackColumn, maxRows = 5) {
  const headerIndex = findHeaderIndex(rows, aliases, maxRows);
  if (headerIndex >= 0) return headerIndex;
  const fallbackIndex = sheetColumnIndex(fallbackColumn);
  if (fallbackIndex < 0) return -1;
  const wideEnough = (rows || []).some((row) => Array.isArray(row) && row.length > fallbackIndex);
  return (wideEnough || hasDataAtIndex(rows, fallbackIndex)) ? fallbackIndex : -1;
}

function normalizeCatalogResult(priceMap, regionPriceMaps, cashDiscountMap, valueDiscountMap, sheetItems) {
  const aliasedRegions = {};
  PRICING_REGIONS.forEach((region) => {
    aliasedRegions[region] = applyPriceCodeAliases(regionPriceMaps?.[region] || {});
  });

  const resolvedRegions = withRegionFallbacks(aliasedRegions, applyPriceCodeAliases(priceMap));
  const resolvedPriceMap = resolvedRegions.riyadh;

  return {
    priceMap: resolvedPriceMap,
    regionPriceMaps: resolvedRegions,
    cashDiscountMap: applyDiscountCodeAliases(cashDiscountMap),
    valueDiscountMap: applyDiscountCodeAliases(valueDiscountMap),
    sheetItems,
  };
}

function normalizeHeaderCell(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ");
}

function headerCellMatches(cell, alias) {
  const normalizedCell = normalizeHeaderCell(cell);
  const normalizedAlias = normalizeHeaderCell(alias);

  if (!normalizedCell || !normalizedAlias) return false;
  if (normalizedCell === normalizedAlias) return true;
  return normalizedCell.includes(normalizedAlias) || normalizedAlias.includes(normalizedCell);
}

function findHeaderIndex(rows, aliases, maxRows = 5) {
  if (!Array.isArray(rows) || rows.length === 0) return -1;
  const limit = Math.min(maxRows, rows.length);
  let bestIndex = -1;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!Array.isArray(row)) continue;

    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const matchedAliasIndex = aliases.findIndex((alias) => headerCellMatches(row[columnIndex], alias));
      if (matchedAliasIndex < 0) continue;

      const score = (aliases.length - matchedAliasIndex) * 1000 + (row.length - columnIndex);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = columnIndex;
      }
    }
  }

  return bestIndex;
}

function sheetCell(row, index) {
  if (!Array.isArray(row) || index < 0) return "";
  return row[index] ?? "";
}

function sheetColumnIndex(columnName) {
  const name = String(columnName || "").trim().toUpperCase();
  let index = 0;

  for (let i = 0; i < name.length; i += 1) {
    const charCode = name.charCodeAt(i);
    if (charCode < 65 || charCode > 90) return -1;
    index = (index * 26) + (charCode - 64);
  }

  return index > 0 ? index - 1 : -1;
}

function isRowLike(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  return [
    "item_code",
    "itemCode",
    "code",
    "item_name",
    "itemName",
    "name",
    "category",
    "CO",
    "rate",
    "price",
    "C",
  ].some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function scoreSheetName(value) {
  const text = normalizeText(value);
  if (!text) return -1;
  if (looksLikeItemCode(text)) return -1;
  if (/^\d+(\.\d+)?$/.test(text)) return -1;
  return text.length;
}

function hasDataAtIndex(rows, index, maxRows = 50) {
  if (!Array.isArray(rows) || index < 0) return false;
  const limit = Math.min(rows.length, maxRows);

  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!Array.isArray(row) || row.length <= index) continue;
    if (String(row[index] ?? "").trim() !== "") return true;
  }

  return false;
}

export function parsePricePayload(payload) {
  const priceMap = {};
  const regionPriceMaps = emptyRegionPriceMaps();
  const cashDiscountMap = {};
  const valueDiscountMap = {};
  const sheetItems = [];
  const seen = new Set();

  function upsertSheetItem(rawCode, rawName, rawCategory) {
    const code = normalizeCode(rawCode);
    if (!code) return;
    if (isExcludedItemCode(code)) return;

    const name = normalizeText(rawName);
    const category = normalizeText(rawCategory);
    if (isExcludedCategory(category)) return;
    const key = `${code}::${name}::${category}`;
    if (seen.has(key)) return;

    seen.add(key);
    sheetItems.push({
      item_code: code,
      item_name: name || code,
      category: category || "Unclassified",
      source: "PRICE_SHEET",
    });
  }

  function addMappedRate(targetMap, rawCode, rawRate) {
    const code = normalizeCode(rawCode);
    if (!code) return;
    if (isExcludedItemCode(code)) return;

    const nextRate = toNumber(rawRate);
    const hasCurrent = Object.prototype.hasOwnProperty.call(targetMap, code);
    const currentRate = hasCurrent ? toNumber(targetMap[code]) : 0;

    // Keep a usable rate once discovered; do not downgrade it to zero.
    if (currentRate > 0 && nextRate <= 0) return;

    if (nextRate > 0 || !hasCurrent) {
      targetMap[code] = nextRate;
    }
  }

  function addRate(rawCode, rawRate, region = DEFAULT_PRICING_REGION) {
    const resolvedRegion = PRICING_REGIONS.includes(region) ? region : DEFAULT_PRICING_REGION;
    addMappedRate(regionPriceMaps[resolvedRegion], rawCode, rawRate);
    if (resolvedRegion === DEFAULT_PRICING_REGION) {
      addMappedRate(priceMap, rawCode, rawRate);
    }
  }

  function addDiscount(targetMap, rawCode, rawDiscount) {
    const code = normalizeCode(rawCode);
    if (!code) return;
    if (isExcludedItemCode(code)) return;

    const nextRate = parseDiscountRate(rawDiscount);
    if (nextRate > 0) {
      targetMap[code] = nextRate;
    }
  }

  function ingestRegionMaps(source) {
    if (!source || typeof source !== "object" || Array.isArray(source)) return;
    PRICING_REGIONS.forEach((region) => {
      const regionMap = source[region];
      if (!regionMap || typeof regionMap !== "object" || Array.isArray(regionMap)) return;
      Object.entries(regionMap).forEach(([code, rate]) => addRate(code, rate, region));
    });
  }

  function ingestDiscountMap(targetMap, source) {
    if (!source || typeof source !== "object" || Array.isArray(source)) return;
    Object.entries(source).forEach(([code, rate]) => addDiscount(targetMap, code, rate));
  }

  function readAny(source, keys) {
    if (!source || typeof source !== "object") return "";
    for (const key of keys) {
      const value = source[key];
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        return String(value).trim();
      }
    }
    return "";
  }

  function walk(value) {
    if (!value) return;

    if (Array.isArray(value)) {
      if (value.length && Array.isArray(value[0])) {
        const headerCodeIndex = findHeaderIndex(value, [
          "item code",
          "item_code",
          "item",
          "code",
          "sku",
          "product code",
        ]);
        const headerNameIndex = findHeaderIndex(value, [
          "item name",
          "item_name",
          "name",
          "description",
          "product",
          "product name",
        ]);
        const headerCategoryIndex = findHeaderIndex(value, [
          "category",
          "item category",
          "group",
          "product group",
        ]);
        const headerRateIndex = findHeaderIndex(value, [
          "wholesale price without vat riyadh",
          "wholesale price riyadh",
          "wholesale price",
          "wholesale price riyal",
          "wholesale price rial",
          "wholesale price saudi riyal",
          "selling price",
          "approx selling price",
          "approx selling price w o vat",
          "rate",
          "price",
          "unit price",
          "mrp",
        ]);

        const codeIndex = sheetColumnIndex("B");
        const nameIndex = sheetColumnIndex("C");
        const categoryIndex = sheetColumnIndex("CO");
        const rateIndex = sheetColumnIndex("D");
        const riyadhIndex = findRegionWholesaleIndex(value, "riyadh", REGION_PRICE_COLUMNS.riyadh);
        const dammamIndex = findRegionWholesaleIndex(value, "dammam", REGION_PRICE_COLUMNS.dammam);
        const jeddahIndex = findRegionWholesaleIndex(value, "jeddah", REGION_PRICE_COLUMNS.jeddah);
        const cashDiscountIndex = findSchemeIndex(value, [
          "cash discount",
          "cash disc",
        ], SCHEME_COLUMNS.cashDiscount, 8);
        const valueDiscountIndex = findSchemeIndex(value, [
          "sales value > 5000 sar",
          "sales value > 5000",
          "sales value 5000",
          "value discount",
          "scheme value",
        ], SCHEME_COLUMNS.valueDiscount, 8);

        const itemCodeIndex = headerCodeIndex >= 0 ? headerCodeIndex : (hasDataAtIndex(value, codeIndex) ? codeIndex : -1);
        const itemNameIndex = headerNameIndex >= 0 ? headerNameIndex : (hasDataAtIndex(value, nameIndex) ? nameIndex : -1);
        const resolvedCategoryIndex = headerCategoryIndex >= 0 ? headerCategoryIndex : (hasDataAtIndex(value, categoryIndex) ? categoryIndex : -1);
        const resolvedRateIndex = riyadhIndex >= 0
          ? riyadhIndex
          : (headerRateIndex >= 0 ? headerRateIndex : (hasDataAtIndex(value, rateIndex) ? rateIndex : -1));

        value.forEach((row) => {
          if (!Array.isArray(row)) return;

          const isHeaderRow = row.some((cell) => {
            const header = normalizeHeaderCell(cell);
            return ["item code", "item name", "item", "rate", "price", "category", "item category"].includes(header);
          });
          if (isHeaderRow) return;

          const rawExplicitCode = itemCodeIndex >= 0 ? sheetCell(row, itemCodeIndex) : "";
          const explicitCode = looksLikeItemCode(rawExplicitCode) ? normalizeCode(rawExplicitCode) : "";
          const codeCandidates = row.filter((cell) => looksLikeItemCode(cell)).map((cell) => normalizeCode(cell));
          const code = explicitCode || codeCandidates.find(Boolean) || "";
          if (!code) return;

          const codeCellIndex = explicitCode
            ? itemCodeIndex
            : row.findIndex((cell) => normalizeCode(cell) === code);

          const explicitName = itemNameIndex >= 0 ? normalizeText(sheetCell(row, itemNameIndex)) : "";
          const nameCandidate = explicitName || row
            .map((cell, index) => ({ cell, index }))
            .filter(({ index }) => index !== codeCellIndex)
            .filter(({ cell }) => looksLikeItemName(cell))
            .sort((a, b) => scoreSheetName(b.cell) - scoreSheetName(a.cell))[0]?.cell || "";
          const rawName = normalizeText(nameCandidate) && normalizeCode(nameCandidate) !== code ? normalizeText(nameCandidate) : "";

          const explicitCategory = resolvedCategoryIndex >= 0 ? normalizeText(sheetCell(row, resolvedCategoryIndex)) : "";
          const categoryCandidate = explicitCategory || row.find((cell) => /electronics|fridge|freezer|air conditioner|ac|window/i.test(String(cell || ""))) || "";
          const rawCategory = normalizeText(categoryCandidate);

          const rawRate = sheetCell(row, resolvedRateIndex) || row.find((cell) => Number.isFinite(Number(String(cell).replace(/,/g, "")))) || "";
          const riyadhRate = riyadhIndex >= 0 ? sheetCell(row, riyadhIndex) : rawRate;
          const dammamRate = dammamIndex >= 0 ? sheetCell(row, dammamIndex) : "";
          const jeddahRate = jeddahIndex >= 0 ? sheetCell(row, jeddahIndex) : "";

          upsertSheetItem(code, rawName || code, rawCategory || "Unclassified");
          addRate(code, riyadhRate || rawRate, "riyadh");
          addRate(code, dammamRate, "dammam");
          addRate(code, jeddahRate, "jeddah");
          if (cashDiscountIndex >= 0) addDiscount(cashDiscountMap, code, sheetCell(row, cashDiscountIndex));
          if (valueDiscountIndex >= 0) addDiscount(valueDiscountMap, code, sheetCell(row, valueDiscountIndex));
        });
        return;
      }

      value.forEach((entry) => walk(entry));
      return;
    }

    if (typeof value !== "object") return;

    if (isRowLike(value)) {
      const code = readAny(value, ["item_code", "itemCode", "code", "B", "Item Code", "ITEM CODE", "sku", "SKU"]);
      const name = readAny(value, ["item_name", "itemName", "name", "C", "Item Name", "ITEM NAME", "description", "Description"]);
      const category = readAny(value, ["category", "item_category", "CO", "Category", "ITEM CATEGORY", "Item Category", "group", "Group", "item_group", "Item Group"]);
      const rate = readAny(value, ["rate", "price", "RATE", "Price", "D", "Selling Rate"]);

      if (code) {
        addRate(code, rate);
        upsertSheetItem(code, name, category);
      }
    }

    Object.entries(value).forEach(([key, entry]) => {
      if (["priceMap", "prices"].includes(key) && entry && typeof entry === "object" && !Array.isArray(entry)) {
        Object.entries(entry).forEach(([code, rate]) => addRate(code, rate, "riyadh"));
        return;
      }

      if (["regionPriceMaps", "priceMaps", "pricesByRegion"].includes(key)) {
        ingestRegionMaps(entry);
        return;
      }

      if (["cashDiscountMap", "cashDiscounts"].includes(key)) {
        ingestDiscountMap(cashDiscountMap, entry);
        return;
      }

      if (["valueDiscountMap", "valueDiscounts"].includes(key)) {
        ingestDiscountMap(valueDiscountMap, entry);
        return;
      }

      if (["data", "rows", "result", "items", "sheetItems", "sheetData", "values"].includes(key)) {
        walk(entry);
        return;
      }

      if (typeof entry === "object") {
        walk(entry);
      }
    });
  }

  if (Array.isArray(payload)) {
    walk(payload);
    return normalizeCatalogResult(priceMap, regionPriceMaps, cashDiscountMap, valueDiscountMap, sheetItems);
  }

  if (payload && typeof payload === "object") {
    walk(payload);

    Object.entries(payload).forEach(([key, value]) => {
      if (typeof value !== "object" || value === null) {
        addRate(key, value, "riyadh");
      }
    });
  }

  return normalizeCatalogResult(priceMap, regionPriceMaps, cashDiscountMap, valueDiscountMap, sheetItems);
}

function readCached(cacheKey) {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.priceMap || typeof parsed.priceMap !== "object") return null;
    return normalizeCatalogResult(
      parsed.priceMap,
      parsed.regionPriceMaps,
      parsed.cashDiscountMap,
      parsed.valueDiscountMap,
      Array.isArray(parsed.sheetItems) ? parsed.sheetItems : [],
    );
  } catch {
    return null;
  }
}

function writeCached(cacheKey, data) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(cacheKey, JSON.stringify(data));
  } catch {
    // Ignore storage write failures.
  }
}

function clearCached(cacheKey) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(cacheKey);
  } catch {
    // Ignore storage removal failures.
  }
}

export async function loadPricePayload(apiUrl, cacheKey = DEFAULT_PRICE_CACHE_KEY) {
  const cached = readCached(cacheKey);
  clearCached(cacheKey);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(apiUrl, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Price API failed with ${response.status}`);
      }

      const data = await response.json().catch(() => null);
      if (!data) {
        throw new Error("Price API returned invalid JSON");
      }
      const parsed = data && typeof data === "object" && data.priceMap && typeof data.priceMap === "object"
        ? normalizeCatalogResult(
            data.priceMap,
            data.regionPriceMaps,
            data.cashDiscountMap,
            data.valueDiscountMap,
            Array.isArray(data.sheetItems) ? data.sheetItems : [],
          )
        : parsePricePayload(data || {});

      if (Object.keys(parsed.priceMap).length === 0) {
        throw new Error("Price API returned no prices");
      }

      writeCached(cacheKey, parsed);
      return parsed;
    } catch {
      // Retry once before falling back to cache.
    }
  }

  if (cached && Object.keys(cached.priceMap || {}).length > 0) {
    return cached;
  }

  throw new Error("Unable to load prices.");
}
