import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import {
  EOD_STOCK_DATASET_KEY,
  applyEodStockUpload,
  buildEodStockReportRows,
  eodCityLabel,
  parseEodStockSheets,
  readEodStockDataset,
  summarizeEodStock,
} from "../../lib/eodStock.js";
import { canViewManagementReports, isCollectionOnlyAccess } from "../../lib/moduleAccess.js";
import { storeUploadedExcel } from "../../lib/uploadFilesStorage.js";
import { getKsaDateString } from "../../lib/workdayActivity.js";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function adminClient() {
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireImportAccess(admin, request) {
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return { error: NextResponse.json({ success: false, error: "Please login again." }, { status: 401 }) };
  }

  const token = authHeader.slice(7);
  const { data: { user }, error: userError } = await admin.auth.getUser(token);
  if (userError || !user) {
    return { error: NextResponse.json({ success: false, error: "Please login again." }, { status: 401 }) };
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,role,salesman_code")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    return { error: NextResponse.json({ success: false, error: "Profile not found." }, { status: 403 }) };
  }

  const role = String(profile.role || "").toLowerCase();
  if (!canViewManagementReports(role) || isCollectionOnlyAccess({ role, salesmanCode: profile.salesman_code })) {
    return {
      error: NextResponse.json({
        success: false,
        error: "Only admin, manager, or invoice maker can use end-of-day stock.",
      }, { status: 403 }),
    };
  }

  return { profile, role };
}

async function loadDataset(admin) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", EOD_STOCK_DATASET_KEY)
    .maybeSingle();
  if (error) throw error;
  try {
    return readEodStockDataset(data?.setting_value) || {};
  } catch {
    return {};
  }
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const admin = adminClient();
    const access = await requireImportAccess(admin, request);
    if (access.error) return access.error;

    const dataset = await loadDataset(admin);
    const summary = summarizeEodStock(dataset);
    const url = new URL(request.url);
    const summaryOnly = ["1", "true", "yes"].includes(String(url.searchParams.get("summary") || "").trim().toLowerCase());

    return NextResponse.json({
      success: true,
      ...summary,
      citiesPresent: Array.isArray(dataset.citiesPresent) ? dataset.citiesPresent : [],
      cityLabels: {
        riyadh: eodCityLabel("riyadh"),
        dammam: eodCityLabel("dammam"),
        jeddah: eodCityLabel("jeddah"),
      },
      hasPrevious: Boolean(summary.previousStockDate),
      rows: summaryOnly ? undefined : buildEodStockReportRows(dataset),
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || "Unable to load end-of-day stock." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const admin = adminClient();
    const access = await requireImportAccess(admin, request);
    if (access.error) return access.error;

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
    if (arrayBuffer.byteLength > 20 * 1024 * 1024) {
      return NextResponse.json({ success: false, error: "File must be 20 MB or smaller." }, { status: 400 });
    }

    const workbook = XLSX.read(Buffer.from(arrayBuffer), { type: "buffer" });
    const sheets = (workbook.SheetNames || []).map((name) => ({
      name,
      matrix: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: "", raw: true }),
    }));
    const requestedDate = String(form.get("stockDate") || "").trim();
    const fallbackDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : getKsaDateString();
    const parsed = parseEodStockSheets(sheets, { fallbackDate });
    if (!parsed.ok) {
      return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    let storedFilePath = "";
    try {
      const storedFile = await storeUploadedExcel(admin, {
        kind: "eod-stock",
        fileName,
        bytes: Buffer.from(arrayBuffer),
        uploadedAt: nowIso,
      });
      storedFilePath = storedFile.filePath;
    } catch (storeError) {
      console.error("Could not store end-of-day stock file for download:", storeError);
    }

    const previous = await loadDataset(admin);
    const applied = applyEodStockUpload(previous, parsed);
    const payload = {
      uploadedAt: nowIso,
      fileName,
      filePath: storedFilePath,
      uploadedBy: access.profile.id,
      stockDate: applied.stockDate,
      previousStockDate: applied.previousStockDate,
      citiesPresent: applied.citiesPresent,
      rows: applied.rows,
      previousRows: applied.previousRows,
      skippedZero: parsed.skippedZero || 0,
      skippedUnknownCity: parsed.skippedUnknownCity || 0,
      skippedOtherDates: parsed.skippedOtherDates || 0,
    };

    const { error: upsertError } = await admin.from("system_settings").upsert({
      setting_key: EOD_STOCK_DATASET_KEY,
      setting_value: JSON.stringify(payload),
    }, { onConflict: "setting_key" });
    if (upsertError) throw upsertError;

    const summary = summarizeEodStock(payload);
    const cityNames = applied.citiesPresent.map(eodCityLabel).filter(Boolean).join(", ");
    return NextResponse.json({
      success: true,
      message: `Saved end-of-day stock for ${applied.stockDate} (${cityNames}).`,
      ...summary,
      skippedZero: payload.skippedZero,
      skippedUnknownCity: payload.skippedUnknownCity,
      skippedOtherDates: payload.skippedOtherDates,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || "Unable to upload end-of-day stock." }, { status: 500 });
  }
}
