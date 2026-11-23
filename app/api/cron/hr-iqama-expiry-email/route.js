import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "../../../lib/cronAuth.js";
import {
  resolveHrIqamaExpiryEmailRouteTrigger,
  runHrIqamaExpiryEmailCycle,
} from "../../../lib/hr/hrIqamaExpiryEmailServer.js";
import { teamEmailWindowSkip } from "../../../lib/workdayActivity.js";

export const runtime = "nodejs";
export const maxDuration = 120;

function truthyFlag(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

async function readParams(request) {
  const url = new URL(request.url);
  const queryForce = url.searchParams.get("force");
  const queryTo = url.searchParams.get("to");
  const queryDate = url.searchParams.get("date");
  const queryTrigger = url.searchParams.get("trigger");
  if (String(request.method || "").toUpperCase() === "GET") {
    return {
      force: queryForce,
      to: queryTo || "",
      date: queryDate || "",
      trigger: queryTrigger || "",
    };
  }
  try {
    const body = await request.json();
    return {
      force: body?.force ?? queryForce,
      to: body?.to || queryTo || "",
      date: body?.date || queryDate || "",
      trigger: body?.trigger || queryTrigger || "",
    };
  } catch {
    return {
      force: queryForce,
      to: queryTo || "",
      date: queryDate || "",
      trigger: queryTrigger || "",
    };
  }
}

async function handleRequest(request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Server configuration is incomplete.");
    const admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { force, to, date, trigger } = await readParams(request);
    const forced = truthyFlag(force);
    const bypass = Boolean(String(to || "").trim() || forced || String(date || "").trim());
    const held = teamEmailWindowSkip(new Date(), { bypass });
    if (held) return NextResponse.json(held);
    const result = await runHrIqamaExpiryEmailCycle(admin, {
      force: forced,
      date,
      env: {
        ...process.env,
        ...(forced ? { HR_IQAMA_EXPIRY_EMAIL_FORCE: "true" } : {}),
        ...(String(to || "").trim()
          ? { HR_IQAMA_EXPIRY_EMAIL_TEST_TO: String(to).trim() }
          : {}),
      },
    });
    return NextResponse.json({
      success: true,
      trigger: resolveHrIqamaExpiryEmailRouteTrigger({ date, force: forced, to, trigger }),
      ...result,
    });
  } catch (error) {
    console.error("hr-iqama-expiry-email failed:", error);
    return NextResponse.json({
      success: false,
      error: error?.message || "HR Iqama expiry email failed.",
    }, { status: 500 });
  }
}

export async function GET(request) {
  return handleRequest(request);
}

export async function POST(request) {
  return handleRequest(request);
}
