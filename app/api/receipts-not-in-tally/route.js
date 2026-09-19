import { createClient } from "@supabase/supabase-js";
import {
  RECEIPT_DATASET_KEY,
  normalizeReceiptDataset,
} from "../../lib/receiptRegister.js";
import {
  DEFAULT_DATE_WINDOW_DAYS,
  reconcileAppReceiptsToTally,
} from "../../lib/receiptsNotInTally.js";
import { formatCollectorDisplayName } from "../../lib/geo.js";
import { getKsaDateString, ksaDayBounds } from "../../lib/workdayActivity.js";

export const runtime = "nodejs";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function parseJson(value) {
  try {
    return JSON.parse(value || "null");
  } catch {
    return null;
  }
}

function parseIsoDateParam(value, label) {
  const date = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid ${label}. Use YYYY-MM-DD.`);
  }
  return date;
}

function defaultFromDate(today = getKsaDateString()) {
  return `${today.slice(0, 7)}-01`;
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
    .select("id,role,salesman_code,salesman_name")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("No profile found for this user");
  return data;
}

function isMissingTableError(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42P01"
    || message.includes("could not find the table")
    || (message.includes("relation") && message.includes("does not exist"));
}

function isMissingColumnError(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42703" || (message.includes("column") && message.includes("does not exist"));
}

async function readReceiptDataset(admin) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", RECEIPT_DATASET_KEY)
    .maybeSingle();

  if (error) throw error;
  return normalizeReceiptDataset(parseJson(data?.setting_value));
}

async function loadAppReceiptVisits(admin, { startIso, endIso }) {
  const selectWithMode = "id,customer_code,visit_outcome,payment_status,amount_received,receipt_mode,saved_at,created_by";
  const selectLegacy = "id,customer_code,visit_outcome,payment_status,amount_received,saved_at,created_by";

  let result = await admin
    .from("collection_visits")
    .select(selectWithMode)
    .eq("visit_outcome", "FUNDS_RECEIVED")
    .gt("amount_received", 0)
    .gte("saved_at", startIso)
    .lte("saved_at", endIso)
    .order("saved_at", { ascending: true });

  if (result.error && isMissingColumnError(result.error)) {
    result = await admin
      .from("collection_visits")
      .select(selectLegacy)
      .eq("visit_outcome", "FUNDS_RECEIVED")
      .gt("amount_received", 0)
      .gte("saved_at", startIso)
      .lte("saved_at", endIso)
      .order("saved_at", { ascending: true });
  }

  if (result.error) {
    if (isMissingTableError(result.error)) {
      throw new Error("Collection tables are not initialized in this environment yet.");
    }
    throw result.error;
  }

  return Array.isArray(result.data) ? result.data : [];
}

async function loadCustomerNames(admin, customerCodes) {
  const codes = [...new Set((customerCodes || []).map((code) => String(code || "").trim().toUpperCase()).filter(Boolean))];
  if (!codes.length) return new Map();

  const { data, error } = await admin
    .from("customers")
    .select("customer_code,customer_name")
    .in("customer_code", codes);

  if (error && !isMissingTableError(error)) throw error;

  return new Map(
    (data || []).map((row) => [
      String(row.customer_code || "").trim().toUpperCase(),
      String(row.customer_name || "").trim(),
    ]),
  );
}

async function loadCollectorNames(admin, userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return new Map();

  const { data, error } = await admin
    .from("profiles")
    .select("id,salesman_code,salesman_name,role,email")
    .in("id", ids);

  if (error) throw error;

  return new Map(
    (data || []).map((row) => [row.id, formatCollectorDisplayName(row)]),
  );
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
    const fromDate = parseIsoDateParam(url.searchParams.get("from") || defaultFromDate(today), "from date");
    const toDate = parseIsoDateParam(url.searchParams.get("to") || today, "to date");
    if (fromDate > toDate) {
      throw new Error("From date must be on or before to date.");
    }

    const windowDaysRaw = Number(url.searchParams.get("windowDays"));
    const windowDays = Number.isFinite(windowDaysRaw)
      ? Math.max(0, Math.min(30, Math.round(windowDaysRaw)))
      : DEFAULT_DATE_WINDOW_DAYS;

    const { startIso } = ksaDayBounds(fromDate);
    const { endIso } = ksaDayBounds(toDate);

    const [visits, dataset] = await Promise.all([
      loadAppReceiptVisits(admin, { startIso, endIso }),
      readReceiptDataset(admin),
    ]);

    const customerCodes = visits.map((row) => row.customer_code);
    const collectorIds = visits.map((row) => row.created_by);
    const [customerNames, collectorNames] = await Promise.all([
      loadCustomerNames(admin, customerCodes),
      loadCollectorNames(admin, collectorIds),
    ]);

    const enrichedVisits = visits.map((visit) => {
      const code = String(visit.customer_code || "").trim().toUpperCase();
      return {
        ...visit,
        customer_name: customerNames.get(code) || visit.customer_code || "",
        collector_name: collectorNames.get(visit.created_by) || "",
        visit_date: getKsaDateString(new Date(visit.saved_at)),
      };
    });

    // Widen Tally candidate window so ±windowDays matches near the range edges.
    const tallyFrom = shiftIsoForWindow(fromDate, -windowDays);
    const tallyTo = shiftIsoForWindow(toDate, windowDays);
    const tallyInRange = (dataset.rows || []).filter((row) => {
      const date = String(row.receipt_date || "").slice(0, 10);
      return date >= tallyFrom && date <= tallyTo;
    });

    const reconciliation = reconcileAppReceiptsToTally({
      appVisits: enrichedVisits,
      tallyReceipts: tallyInRange,
      windowDays,
    });

    return Response.json({
      success: true,
      from: fromDate,
      to: toDate,
      windowDays: reconciliation.windowDays,
      amountTolerance: reconciliation.amountTolerance,
      tallyUpload: {
        uploadedAt: dataset.uploadedAt || "",
        fileName: dataset.fileName || "",
        rowsCount: dataset.rowsCount || dataset.rows.length,
        matchedCount: dataset.matchedCount,
        unmatchedCount: dataset.unmatchedCount,
        datesUpdated: dataset.datesUpdated || [],
      },
      summary: {
        appCount: reconciliation.appCount,
        matchedCount: reconciliation.matchedCount,
        missingCount: reconciliation.missingCount,
        appTotal: reconciliation.appTotal,
        matchedTotal: reconciliation.matchedTotal,
        missingTotal: reconciliation.missingTotal,
        tallyCandidateCount: tallyInRange.length,
      },
      missingInTally: reconciliation.missingInTally.map((visit) => ({
        id: visit.id,
        visitDate: visit.visit_date,
        savedAt: visit.saved_at,
        customerCode: visit.customer_code,
        customerName: visit.customer_name,
        amountReceived: visit.amount_received,
        receiptMode: visit.receipt_mode,
        paymentStatus: visit.payment_status,
        collectorName: visit.collector_name,
        createdBy: visit.created_by,
      })),
    });
  } catch (error) {
    console.error("Error building receipts-not-in-tally report:", error);
    return Response.json(
      { success: false, error: error.message || "Unable to load receipts not in Tally report" },
      { status: 400 },
    );
  }
}

function shiftIsoForWindow(isoDate, days) {
  const match = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return isoDate;
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + Number(days || 0));
  const date = new Date(utc);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
