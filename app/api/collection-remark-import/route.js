import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ocrImageBuffer } from "../../lib/extractCustomerDocumentText.js";
import {
  normalizeCollectionRemarkImportRows,
  parseCollectionRemarkImportText,
  suggestCollectionRemarkPaymentStatus,
} from "../../lib/collectionRemarkImport.js";
import { madibaStoreLocation } from "../../lib/madibaStoreLocation.js";
import { isManagementRole } from "../../lib/moduleAccess.js";
import { assertCollectionVisitRemark } from "../../lib/paymentCollections.js";
import { addKsaCalendarDays, getKsaDateString } from "../../lib/workdayActivity.js";

export const runtime = "nodejs";
export const maxDuration = 120;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function adminClient() {
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireManagementUser(admin, request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw Object.assign(new Error("Not authenticated"), { status: 401 });
  }

  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: userError } = await admin.auth.getUser(token);
  if (userError || !user) {
    throw Object.assign(new Error("Invalid login session"), { status: 401 });
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,role,salesman_code")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    throw Object.assign(new Error("Profile not found."), { status: 403 });
  }

  const role = String(profile.role || "").toLowerCase();
  if (!isManagementRole(role)) {
    throw Object.assign(new Error("Only admin or manager can import collection remarks."), { status: 403 });
  }

  return { user, profile, role };
}

function jsonError(error) {
  const status = Number(error?.status) || 500;
  return NextResponse.json({ success: false, error: error?.message || "Request failed." }, { status });
}

async function resolveExistingCustomerCodes(admin, codes) {
  const unique = [...new Set((codes || []).map((code) => String(code || "").trim().toUpperCase()).filter(Boolean))];
  if (!unique.length) return new Set();

  const { data, error } = await admin
    .from("customers")
    .select("customer_code")
    .in("customer_code", unique);

  if (error) throw Object.assign(new Error(error.message || "Unable to load customers."), { status: 500 });

  const found = new Set((data || []).map((row) => String(row.customer_code || "").trim().toUpperCase()).filter(Boolean));

  // Also try case-insensitive match for codes that differ only by casing.
  const missing = unique.filter((code) => !found.has(code));
  if (missing.length) {
    const orFilter = missing.map((code) => `customer_code.ilike.${code}`).join(",");
    const { data: fuzzy } = await admin
      .from("customers")
      .select("customer_code")
      .or(orFilter);
    (fuzzy || []).forEach((row) => {
      const code = String(row.customer_code || "").trim().toUpperCase();
      if (code) found.add(code);
    });
  }

  return found;
}

export async function POST(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Supabase is not configured." }, { status: 500 });
    }

    const admin = adminClient();
    const { user } = await requireManagementUser(admin, request);
    const contentType = String(request.headers.get("content-type") || "");

    let action = "parse";
    let pastedText = "";
    let imageBuffer = null;
    let commitRows = [];

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      action = String(form.get("action") || "parse").trim().toLowerCase() || "parse";
      pastedText = String(form.get("text") || form.get("pastedText") || "");
      const file = form.get("file") || form.get("image") || form.get("screenshot");
      if (file && typeof file === "object" && typeof file.arrayBuffer === "function") {
        const bytes = Buffer.from(await file.arrayBuffer());
        if (bytes.length) imageBuffer = bytes;
      }
      const rowsRaw = String(form.get("rows") || "").trim();
      if (rowsRaw) {
        try {
          commitRows = JSON.parse(rowsRaw);
        } catch {
          throw Object.assign(new Error("Invalid rows payload."), { status: 400 });
        }
      }
    } else {
      const body = await request.json().catch(() => ({}));
      action = String(body?.action || "parse").trim().toLowerCase() || "parse";
      pastedText = String(body?.text || body?.pastedText || "");
      commitRows = Array.isArray(body?.rows) ? body.rows : [];
    }

    if (action === "parse") {
      let ocrText = "";
      if (imageBuffer) {
        ocrText = await ocrImageBuffer(imageBuffer);
      }
      const combined = [pastedText, ocrText].filter((part) => String(part || "").trim()).join("\n");
      if (!combined.trim()) {
        throw Object.assign(new Error("Upload a screenshot or paste table text to parse."), { status: 400 });
      }

      const parsed = parseCollectionRemarkImportText(combined, {
        prefer: imageBuffer && !pastedText.trim() ? "ocr" : "auto",
      });
      const rows = normalizeCollectionRemarkImportRows(parsed);
      const existing = await resolveExistingCustomerCodes(admin, rows.map((row) => row.customerCode));
      const enriched = rows.map((row) => ({
        ...row,
        customerExists: existing.has(row.customerCode),
      }));

      return NextResponse.json({
        success: true,
        action: "parse",
        rowCount: enriched.length,
        ocrText: ocrText || "",
        rows: enriched,
      });
    }

    if (action === "commit") {
      const rows = normalizeCollectionRemarkImportRows(commitRows).filter((row) => row.selected !== false);
      if (!rows.length) {
        throw Object.assign(new Error("Select at least one row with a customer code and remark."), { status: 400 });
      }

      const existing = await resolveExistingCustomerCodes(admin, rows.map((row) => row.customerCode));
      const missing = rows.filter((row) => !existing.has(row.customerCode)).map((row) => row.customerCode);
      if (missing.length) {
        throw Object.assign(
          new Error(`Unknown customer code(s): ${missing.join(", ")}`),
          { status: 400 },
        );
      }

      const store = madibaStoreLocation();
      const today = getKsaDateString();
      const defaultNextVisit = addKsaCalendarDays(today, 7);
      const savedAt = new Date().toISOString();

      const inserts = rows.map((row) => {
        const visitOutcome = row.visitOutcome;
        const paymentStatus = row.paymentStatus || suggestCollectionRemarkPaymentStatus(visitOutcome);
        assertCollectionVisitRemark({
          paymentStatus,
          visitOutcome,
          remarkArabic: row.remark,
          remarkEnglish: row.remark,
        });
        const isLegal = visitOutcome === "TRANSFER_TO_LEGAL";
        return {
          customer_code: row.customerCode,
          visit_outcome: visitOutcome,
          payment_status: paymentStatus,
          amount_received: 0,
          next_visit_at: isLegal ? null : defaultNextVisit,
          remark_arabic: row.remark,
          remark_english: row.remark,
          latitude: store.latitude,
          longitude: store.longitude,
          gps_accuracy_meters: 20,
          created_by: user.id,
          saved_at: savedAt,
        };
      });

      const { data, error } = await admin
        .from("collection_visits")
        .insert(inserts)
        .select("id,customer_code,visit_outcome,payment_status,remark_english,saved_at,latitude,longitude");

      if (error) {
        throw Object.assign(new Error(error.message || "Unable to save collection visits."), { status: 500 });
      }

      return NextResponse.json({
        success: true,
        action: "commit",
        savedCount: (data || []).length,
        visits: data || [],
      });
    }

    throw Object.assign(new Error("Unknown action. Use parse or commit."), { status: 400 });
  } catch (error) {
    return jsonError(error);
  }
}
