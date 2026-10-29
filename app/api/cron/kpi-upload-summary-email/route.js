import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "../../../lib/cronAuth.js";
import { runKpiUploadSummaryEmailCycle } from "../../../lib/kpiUploadSummaryEmailServer.js";

export const runtime = "nodejs";
export const maxDuration = 180;

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
  const queryForce = url.searchParams.get("force");
  const queryTrigger = url.searchParams.get("trigger");
  if (String(request.method || "").toUpperCase() === "GET") {
    return {
      force: truthy(queryForce),
      trigger: queryTrigger || "manual-test",
    };
  }
  try {
    const body = await request.json();
    return {
      force: truthy(body?.force ?? queryForce),
      trigger: String(body?.trigger || queryTrigger || "manual-test").trim() || "manual-test",
    };
  } catch {
    return {
      force: truthy(queryForce),
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
    const result = await runKpiUploadSummaryEmailCycle(createAdminClient(), {
      trigger: params.trigger,
      force: params.force || params.trigger === "manual-test",
      env: process.env,
    });
    return NextResponse.json({
      success: true,
      ...result,
    });
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
