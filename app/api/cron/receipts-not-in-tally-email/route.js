import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "../../../lib/cronAuth.js";
import { formatSupabaseError, withJwtClockSkewRetry } from "../../../lib/dailySalesmanResumeServer.js";
import { DEFAULT_DATE_WINDOW_DAYS } from "../../../lib/receiptsNotInTally.js";
import { runReceiptsNotInTallyEmailCycle } from "../../../lib/receiptsNotInTallyEmailServer.js";

export const runtime = "nodejs";
export const maxDuration = 120;

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

function looksLikeEmailList(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  if (raw.includes("@")) return true;
  return false;
}

async function readParams(request) {
  const url = new URL(request.url);
  const queryDate = url.searchParams.get("date");
  const queryFrom = url.searchParams.get("from");
  const queryToDate = url.searchParams.get("toDate");
  const queryForce = url.searchParams.get("force");
  const queryToEmail = url.searchParams.get("toEmail");
  const queryTo = url.searchParams.get("to");
  const queryWindowDays = url.searchParams.get("windowDays");

  const resolveToFields = ({ toEmail, to, toDate }) => {
    // Workflow uses `to` for test email override; date end uses toDate.
    if (String(toEmail || "").trim()) {
      return { toEmail: String(toEmail).trim(), toDate: String(toDate || "").trim() };
    }
    if (looksLikeEmailList(to)) {
      return { toEmail: String(to).trim(), toDate: String(toDate || "").trim() };
    }
    return {
      toEmail: "",
      toDate: String(toDate || to || "").trim(),
    };
  };

  if (String(request.method || "").toUpperCase() === "GET") {
    const fields = resolveToFields({
      toEmail: queryToEmail,
      to: queryTo,
      toDate: queryToDate,
    });
    return {
      date: queryDate || "",
      from: queryFrom || "",
      to: fields.toDate,
      force: queryForce,
      toEmail: fields.toEmail,
      windowDays: queryWindowDays,
    };
  }

  try {
    const body = await request.json();
    const fields = resolveToFields({
      toEmail: body?.toEmail ?? queryToEmail,
      to: body?.to ?? queryTo,
      toDate: body?.toDate ?? queryToDate,
    });
    return {
      date: body?.date || queryDate || "",
      from: body?.from || queryFrom || "",
      to: fields.toDate,
      force: body?.force ?? queryForce,
      toEmail: fields.toEmail,
      windowDays: body?.windowDays ?? queryWindowDays,
    };
  } catch {
    const fields = resolveToFields({
      toEmail: queryToEmail,
      to: queryTo,
      toDate: queryToDate,
    });
    return {
      date: queryDate || "",
      from: queryFrom || "",
      to: fields.toDate,
      force: queryForce,
      toEmail: fields.toEmail,
      windowDays: queryWindowDays,
    };
  }
}

async function handleRequest(request) {
  try {
    if (!isCronAuthorized(request)) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const { date, from, to, force, toEmail, windowDays } = await readParams(request);
    const result = await withJwtClockSkewRetry(async () => {
      const admin = createAdminClient();
      return runReceiptsNotInTallyEmailCycle(admin, {
        date,
        from,
        to,
        windowDays: windowDays == null || String(windowDays).trim() === ""
          ? DEFAULT_DATE_WINDOW_DAYS
          : windowDays,
        trigger: String(toEmail || "").trim() ? "manual" : "cron",
        env: {
          ...process.env,
          ...(String(force || "").trim() ? { RECEIPTS_NOT_IN_TALLY_EMAIL_FORCE: "true" } : {}),
          ...(String(toEmail || "").trim() ? { RECEIPTS_NOT_IN_TALLY_EMAIL_TEST_TO: String(toEmail).trim() } : {}),
        },
      });
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: formatSupabaseError(error) || "Receipts not in Tally email cycle failed.",
      },
      { status: 500 },
    );
  }
}

export async function GET(request) {
  return handleRequest(request);
}

export async function POST(request) {
  return handleRequest(request);
}
