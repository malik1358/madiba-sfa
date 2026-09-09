import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { isMissingSchemaColumn } from "../../lib/performanceKpis.js";
import {
  attachQtyMidToLines,
  convertEnteredQtyToUnits,
  findItemByBarcode,
  findItemByItemCode,
  hasStockTakeModuleAccess,
  normalizeBarcode,
  normalizeStockTakeCode,
  normalizeWarehouseName,
  resolveScannedUom,
  uomLabel,
  warehouseKey,
} from "../../lib/stockTake.js";
import {
  parseStockTakeMasterRows,
  parseSystemInventoryRows,
  rowsFromSheetMatrix,
} from "../../lib/stockTakeMasterImport.js";

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

function missingSetup(error) {
  return isMissingSchemaColumn(error)
    || String(error?.message || "").toLowerCase().includes("stock_take");
}

function setupMessage() {
  return "Run sql/setup_stock_take.sql in Supabase to enable Stock Take.";
}

async function requireStockTakeUser(admin, request) {
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return { error: NextResponse.json({ success: false, error: "Please login again." }, { status: 401 }) };
  }

  const token = authHeader.slice(7);
  const { data: { user }, error: userError } = await admin.auth.getUser(token);
  if (userError || !user) {
    return { error: NextResponse.json({ success: false, error: "Please login again." }, { status: 401 }) };
  }

  let profileRes = await admin
    .from("profiles")
    .select("id,role,salesman_code,salesman_name,stock_take_access")
    .eq("id", user.id)
    .maybeSingle();

  if (profileRes.error && isMissingSchemaColumn(profileRes.error)) {
    profileRes = await admin
      .from("profiles")
      .select("id,role,salesman_code,salesman_name")
      .eq("id", user.id)
      .maybeSingle();
  }

  if (profileRes.error || !profileRes.data) {
    return { error: NextResponse.json({ success: false, error: "Profile not found." }, { status: 403 }) };
  }

  const profile = {
    ...profileRes.data,
    stock_take_access: profileRes.data.stock_take_access === true,
  };

  if (!hasStockTakeModuleAccess({ role: profile.role, stockTakeAccess: profile.stock_take_access })) {
    return { error: NextResponse.json({ success: false, error: "Stock Take access is not enabled for this user." }, { status: 403 }) };
  }

  return { user, profile };
}

function excelRowsFromBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const preferred = workbook.SheetNames.find((name) => String(name).toLowerCase() === "master")
    || workbook.SheetNames[0];
  const sheet = workbook.Sheets[preferred];
  if (!sheet) return [];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
  const fromMatrix = rowsFromSheetMatrix(matrix);
  if (fromMatrix.length) return fromMatrix;
  return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
}

