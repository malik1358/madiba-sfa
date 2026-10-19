import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "../../../lib/cronAuth.js";
import { rebuildAllMobileFieldSnapshots } from "../../../lib/server/mobileFieldSnapshot.js";

export const runtime = "nodejs";
export const maxDuration = 300;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(request) {
  return handleRequest(request);
}

export async function GET(request) {
  return handleRequest(request);
}

async function readRebuildOptions(request) {
  const url = new URL(request.url);
  let body = {};
  if (request.method === "POST") {
    try {
      const parsed = await request.json();
      if (parsed && typeof parsed === "object") body = parsed;
    } catch {
      body = {};
    }
  }

  const cursor = String(body.cursor || url.searchParams.get("cursor") || "").trim();
  const parsedLimit = Number(body.limit || url.searchParams.get("limit") || 1);
  const start = body.start === true || url.searchParams.get("start") === "true";

  return {
    trigger: "cron",
    cursor,
    limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.floor(parsedLimit) : 1,
    timeBudgetMs: 220000,
    start,
    resume: start ? false : true,
  };
}

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

    const options = await readRebuildOptions(request);
    const meta = await rebuildAllMobileFieldSnapshots(admin, options);

    return NextResponse.json({
      success: true,
      ...meta,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "Mobile snapshot rebuild failed." },
      { status: 500 },
    );
  }
}
