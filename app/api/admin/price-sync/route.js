import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { parsePricePayload } from "../../../lib/pricePayload.js";
import { PRICE_SOURCE_URL } from "../../../lib/priceApiConfig.js";

export const runtime = "nodejs";
export const maxDuration = 120;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const cronSecret = process.env.CRON_SECRET;

const CODE_CHUNK_SIZE = 200;

function normalizeSecret(value) {
  return String(value || "").trim();
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeText(value) {
  return String(value || "").trim();
}

function isExcludedCategory(value) {
  const compact = normalizeText(value).toLowerCase().replace(/[^a-z]/g, "");
  return ["buildingmaterial", "buildingmaterials", "buidingmaterial", "buidingmaterials"].includes(compact);
}

function toPositiveNumber(value) {
  const cleaned = String(value ?? "")
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "")
    .trim();

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function isPlaceholderValue(value) {
  const text = normalizeText(value).toUpperCase();
  if (!text) return true;
  if (/^REAL_(?:ITEM_NAME|CATEGORY)_FOR_[A-Z0-9/._-]+$/.test(text)) return true;
  return [
    "PUT_REAL_ITEM_NAME_HERE",
    "PUT_REAL_CATEGORY_HERE",
    "TO_MAP",
    "TBD",
    "TODO",
  ].includes(text);
}

function hasMeaningfulItemName(value, itemCode = "") {
  const text = normalizeText(value);
  if (!text) return false;
  if (isPlaceholderValue(text)) return false;
  if (/^[A-Z][A-Z0-9/.-]{3,20}$/i.test(text)) return false;
  if (normalizeCode(text) === normalizeCode(itemCode)) return false;
  return true;
}

function hasMeaningfulCategory(value) {
  const text = normalizeText(value);
  if (!text) return false;
  if (isPlaceholderValue(text)) return false;
  return !["UNCLASSIFIED", "N/A", "NA", "-"].includes(text.toUpperCase());
}

function chunkCodes(codes, size = CODE_CHUNK_SIZE) {
  const chunks = [];
  for (let i = 0; i < codes.length; i += size) {
    chunks.push(codes.slice(i, i + size));
  }
  return chunks;
}

async function loadItemMetadata(admin, codes) {
  const metadataByCode = new Map();
  if (!Array.isArray(codes) || codes.length === 0) return metadataByCode;

  const codeChunks = chunkCodes(codes);

  for (const chunk of codeChunks) {
    const { data, error } = await admin
      .from("items_master")
      .select("item_code,item_name,category")
      .in("item_code", chunk);

    if (error) {
      throw new Error(`items_master lookup failed: ${error.message}`);
    }

    (data || []).forEach((row) => {
      const code = normalizeCode(row.item_code);
      if (!code) return;

      const current = metadataByCode.get(code) || { item_name: "", category: "" };
      const nextName = normalizeText(row.item_name);
      const nextCategory = normalizeText(row.category);

      if (!hasMeaningfulItemName(current.item_name, code) && hasMeaningfulItemName(nextName, code)) {
        current.item_name = nextName;
      }

      if (!hasMeaningfulCategory(current.category) && hasMeaningfulCategory(nextCategory)) {
        current.category = nextCategory;
      }

      metadataByCode.set(code, current);
    });
  }

  for (const chunk of codeChunks) {
    const { data, error } = await admin
      .from("active_sales")
      .select("item_code,item_name,category,transaction_date")
      .in("item_code", chunk)
      .order("transaction_date", { ascending: false })
      .limit(2000);

    if (error) {
      throw new Error(`sales_raw lookup failed: ${error.message}`);
    }

    (data || []).forEach((row) => {
      const code = normalizeCode(row.item_code);
      if (!code) return;

      const current = metadataByCode.get(code) || { item_name: "", category: "" };
      const nextName = normalizeText(row.item_name);
      const nextCategory = normalizeText(row.category);

      if (!hasMeaningfulItemName(current.item_name, code) && hasMeaningfulItemName(nextName, code)) {
        current.item_name = nextName;
      }

      if (!hasMeaningfulCategory(current.category) && hasMeaningfulCategory(nextCategory)) {
        current.category = nextCategory;
      }

      metadataByCode.set(code, current);
    });
  }

  return metadataByCode;
}

async function loadRateFallback(admin, codes) {
  const rateByCode = new Map();
  if (!Array.isArray(codes) || codes.length === 0) return rateByCode;

  const codeChunks = chunkCodes(codes);

  for (const chunk of codeChunks) {
    const { data, error } = await admin
      .from("active_sales")
      .select("item_code,rate,transaction_date,id")
      .in("item_code", chunk)
      .order("transaction_date", { ascending: false })
      .order("id", { ascending: false })
      .limit(2000);

    if (error) {
      throw new Error(`sales_raw rate lookup failed: ${error.message}`);
    }

    (data || []).forEach((row) => {
      const code = normalizeCode(row.item_code);
      if (!code || rateByCode.has(code)) return;
      if (code.startsWith("LP")) return;

      const rate = toPositiveNumber(row.rate);
      if (rate > 0) {
        rateByCode.set(code, rate);
      }
    });
  }

  return rateByCode;
}

function buildEnrichedSheetItems(parsed, metadataByCode) {
  const byCode = new Map();

  (Array.isArray(parsed.sheetItems) ? parsed.sheetItems : []).forEach((item) => {
    const code = normalizeCode(item?.item_code);
    if (!code) return;

    if (isExcludedCategory(item?.category)) return;

    byCode.set(code, {
      item_code: code,
      item_name: normalizeText(item.item_name) || code,
      category: normalizeText(item.category) || "Unclassified",
      source: "PRICE_SHEET",
    });
  });

  Object.keys(parsed.priceMap || {}).forEach((rawCode) => {
    const code = normalizeCode(rawCode);
    if (!code) return;

    const existing = byCode.get(code) || {
      item_code: code,
      item_name: code,
      category: "Unclassified",
      source: "PRICE_MAP_ONLY",
    };

    const meta = metadataByCode.get(code) || {};
    const nextName = hasMeaningfulItemName(existing.item_name, code)
      ? normalizeText(existing.item_name)
      : (hasMeaningfulItemName(meta.item_name, code) ? normalizeText(meta.item_name) : code);

    const nextCategory = hasMeaningfulCategory(existing.category)
      ? normalizeText(existing.category)
      : (hasMeaningfulCategory(meta.category) ? normalizeText(meta.category) : "Unclassified");

    if (isExcludedCategory(nextCategory)) {
      byCode.delete(code);
      return;
    }

    byCode.set(code, {
      item_code: code,
      item_name: nextName,
      category: nextCategory,
      source: hasMeaningfulItemName(meta.item_name, code) || hasMeaningfulCategory(meta.category)
        ? "ENRICHED_CACHE"
        : existing.source,
    });
  });

  return Array.from(byCode.values());
}

function isAuthorized(request) {
  const expectedSecret = normalizeSecret(cronSecret);
  if (!expectedSecret) return false;

  const authHeader = request.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ")
    ? normalizeSecret(authHeader.slice(7))
    : "";
  const headerSecret = normalizeSecret(request.headers.get("x-cron-secret"));

  return bearer === expectedSecret || headerSecret === expectedSecret;
}

function extractSourcePayload(body) {
  if (!body || typeof body !== "object") return null;
  if (body.payload && typeof body.payload === "object") return body.payload;
  if (body.priceMap && typeof body.priceMap === "object") return body;
  return null;
}

async function readRequestBody(request) {
  const contentType = String(request.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) return null;

  const text = await request.text();
  if (!text.trim()) return null;

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Request body must be valid JSON when provided.");
  }
}

