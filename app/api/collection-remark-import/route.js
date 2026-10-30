import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ocrImageBuffer } from "../../lib/extractCustomerDocumentText.js";
import {
  COLLECTION_REMARK_PARSER_VERSION,
  expandCollectionRemarkCustomerCodeCandidates,
  formatCollectionRemarkActorLabel,
  normalizeCollectionRemarkImportRows,
  parseCollectionRemarkImportText,
  resolveCollectionRemarkCustomerCodeFromKnown,
  suggestCollectionRemarkPaymentStatus,
} from "../../lib/collectionRemarkImport.js";
import { normalizeCustomerNameKey } from "../../lib/customerCode.js";
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
    .select("id,role,salesman_code,salesman_name,email")
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

function partyNameSearchTokens(partyName = "") {
  const key = normalizeCustomerNameKey(partyName);
  if (!key || key.length < 6) return [];
  const words = key.split(" ").filter((word) => word.length >= 3).slice(0, 4);
  if (words.length >= 2) return [words.slice(0, 3).join(" "), words.slice(0, 2).join(" ")];
  return words.slice(0, 1);
}

/**
 * Map each parsed/OCR code (and optional ledger/party name) to a unique customers.customer_code.
 */
async function resolveCustomerCodeMap(admin, rowsOrCodes) {
  const rows = (Array.isArray(rowsOrCodes) ? rowsOrCodes : [])
    .map((entry) => {
      if (entry && typeof entry === "object") {
        const customerCode = String(entry.customerCode || entry.customer_code || "").trim().toUpperCase();
        const candidates = [...new Set(
          [
            customerCode,
            ...((entry.customerCodeCandidates || entry.customer_code_candidates || [])
              .map((code) => String(code || "").trim().toUpperCase())),
          ].filter(Boolean),
        )];
        return {
          customerCode: customerCode || candidates[0] || "",
          customerCodeCandidates: candidates,
          partyName: String(entry.partyName || entry.party_name || "").trim(),
        };
      }
      return {
        customerCode: String(entry || "").trim().toUpperCase(),
        customerCodeCandidates: [String(entry || "").trim().toUpperCase()].filter(Boolean),
        partyName: "",
      };
    })
    .filter((row) => row.customerCode || row.customerCodeCandidates.length);

  const resolved = new Map();
  if (!rows.length) return resolved;

  const uniqueCodes = [...new Set(rows.flatMap((row) => row.customerCodeCandidates))];
  const lookup = new Set();
  uniqueCodes.forEach((code) => {
    expandCollectionRemarkCustomerCodeCandidates(code).forEach((candidate) => lookup.add(candidate));
  });

  const lookupList = [...lookup];
  const { data, error } = await admin
    .from("customers")
    .select("customer_code,customer_name")
    .in("customer_code", lookupList);

  if (error) throw Object.assign(new Error(error.message || "Unable to load customers."), { status: 500 });

  const known = new Set(
    (data || []).map((row) => String(row.customer_code || "").trim().toUpperCase()).filter(Boolean),
  );
  const nameIndex = new Map();
  const addNameIndex = (row) => {
    const code = String(row?.customer_code || "").trim().toUpperCase();
    const key = normalizeCustomerNameKey(row?.customer_name || "");
    if (!code || !key) return;
    known.add(code);
    if (!nameIndex.has(key)) nameIndex.set(key, []);
    nameIndex.get(key).push(code);
  };
  (data || []).forEach(addNameIndex);

  // Prefix search for any still-unresolved stems (1058 → 1058C / branch suffixes).
  const unresolvedStems = uniqueCodes
    .filter((code) => !resolveCollectionRemarkCustomerCodeFromKnown(code, [...known]))
    .flatMap((code) => expandCollectionRemarkCustomerCodeCandidates(code))
    .map((code) => code.replace(/C$/i, "").replace(/^0+/, "") || code)
    .filter((stem) => stem.length >= 3);
  const stemSet = [...new Set(unresolvedStems)];
  if (stemSet.length) {
    const orFilter = stemSet
      .slice(0, 40)
      .map((stem) => `customer_code.ilike.${stem}%`)
      .join(",");
    const { data: fuzzy, error: fuzzyError } = await admin
      .from("customers")
      .select("customer_code,customer_name")
      .or(orFilter)
      .limit(200);
    if (fuzzyError) {
      throw Object.assign(new Error(fuzzyError.message || "Unable to load customers."), { status: 500 });
    }
    (fuzzy || []).forEach(addNameIndex);
  }

  // Ledger/party name fallback when OCR code is wrong but Party's Name is clear.
  const nameTokens = [...new Set(rows.flatMap((row) => partyNameSearchTokens(row.partyName)))];
  for (const token of nameTokens.slice(0, 30)) {
    const { data: byName, error: nameError } = await admin
      .from("customers")
      .select("customer_code,customer_name")
      .ilike("customer_name", `%${token}%`)
      .limit(25);
    if (nameError) {
      throw Object.assign(new Error(nameError.message || "Unable to load customers."), { status: 500 });
    }
    (byName || []).forEach(addNameIndex);
  }

  const knownList = [...known];
  rows.forEach((row) => {
    const mapKey = row.customerCode || row.customerCodeCandidates[0];
    if (!mapKey || resolved.has(mapKey)) return;

    // Prefer ledger/primary, then any other OCR number on the same row (invoice etc.).
    for (const candidate of row.customerCodeCandidates) {
      const byCode = resolveCollectionRemarkCustomerCodeFromKnown(candidate, knownList);
      if (byCode) {
        resolved.set(mapKey, byCode);
        return;
      }
    }

    const partyKey = normalizeCustomerNameKey(row.partyName);
    if (!partyKey) return;
    const exactName = nameIndex.get(partyKey) || [];
    if (exactName.length === 1) {
      resolved.set(mapKey, exactName[0]);
      return;
    }

    const partial = [...nameIndex.entries()]
      .filter(([key]) => key.includes(partyKey) || partyKey.includes(key))
      .flatMap(([, codes]) => codes);
    const uniquePartial = [...new Set(partial)];
    if (uniquePartial.length === 1) {
      resolved.set(mapKey, uniquePartial[0]);
    }
  });

  return resolved;
}

