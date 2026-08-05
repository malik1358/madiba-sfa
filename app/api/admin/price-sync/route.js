import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { parsePricePayload } from "../../../lib/pricePayload.js";
import { PRICE_SOURCE_URL } from "../../../lib/priceApiConfig.js";

export const runtime = "nodejs";
export const maxDuration = 120;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const cronSecret = process.env.CRON_SECRET;

function isAuthorized(request) {
  if (!cronSecret) return false;

  const authHeader = request.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const headerSecret = request.headers.get("x-cron-secret") || "";

  return bearer === cronSecret || headerSecret === cronSecret;
}

async function runSync() {
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Server configuration is incomplete.");
  }

  const response = await fetch(PRICE_SOURCE_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Price source failed with ${response.status}`);
  }

  const payload = await response.json();
  const parsed = parsePricePayload(payload || {});

  if (!parsed.priceMap || Object.keys(parsed.priceMap).length === 0) {
    throw new Error("Price source returned no prices.");
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

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
      sheet_items: parsed.sheetItems,
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
    sheetItemCount: Array.isArray(parsed.sheetItems) ? parsed.sheetItems.length : 0,
  };
}

export async function POST(request) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const result = await runSync();
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
