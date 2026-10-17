import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "../../../lib/cronAuth.js";
import { runGpsChangeEmailCycle } from "../../../lib/customerGpsChangeEmailServer.js";
import { scheduledPreviousDayEmailDates, teamEmailWindowSkip } from "../../../lib/workdayActivity.js";

export const runtime = "nodejs";
export const maxDuration = 120;

async function readParams(request) {
  const url = new URL(request.url);
  const queryDate = url.searchParams.get("date");
  const queryForce = url.searchParams.get("force");
  const queryTo = url.searchParams.get("to");
  if (String(request.method || "").toUpperCase() === "GET") {
    return { date: queryDate || "", force: queryForce, to: queryTo || "" };
  }
  try {
    const body = await request.json();
    return {
      date: body?.date || queryDate || "",
      force: body?.force ?? queryForce,
      to: body?.to || queryTo || "",
    };
  } catch {
    return { date: queryDate || "", force: queryForce, to: queryTo || "" };
  }
}

async function handleRequest(request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Server configuration is incomplete.");
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { date, force, to } = await readParams(request);
    const bypass = Boolean(String(to || "").trim() || String(force || "").trim());
    const held = teamEmailWindowSkip(new Date(), { bypass });
    if (held) return NextResponse.json(held);
    const explicitDate = String(date || "").trim();
    const dates = explicitDate || bypass ? [explicitDate] : scheduledPreviousDayEmailDates();
    const runs = [];
    for (const reportDate of dates) {
      runs.push(await runGpsChangeEmailCycle(admin, {
        date: reportDate,
        force,
        env: {
          ...process.env,
          ...(String(force || "").trim() ? { CUSTOMER_GPS_CHANGE_EMAIL_FORCE: "true" } : {}),
          ...(String(to || "").trim() ? { CUSTOMER_GPS_CHANGE_EMAIL_TEST_TO: String(to).trim() } : {}),
        },
      }));
    }
    const result = runs[runs.length - 1] || {};
    return NextResponse.json({ success: true, ...result, dates: runs.map((run) => run.date), runs });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || "GPS digest failed." }, { status: 500 });
  }
}

export const GET = handleRequest;
export const POST = handleRequest;
