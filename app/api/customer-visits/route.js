import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ensureCustomerVisibleToScope, withSalesScopeMatchers } from "../../lib/customerAccess.js";
import { canonicalCustomerCode } from "../../lib/customerCode.js";
import { formatFieldVisitOutcome } from "../../lib/fieldVisitWhatsapp.js";
import { formatCollectionUserDisplayName } from "../../lib/geo.js";
import { resolveSalesScopeForUserId } from "../user/sales-scope/route.js";

export const runtime = "nodejs";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const COLLECTION_OUTCOME_LABELS = {
  FUNDS_RECEIVED: "Funds received",
  ASKED_COME_LATER: "Asked to come later",
  RESPONSIBLE_NOT_AVAILABLE: "Responsible not available",
  WRONG_CREDIT_DAYS: "Wrong credit days",
  NO_DUE_AS_PER_CUSTOMER: "No due according to customer",
  TRANSFER_TO_LEGAL: "Transfer to legal",
  PAID: "Paid",
  PARTIAL: "Partial",
  NOT_PAID: "Not Paid",
  PROMISED: "Promised To Pay",
};

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function customerCodeCandidates(customerCode) {
  const normalized = normalizeCode(customerCode);
  const canonical = canonicalCustomerCode(normalized);
  const leading = normalizeCode(normalized.match(/^([A-Z0-9]+)/)?.[1] || "");
  return [...new Set([normalized, canonical, leading].filter(Boolean))];
}

function getBearerToken(request) {
  const authHeader = request.headers.get("authorization") || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
}

function isMissingTableError(error) {
  const message = String(error?.message || "").toLowerCase();
  return error?.code === "42P01" || message.includes("does not exist");
}

function parseSettingValue(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function formatCollectionOutcome(outcome) {
  const key = String(outcome || "").trim().toUpperCase();
  if (!key) return "-";
  return COLLECTION_OUTCOME_LABELS[key]
    || String(outcome || "")
      .trim()
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (char) => char.toUpperCase())
    || "-";
}

function visitSortTs(visit) {
  return new Date(visit.savedAt || 0).getTime() || 0;
}

async function resolveScope(admin, token) {
  const {
    data: { user },
    error: userError,
  } = await admin.auth.getUser(token);

  if (userError || !user) {
    throw new Error("Invalid login session");
  }

  const payload = await resolveSalesScopeForUserId(admin, user.id);
  return withSalesScopeMatchers({
    userId: user.id,
    role: payload.role,
    hasAllAccess: payload.hasAllAccess,
    visibleSalesmanCodes: payload.visibleSalesmanCodes || [],
    visibleMembers: payload.visibleMembers || [],
  });
}

async function loadCollectionVisits(admin, codes) {
  if (!codes.length) return [];

  const { data, error } = await admin
    .from("collection_visits")
    .select("id,customer_code,visit_outcome,payment_status,amount_received,receipt_mode,next_visit_at,remark_arabic,remark_english,saved_at,created_by")
    .in("customer_code", codes)
    .order("saved_at", { ascending: false })
    .limit(500);

  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }

  return data || [];
}

async function loadFieldVisitSettings(admin, codes) {
  if (!codes.length) return [];

  const rows = [];
  for (const code of codes) {
    const latestKey = `visit_report_latest:${code}`;
    const historyPrefix = `visit_report_history:${code}:`;

    const [{ data: latestRows, error: latestError }, { data: historyRows, error: historyError }] = await Promise.all([
      admin
        .from("system_settings")
        .select("setting_key,setting_value")
        .eq("setting_key", latestKey)
        .maybeSingle(),
      admin
        .from("system_settings")
        .select("setting_key,setting_value")
        .like("setting_key", `${historyPrefix}%`)
        .order("setting_key", { ascending: false })
        .limit(200),
    ]);

    if (latestError && !isMissingTableError(latestError)) throw latestError;
    if (historyError && !isMissingTableError(historyError)) throw historyError;

    if (latestRows?.setting_value) rows.push(latestRows);
    (historyRows || []).forEach((row) => rows.push(row));
  }

  return rows;
}