async function loadAllItems(admin) {
  const { data, error } = await admin
    .from("stock_take_items")
    .select("item_code,item_name,base_uom,mid_uom,master_uom,base_uom_pack_size,mid_uom_pack_size,barcode_base,barcode_mid,barcode_master");
  if (error) throw error;
  return data || [];
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete" }, { status: 500 });
    }

    const admin = adminClient();
    const access = await requireStockTakeUser(admin, request);
    if (access.error) return access.error;

    const url = new URL(request.url);
    const action = String(url.searchParams.get("action") || "report").trim();

    if (action === "lookup") {
      const barcode = normalizeBarcode(url.searchParams.get("barcode"));
      const itemCode = normalizeStockTakeCode(url.searchParams.get("itemCode"));
      if (!barcode && !itemCode) {
        return NextResponse.json({ success: false, error: "Enter a barcode or item code." }, { status: 400 });
      }
      const items = await loadAllItems(admin);
      if (itemCode) {
        const item = findItemByItemCode(items, itemCode);
        if (!item) {
          return NextResponse.json({ success: false, error: "Item code not found in stock take master." }, { status: 404 });
        }
        return NextResponse.json({
          success: true,
          item,
          lookupMode: "itemCode",
          scannedUom: "",
          scannedUomLabel: "",
          needsUom: true,
          unitLocked: false,
        });
      }

      const item = findItemByBarcode(items, barcode);
      if (!item) {
        return NextResponse.json({ success: false, error: "Barcode not found in stock take master." }, { status: 404 });
      }
      const resolved = resolveScannedUom(item, barcode);
      const unitLocked = Boolean(resolved.kind) && !resolved.ambiguous;
      return NextResponse.json({
        success: true,
        item,
        lookupMode: unitLocked ? "barcode" : "itemCode",
        scannedUom: unitLocked ? resolved.kind : "",
        scannedUomLabel: unitLocked ? uomLabel(item, resolved.kind) : "",
        needsUom: !unitLocked,
        unitLocked,
      });
    }

    if (action === "session-lines") {
      const sessionId = String(url.searchParams.get("sessionId") || "").trim();
      if (!sessionId) {
        return NextResponse.json({ success: false, error: "Missing session." }, { status: 400 });
      }
      const { data, error } = await admin
        .from("stock_take_lines")
        .select("id,item_code,item_name,barcode,scanned_uom,scanned_uom_label,qty_entered,qty_base,qty_master,pallet_ref,location_ref,scanned_by_name,scanned_at")
        .eq("session_id", sessionId)
        .order("scanned_at", { ascending: false })
        .limit(500);
      if (error) {
        if (missingSetup(error)) {
          return NextResponse.json({ success: false, error: setupMessage() }, { status: 400 });
        }
        throw error;
      }
      const items = await loadAllItems(admin).catch(() => []);
      return NextResponse.json({ success: true, lines: attachQtyMidToLines(data || [], items) });
    }

    const warehouse = normalizeWarehouseName(url.searchParams.get("warehouse"));
    const userId = String(url.searchParams.get("userId") || "").trim();
    let query = admin
      .from("stock_take_lines")
      .select("id,session_id,warehouse_name,item_code,item_name,barcode,scanned_uom,scanned_uom_label,qty_entered,qty_base,qty_master,pallet_ref,location_ref,scanned_by,scanned_by_name,scanned_at")
      .order("scanned_at", { ascending: false })
      .limit(3000);

    if (warehouse) query = query.eq("warehouse_key", warehouseKey(warehouse));
    if (userId) query = query.eq("scanned_by", userId);

    const { data: lines, error } = await query;
    if (error) {
      if (missingSetup(error)) {
        return NextResponse.json({ success: false, error: setupMessage() }, { status: 400 });
      }
      throw error;
    }

    let systemRows = [];
    if (warehouse) {
      const systemRes = await admin
        .from("stock_take_system_inventory")
        .select("item_code,qty_base,item_name,uploaded_at")
        .eq("warehouse_key", warehouseKey(warehouse));
      if (!systemRes.error) systemRows = systemRes.data || [];
    }

    const reportLines = (lines || []).map((line) => {
      const system = systemRows.find((row) => String(row.item_code).toUpperCase() === String(line.item_code).toUpperCase());
      return {
        ...line,
        system_qty_base: system ? Number(system.qty_base) : null,
      };
    });

    return NextResponse.json({
      success: true,
      lines: reportLines,
      systemItemCount: systemRows.length,
      systemUploadedAt: systemRows[0]?.uploaded_at || null,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "Unable to load stock take." },
      { status: 400 },
    );
  }
}

