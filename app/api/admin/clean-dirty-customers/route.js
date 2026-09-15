import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cleanDirtyCustomerCodeDuplicates } from "../../../lib/cleanDirtyCustomerCodes.js";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function createAdminClient() {
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

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
    .select("id,role")
    .eq("id", user.id)
    .single();

  if (profileError || !profile || String(profile.role || "").toLowerCase() !== "admin") {
    return {
      error: NextResponse.json({ success: false, error: "Only admin can clean customer master data." }, { status: 403 }),
    };
  }

  return { user, profile };
}

export async function POST(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const admin = createAdminClient();
    const access = await requireAdmin(admin, request);
    if (access.error) return access.error;

    const result = await cleanDirtyCustomerCodeDuplicates(admin);
    return NextResponse.json({
      success: true,
      ...result,
    }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error?.message || error || "Cleanup failed.") },
      { status: 500 },
    );
  }
}