function buildProfileMap(profiles) {
  const map = new Map();
  (profiles || []).forEach((profile) => {
    if (profile?.id) map.set(profile.id, profile);
  });
  return map;
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const token = getBearerToken(request);
    if (!token) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    const url = new URL(request.url);
    const customerCode = normalizeCode(url.searchParams.get("customerCode"));
    if (!customerCode) {
      return NextResponse.json({ success: false, error: "Customer code is required." }, { status: 400 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const scope = await resolveScope(admin, token);
    const visibleCustomer = await ensureCustomerVisibleToScope(admin, customerCode, scope);
    const storedCode = normalizeCode(visibleCustomer?.customer_code || customerCode);
    const codes = customerCodeCandidates(storedCode);

    const [collectionRows, fieldSettingRows] = await Promise.all([
      loadCollectionVisits(admin, codes),
      loadFieldVisitSettings(admin, codes),
    ]);

    const visits = [];
    const seenFieldKeys = new Set();

    fieldSettingRows.forEach((row) => {
      const value = parseSettingValue(row?.setting_value);
      if (!value) return;

      const outcome = String(value.outcome || "").trim();
      const savedAt = value.saved_at || value.captured_at || "";
      const userId = value.saved_by_user_id || "";
      const dedupeKey = [
        normalizeCode(value.customer_code || storedCode),
        savedAt,
        userId,
        outcome.toUpperCase(),
      ].join("|");
      if (seenFieldKeys.has(dedupeKey)) return;
      seenFieldKeys.add(dedupeKey);

      visits.push({
        id: `field:${row.setting_key || dedupeKey}`,
        type: "VISIT_REPORT",
        typeLabel: "Field visit",
        savedAt,
        userId,
        userName: "",
        outcome,
        outcomeLabel: formatFieldVisitOutcome(outcome, "en"),
        amountReceived: 0,
        remark: String(value.note || "").trim(),
        nextVisitAt: value.next_visit_at || "",
      });
    });

    collectionRows.forEach((row) => {
      const outcome = String(row.visit_outcome || row.payment_status || "").trim();
      const remark = String(row.remark_english || row.remark_arabic || "").trim();
      visits.push({
        id: `collection:${row.id}`,
        type: "COLLECTION_VISIT",
        typeLabel: "Collection",
        savedAt: row.saved_at || "",
        userId: row.created_by || "",
        userName: "",
        outcome,
        outcomeLabel: formatCollectionOutcome(outcome),
        amountReceived: Number(row.amount_received || 0),
        remark,
        nextVisitAt: row.next_visit_at || "",
      });
    });

    const userIds = [...new Set(visits.map((visit) => visit.userId).filter(Boolean))];
    let profileMap = new Map();
    if (userIds.length > 0) {
      const { data: profiles, error: profilesError } = await admin
        .from("profiles")
        .select("id,role,salesman_code,salesman_name,email")
        .in("id", userIds);
      if (profilesError) throw profilesError;
      profileMap = buildProfileMap(profiles);
    }

    const enriched = visits
      .map((visit) => {
        const profile = visit.userId ? profileMap.get(visit.userId) : null;
        return {
          ...visit,
          userName: profile
            ? formatCollectionUserDisplayName(profile, { includeRole: true })
            : (visit.userId ? "Unknown user" : "-"),
        };
      })
      .sort((left, right) => visitSortTs(right) - visitSortTs(left));

    return NextResponse.json({
      success: true,
      customerCode: storedCode,
      visits: enriched,
    });
  } catch (error) {
    const message = String(error?.message || "Unable to load customer visits.");
    const status = /not authenticated|invalid login|not visible|not found|access/i.test(message) ? 403 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