export async function POST(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete" }, { status: 500 });
    }

    const admin = adminClient();
    const access = await requireStockTakeUser(admin, request);
    if (access.error) return access.error;

    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const mode = String(form.get("mode") || "").trim();
      const file = form.get("file");
      if (!file || typeof file === "string") {
        return NextResponse.json({ success: false, error: "Choose an Excel file." }, { status: 400 });
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const rows = excelRowsFromBuffer(buffer);

      if (mode === "upload-master") {
        const parsed = parseStockTakeMasterRows(rows);
        if (!parsed.items.length) {
          return NextResponse.json({ success: false, error: "No product rows found. Use Product Code, Item Name, Base UOM Pack Size, MID UOM Pack Size, and barcodes." }, { status: 400 });
        }
        const payload = parsed.items.map((item) => ({
          ...item,
          updated_at: new Date().toISOString(),
          updated_by: access.profile.id,
        }));
        const { error } = await admin.from("stock_take_items").upsert(payload, { onConflict: "item_code" });
        if (error) {
          if (missingSetup(error)) {
            return NextResponse.json({ success: false, error: setupMessage() }, { status: 400 });
          }
          throw error;
        }
        return NextResponse.json({
          success: true,
          message: `Saved ${parsed.items.length} stock take items.`,
          itemCount: parsed.items.length,
          skipped: parsed.skipped,
        });
      }

      if (mode === "upload-system") {
        const warehouseName = normalizeWarehouseName(form.get("warehouse"));
        if (!warehouseName) {
          return NextResponse.json({ success: false, error: "Enter the warehouse name before uploading system inventory." }, { status: 400 });
        }
        const parsed = parseSystemInventoryRows(rows);
        if (!parsed.length) {
          return NextResponse.json({ success: false, error: "No system inventory rows found. Use Item Code and Qty in base unit." }, { status: 400 });
        }
        const key = warehouseKey(warehouseName);
        const { error: deleteError } = await admin
          .from("stock_take_system_inventory")
          .delete()
          .eq("warehouse_key", key);
        if (deleteError) {
          if (missingSetup(deleteError)) {
            return NextResponse.json({ success: false, error: setupMessage() }, { status: 400 });
          }
          throw deleteError;
        }
        const { error } = await admin.from("stock_take_system_inventory").insert(
          parsed.map((row) => ({
            warehouse_key: key,
            warehouse_name: warehouseName,
            item_code: row.item_code,
            item_name: row.item_name || null,
            qty_base: row.qty_base,
            uploaded_at: new Date().toISOString(),
            uploaded_by: access.profile.id,
          })),
        );
        if (error) throw error;
        return NextResponse.json({
          success: true,
          message: `Saved ${parsed.length} system inventory rows for ${warehouseName}.`,
          itemCount: parsed.length,
          warehouse: warehouseName,
        });
      }

      return NextResponse.json({ success: false, error: "Unsupported upload." }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const mode = String(body?.mode || "save-line").trim();

    if (mode === "start-session") {
      const warehouseName = normalizeWarehouseName(body?.warehouse);
      if (!warehouseName) {
        return NextResponse.json({ success: false, error: "Enter the warehouse name before starting inventory." }, { status: 400 });
      }
      const startedByName = access.profile.salesman_name || access.profile.salesman_code || access.user.email || "";
      const { data, error } = await admin
        .from("stock_take_sessions")
        .insert({
          warehouse_name: warehouseName,
          warehouse_key: warehouseKey(warehouseName),
          started_by: access.profile.id,
          started_by_name: startedByName,
          status: "OPEN",
        })
        .select("id,warehouse_name,started_at")
        .single();
      if (error) {
        if (missingSetup(error)) {
          return NextResponse.json({ success: false, error: setupMessage() }, { status: 400 });
        }
        throw error;
      }
      return NextResponse.json({ success: true, session: data });
    }

    if (mode === "save-line") {
      const warehouseName = normalizeWarehouseName(body?.warehouse);
      const sessionId = String(body?.sessionId || "").trim();
      const barcode = normalizeBarcode(body?.barcode);
      const requestedItemCode = normalizeStockTakeCode(body?.itemCode);
      const qtyEntered = body?.qty;
      if (!warehouseName) {
        return NextResponse.json({ success: false, error: "Enter the warehouse name before counting." }, { status: 400 });
      }
      if (!sessionId) {
        return NextResponse.json({ success: false, error: "Start the warehouse session first." }, { status: 400 });
      }
      if (!barcode && !requestedItemCode) {
        return NextResponse.json({ success: false, error: "Enter a barcode or item code." }, { status: 400 });
      }

      const items = await loadAllItems(admin);
      const item = requestedItemCode
        ? findItemByItemCode(items, requestedItemCode)
        : findItemByBarcode(items, barcode);
      if (!item) {
        return NextResponse.json({
          success: false,
          error: requestedItemCode ? "Item code not found in stock take master." : "Barcode not found in stock take master.",
        }, { status: 404 });
      }

      const resolved = barcode ? resolveScannedUom(item, barcode) : { kind: null };
      const scannedUom = String(body?.scannedUom || resolved.kind || "").toUpperCase();
      const converted = convertEnteredQtyToUnits({
        qtyEntered,
        scannedUom,
        baseUomPackSize: item.base_uom_pack_size,
        midUomPackSize: item.mid_uom_pack_size,
      });

      const scannedByName = access.profile.salesman_name || access.profile.salesman_code || access.user.email || "";
      const { data, error } = await admin
        .from("stock_take_lines")
        .insert({
          session_id: sessionId,
          warehouse_name: warehouseName,
          warehouse_key: warehouseKey(warehouseName),
          item_code: item.item_code,
          item_name: item.item_name,
          barcode: barcode || item.item_code,
          scanned_uom: converted.scannedUom,
          scanned_uom_label: uomLabel(item, converted.scannedUom),
          qty_entered: converted.qtyEntered,
          qty_base: converted.qtyBase,
          qty_master: converted.qtyMaster,
          pallet_ref: String(body?.pallet || "").trim() || null,
          location_ref: String(body?.location || "").trim() || null,
          scanned_by: access.profile.id,
          scanned_by_name: scannedByName,
        })
        .select("id,item_code,item_name,barcode,scanned_uom,scanned_uom_label,qty_entered,qty_base,qty_master,pallet_ref,location_ref,scanned_by_name,scanned_at")
        .single();

      if (error) {
        if (missingSetup(error)) {
          return NextResponse.json({ success: false, error: setupMessage() }, { status: 400 });
        }
        throw error;
      }

      return NextResponse.json({
        success: true,
        line: attachQtyMidToLines([data], [item])[0],
      });
    }

    return NextResponse.json({ success: false, error: "Unsupported action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "Unable to save stock take." },
      { status: 400 },
    );
  }
}
