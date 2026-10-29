import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "../../../lib/cronAuth.js";
import { runDailyVisitReportEmailCycle } from "../../../lib/dailyVisitReportEmailServer.js";
import { isLikelyEmail, parseEmailList } from "../../../lib/mailer.js";
import { teamEmailWindowSkip } from "../../../lib/workdayActivity.js";

export const runtime = "nodejs";
export const maxDuration = 120;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function truthyFlag(value) {
  const raw = String(value || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

async function readCycleParams(request) {
  const url = new URL(request.url);
  const queryDate = String(url.searchParams.get("date") || "").trim();
  const queryDigestOnlyTo = String(
    url.searchParams.get("digestOnlyTo") || url.searchParams.get("to") || "",
  ).trim();
  const queryForce = truthyFlag(url.searchParams.get("force"));

  let body = {};
  if (String(request.method || "").toUpperCase() !== "GET") {
    try {
      body = await request.json();
    } catch {
      body = {};
    }
  }

  const date = queryDate || String(body?.date || "").trim();
  const digestOnlyTo = queryDigestOnlyTo
    || String(body?.digestOnlyTo || body?.to || "").trim();
  const force = queryForce || truthyFlag(body?.force);

  return { date, digestOnlyTo, force };
}

function normalizeDigestOnlyTo(value) {
  const emails = parseEmailList(value).filter((email) => isLikelyEmail(email));
  return emails[0] || "";
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

    const { date, digestOnlyTo: rawDigestOnlyTo, force } = await readCycleParams(request);
    const digestOnlyTo = normalizeDigestOnlyTo(rawDigestOnlyTo);

    // Digest-only / forced test resends may run outside the team email window.
    if (!digestOnlyTo && !force) {
      const held = teamEmailWindowSkip();
      if (held) return NextResponse.json(held);
    }

    const result = await runDailyVisitReportEmailCycle(admin, {
      date,
      digestOnlyTo,
    });
    const failedCount = Number(result.failedCount || 0);
    return NextResponse.json(
      {
        success: failedCount === 0,
        ...result,
        digestOnlyTo: digestOnlyTo || undefined,
        forced: force || Boolean(digestOnlyTo) || undefined,
      },
      { status: failedCount ? 500 : 200 },
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "Daily visit report email cycle failed." },
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
