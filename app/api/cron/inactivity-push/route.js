import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "../../../lib/cronAuth.js";
import { runInactivityEmailCycle } from "../../../lib/inactivityEmailServer.js";
import { runInactivityPushCycle } from "../../../lib/inactivityPushServer.js";

export const runtime = "nodejs";
export const maxDuration = 120;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function handleRequest(request) {
  try {
    if (!isCronAuthorized(request)) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const email = await runInactivityEmailCycle(admin);
    console.info("inactivity-email-cycle", JSON.stringify({
      reportDate: email?.reportDate || null,
      skipped: Boolean(email?.skipped),
      reason: email?.reason || null,
      checked: Number(email?.checked || 0),
      sent: Number(email?.sent || 0),
      loginRemindersSent: Number(email?.loginRemindersSent || 0),
      details: (email?.details || []).map((row) => ({
        userId: row.userId,
        kind: row.kind,
        status: row.status,
        reason: row.reason || null,
        slot: row.slot ?? null,
        idleMinutes: row.idleMinutes ?? null,
      })),
    }));

    let push;
    try {
      push = await runInactivityPushCycle(admin);
    } catch (error) {
      const message = error.message || "Inactivity push cycle failed.";
      if (String(message).includes("FIREBASE_SERVICE_ACCOUNT_JSON")) {
        push = {
          ok: true,
          skipped: true,
          reason: "fcm_misconfigured",
          error: message,
        };
      } else {
        throw error;
      }
    }

    return NextResponse.json({
      success: true,
      ...push,
      email,
      push,
    });
  } catch (error) {
    const message = error.message || "Inactivity push cycle failed.";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}

export async function POST(request) {
  return handleRequest(request);
}

export async function GET(request) {
  return handleRequest(request);
}
