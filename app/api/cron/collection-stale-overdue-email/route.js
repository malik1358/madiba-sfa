import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "../../../lib/cronAuth.js";
import { formatSupabaseError, withJwtClockSkewRetry } from "../../../lib/dailySalesmanResumeServer.js";
import {
  resolveCollectionStaleOverdueRouteTrigger,
  runCollectionStaleOverdueEmailCycle,
} from "../../../lib/collectionStaleOverdueEmailServer.js";

export const runtime = "nodejs";
export const maxDuration = 120;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function createAdminClient() {
  return createClient(supabaseUrl, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

async function readParams(request) {
  const url = new URL(request.url);
  const queryDate = url.searchParams.get("date");
  const queryForce = url.searchParams.get("force");
  const queryTo = url.searchParams.get("to");
  const queryTrigger = url.searchParams.get("trigger");
  if (String(request.method || "").toUpperCase() === "GET") {
    return {
      date: queryDate || "",
      force: queryForce,
      to: queryTo || "",
      trigger: queryTrigger || "",
    };
  }

  try {
    const body = await request.json();
    return {
      date: body?.date || queryDate || "",
      force: body?.force ?? queryForce,
      to: body?.to || queryTo || "",
      trigger: body?.trigger || queryTrigger || "",
    };
  } catch {
    return {
      date: queryDate || "",
      force: queryForce,
      to: queryTo || "",
      trigger: queryTrigger || "",
    };
  }
}

async function handleRequest(request) {
  try {
    if (!isCronAuthorized(request)) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const { date, force, to, trigger } = await readParams(request);
    const result = await withJwtClockSkewRetry(async () => {
      const admin = createAdminClient();
      return runCollectionStaleOverdueEmailCycle(admin, {
        date,
        trigger: resolveCollectionStaleOverdueRouteTrigger({ date, force, to, trigger }),
        env: {
          ...process.env,
          ...(String(force || "").trim() ? { COLLECTION_STALE_OVERDUE_EMAIL_FORCE: "true" } : {}),
          ...(String(to || "").trim() ? { COLLECTION_STALE_OVERDUE_EMAIL_TEST_TO: String(to).trim() } : {}),
        },
      });
    });
    const failedCount = Number(result.failedCount || 0);
    return NextResponse.json(
      { success: failedCount === 0, ...result },
      { status: failedCount ? 500 : 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: formatSupabaseError(error) || "Collection stale overdue email cycle failed.",
      },
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
