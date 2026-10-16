import { createClient } from "@supabase/supabase-js";
import {
  normalizeSessionPlatform,
  sessionIdFromAccessToken,
} from "../../../lib/authSessionLimit.js";

export const runtime = "nodejs";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return Response.json({ success: false, error: "Server configuration is incomplete" }, { status: 500 });
    }

    const authHeader = request.headers.get("authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return Response.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    const token = authHeader.slice(7).trim();
    const sessionId = sessionIdFromAccessToken(token);
    if (!sessionId) {
      return Response.json({ success: true, limited: false, revoked: 0 });
    }

    let requestedPlatform = "";
    try {
      const body = await request.json();
      requestedPlatform = normalizeSessionPlatform(body?.platform);
    } catch {
      requestedPlatform = "";
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData?.user) {
      return Response.json({ success: false, error: "Unable to verify user session" }, { status: 401 });
    }

    const { data, error } = await admin.rpc("enforce_single_platform_session", {
      p_session_id: sessionId,
      p_platform: requestedPlatform || "web",
    });

    if (error) {
      return Response.json({ success: true, limited: false, revoked: 0 });
    }

    return Response.json({
      success: true,
      limited: data?.limited !== false,
      revoked: Number(data?.revoked || 0),
    });
  } catch (error) {
    return Response.json(
      { success: false, error: error.message || "Unable to limit sessions" },
      { status: 500 },
    );
  }
}
