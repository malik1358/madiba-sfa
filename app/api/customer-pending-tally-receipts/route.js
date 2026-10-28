import { createClient } from "@supabase/supabase-js";
import {
  ORDER_PDF_PENDING_TALLY_WORKING_DAYS,
} from "../../lib/receiptsNotInTally.js";
import {
  buildCustomerPendingTallyReceipts,
} from "../../lib/receiptsNotInTallyServer.js";
import { getKsaDateString } from "../../lib/workdayActivity.js";

export const runtime = "nodejs";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return Response.json(
        { success: false, error: "Server configuration is incomplete" },
        { status: 500 },
      );
    }

    await getAuthUser(request);
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const url = new URL(request.url);
    const customerCode = String(url.searchParams.get("customerCode") || "").trim();
    const customerName = String(url.searchParams.get("customerName") || "").trim();
    if (!customerCode && !customerName) {
      return Response.json(
        { success: false, error: "customerCode or customerName is required." },
        { status: 400 },
      );
    }

    const workingDaysRaw = Number(url.searchParams.get("workingDays"));
    const workingDays = Number.isFinite(workingDaysRaw)
      ? Math.max(1, Math.min(14, Math.round(workingDaysRaw)))
      : ORDER_PDF_PENDING_TALLY_WORKING_DAYS;

    const result = await buildCustomerPendingTallyReceipts(admin, {
      customerCode,
      customerName,
      workingDays,
      todayKey: getKsaDateString(),
    });

    return Response.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Error loading customer pending Tally receipts:", error);
    return Response.json(
      { success: false, error: error.message || "Unable to load pending Tally receipts" },
      { status: 400 },
    );
  }
}
