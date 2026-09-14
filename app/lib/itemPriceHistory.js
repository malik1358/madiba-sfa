import { parsePricePayload } from "./pricePayload.js";
import {
  DEFAULT_PRICING_REGION,
  PRICING_REGIONS,
  normalizePricingRegion,
  withRegionFallbacks,
} from "./regionalPricing.js";

export const DEFAULT_ITEM_PRICE_HISTORY_LIMIT = 12;
export const MIN_ITEM_PRICE_HISTORY_ROWS = 5;
const SNAPSHOT_FALLBACK_LIMIT = 40;
const HISTORY_INSERT_CHUNK = 400;

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeText(value) {
  return String(value || "").trim();
}

function toPositiveNumber(value) {
  const cleaned = String(value ?? "")
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "")
    .trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function roundPrice(value) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}

export function pricesEqual(a, b) {
  return roundPrice(a) === roundPrice(b);
}

/**
 * Build insert rows for prices that differ from the latest recorded value.
 * @param {Map<string, number>|Record<string, number>} previousByKey map of `${code}::${region}` -> price
 * @param {Record<string, Record<string, number>>} regionPriceMaps
 * @param {{ recordedAt?: string, source?: string }} options
 */
export function buildItemPriceHistoryInserts(previousByKey, regionPriceMaps, options = {}) {
  const previous = previousByKey instanceof Map
    ? previousByKey
    : new Map(Object.entries(previousByKey || {}));
  const recordedAt = options.recordedAt || new Date().toISOString();
  const source = normalizeText(options.source) || "price_sync";
  const maps = withRegionFallbacks(regionPriceMaps || {}, regionPriceMaps?.[DEFAULT_PRICING_REGION] || {});
  const rows = [];

  PRICING_REGIONS.forEach((region) => {
    const priceMap = maps[region] || {};
    Object.entries(priceMap).forEach(([rawCode, rawPrice]) => {
      const itemCode = normalizeCode(rawCode);
      const price = toPositiveNumber(rawPrice);
      if (!itemCode || price <= 0) return;

      const key = `${itemCode}::${region}`;
      const previousPrice = toPositiveNumber(previous.get(key));
      if (previous.has(key) && pricesEqual(previousPrice, price)) return;

      rows.push({
        item_code: itemCode,
        region,
        price,
        recorded_at: recordedAt,
        source,
      });
      previous.set(key, price);
    });
  });

  return rows;
}

export function decoratePriceHistoryRows(rows = [], { currentPrice = null, isCurrentAt = null } = {}) {
  const sorted = [...(rows || [])].sort((a, b) => {
    const aTs = Date.parse(String(a.recorded_at || a.recordedAt || 0));
    const bTs = Date.parse(String(b.recorded_at || b.recordedAt || 0));
    return bTs - aTs;
  });

  return sorted.map((row, index) => {
    const price = toPositiveNumber(row.price);
    const older = sorted[index + 1];
    const previousPrice = older ? toPositiveNumber(older.price) : null;
    let change = "same";
    if (previousPrice != null && previousPrice > 0) {
      if (price > previousPrice) change = "up";
      else if (price < previousPrice) change = "down";
    }

    const recordedAt = row.recorded_at || row.recordedAt || null;
    const isCurrent = Boolean(
      (isCurrentAt && recordedAt && recordedAt === isCurrentAt)
      || (currentPrice != null && index === 0 && pricesEqual(price, currentPrice))
      || (currentPrice == null && index === 0),
    );

    return {
      id: row.id || null,
      itemCode: normalizeCode(row.item_code || row.itemCode),
      region: normalizePricingRegion(row.region),
      price,
      previousPrice,
      change,
      recordedAt,
      source: normalizeText(row.source) || "price_sync",
      isCurrent,
    };
  });
}

export function extractItemPriceFromSnapshotPayload(payload, itemCode, region = DEFAULT_PRICING_REGION) {
  const code = normalizeCode(itemCode);
  if (!code) return 0;

  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const directMap = payload.price_map || payload.priceMap;
    if (directMap && typeof directMap === "object") {
      const direct = toPositiveNumber(directMap[code] ?? directMap[itemCode]);
      if (direct > 0) return direct;
    }

    const regionMaps = payload.regionPriceMaps || payload.region_price_maps;
    if (regionMaps && typeof regionMaps === "object") {
      const regionMap = regionMaps[normalizePricingRegion(region)] || {};
      const fromRegion = toPositiveNumber(regionMap[code] ?? regionMap[itemCode]);
      if (fromRegion > 0) return fromRegion;
    }
  }

  try {
    const parsed = parsePricePayload(payload || {});
    const maps = withRegionFallbacks(parsed.regionPriceMaps, parsed.priceMap);
    const regionMap = maps[normalizePricingRegion(region)] || parsed.priceMap || {};
    return toPositiveNumber(regionMap[code]);
  } catch {
    return 0;
  }
}

