import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isFcmConfigured, sendPushToUser } from "../../../lib/fcm.js";

export const runtime = "nodejs";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function requireAdminAccess(admin, request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 }) };
  }

  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: userError } = await admin.auth.getUser(token);
  if (userError || !user) {
    return { error: NextResponse.json({ success: false, error: "Invalid login session" }, { status: 401 }) };
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const role = String(profile?.role || "").toLowerCase();
  if (profileError || !profile || !["admin", "manager"].includes(role)) {
    return {
      error: NextResponse.json(
        { success: false, error: "Only admin or manager can send push notifications." },
        { status: 403 },
      ),
    };
  }

  return { user, role };
}

function normalizeUserIds(body) {
  const ids = [];
  if (body?.userId) ids.push(String(body.userId).trim());
  if (Array.isArray(body?.userIds)) {
    body.userIds.forEach((value) => {
      const next = String(value || "").trim();
      if (next) ids.push(next);
    });
  }
  return [...new Set(ids.filter(Boolean))];
}

export async function POST(request) {
  try {
    if (!isFcmConfigured()) {
      return NextResponse.json(
        { success: false, error: "FIREBASE_SERVICE_ACCOUNT_JSON is not configured on the server." },
        { status: 503 },
      );
    }

    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const access = await requireAdminAccess(admin, request);
    if (access.error) return access.error;

    const body = await request.json().catch(() => ({}));
    const userIds = normalizeUserIds(body);
    const title = String(body?.title || "MADIBA SFA").trim() || "MADIBA SFA";
    const bodyText = String(body?.body || body?.message || "").trim();
    const notificationType = String(body?.type || "manual").trim() || "manual";

    if (userIds.length === 0) {
      return NextResponse.json({ success: false, error: "userId or userIds is required." }, { status: 400 });
    }

    if (!bodyText) {
      return NextResponse.json({ success: false, error: "body is required." }, { status: 400 });
    }

    const results = [];

    for (const userId of userIds) {
      const sendResult = await sendPushToUser(admin, userId, {
        title,
        body: bodyText,
        data: {
          type: notificationType,
        },
      });

      await admin.from("push_notification_log").insert({
        user_id: userId,
        notification_type: notificationType,
        title,
        body: bodyText,
        success_count: sendResult.successCount,
        failure_count: sendResult.failureCount,
      });

      results.push({
        userId,
        successCount: sendResult.successCount,
        failureCount: sendResult.failureCount,
      });
    }

    return NextResponse.json({
      success: true,
      sentToUsers: results.filter((row) => row.successCount > 0).length,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "Unable to send push notification." },
      { status: 500 },
    );
  }
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const access = await requireAdminAccess(admin, request);
    if (access.error) return access.error;

    const url = new URL(request.url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 25)));

    const { data, error } = await admin
      .from("push_notification_log")
      .select("id,user_id,notification_type,title,body,success_count,failure_count,sent_at")
      .order("sent_at", { ascending: false })
      .limit(limit);

    if (error) throw error;

    return NextResponse.json({
      success: true,
      configured: isFcmConfigured(),
      notifications: data || [],
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "Unable to load push notification log." },
      { status: 500 },
    );
  }
}
