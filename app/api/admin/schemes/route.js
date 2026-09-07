import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCollectionOnlyAccess } from "../../../lib/moduleAccess.js";
import {
  DEFAULT_ORDER_SCHEMES,
  normalizeOrderSchemes,
  ORDER_SCHEMES_CACHE_KEY,
  resolveStoredOrderSchemes,
} from "../../../lib/orderSchemes.js";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function requireManager(admin, request) {
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
  if (
    profileError
    || !profile
    || !["admin", "manager"].includes(role)
    || isCollectionOnlyAccess({ role, salesmanCode: profile.salesman_code })
  ) {
    return { error: NextResponse.json({ success: false, error: "Only admin or manager can configure schemes." }, { status: 403 }) };
  }

  return { user, profile, role };
}

async function readSchemes(admin) {
  const { data, error } = await admin
    .from("price_catalog_cache")
    .select("price_map,updated_at")
    .eq("cache_key", ORDER_SCHEMES_CACHE_KEY)
    .maybeSingle();

  if (error) throw error;

  const configured = Boolean(data?.price_map && typeof data.price_map === "object");
  return {
    schemes: configured ? resolveStoredOrderSchemes(data.price_map) : normalizeOrderSchemes(DEFAULT_ORDER_SCHEMES),
    configured,
    updatedAt: data?.updated_at || null,
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
    const access = await requireManager(admin, request);
    if (access.error) return access.error;

    const payload = await readSchemes(admin);
    return NextResponse.json({
      success: true,
      ...payload,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "Unable to load schemes." },
      { status: 400 },
    );
  }
}

export async function PUT(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const access = await requireManager(admin, request);
    if (access.error) return access.error;

    const body = await request.json().catch(() => ({}));
    const schemes = normalizeOrderSchemes(body.schemes);
    const nowIso = new Date().toISOString();

    const { error } = await admin.from("price_catalog_cache").upsert(
      {
        cache_key: ORDER_SCHEMES_CACHE_KEY,
        price_map: { schemes },
        sheet_items: [],
        source_synced_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: "cache_key" },
    );

    if (error) throw error;

    try {
      const { hashOfflineDataContent, publishOfflineDataUpdate } = await import("../../../lib/offlineDataBroadcast.js");
      await publishOfflineDataUpdate(admin, {
        trigger: "schemes-update",
        kinds: ["schemes"],
        contentHash: hashOfflineDataContent(schemes),
      });
    } catch (publishError) {
      console.error("Offline data publish after schemes update failed:", publishError);
    }

    return NextResponse.json({
      success: true,
      schemes,
      configured: true,
      updatedAt: nowIso,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "Unable to save schemes." },
      { status: 400 },
    );
  }
}
