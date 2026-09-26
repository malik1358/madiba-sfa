import { createClient } from "@supabase/supabase-js";
import {
  buildReceiptsNotInTallyReport,
  defaultReceiptsNotInTallyFromDate,
  markReceiptAsMistake,
  parseReceiptsNotInTallyWindowDays,
} from "../../lib/receiptsNotInTallyServer.js";
import { formatCollectorDisplayName } from "../../lib/geo.js";
import { getKsaDateString } from "../../lib/workdayActivity.js";

export const runtime = "nodejs";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function parseIsoDateParam(value, label) {
  const date = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid ${label}. Use YYYY-MM-DD.`);
  }
  return date;
}

function canAccessReport(role) {
  const normalized = String(role || "").trim().toLowerCase().replace(/_/g, "-");
  return normalized === "admin" || normalized === "manager" || normalized === "collector";
}

async function getAuthUser(request) {
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("No authorization header provided");
  }

  const token = authHeader.slice(7);
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Unable to verify user session");
  return user;
}

async function getProfile(admin, userId) {
  const { data, error } = await admin
    .from("profiles")
    .select("id,role,salesman_code,salesman_name,email")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("No profile found for this user");
  return data;
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return Response.json(
        { success: false, error: "Server configuration is incomplete" },
        { status: 500 },
      );
    }

    const user = await getAuthUser(request);
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const profile = await getProfile(admin, user.id);
    if (!canAccessReport(profile.role)) {
      return Response.json(
        { success: false, error: "You do not have access to this report." },
        { status: 403 },
      );
    }

    const url = new URL(request.url);
    const today = getKsaDateString();
    const fromDate = parseIsoDateParam(url.searchParams.get("from") || defaultReceiptsNotInTallyFromDate(today), "from date");
    const toDate = parseIsoDateParam(url.searchParams.get("to") || today, "to date");
    const windowDays = parseReceiptsNotInTallyWindowDays(url.searchParams.get("windowDays"));

    const report = await buildReceiptsNotInTallyReport(admin, {
      fromDate,
      toDate,
      windowDays,
    });

    return Response.json({
      success: true,
      ...report,
    });
  } catch (error) {
    console.error("Error building receipts-not-in-tally report:", error);
    return Response.json(
      { success: false, error: error.message || "Unable to load receipts not in Tally report" },
      { status: 400 },
    );
  }
}

export async function POST(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return Response.json(
        { success: false, error: "Server configuration is incomplete" },
        { status: 500 },
      );
    }

    const user = await getAuthUser(request);
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const profile = await getProfile(admin, user.id);
    if (!canAccessReport(profile.role)) {
      return Response.json(
        { success: false, error: "You do not have access to this report." },
        { status: 403 },
      );
    }

    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const visitId = String(body?.visitId || body?.id || "").trim();
    if (!visitId) {
      return Response.json({ success: false, error: "visitId is required." }, { status: 400 });
    }

    const result = await markReceiptAsMistake(admin, {
      visitId,
      action: body?.action || "ignore",
      note: body?.note || "mistake",
      actor: {
        id: user.id,
        name: formatCollectorDisplayName(profile) || profile.salesman_name || profile.email || "",
        email: profile.email || user.email || "",
      },
      snapshot: {
        visitDate: body?.visitDate || body?.visit_date || "",
        customerCode: body?.customerCode || body?.customer_code || "",
        customerName: body?.customerName || body?.customer_name || "",
        amountReceived: body?.amountReceived ?? body?.amount_received,
      },
    });

    return Response.json({ success: true, ...result });
  } catch (error) {
    console.error("Error marking receipts-not-in-tally mistake:", error);
    return Response.json(
      { success: false, error: error.message || "Unable to mark receipt as mistake" },
      { status: 400 },
    );
  }
}