async function runSync(sourcePayload = null) {
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Server configuration is incomplete.");
  }

  let payload = sourcePayload;

  if (!payload) {
    const response = await fetch(PRICE_SOURCE_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Price source failed with ${response.status}`);
    }

    const sourceContentType = String(response.headers.get("content-type") || "").toLowerCase();
    const sourceText = await response.text();

    try {
      payload = JSON.parse(sourceText);
    } catch {
      const snippet = sourceText.slice(0, 180).replace(/\s+/g, " ").trim();
      throw new Error(
        `Price source returned non-JSON content (content-type: ${sourceContentType || "unknown"}). ` +
        `First bytes: ${snippet || "(empty response)"}`
      );
    }
  }

  const parsed = parsePricePayload(payload || {});

  if (!parsed.priceMap || Object.keys(parsed.priceMap).length === 0) {
    throw new Error("Price source returned no prices.");
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: existingCacheRow, error: existingCacheError } = await admin
    .from("price_catalog_cache")
    .select("price_map")
    .eq("cache_key", "default")
    .maybeSingle();

  if (existingCacheError) {
    throw new Error(`Existing cache lookup failed: ${existingCacheError.message}`);
  }

  const existingPriceMap =
    existingCacheRow && existingCacheRow.price_map && typeof existingCacheRow.price_map === "object"
      ? existingCacheRow.price_map
      : {};

  const codes = Object.keys(parsed.priceMap || {}).map((value) => normalizeCode(value)).filter(Boolean);
  const metadataByCode = await loadItemMetadata(admin, codes);
  const fallbackRatesByCode = await loadRateFallback(admin, codes);

  Object.keys(parsed.priceMap || {}).forEach((rawCode) => {
    const code = normalizeCode(rawCode);
    if (!code) return;

    const metadataCategory = normalizeText(metadataByCode.get(code)?.category);
    if (isExcludedCategory(metadataCategory)) {
      delete parsed.priceMap[rawCode];
    }
  });

  Object.keys(parsed.priceMap || {}).forEach((rawCode) => {
    const code = normalizeCode(rawCode);
    if (!code) return;

    const currentRate = toPositiveNumber(parsed.priceMap[rawCode]);
    if (currentRate > 0) return;

    const fallbackRate = fallbackRatesByCode.get(code) || 0;
    if (fallbackRate > 0) {
      parsed.priceMap[rawCode] = fallbackRate;
      return;
    }

    const existingRate = toPositiveNumber(existingPriceMap[rawCode] ?? existingPriceMap[code]);
    if (existingRate > 0) {
      parsed.priceMap[rawCode] = existingRate;
    }
  });

  const enrichedSheetItems = buildEnrichedSheetItems(parsed, metadataByCode);

  const nowIso = new Date().toISOString();
  const priceCount = Object.keys(parsed.priceMap).length;

  const { error: snapshotError } = await admin.from("price_catalog_snapshots").insert({
    source_url: PRICE_SOURCE_URL,
    payload,
    price_count: priceCount,
    created_at: nowIso,
  });

  if (snapshotError) {
    throw new Error(`Snapshot write failed: ${snapshotError.message}`);
  }

  const { error: cacheError } = await admin.from("price_catalog_cache").upsert(
    {
      cache_key: "default",
      price_map: parsed.priceMap,
      sheet_items: enrichedSheetItems,
      source_synced_at: nowIso,
      updated_at: nowIso,
    },
    { onConflict: "cache_key" }
  );

  if (cacheError) {
    throw new Error(`Cache write failed: ${cacheError.message}`);
  }

  return {
    ok: true,
    syncedAt: nowIso,
    priceCount,
    sheetItemCount: enrichedSheetItems.length,
  };
}

export async function POST(request) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await readRequestBody(request);
    const result = await runSync(extractSourcePayload(body));
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "Price sync failed." },
      { status: 500 }
    );
  }
}

export async function GET(request) {
  return POST(request);
}
