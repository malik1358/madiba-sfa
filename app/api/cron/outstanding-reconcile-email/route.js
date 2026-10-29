import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "../../../lib/cronAuth.js";
import { sendOutstandingReconcileEmailNow } from "../../../lib/outstandingReconcileEmailServer.js";

export const runtime = "nodejs";
export const maxDuration = 300;

function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function truthy(value) {
  return ["1", "true", "yes"].includes(String(value || "").trim().toLowerCase());
}

async function readParams(request) {
  const url = new URL(request.url);
  const queryRebuild = url.searchParams.get("rebuild");
  const queryTrigger = url.searchParams.get("trigger");
  if (String(request.method || "").toUpperCase() === "GET") {
    return {
      rebuild: truthy(queryRebuild),
      trigger: queryTrigger || "manual-test",
    };
  }
  try {
    const body = await request.json();
    return {
      rebuild: truthy(body?.rebuild ?? queryRebuild),
      trigger: String(body?.trigger || queryTrigger || "manual-test").trim() || "manual-test",
    };
  } catch {
    return {
      rebuild: truthy(queryRebuild),
      trigger: queryTrigger || "manual-test",
    };
  }
}

async function handleRequest(request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
  }

  const params = await readParams(request);
  try {
    const result = await sendOutstandingReconcileEmailNow(createAdminClient(), {
      trigger: params.trigger,
      // Default: email the saved differences snapshot. Pass rebuild=1 to recompute first.
      rebuildSaved: !params.rebuild,
    });
    return NextResponse.json({
      success: !result.skipped || result.reason === "no_differences",
      ...result,
    }, { status: result.skipped && result.reason !== "no_differences" ? 500 : 200 });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: String(error?.message || error),
    }, { status: 500 });
  }
}

export async function GET(request) {
  return handleRequest(request);
}

export async function POST(request) {
  return handleRequest(request);
}
