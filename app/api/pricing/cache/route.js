import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STALE_HOURS = 8;

function getAgeHours(isoTime) {
  if (!isoTime) return Number.POSITIVE_INFINITY;
  const timestamp = Date.parse(isoTime);
  if (!Number.isFinite(timestamp)) return Number.POSITIVE_INFINITY;
  return (Date.now() - timestamp) / (1000 * 60 * 60);
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

    const { data, error } = await admin
      .from("price_catalog_cache")
      .select("cache_key,price_map,sheet_items,source_synced_at,updated_at")
      .eq("cache_key", "default")
      .single();

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

    return NextResponse.json({
      success: true,
      source: "database-cache",
      isStale: ageHours > STALE_HOURS,
      syncedAt: data.source_synced_at || data.updated_at,
      priceMap: data.price_map || {},
      sheetItems: Array.isArray(data.sheet_items) ? data.sheet_items : [],
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "Unable to load price cache." },
      { status: 500 }
    );
  }
}
