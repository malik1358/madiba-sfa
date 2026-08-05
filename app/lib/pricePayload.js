function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function looksLikeItemCode(value) {
  return /^[A-Z][A-Z0-9/.-]{3,20}$/i.test(String(value || "").trim());
}

function toNumber(value) {
  const cleaned = String(value ?? "")
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "")
    .trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeHeaderCell(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ");
}

function findHeaderIndex(rows, aliases, maxRows = 5) {
  if (!Array.isArray(rows) || rows.length === 0) return -1;
  const normalizedAliases = aliases.map((alias) => normalizeHeaderCell(alias));
  const limit = Math.min(maxRows, rows.length);

  for (let r = 0; r < limit; r += 1) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;

    for (let c = 0; c < row.length; c += 1) {
      const cell = normalizeHeaderCell(row[c]);
      if (!cell) continue;
      if (normalizedAliases.includes(cell)) {
        return c;
      }
    }
  }

  return -1;
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

export function parsePricePayload(payload) {
  const priceMap = {};
  const sheetItems = [];
  const seen = new Set();

  function upsertSheetItem(rawCode, rawName, rawCategory) {
    const code = normalizeCode(rawCode);
    if (!code) return;

    const name = String(rawName || "").trim();
    const category = String(rawCategory || "").trim();
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
    priceMap[code] = toNumber(rawRate);
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
          "rate",
          "price",
          "unit price",
          "mrp",
          "selling price",
        ]);

        const codeIndex = sheetColumnIndex("B");
        const nameIndex = sheetColumnIndex("C");
        const categoryIndex = sheetColumnIndex("CO");
        const rateIndex = sheetColumnIndex("D");

        value.forEach((row) => {
          if (!Array.isArray(row)) return;

          const rawCode = sheetCell(row, codeIndex) || (headerCodeIndex >= 0 ? row[headerCodeIndex] : row[0]);
          if (!normalizeCode(rawCode)) return;

          const rawName = sheetCell(row, nameIndex) || (headerNameIndex >= 0 ? row[headerNameIndex] : "");
          const rawCategory = sheetCell(row, categoryIndex) || (headerCategoryIndex >= 0 ? row[headerCategoryIndex] : "");
          const rawRate = sheetCell(row, rateIndex) || (headerRateIndex >= 0 ? row[headerRateIndex] : row[1]);

          upsertSheetItem(rawCode, rawName, rawCategory);
          addRate(rawCode, rawRate);
        });
        return;
      }

      value.forEach((entry) => walk(entry));
      return;
    }

    if (typeof value === "object") {
      const keys = Object.keys(value);

      // Handle row-like objects where columns are serialized as keys (e.g. B/C/CO/D).
      const rowCode = readAny(value, ["B", "item_code", "itemCode", "code", "sku", "SKU", "Item Code", "ITEM CODE"]);
      if (rowCode) {
        const rowName = readAny(value, ["C", "item_name", "itemName", "name", "description", "Item Name", "ITEM NAME"]);
        const rowCategory = readAny(value, ["CO", "category", "item_category", "group", "Item Category", "ITEM CATEGORY"]);
        const rowRate = readAny(value, ["D", "rate", "price", "unit_price", "selling_price", "Rate", "Price"]);

        upsertSheetItem(rowCode, rowName, rowCategory);
        addRate(rowCode, rowRate);
      }

      const looksLikeRateMap = keys.some((key) => looksLikeItemCode(key) && typeof value[key] !== "object");

      if (looksLikeRateMap) {
        keys.forEach((key) => {
          addRate(key, value[key]);
        });
      }

      keys.forEach((key) => walk(value[key]));
    }
  }

  walk(payload);

  return { priceMap, sheetItems };
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

export async function loadPricePayload(apiUrl, cacheKey = "madiba.pricePayload") {
  const cached = readCached(cacheKey);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(apiUrl, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Price API failed with ${response.status}`);
      }

      const data = await response.json();

      const parsed = data && typeof data === "object" && data.priceMap && typeof data.priceMap === "object"
        ? {
            priceMap: data.priceMap,
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