import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadRoleModuleMatrix } from "../../lib/roleModuleAccessServer.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function requireUser(admin, request) {
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return { error: NextResponse.json({ success: false, error: "Please login again." }, { status: 401 }) };
  }

  const token = authHeader.slice(7);
  const { data: { user }, error: userError } = await admin.auth.getUser(token);
  if (userError || !user) {
    return { error: NextResponse.json({ success: false, error: "Please login again." }, { status: 401 }) };
  }

  return { user };
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const auth = await requireUser(admin, request);
    if (auth.error) return auth.error;

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
