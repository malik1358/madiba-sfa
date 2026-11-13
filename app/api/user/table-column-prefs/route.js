import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadUserTableColumnPrefs, saveUserTableHidden } from "../../../lib/tableColumnPrefsServer.js";
import { normalizeHiddenLabels, normalizeTableId } from "../../../lib/tableColumnVisibility.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function adminClient() {
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireUser(admin, request) {
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return { error: NextResponse.json({ success: false, error: "Please login again." }, { status: 401 }) };
  }
  const token = authHeader.slice(7);
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) {
    return { error: NextResponse.json({ success: false, error: "Please login again." }, { status: 401 }) };
  }
  return { user };
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }
    const admin = adminClient();
    const access = await requireUser(admin, request);
    if (access.error) return access.error;

    const prefs = await loadUserTableColumnPrefs(admin, access.user.id);
    return NextResponse.json({ success: true, version: prefs.version, tables: prefs.tables });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error?.message || "Unable to load column preferences." },
      { status: 500 },
    );
  }
}

export async function PUT(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }
    const admin = adminClient();
    const access = await requireUser(admin, request);
    if (access.error) return access.error;

    const body = await request.json().catch(() => ({}));
    const tableId = normalizeTableId(body?.tableId);
    if (!tableId) {
      return NextResponse.json({ success: false, error: "tableId is required." }, { status: 400 });
    }
    const hidden = normalizeHiddenLabels(body?.hidden);
    const prefs = await saveUserTableHidden(admin, access.user.id, tableId, hidden);
    return NextResponse.json({
      success: true,
      version: prefs.version,
      tables: prefs.tables,
      tableId,
      hidden: prefs.tables?.[tableId]?.hidden || [],
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error?.message || "Unable to save column preferences." },
      { status: 500 },
    );
  }
}
