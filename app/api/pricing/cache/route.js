import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ORDER_SCHEMES_CACHE_KEY, resolveStoredOrderSchemes } from "../../../lib/orderSchemes.js";
import { PRICE_SOURCE_URL } from "../../../lib/priceApiConfig.js";
import { overlayGoogleSheetItemNames } from "../../../lib/pricePayload.js";

export const runtime = "nodejs";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STALE_HOURS = 8;
const GOOGLE_SHEET_NAME_TIMEOUT_MS = 20000;

function getAgeHours(isoTime) {
  if (!isoTime) return Number.POSITIVE_INFINITY;
  const timestamp = Date.parse(isoTime);
  if (!Number.isFinite(timestamp)) return Number.POSITIVE_INFINITY;
  return (Date.now() - timestamp) / (1000 * 60 * 60);
}

function sheetItemsFromPayload(payload) {
  if (!payload || typeof payload !== "object") return [];
  return Array.isArray(payload.sheetItems) ? payload.sheetItems : [];
}

async function loadGoogleSheetItemsFromSnapshot(admin) {
  const { data, error } = await admin
    .from("price_catalog_snapshots")
    .select("payload,created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return [];
  return sheetItemsFromPayload(data.payload);
}

async function loadGoogleSheetItemsLive() {
  const sourceUrl = String(PRICE_SOURCE_URL || "").trim();
  if (!sourceUrl) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GOOGLE_SHEET_NAME_TIMEOUT_MS);

  try {
    const response = await fetch(sourceUrl, {
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) return [];

    const payload = await response.json().catch(() => null);
    return sheetItemsFromPayload(payload);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function loadGoogleSheetItems(admin) {
  const fromSnapshot = await loadGoogleSheetItemsFromSnapshot(admin);
  if (fromSnapshot.length > 0) return fromSnapshot;
  return loadGoogleSheetItemsLive();
}

export async function GET() {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json(
        { success: false, error: "Server configuration is incomplete." },
        { status: 500 }
      );
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const [{ data, error }, { data: rulesRow }, { data: schemesRow }] = await Promise.all([
      admin
        .from("price_catalog_cache")
        .select("cache_key,price_map,sheet_items,source_synced_at,updated_at")
        .eq("cache_key", "default")
        .single(),
      admin
        .from("price_catalog_cache")
        .select("price_map")
        .eq("cache_key", "pricing_rules")
        .maybeSingle(),
      admin
        .from("price_catalog_cache")
        .select("price_map")
        .eq("cache_key", ORDER_SCHEMES_CACHE_KEY)
        .maybeSingle(),
    ]);

    if (error || !data?.price_map) {
      return NextResponse.json(
        {
          success: false,
          error: "Price cache is empty. Run sync first.",
        },
        { status: 503 }
      );
    }

    const ageHours = getAgeHours(data.source_synced_at || data.updated_at);
    const rules = rulesRow?.price_map && typeof rulesRow.price_map === "object" ? rulesRow.price_map : {};
    const cachedSheetItems = Array.isArray(data.sheet_items) ? data.sheet_items : [];
    const googleSheetItems = await loadGoogleSheetItems(admin);
    const sheetItems = googleSheetItems.length > 0
      ? overlayGoogleSheetItemNames(cachedSheetItems, googleSheetItems)
      : cachedSheetItems;

    return NextResponse.json({
      success: true,
      source: "database-cache",
      isStale: ageHours > STALE_HOURS,
      syncedAt: data.source_synced_at || data.updated_at,
      priceMap: data.price_map || {},
      regionPriceMaps: rules.regionPriceMaps || {},
      cashDiscountMap: rules.cashDiscountMap || {},
      valueDiscountMap: rules.valueDiscountMap || {},
      schemes: resolveStoredOrderSchemes(schemesRow?.price_map),
      sheetItems,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "Unable to load price cache." },
      { status: 500 }
    );
  }
}
