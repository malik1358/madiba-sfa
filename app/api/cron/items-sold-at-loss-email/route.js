import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "../../../lib/cronAuth.js";
import { formatSupabaseError, withJwtClockSkewRetry } from "../../../lib/dailySalesmanResumeServer.js";
import {
  resolveItemsSoldAtLossRouteTrigger,
  runItemsSoldAtLossEmailCycle,
} from "../../../lib/itemsSoldAtLossEmailServer.js";
import { teamEmailWindowSkip } from "../../../lib/workdayActivity.js";

export const runtime = "nodejs";
export const maxDuration = 180;

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

function truthyFlag(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
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
    const forced = truthyFlag(force);
    const held = teamEmailWindowSkip(new Date(), {
      bypass: Boolean(String(to || "").trim() || forced),
    });
    if (held) return NextResponse.json(held);

    const result = await withJwtClockSkewRetry(async () => {
      const admin = createAdminClient();
      return runItemsSoldAtLossEmailCycle(admin, {
        date,
        force: forced,
        trigger: resolveItemsSoldAtLossRouteTrigger({ date, force, to, trigger }),
        env: {
          ...process.env,
          ...(forced ? { ITEMS_SOLD_AT_LOSS_EMAIL_FORCE: "true" } : {}),
          ...(String(to || "").trim() ? { ITEMS_SOLD_AT_LOSS_EMAIL_TEST_TO: String(to).trim() } : {}),
        },
      });
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: formatSupabaseError(error) || "Items sold at loss email cycle failed.",
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