async function loadLatestHistoryPrices(admin, codes, region) {
  const previous = new Map();
  const normalizedCodes = [...new Set((codes || []).map(normalizeCode).filter(Boolean))];
  if (normalizedCodes.length === 0) return previous;

  const resolvedRegion = normalizePricingRegion(region);

  for (let i = 0; i < normalizedCodes.length; i += 200) {
    const chunk = normalizedCodes.slice(i, i + 200);
    const remaining = new Set(chunk);

    while (remaining.size > 0) {
      const { data, error } = await admin
        .from("item_price_history")
        .select("item_code,price,recorded_at")
        .eq("region", resolvedRegion)
        .in("item_code", [...remaining])
        .order("recorded_at", { ascending: false })
        .limit(1000);

      if (error) {
        if (isMissingHistoryTableError(error)) return previous;
        throw error;
      }

      if (!Array.isArray(data) || data.length === 0) break;

      let newlyFound = 0;
      data.forEach((row) => {
        const code = normalizeCode(row.item_code);
        if (!code || !remaining.has(code)) return;
        previous.set(`${code}::${resolvedRegion}`, toPositiveNumber(row.price));
        remaining.delete(code);
        newlyFound += 1;
      });

      // No new codes resolved in this page — stop to avoid a tight loop.
      if (newlyFound === 0) break;
    }
  }

  return previous;
}

export function isMissingHistoryTableError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("item_price_history")
    && (message.includes("does not exist") || message.includes("could not find") || message.includes("schema cache"));
}

export async function recordItemPriceHistory(admin, {
  regionPriceMaps,
  recordedAt = new Date().toISOString(),
  source = "price_sync",
} = {}) {
  const maps = withRegionFallbacks(regionPriceMaps || {}, regionPriceMaps?.[DEFAULT_PRICING_REGION] || {});
  const allCodes = new Set();
  PRICING_REGIONS.forEach((region) => {
    Object.keys(maps[region] || {}).forEach((code) => {
      const normalized = normalizeCode(code);
      if (normalized) allCodes.add(normalized);
    });
  });

  const previous = new Map();
  for (const region of PRICING_REGIONS) {
    const regionPrevious = await loadLatestHistoryPrices(admin, [...allCodes], region);
    regionPrevious.forEach((value, key) => previous.set(key, value));
  }

  const rows = buildItemPriceHistoryInserts(previous, maps, { recordedAt, source });
  if (rows.length === 0) {
    return { inserted: 0, skipped: true };
  }

  for (let i = 0; i < rows.length; i += HISTORY_INSERT_CHUNK) {
    const chunk = rows.slice(i, i + HISTORY_INSERT_CHUNK);
    const { error } = await admin.from("item_price_history").insert(chunk);
    if (error) {
      if (isMissingHistoryTableError(error)) {
        return { inserted: 0, skipped: true, missingTable: true };
      }
      throw error;
    }
  }

  return { inserted: rows.length, skipped: false };
}

async function loadHistoryFromTable(admin, itemCode, region, limit) {
  const { data, error } = await admin
    .from("item_price_history")
    .select("id,item_code,region,price,recorded_at,source")
    .eq("item_code", itemCode)
    .eq("region", region)
    .order("recorded_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (isMissingHistoryTableError(error)) return [];
    throw error;
  }

  return Array.isArray(data) ? data : [];
}

