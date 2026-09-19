import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { canManageOrderInvoice, isCollectionOnlyAccess } from "../../lib/moduleAccess.js";
import {
  applyTallyUnitUpdates,
  isMissingTallyUnitColumn,
  parseTallyItemMasterRows,
  rowsFromSheetMatrix,
  TALLY_UNIT_SOURCE_EXCEL,
  unitMapFromItems,
} from "../../lib/tallyItemUnits.js";

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

async function requireAuthenticated(admin, request) {
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

  return { user, profile, role: String(profile.role || "").toLowerCase() };
}

async function requireImportAccess(admin, request) {
  const access = await requireAuthenticated(admin, request);
  if (access.error) return access;

  const role = access.role;
  if (
    !canManageOrderInvoice(role)
    || isCollectionOnlyAccess({ role, salesmanCode: access.profile.salesman_code })
  ) {
    return {
      error: NextResponse.json({
        success: false,
        error: "Only admin, manager, or invoice maker can import Tally item units.",
      }, { status: 403 }),
    };
  }

  return access;
}

async function loadUnitSummary(admin) {
  const { count, error: countError } = await admin
    .from("items_master")
    .select("id", { count: "exact", head: true })
    .not("tally_unit", "is", null)
    .neq("tally_unit", "");

  if (countError) {
    if (isMissingTallyUnitColumn(countError)) {
      return {
        ready: false,
        setupRequired: true,
        unitsCount: 0,
        updatedAt: null,
      };
    }
    throw countError;
  }

  const { data: latest, error: latestError } = await admin
    .from("items_master")
    .select("tally_unit_updated_at")
    .not("tally_unit_updated_at", "is", null)
    .order("tally_unit_updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestError && !isMissingTallyUnitColumn(latestError)) throw latestError;

  return {
    ready: true,
    setupRequired: false,
    unitsCount: Number(count || 0),
    updatedAt: latest?.tally_unit_updated_at || null,
  };
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const admin = adminClient();
    const access = await requireAuthenticated(admin, request);
    if (access.error) return access.error;

    const url = new URL(request.url);
    const codesParam = String(url.searchParams.get("codes") || "").trim();
    const summary = await loadUnitSummary(admin);

    if (!codesParam) {
      return NextResponse.json({ success: true, ...summary });
    }

    if (summary.setupRequired) {
      return NextResponse.json({
        success: true,
        ...summary,
        units: {},
        message: "Run sql/setup_tally_item_units.sql in Supabase to enable Tally item units.",
      });
    }

    const codes = [...new Set(
      codesParam
        .split(",")
        .map((code) => String(code || "").trim().toUpperCase())
        .filter(Boolean),
    )].slice(0, 500);

    const { data, error } = await admin
      .from("items_master")
      .select("item_code,tally_unit,tally_item_name")
      .in("item_code", codes);

    if (error) {
      if (isMissingTallyUnitColumn(error)) {
        return NextResponse.json({
          success: true,
          ...summary,
          units: {},
          message: "Run sql/setup_tally_item_units.sql in Supabase to enable Tally item units.",
        });
      }
      throw error;
    }

    return NextResponse.json({
      success: true,
      ...summary,
      units: unitMapFromItems(data || []),
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error?.message || "Unable to load Tally item units.",
    }, { status: 500 });
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

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      return NextResponse.json({ success: false, error: "Upload an Excel file as multipart form data." }, { status: 400 });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: "Excel file is required." }, { status: 400 });
    }

    const fileName = String(file.name || "item-master.xlsx");
    if (!/\.(xlsx|xls)$/i.test(fileName)) {
      return NextResponse.json({ success: false, error: "Only .xlsx or .xls files are supported." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return NextResponse.json({ success: false, error: "Excel file has no sheets." }, { status: 400 });
    }

    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      defval: "",
      raw: false,
    });
    const { items, skipped } = parseTallyItemMasterRows(rowsFromSheetMatrix(matrix));
    if (!items.length) {
      return NextResponse.json({
        success: false,
        error: "No item rows found. Expected columns like \"TALLY ITEM NAME\" and \"MASTER UNIT\".",
      }, { status: 400 });
    }

    const createMissing = String(form.get("createMissing") || "").trim() === "1";
    const result = await applyTallyUnitUpdates(admin, items.map((item) => ({
      ...item,
      source: TALLY_UNIT_SOURCE_EXCEL,
    })), {
      source: TALLY_UNIT_SOURCE_EXCEL,
      createMissing,
    });

    const summary = await loadUnitSummary(admin);

    return NextResponse.json({
      success: true,
      message: `Imported ${result.updated + result.created} item unit${result.updated + result.created === 1 ? "" : "s"} from ${fileName}.`,
      fileName,
      parsed: items.length,
      skippedRows: skipped,
      ...result,
      ...summary,
    });
  } catch (error) {
    const message = error?.message || "Unable to import Tally item units.";
    const status = String(message).includes("setup_tally_item_units") ? 400 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
