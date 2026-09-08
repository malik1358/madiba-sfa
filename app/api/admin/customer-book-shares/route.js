import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCollectionOnlyAccess } from "../../../lib/moduleAccess.js";
import {
  ensureDefaultCustomerBookShares,
  loadAllCustomerBookShareRows,
  salesmanLabel,
} from "../../../lib/customerBookShares.js";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function createAdmin() {
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

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
    .select("id,role,salesman_code,salesman_name")
    .eq("id", user.id)
    .single();

  const role = String(profile?.role || "").toLowerCase();
  if (
    profileError
    || !profile
    || !["admin", "manager"].includes(role)
    || isCollectionOnlyAccess({ role, salesmanCode: profile.salesman_code })
  ) {
    return { error: NextResponse.json({ success: false, error: "Only admin or manager can manage customer book shares." }, { status: 403 }) };
  }

  return { user, profile, role };
}

async function listSalesmen(admin) {
  const { data, error } = await admin
    .from("profiles")
    .select("id,salesman_code,salesman_name,role,is_active,email")
    .order("salesman_name");

  if (error) throw error;

  return (data || []).filter((row) => {
    const code = String(row.salesman_code || "").trim();
    if (!code) return false;
    return !isCollectionOnlyAccess({ role: row.role, salesmanCode: code });
  });
}

function enrichShares(rows, salesmenById) {
  return (rows || []).map((row) => {
    const source = salesmenById.get(row.source_salesman_id) || null;
    const viewer = salesmenById.get(row.viewer_salesman_id) || null;
    return {
      id: row.id,
      source_salesman_id: row.source_salesman_id,
      viewer_salesman_id: row.viewer_salesman_id,
      is_active: row.is_active !== false,
      created_at: row.created_at || null,
      updated_at: row.updated_at || null,
      source_label: salesmanLabel(source),
      viewer_label: salesmanLabel(viewer),
      source_salesman_code: source?.salesman_code || "",
      source_salesman_name: source?.salesman_name || "",
      viewer_salesman_code: viewer?.salesman_code || "",
      viewer_salesman_name: viewer?.salesman_name || "",
    };
  });
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const admin = createAdmin();
    const auth = await requireManager(admin, request);
    if (auth.error) return auth.error;

    const salesmen = await listSalesmen(admin);
    const seed = await ensureDefaultCustomerBookShares(admin, salesmen, auth.profile.id);
    if (seed.tableMissing) {
      return NextResponse.json({
        success: false,
        error: "Customer book shares table is not installed yet. Apply the latest database migration.",
        tableMissing: true,
      }, { status: 503 });
    }

    const rows = await loadAllCustomerBookShareRows(admin);
    const salesmenById = new Map(salesmen.map((row) => [row.id, row]));

    return NextResponse.json({
      success: true,
      shares: enrichShares(rows, salesmenById),
      salesmen: salesmen.map((row) => ({
        id: row.id,
        salesman_code: row.salesman_code || "",
        salesman_name: row.salesman_name || "",
        role: row.role || "",
        is_active: row.is_active !== false,
        label: salesmanLabel(row),
      })),
      seeded: seed.seeded || 0,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || "Unable to load customer book shares." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const admin = createAdmin();
    const auth = await requireManager(admin, request);
    if (auth.error) return auth.error;

    const body = await request.json().catch(() => ({}));
    const mode = String(body.mode || "create").trim().toLowerCase();

    if (mode === "create") {
      const sourceId = String(body.sourceSalesmanId || "").trim();
      const viewerId = String(body.viewerSalesmanId || "").trim();
      if (!sourceId || !viewerId) {
        return NextResponse.json({ success: false, error: "Choose both whose customers to share and who can see them." }, { status: 400 });
      }
      if (sourceId === viewerId) {
        return NextResponse.json({ success: false, error: "Source and viewer must be different salesmen." }, { status: 400 });
      }

      const salesmen = await listSalesmen(admin);
      const salesmenById = new Map(salesmen.map((row) => [row.id, row]));
      if (!salesmenById.has(sourceId) || !salesmenById.has(viewerId)) {
        return NextResponse.json({ success: false, error: "One or both salesmen were not found." }, { status: 404 });
      }

      const { data: existing } = await admin
        .from("customer_book_shares")
        .select("id,is_active")
        .eq("source_salesman_id", sourceId)
        .eq("viewer_salesman_id", viewerId)
        .maybeSingle();

      if (existing?.id) {
        const { data, error } = await admin
          .from("customer_book_shares")
          .update({
            is_active: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id)
          .select("id,source_salesman_id,viewer_salesman_id,is_active,created_at,updated_at")
          .single();
        if (error) throw error;
        return NextResponse.json({
          success: true,
          message: "Customer book share updated.",
          share: enrichShares([data], salesmenById)[0],
        });
      }

      const { data, error } = await admin
        .from("customer_book_shares")
        .insert({
          source_salesman_id: sourceId,
          viewer_salesman_id: viewerId,
          is_active: true,
          created_by: auth.profile.id,
          updated_at: new Date().toISOString(),
        })
        .select("id,source_salesman_id,viewer_salesman_id,is_active,created_at,updated_at")
        .single();
      if (error) throw error;

      return NextResponse.json({
        success: true,
        message: "Customer book share created.",
        share: enrichShares([data], salesmenById)[0],
      });
    }

    if (mode === "delete" || mode === "deactivate") {
      const shareId = String(body.shareId || "").trim();
      if (!shareId) {
        return NextResponse.json({ success: false, error: "Share id is required." }, { status: 400 });
      }

      if (mode === "delete") {
        const { error } = await admin.from("customer_book_shares").delete().eq("id", shareId);
        if (error) throw error;
        return NextResponse.json({ success: true, message: "Customer book share removed." });
      }

      const { error } = await admin
        .from("customer_book_shares")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", shareId);
      if (error) throw error;
      return NextResponse.json({ success: true, message: "Customer book share deactivated." });
    }

    return NextResponse.json({ success: false, error: "Unsupported mode." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || "Unable to update customer book shares." }, { status: 500 });
  }
}
