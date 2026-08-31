import { NextResponse } from "next/server";
import { after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import {
  OUTSTANDING_DATASET_KEY,
  buildOutstandingRow,
  findOutstandingForCustomer,
  findOutstandingHeaderRow,
  isSameOutstandingCustomer,
  parseOutstandingRows,
  mergeParsedOutstandingSheets,
  prioritizeOutstandingSheets,
  selectPreferredOutstandingParses,
  sortBucketLabels,
} from "../../lib/outstanding";
import { scheduleMobileFieldSnapshotRebuild } from "../../lib/server/mobileFieldSnapshot.js";

export const runtime = "nodejs";
export const maxDuration = 120;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function parseJson(value) {
  try {
    return JSON.parse(value || "null");
  } catch {
    return null;
  }
}

function roleCanUpload(role) {
  const normalized = String(role || "").trim().toLowerCase();
  return ["admin", "manager", "invoice-maker", "invoice_maker"].includes(normalized);
}

async function resolveProfile(admin, token) {
  const {
    data: { user },
    error: userError,
  } = await admin.auth.getUser(token);

  if (userError || !user) {
    throw new Error("Invalid login session");
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,role,salesman_code,salesman_name")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    throw new Error("Profile not found.");
  }

  return {
    id: profile.id,
    role: String(profile.role || "").toLowerCase(),
  };
}

async function readDataset(admin) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", OUTSTANDING_DATASET_KEY)
    .maybeSingle();

  if (error) throw error;

  const parsed = parseJson(data?.setting_value);
  if (!parsed || typeof parsed !== "object") {
    return {
      uploadedAt: "",
      fileName: "",
      bucketLabels: [],
      rows: [],
      invoices: [],
    };
  }

  return {
    uploadedAt: String(parsed.uploadedAt || ""),
    fileName: String(parsed.fileName || ""),
    bucketLabels: sortBucketLabels(parsed.bucketLabels || []),
    rows: Array.isArray(parsed.rows) ? parsed.rows.map(buildOutstandingRow) : [],
    invoices: Array.isArray(parsed.invoices) ? parsed.invoices : [],
  };
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    await resolveProfile(admin, authHeader.replace("Bearer ", ""));
    const dataset = await readDataset(admin);

    const url = new URL(request.url);
    const customerCode = String(url.searchParams.get("customerCode") || "").trim();
    const customerName = String(url.searchParams.get("customerName") || "").trim();

    const customer = (customerCode || customerName)
      ? findOutstandingForCustomer(dataset, customerCode, customerName)
      : null;
    const hasInvoiceRowsInDataset = Array.isArray(dataset.invoices) && dataset.invoices.length > 0;
    const customerInvoices = (customerCode || customerName)
      ? dataset.invoices
        .filter((row) => isSameOutstandingCustomer(row.customer_code, row.customer_name, customerCode, customerName))
        .sort((a, b) => {
          const aDue = String(a?.due_date || "");
          const bDue = String(b?.due_date || "");
          if (aDue !== bDue) return aDue.localeCompare(bDue);
          return String(a?.ref_no || "").localeCompare(String(b?.ref_no || ""));
        })
      : [];

    return NextResponse.json({
      success: true,
      uploadedAt: dataset.uploadedAt,
      fileName: dataset.fileName,
      bucketLabels: dataset.bucketLabels,
      customer,
      customerInvoices,
      needsInvoiceRowsReupload: !hasInvoiceRowsInDataset,
      rowsCount: dataset.rows.length,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || "Unable to load outstanding data." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const profile = await resolveProfile(admin, authHeader.replace("Bearer ", ""));
    if (!roleCanUpload(profile.role)) {
      return NextResponse.json({ success: false, error: "Only admin/manager/invoice-maker can upload outstanding file." }, { status: 403 });
    }

    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: "Excel file is required." }, { status: 400 });
    }

    const fileName = String(file.name || "").trim();
    if (!/\.(xlsx|xls)$/i.test(fileName)) {
      return NextResponse.json({ success: false, error: "Only .xlsx or .xls files are supported." }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(Buffer.from(arrayBuffer), { type: "buffer" });

    if (!Array.isArray(workbook.SheetNames) || workbook.SheetNames.length === 0) {
      throw new Error("Excel file does not contain any sheet.");
    }

    const candidateSheetNames = prioritizeOutstandingSheets(workbook.SheetNames);
    const parsedBySheetName = [];
    const sheetPreviews = [];
    let workbookHasRows = false;

    for (const sheetName of candidateSheetNames) {
      const sheetRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
      if (Array.isArray(sheetRows) && sheetRows.length > 0) workbookHasRows = true;
      const previewRows = (sheetRows || [])
        .filter((row) => Array.isArray(row) && row.some((cell) => String(cell || "").trim()))
        .slice(0, 8)
        .map((row) => row.map((cell) => String(cell || "").trim()).filter(Boolean).slice(0, 12).join(" | "));
      sheetPreviews.push(`${sheetName}: ${previewRows.join(" / ")}`);
      const sheetHeaderRowIndex = findOutstandingHeaderRow(sheetRows);
      if (sheetHeaderRowIndex < 0) continue;
      parsedBySheetName.push({
        sheetName,
        parsed: parseOutstandingRows(sheetRows, sheetHeaderRowIndex),
      });
    }

    if (!workbookHasRows) {
      throw new Error("Excel file is empty.");
    }

    const parsedSheets = selectPreferredOutstandingParses(parsedBySheetName);

    if (parsedSheets.length === 0) {
      const preview = sheetPreviews.join("; ").slice(0, 1200);
      throw new Error(`Unable to detect header row. Found: ${preview || "no readable cells"}`);
    }

    const parsed = parsedSheets.length === 1
      ? parsedSheets[0]
      : mergeParsedOutstandingSheets(parsedSheets);
    const nowIso = new Date().toISOString();

    const payload = {
      uploadedAt: nowIso,
      fileName,
      bucketLabels: parsed.bucketLabels,
      rows: parsed.rows,
      invoices: parsed.invoices,
      rowsCount: parsed.rows.length,
      uploadedBy: profile.id,
    };

    const { error: upsertError } = await admin
      .from("system_settings")
      .upsert({
        setting_key: OUTSTANDING_DATASET_KEY,
        setting_value: JSON.stringify(payload),
      }, { onConflict: "setting_key" });

    if (upsertError) throw upsertError;

    after(async () => {
      try {
        if (!supabaseUrl || !serviceKey) return;
        const rebuildAdmin = createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        await scheduleMobileFieldSnapshotRebuild(rebuildAdmin, { trigger: "outstanding-upload" });
      } catch (rebuildError) {
        console.error("Mobile snapshot rebuild after outstanding upload failed:", rebuildError);
      }
    });

    return NextResponse.json({
      success: true,
      uploadedAt: payload.uploadedAt,
      fileName: payload.fileName,
      rowsCount: payload.rowsCount,
      bucketLabels: payload.bucketLabels,
      customerPreview: payload.rows.slice(0, 5),
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || "Unable to upload outstanding file." }, { status: 500 });
  }
}