async function loadActorOptions(admin) {
  let query = admin
    .from("profiles")
    .select("id,salesman_code,salesman_name,role,email,is_active")
    .order("salesman_name", { ascending: true });

  let { data, error } = await query;
  if (error && /is_active/i.test(error.message || "")) {
    ({ data, error } = await admin
      .from("profiles")
      .select("id,salesman_code,salesman_name,role,email")
      .order("salesman_name", { ascending: true }));
  }
  if (error) throw Object.assign(new Error(error.message || "Unable to load users."), { status: 500 });

  return (data || [])
    .filter((row) => row?.is_active !== false)
    .map((row) => ({
      id: row.id,
      label: formatCollectionRemarkActorLabel(row),
      salesmanCode: String(row.salesman_code || "").trim(),
      salesmanName: String(row.salesman_name || "").trim(),
      role: String(row.role || "").trim(),
      email: String(row.email || "").trim(),
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

async function resolveCreatedByUserId(admin, requestedId, fallbackUserId) {
  const requested = String(requestedId || "").trim();
  if (!requested) return fallbackUserId;
  const { data, error } = await admin
    .from("profiles")
    .select("id")
    .eq("id", requested)
    .maybeSingle();
  if (error) throw Object.assign(new Error(error.message || "Unable to validate save-as user."), { status: 500 });
  if (!data?.id) {
    throw Object.assign(new Error("Selected save-as user was not found."), { status: 400 });
  }
  return data.id;
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Supabase is not configured." }, { status: 500 });
    }
    const admin = adminClient();
    const { user } = await requireManagementUser(admin, request);
    const actors = await loadActorOptions(admin);
    return NextResponse.json({
      success: true,
      currentUserId: user.id,
      actors,
    });
  } catch (error) {
    return jsonError(error);
  }
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
    let createdByUserId = "";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      action = String(form.get("action") || "parse").trim().toLowerCase() || "parse";
      pastedText = String(form.get("text") || form.get("pastedText") || "");
      createdByUserId = String(form.get("createdByUserId") || form.get("created_by") || "");
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
      createdByUserId = String(body?.createdByUserId || body?.created_by || "");
      commitRows = Array.isArray(body?.rows) ? body.rows : [];
    }

    if (action === "parse") {
      let ocrText = "";
      let ocrError = "";
      // Prefer browser-extracted / pasted text. Server OCR is fallback only (slow/fragile on Vercel).
      if (imageBuffer && !String(pastedText || "").trim()) {
        try {
          ocrText = await ocrImageBuffer(imageBuffer);
          if (!String(ocrText || "").trim()) {
            ocrError = "Server OCR returned no text.";
          }
        } catch (error) {
          ocrError = error?.message || "OCR failed.";
        }
      }
      const combined = [pastedText, ocrText].filter((part) => String(part || "").trim()).join("\n");
      if (!combined.trim()) {
        throw Object.assign(
          new Error(ocrError
            ? `Could not read the screenshot (${ocrError}). Paste Party/Customer + Remarks columns instead.`
            : "Upload a screenshot or paste table text to parse."),
          { status: 400 },
        );
      }

      const parsed = parseCollectionRemarkImportText(combined, {
        prefer: imageBuffer && !pastedText.trim() ? "ocr" : "auto",
      });
      const rows = normalizeCollectionRemarkImportRows(parsed);
      const resolvedMap = await resolveCustomerCodeMap(admin, rows);
      const enriched = rows.map((row) => {
        const resolvedCode = resolvedMap.get(row.customerCode) || "";
        const customerCode = resolvedCode || row.customerCode;
        return {
          ...row,
          customerCode,
          customerExists: Boolean(resolvedCode),
          selected: Boolean(resolvedCode) && row.selected !== false,
        };
      });

      return NextResponse.json({
        success: true,
        action: "parse",
        parserVersion: COLLECTION_REMARK_PARSER_VERSION,
        rowCount: enriched.length,
        ocrText: ocrText || String(pastedText || "").trim() || "",
        ocrError: ocrError || "",
        hint: enriched.length
          ? (enriched.some((row) => !row.customerExists)
            ? "Some Party's Name codes were not found in the customer master. Fix the Customer column or paste Party + Remarks only."
            : "")
          : "No customer remarks matched. For Bills Receivable screenshots, paste Party + Remarks columns if OCR is messy.",
        rows: enriched,
      });
    }

    if (action === "commit") {
      const rows = normalizeCollectionRemarkImportRows(commitRows).filter((row) => row.selected !== false);
      if (!rows.length) {
        throw Object.assign(new Error("Select at least one row with a customer code and remark."), { status: 400 });
      }

      const resolvedMap = await resolveCustomerCodeMap(admin, rows);
      const missing = rows
        .filter((row) => !resolvedMap.get(row.customerCode))
        .map((row) => row.customerCode);
      if (missing.length) {
        throw Object.assign(
          new Error(
            `Unknown customer code(s): ${missing.join(", ")}. Codes must come from Party's Name (ledger), not Invoice/Overdue. Fix the Customer column or deselect those rows.`,
          ),
          { status: 400 },
        );
      }

      const actorId = await resolveCreatedByUserId(admin, createdByUserId, user.id);
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
          customer_code: resolvedMap.get(row.customerCode) || row.customerCode,
          visit_outcome: visitOutcome,
          payment_status: paymentStatus,
          amount_received: 0,
          next_visit_at: isLegal ? null : defaultNextVisit,
          remark_arabic: row.remark,
          remark_english: row.remark,
          latitude: store.latitude,
          longitude: store.longitude,
          gps_accuracy_meters: 20,
          created_by: actorId,
          saved_at: savedAt,
        };
      });

      const { data, error } = await admin
        .from("collection_visits")
        .insert(inserts)
        .select("id,customer_code,visit_outcome,payment_status,remark_english,saved_at,latitude,longitude,created_by");

      if (error) {
        throw Object.assign(new Error(error.message || "Unable to save collection visits."), { status: 500 });
      }

      return NextResponse.json({
        success: true,
        action: "commit",
        savedCount: (data || []).length,
        createdByUserId: actorId,
        visits: data || [],
      });
    }

    throw Object.assign(new Error("Unknown action. Use parse or commit."), { status: 400 });
  } catch (error) {
    return jsonError(error);
  }
}