async function loadHistoryFromSnapshots(admin, itemCode, region, limit) {
  const selectAttempts = [
    "id,created_at,price_map,payload",
    "id,created_at,payload",
  ];

  let snapshots = [];
  for (const columns of selectAttempts) {
    const { data, error } = await admin
      .from("price_catalog_snapshots")
      .select(columns)
      .order("created_at", { ascending: false })
      .limit(SNAPSHOT_FALLBACK_LIMIT);

    if (!error) {
      snapshots = Array.isArray(data) ? data : [];
      break;
    }

    const message = String(error.message || "").toLowerCase();
    if (columns.includes("price_map") && message.includes("price_map")) {
      continue;
    }
    throw error;
  }

  const points = [];
  let lastPrice = null;

  snapshots.forEach((snapshot) => {
    let price = 0;
    if (snapshot.price_map && typeof snapshot.price_map === "object") {
      price = toPositiveNumber(
        snapshot.price_map[itemCode]
        || snapshot.price_map[normalizeCode(itemCode)],
      );
      if (!price) {
        const regionMaps = snapshot.price_map.regionPriceMaps || snapshot.price_map.region_price_maps;
        if (regionMaps && typeof regionMaps === "object") {
          price = toPositiveNumber((regionMaps[region] || {})[itemCode]);
        }
      }
    }

    if (!price) {
      price = extractItemPriceFromSnapshotPayload(snapshot.payload, itemCode, region);
    }

    if (price <= 0) return;
    if (lastPrice != null && pricesEqual(lastPrice, price)) return;

    points.push({
      id: `snapshot-${snapshot.id}`,
      item_code: itemCode,
      region,
      price,
      recorded_at: snapshot.created_at,
      source: "price_snapshot",
    });
    lastPrice = price;
  });

  return points.slice(0, limit);
}

export async function loadItemPriceHistory(admin, {
  itemCode,
  region = DEFAULT_PRICING_REGION,
  limit = DEFAULT_ITEM_PRICE_HISTORY_LIMIT,
  currentPrice = null,
} = {}) {
  const code = normalizeCode(itemCode);
  const resolvedRegion = normalizePricingRegion(region);
  const resolvedLimit = Math.max(MIN_ITEM_PRICE_HISTORY_ROWS, Number(limit) || DEFAULT_ITEM_PRICE_HISTORY_LIMIT);

  if (!code) {
    return { history: [], source: "none" };
  }

  let rows = await loadHistoryFromTable(admin, code, resolvedRegion, resolvedLimit);
  let source = "item_price_history";

  if (rows.length < MIN_ITEM_PRICE_HISTORY_ROWS) {
    const snapshotRows = await loadHistoryFromSnapshots(admin, code, resolvedRegion, resolvedLimit);
    if (snapshotRows.length > rows.length) {
      rows = snapshotRows;
      source = "price_catalog_snapshots";
    } else if (rows.length === 0 && snapshotRows.length > 0) {
      rows = snapshotRows;
      source = "price_catalog_snapshots";
    }
  }

  // Ensure the live cache price appears as the newest point when it differs.
  const livePrice = toPositiveNumber(currentPrice);
  if (livePrice > 0) {
    const newest = rows[0];
    const newestPrice = newest ? toPositiveNumber(newest.price) : 0;
    if (!newest || !pricesEqual(newestPrice, livePrice)) {
      rows = [
        {
          id: "current-cache",
          item_code: code,
          region: resolvedRegion,
          price: livePrice,
          recorded_at: new Date().toISOString(),
          source: "price_cache",
        },
        ...rows,
      ].slice(0, resolvedLimit);
      source = source === "none" ? "price_cache" : `${source}+cache`;
    }
  }

  return {
    history: decoratePriceHistoryRows(rows, { currentPrice: livePrice || null }),
    source,
  };
}

export function matchItemCatalogEntries(entries = [], query = "", limit = 20) {
  const needle = normalizeText(query).toLowerCase();
  if (!needle) return [];

  const scored = [];
  (entries || []).forEach((entry) => {
    const code = normalizeCode(entry.item_code || entry.code || entry.itemCode);
    const name = normalizeText(entry.item_name || entry.name || entry.itemName);
    const category = normalizeText(entry.category);
    if (!code) return;

    const codeLower = code.toLowerCase();
    const nameLower = name.toLowerCase();
    let score = 0;
    if (codeLower === needle) score = 1000;
    else if (codeLower.startsWith(needle)) score = 800;
    else if (codeLower.includes(needle)) score = 600;
    else if (nameLower.startsWith(needle)) score = 400;
    else if (nameLower.includes(needle)) score = 200;
    else if (category.toLowerCase().includes(needle)) score = 50;
    else return;

    scored.push({
      itemCode: code,
      itemName: name || code,
      category: category || "",
      score,
    });
  });

  scored.sort((a, b) => b.score - a.score || a.itemCode.localeCompare(b.itemCode));
  const seen = new Set();
  const unique = [];
  for (const row of scored) {
    if (seen.has(row.itemCode)) continue;
    seen.add(row.itemCode);
    unique.push({
      itemCode: row.itemCode,
      itemName: row.itemName,
      category: row.category,
    });
    if (unique.length >= limit) break;
  }
  return unique;
}
