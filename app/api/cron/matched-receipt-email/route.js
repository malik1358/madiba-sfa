import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "../../../lib/cronAuth.js";
import { runMatchedReceiptEmailCycle } from "../../../lib/matchedReceiptEmailServer.js";

export const runtime = "nodejs";
export const maxDuration = 120;

function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function handleRequest(request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
  }

  try {
    const url = new URL(request.url);
    let body = {};
    if (request.method === "POST") {
      try { body = await request.json(); } catch {}
    }
    const to = String(body.to || url.searchParams.get("to") || "").trim();
    const result = await runMatchedReceiptEmailCycle(createAdminClient(), {
      date: body.date || url.searchParams.get("date") || "",
      preview: body.preview === true || url.searchParams.get("preview") === "true",
      to,
      now: new Date(),
      env: process.env,
    });
    return NextResponse.json({ success: !result.failedCount, ...result }, { status: result.failedCount ? 500 : 200 });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error?.message || error) }, { status: 500 });
  }
}

export async function GET(request) {
  return handleRequest(request);
}

export async function POST(request) {
  return handleRequest(request);
}