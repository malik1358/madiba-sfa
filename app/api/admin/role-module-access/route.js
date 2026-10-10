import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdminRole } from "../../../lib/moduleAccess.js";
import {
  loadRoleModuleMatrix,
  saveRoleModuleMatrix,
} from "../../../lib/roleModuleAccessServer.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function requireAdmin(admin, request) {
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
    .select("id,role,salesman_code,salesman_name,email")
    .eq("id", user.id)
    .single();

  if (profileError || !profile || !isAdminRole(profile.role)) {
    return {
      error: NextResponse.json({ success: false, error: "Only admin can configure role access." }, { status: 403 }),
    };
  }

  return { user, profile };
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const access = await requireAdmin(admin, request);
    if (access.error) return access.error;

    const payload = await loadRoleModuleMatrix(admin);
    return NextResponse.json({
      success: true,
      ...payload,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "Unable to load role access." },
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
    const access = await requireAdmin(admin, request);
    if (access.error) return access.error;

    const body = await request.json().catch(() => ({}));
    const updatedBy = access.profile?.email
      || access.profile?.salesman_name
      || access.profile?.salesman_code
      || access.user?.id
      || null;

    const payload = await saveRoleModuleMatrix(admin, body.matrix, { updatedBy });
    return NextResponse.json({
      success: true,
      ...payload,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "Unable to save role access." },
      { status: 400 },
    );
  }
}
