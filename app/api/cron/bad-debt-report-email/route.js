import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runBadDebtReportEmailCycle } from "../../../lib/badDebtReportEmailServer.js";
import { isCronAuthorized } from "../../../lib/cronAuth.js";
import { teamEmailWindowSkip } from "../../../lib/workdayActivity.js";

export const runtime = "nodejs";
export const maxDuration = 180;

function truthyFlag(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

async function readParams(request) {
  const url = new URL(request.url);
  const queryForce = url.searchParams.get("force");
  const queryTo = url.searchParams.get("to");
  if (String(request.method || "").toUpperCase() === "GET") {
    return { force: queryForce, to: queryTo || "" };
  }
  try {
    const body = await request.json();
    return { force: body?.force ?? queryForce, to: body?.to || queryTo || "" };
  } catch {
    return { force: queryForce, to: queryTo || "" };
  }
}

async function handleRequest(request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Server configuration is incomplete.");
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { force, to } = await readParams(request);
    const forced = truthyFlag(force);
    const bypass = Boolean(String(to || "").trim() || forced);
    const held = teamEmailWindowSkip(new Date(), { bypass });
    if (held) return NextResponse.json(held);
    const result = await runBadDebtReportEmailCycle(admin, {
      force: forced,
      env: {
        ...process.env,
        ...(forced ? { BAD_DEBT_REPORT_EMAIL_FORCE: "true" } : {}),
        ...(String(to || "").trim() ? { BAD_DEBT_REPORT_EMAIL_TEST_TO: String(to).trim() } : {}),
      },
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Potential bad debt email failed:", error?.message || error);
    return NextResponse.json({ success: false, error: error.message || "Potential bad debt email failed." }, { status: 500 });
  }
}

export const GET = handleRequest;
export const POST = handleRequest;
