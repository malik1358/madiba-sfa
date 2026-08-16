import { PRICE_CACHE_KEY as DEFAULT_PRICE_CACHE_KEY } from "./priceApiConfig.js";

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

  function addRate(rawCode, rawRate) {
    const code = normalizeCode(rawCode);
    if (!code) return;
    if (isExcludedItemCode(code)) return;

    const nextRate = toNumber(rawRate);
    const hasCurrent = Object.prototype.hasOwnProperty.call(priceMap, code);
    const currentRate = hasCurrent ? toNumber(priceMap[code]) : 0;

    // Keep a usable rate once discovered; do not downgrade it to zero.
    if (currentRate > 0 && nextRate <= 0) return;

    if (nextRate > 0 || !hasCurrent) {
      priceMap[code] = nextRate;
    }
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

        const itemCodeIndex = headerCodeIndex >= 0 ? headerCodeIndex : (hasDataAtIndex(value, codeIndex) ? codeIndex : -1);
        const itemNameIndex = headerNameIndex >= 0 ? headerNameIndex : (hasDataAtIndex(value, nameIndex) ? nameIndex : -1);
        const resolvedCategoryIndex = headerCategoryIndex >= 0 ? headerCategoryIndex : (hasDataAtIndex(value, categoryIndex) ? categoryIndex : -1);
        const resolvedRateIndex = headerRateIndex >= 0 ? headerRateIndex : (hasDataAtIndex(value, rateIndex) ? rateIndex : -1);

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

          upsertSheetItem(code, rawName || code, rawCategory || "Unclassified");
          addRate(code, rawRate);
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
      if (["priceMap", "prices", "data", "rows", "result", "items", "sheetData", "values"].includes(key)) {
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
    return { priceMap: applyPriceCodeAliases(priceMap), sheetItems };
  }

  if (payload && typeof payload === "object") {
    walk(payload);

    Object.entries(payload).forEach(([key, value]) => {
      if (typeof value !== "object" || value === null) {
        addRate(key, value);
      }
    });
  }

  return { priceMap: applyPriceCodeAliases(priceMap), sheetItems };
}

function readCached(cacheKey) {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.priceMap || typeof parsed.priceMap !== "object") return null;
    return {
      priceMap: parsed.priceMap,
      sheetItems: Array.isArray(parsed.sheetItems) ? parsed.sheetItems : [],
    };
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

export async function loadPricePayload(apiUrl, cacheKey = DEFAULT_PRICE_CACHE_KEY) {
  const cached = readCached(cacheKey);

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
        ? {
            priceMap: applyPriceCodeAliases(data.priceMap),
            sheetItems: Array.isArray(data.sheetItems) ? data.sheetItems : [],
          }
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
