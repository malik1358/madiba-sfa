import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "../../../lib/cronAuth.js";
import {
  resolveDailyWarehouseInvoiceResumeRouteTrigger,
  runDailyWarehouseInvoiceResumeEmailCycle,
} from "../../../lib/dailyWarehouseInvoiceResumeEmailServer.js";
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
  const queryCc = url.searchParams.get("cc");
  const queryDate = url.searchParams.get("date");
  const queryTrigger = url.searchParams.get("trigger");
  if (String(request.method || "").toUpperCase() === "GET") {
    return {
      force: queryForce,
      to: queryTo || "",
      cc: queryCc || "",
      date: queryDate || "",
      trigger: queryTrigger || "",
    };
  }
  try {
    const body = await request.json();
    return {
      force: body?.force ?? queryForce,
      to: body?.to || queryTo || "",
      cc: body?.cc || queryCc || "",
      date: body?.date || queryDate || "",
      trigger: body?.trigger || queryTrigger || "",
    };
  } catch {
    return {
      force: queryForce,
      to: queryTo || "",
      cc: queryCc || "",
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
    if (!url || !key) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }
    const admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { force, to, cc, date, trigger } = await readParams(request);
    const forced = truthyFlag(force);
    const bypass = Boolean(String(to || "").trim() || forced || String(date || "").trim());
    const held = teamEmailWindowSkip(new Date(), { bypass });
    if (held) return NextResponse.json(held);

    const result = await runDailyWarehouseInvoiceResumeEmailCycle(admin, {
      force: forced,
      date,
      to,
      cc,
      env: {
        ...process.env,
        ...(forced ? { DAILY_WAREHOUSE_INVOICE_RESUME_FORCE: "true" } : {}),
        ...(String(to || "").trim()
          ? { DAILY_WAREHOUSE_INVOICE_RESUME_TEST_TO: String(to).trim() }
          : {}),
      },
    });
    return NextResponse.json({
      success: true,
      trigger: resolveDailyWarehouseInvoiceResumeRouteTrigger({ date, force: forced, to, trigger }),
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: String(error?.message || error || "Daily warehouse invoice resume email failed."),
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
