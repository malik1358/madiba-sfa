import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import {
  RECEIPT_DATASET_KEY,
  buildCustomerLookup,
  emptyReceiptDataset,
  findReceiptHeaderRow,
  findReceiptsForCustomer,
  mergeReceiptDatasets,
  normalizeReceiptDataset,
  parseReceiptRegisterRows,
  prioritizeReceiptSheets,
} from "../../lib/receiptRegister.js";
import { storeUploadedExcel } from "../../lib/uploadFilesStorage.js";

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
    .eq("setting_key", RECEIPT_DATASET_KEY)
    .maybeSingle();

  if (error) throw error;
  return normalizeReceiptDataset(parseJson(data?.setting_value));
}

async function loadCustomerLookup(admin) {
  const { data, error } = await admin
    .from("customers")
    .select("customer_code,customer_name");

  if (error) throw error;
  return buildCustomerLookup(data || []);
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

    const receipts = (customerCode || customerName)
      ? findReceiptsForCustomer(dataset, customerCode, customerName)
      : [];

    return NextResponse.json({
      success: true,
      uploadedAt: dataset.uploadedAt,
      fileName: dataset.fileName,
      canDownload: Boolean(String(dataset.filePath || "").trim()),
      rowsCount: dataset.rowsCount || dataset.rows.length,
      matchedCount: dataset.matchedCount,
      unmatchedCount: dataset.unmatchedCount,
      datesUpdated: dataset.datesUpdated || [],
      receipts,
      receiptTotal: receipts.reduce((total, row) => total + Number(row.amount || 0), 0),
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message || "Unable to load receipt data.",
    }, { status: 500 });
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
      return NextResponse.json({
        success: false,
        error: "Only admin/manager/invoice-maker can upload receipt register file.",
      }, { status: 403 });
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
    const workbook = XLSX.read(Buffer.from(arrayBuffer), { type: "buffer", cellDates: false });

    if (!Array.isArray(workbook.SheetNames) || workbook.SheetNames.length === 0) {
      throw new Error("Excel file does not contain any sheet.");
    }

    const customerLookup = await loadCustomerLookup(admin);
    const existing = await readDataset(admin).catch(() => emptyReceiptDataset());

    let parsed = null;
    const sheetPreviews = [];

    for (const sheetName of prioritizeReceiptSheets(workbook.SheetNames)) {
      const sheetRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1,
        defval: "",
        raw: true,
      });
      const previewRows = (sheetRows || [])
        .filter((row) => Array.isArray(row) && row.some((cell) => String(cell || "").trim()))
        .slice(0, 6)
        .map((row) => row.map((cell) => String(cell || "").trim()).filter(Boolean).slice(0, 10).join(" | "));
      sheetPreviews.push(`${sheetName}: ${previewRows.join(" / ")}`);

      const header = findReceiptHeaderRow(sheetRows);
      if (!header) continue;

      parsed = parseReceiptRegisterRows(sheetRows, header, customerLookup);
      if (parsed.rows.length > 0) break;
    }

    if (!parsed || !parsed.rows.length) {
      const preview = sheetPreviews.join("; ").slice(0, 1200);
      throw new Error(`Unable to read receipt register rows. Found: ${preview || "no readable cells"}`);
    }

    if (!parsed.dates.length) {
      throw new Error("No receipt dates found in the uploaded file.");
    }

    const mergedRows = mergeReceiptDatasets(existing.rows, parsed.rows, parsed.dates);
    const liveMatched = mergedRows.filter((row) => row.matched || row.customer_code).length;
    const liveUnmatched = mergedRows.length - liveMatched;
    const nowIso = new Date().toISOString();

    let storedFilePath = "";
    try {
      const storedFile = await storeUploadedExcel(admin, {
        kind: "receipt",
        fileName,
        bytes: Buffer.from(arrayBuffer),
        uploadedAt: nowIso,
      });
      storedFilePath = storedFile.filePath;
    } catch (storeError) {
      console.error("Could not store receipt upload file for download:", storeError);
    }

    const payload = {
      uploadedAt: nowIso,
      fileName,
      filePath: storedFilePath,
      rows: mergedRows,
      datesUpdated: parsed.dates,
      matchedCount: liveMatched,
      unmatchedCount: liveUnmatched,
      rowsCount: mergedRows.length,
      uploadedBy: profile.id,
      lastFileMatchedCount: parsed.matchedCount,
      lastFileUnmatchedCount: parsed.unmatchedCount,
      lastFileRowsCount: parsed.rows.length,
    };

    const { error: upsertError } = await admin
      .from("system_settings")
      .upsert({
        setting_key: RECEIPT_DATASET_KEY,
        setting_value: JSON.stringify(payload),
      }, { onConflict: "setting_key" });

    if (upsertError) throw upsertError;

    return NextResponse.json({
      success: true,
      uploadedAt: payload.uploadedAt,
      fileName: payload.fileName,
      rows: parsed.rows.length,
      rowsCount: payload.rowsCount,
      datesUpdated: parsed.dates.length,
      uploadDates: parsed.dates,
      matchedCount: parsed.matchedCount,
      unmatchedCount: parsed.unmatchedCount,
      liveRows: payload.rowsCount,
      liveMatched: liveMatched,
      liveUnmatched: liveUnmatched,
      mergedIntoExisting: existing.rows.length > 0,
      message: existing.rows.length > 0
        ? `Receipt register updated for ${parsed.dates.length} date(s). Other dates were kept unchanged.`
        : "Receipt register is now live.",
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message || "Unable to upload receipt register.",
    }, { status: 500 });
  }
}
