import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCollectionOnlyAccess } from "../../../lib/moduleAccess.js";
import {
  DEFAULT_ITEM_PRICE_HISTORY_LIMIT,
  MIN_ITEM_PRICE_HISTORY_ROWS,
  loadItemPriceHistory,
  matchItemCatalogEntries,
} from "../../../lib/itemPriceHistory.js";
import {
  DEFAULT_PRICING_REGION,
  normalizePricingRegion,
  pricingRegionLabel,
  regionPriceMapFor,
  withRegionFallbacks,
} from "../../../lib/regionalPricing.js";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

async function requirePriceHistoryAccess(admin, request) {
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return { error: NextResponse.json({ success: false, error: "Please login again." }, { status: 401 }) };
  }

  const token = authHeader.slice(7);
  const { data: { user }, error: userError } = await admin.auth.getUser(token);
  if (userError || !user) {
    return { error: NextResponse.json({ success: false, error: "Please login again." }, { status: 401 }) };
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,role,salesman_code")
    .eq("id", user.id)
    .single();

  const role = String(profile?.role || "").toLowerCase();
  const collectionOnly = isCollectionOnlyAccess({
    role,
    salesmanCode: profile?.salesman_code,
    collectionOnlyMetadata: Boolean(user.user_metadata?.collection_only),
  });

  if (
    profileError
    || !profile
    || collectionOnly
    || !["admin", "manager", "invoice-maker", "invoice_maker", "salesman", "product-promoter"].includes(role)
  ) {
    return {
      error: NextResponse.json(
        { success: false, error: "Only sales users can view item price history." },
        { status: 403 },
      ),
    };
  }

  return { user, profile, role };
}

async function loadCatalog(admin) {
  const [{ data: cacheRow }, { data: rulesRow }] = await Promise.all([
    admin
      .from("price_catalog_cache")
      .select("price_map,sheet_items,source_synced_at,updated_at")
      .eq("cache_key", "default")
      .maybeSingle(),
    admin
      .from("price_catalog_cache")
      .select("price_map")
      .eq("cache_key", "pricing_rules")
      .maybeSingle(),
  ]);

  const priceMap = cacheRow?.price_map && typeof cacheRow.price_map === "object"
    ? cacheRow.price_map
    : {};
  const rules = rulesRow?.price_map && typeof rulesRow.price_map === "object"
    ? rulesRow.price_map
    : {};
  const regionPriceMaps = withRegionFallbacks(rules.regionPriceMaps || {}, priceMap);
  const sheetItems = Array.isArray(cacheRow?.sheet_items) ? cacheRow.sheet_items : [];

  return {
    priceMap,
    regionPriceMaps,
    sheetItems,
    syncedAt: cacheRow?.source_synced_at || cacheRow?.updated_at || null,
  };
}

async function resolveItemMeta(admin, itemCode, sheetItems = []) {
  const code = normalizeCode(itemCode);
  const fromSheet = (sheetItems || []).find((row) => normalizeCode(row?.item_code) === code);
  if (fromSheet) {
    return {
      itemCode: code,
      itemName: normalizeText(fromSheet.item_name) || code,
      category: normalizeText(fromSheet.category) || "",
    };
  }

  const { data } = await admin
    .from("items_master")
    .select("item_code,item_name,category")
    .eq("item_code", code)
    .maybeSingle();

  if (data) {
    return {
      itemCode: code,
      itemName: normalizeText(data.item_name) || code,
      category: normalizeText(data.category) || "",
    };
  }

  return {
    itemCode: code,
    itemName: code,
    category: "",
  };
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const access = await requirePriceHistoryAccess(admin, request);
    if (access.error) return access.error;

    const url = new URL(request.url);
    const query = normalizeText(url.searchParams.get("q") || url.searchParams.get("query"));
    const itemCode = normalizeCode(url.searchParams.get("itemCode") || url.searchParams.get("item_code"));
    const region = normalizePricingRegion(url.searchParams.get("region") || DEFAULT_PRICING_REGION);
    const limit = Math.min(
      50,
      Math.max(MIN_ITEM_PRICE_HISTORY_ROWS, Number(url.searchParams.get("limit")) || DEFAULT_ITEM_PRICE_HISTORY_LIMIT),
    );

    const catalog = await loadCatalog(admin);

    if (query && !itemCode) {
      const matches = matchItemCatalogEntries(catalog.sheetItems, query, 25);
      if (matches.length === 0 && query.length >= 2) {
        const { data: masterRows } = await admin
          .from("items_master")
          .select("item_code,item_name,category")
          .or(`item_code.ilike.%${query}%,item_name.ilike.%${query}%`)
          .limit(25);
        return NextResponse.json({
          success: true,
          matches: matchItemCatalogEntries(masterRows || [], query, 25),
          region,
          regionLabel: pricingRegionLabel(region),
        });
      }

      return NextResponse.json({
        success: true,
        matches,
        region,
        regionLabel: pricingRegionLabel(region),
      });
    }

    if (!itemCode) {
      return NextResponse.json({
        success: false,
        error: "Enter an item code or search query.",
      }, { status: 400 });
    }

    const regionMap = regionPriceMapFor(catalog.regionPriceMaps, region, catalog.priceMap);
    const currentPrice = toPositiveNumber(regionMap[itemCode]);
    const item = await resolveItemMeta(admin, itemCode, catalog.sheetItems);
    const { history, source } = await loadItemPriceHistory(admin, {
      itemCode,
      region,
      limit,
      currentPrice,
    });

    return NextResponse.json({
      success: true,
      item,
      region,
      regionLabel: pricingRegionLabel(region),
      currentPrice,
      syncedAt: catalog.syncedAt,
      history,
      historyCount: history.length,
      source,
      migrationHint: history.length === 0
        ? "Run sql/setup_item_price_history.sql in Supabase, then wait for the next price sync (or trigger /api/admin/price-sync)."
        : null,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "Unable to load item price history." },
      { status: 500 },
    );
  }
}
