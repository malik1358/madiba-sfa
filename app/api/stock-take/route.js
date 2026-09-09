import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { isMissingSchemaColumn } from "../../lib/performanceKpis.js";
import {
  annotateOpenStockTakeSessions,
  applyStockTakeLineEdit,
  attachQtyMidToLines,
  attachStockTakeLineChanges,
  canAccessStockTakeSession,
  convertEnteredQtyToUnits,
  diffStockTakeLineSnapshots,
  duplicateOpenWarehouseMessage,
  findItemByBarcode,
  findItemByItemCode,
  hasStockTakeModuleAccess,
  isOpenStockTakeSession,
  canArchiveStockTakeSession,
  normalizeBarcode,
  normalizeStockTakeCode,
  normalizeWarehouseName,
  resolveScannedUom,
  stockTakeLineSnapshot,
  stockTakeShareTargets,
  summarizeStockTakeLineChange,
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

function missingSharesTable(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("stock_take_session_shares");
}

function missingChangesTable(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("stock_take_line_changes");
}

function lineChangeSetupMessage() {
  return "Run sql/setup_stock_take.sql in Supabase to enable stock take change logging.";
}

async function loadChangesForLineIds(admin, lineIds) {
  const ids = [...new Set((lineIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) return [];
  const rows = [];
  for (let index = 0; index < ids.length; index += 150) {
    const chunk = ids.slice(index, index + 150);
    const { data, error } = await admin
      .from("stock_take_line_changes")
      .select("id,line_id,action,changed_by_name,changed_at,summary,diffs")
      .in("line_id", chunk)
      .order("changed_at", { ascending: false });
    if (error) {
      if (missingChangesTable(error) || missingSetup(error)) return [];
      throw error;
    }
    rows.push(...(data || []));
  }
  return rows;
}

async function loadDeletedLineChanges(admin, warehouseName) {
  let query = admin
    .from("stock_take_line_changes")
    .select("id,line_id,action,changed_by_name,changed_at,summary,diffs,warehouse_name,item_code,item_name,before_snapshot")
    .eq("action", "DELETE")
    .order("changed_at", { ascending: false })
    .limit(80);
  if (warehouseName) query = query.eq("warehouse_key", warehouseKey(warehouseName));
  const { data, error } = await query;
  if (error) {
    if (missingChangesTable(error) || missingSetup(error)) return [];
    throw error;
  }
  return data || [];
}

async function recordStockTakeLineChange(admin, row) {
  const { error } = await admin.from("stock_take_line_changes").insert(row);
  if (error) {
    if (missingChangesTable(error) || missingSetup(error)) {
      throw new Error(lineChangeSetupMessage());
    }
    throw error;
  }
}

function lineSelectColumns() {
  return "id,session_id,warehouse_name,item_code,item_name,barcode,scanned_uom,scanned_uom_label,qty_entered,qty_base,qty_master,pallet_ref,location_ref,scanned_by,scanned_by_name,scanned_at,updated_at,updated_by_name";
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}

function personLabel(profile) {
  return String(profile?.salesman_name || profile?.salesman_code || profile?.id || "").trim();
}

async function loadSharedSessionIds(admin, userId) {
  const { data, error } = await admin
    .from("stock_take_session_shares")
    .select("session_id")
    .eq("shared_with", userId);
  if (error) {
    if (missingSharesTable(error)) return { ids: [], sharesAvailable: false };
    throw error;
  }
  return { ids: (data || []).map((row) => row.session_id).filter(Boolean), sharesAvailable: true };
}

async function loadSessionAccess(admin, sessionId, userId) {
  const { data: session, error } = await admin
    .from("stock_take_sessions")
    .select("id,warehouse_name,warehouse_key,started_by,started_by_name,started_at,status")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw error;
  if (!session) {
    return { error: NextResponse.json({ success: false, error: "Inventory not found." }, { status: 404 }) };
  }
  const { ids } = await loadSharedSessionIds(admin, userId);
  if (!canAccessStockTakeSession({ session, userId, sharedSessionIds: ids })) {
    return { error: NextResponse.json({ success: false, error: "This inventory is not shared with you." }, { status: 403 }) };
  }
  return { session };
}

async function loadShareUsers(admin, currentUserId) {
  let profileRes = await admin
    .from("profiles")
    .select("id,salesman_name,salesman_code,role,is_active,stock_take_access");
  if (profileRes.error && isMissingSchemaColumn(profileRes.error)) {
    profileRes = await admin
      .from("profiles")
      .select("id,salesman_name,salesman_code,role,stock_take_access");
  }
  if (profileRes.error && isMissingSchemaColumn(profileRes.error)) {
    profileRes = await admin
      .from("profiles")
      .select("id,salesman_name,salesman_code,role");
  }
  if (profileRes.error) throw profileRes.error;
  return stockTakeShareTargets(profileRes.data || [], currentUserId);
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

    if (action === "master") {
      const items = await loadAllItems(admin);
      return NextResponse.json({ success: true, items });
    }

    if (action === "open-sessions") {
      const userId = access.profile.id;
      const { ids: sharedIds, sharesAvailable } = await loadSharedSessionIds(admin, userId);
      const ownedRes = await admin
        .from("stock_take_sessions")
        .select("id,warehouse_name,started_by,started_by_name,started_at,status")
        .eq("status", "OPEN")
        .eq("started_by", userId)
        .order("started_at", { ascending: false })
        .limit(200);
      if (ownedRes.error) {
        if (missingSetup(ownedRes.error)) {
          return NextResponse.json({ success: false, error: setupMessage() }, { status: 400 });
        }
        throw ownedRes.error;
      }

      let sharedSessions = [];
      if (sharedIds.length) {
        const sharedRes = await admin
          .from("stock_take_sessions")
          .select("id,warehouse_name,started_by,started_by_name,started_at,status")
          .eq("status", "OPEN")
          .in("id", sharedIds)
          .order("started_at", { ascending: false })
          .limit(200);
        if (sharedRes.error) throw sharedRes.error;
        sharedSessions = sharedRes.data || [];
      }

      const byId = new Map();
      [...(ownedRes.data || []), ...sharedSessions].forEach((row) => byId.set(row.id, row));
      const sessions = annotateOpenStockTakeSessions({
        sessions: [...byId.values()],
        userId,
        sharedSessionIds: sharedIds,
      });

      const shareBySession = new Map();
      const shareUsers = sharesAvailable ? await loadShareUsers(admin, userId).catch(() => []) : [];
      if (sharesAvailable && sessions.some((row) => row.accessKind === "mine")) {
        const ownedIds = sessions.filter((row) => row.accessKind === "mine").map((row) => row.id);
        const shareRes = await admin
          .from("stock_take_session_shares")
          .select("session_id,shared_with")
          .in("session_id", ownedIds);
        if (!shareRes.error) {
          const nameById = new Map(shareUsers.map((person) => [person.id, person.name]));
          (shareRes.data || []).forEach((row) => {
            const list = shareBySession.get(row.session_id) || [];
            list.push(nameById.get(row.shared_with) || row.shared_with);
            shareBySession.set(row.session_id, list);
          });
        }
      }

      return NextResponse.json({
        success: true,
        sharesAvailable,
        shareUsers,
        sessions: sessions.map((session) => ({
          ...session,
          sharedWithNames: shareBySession.get(session.id) || [],
        })),
      });
    }

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
      const accessCheck = await loadSessionAccess(admin, sessionId, access.profile.id);
      if (accessCheck.error) return accessCheck.error;
      let linesRes = await admin
        .from("stock_take_lines")
        .select("id,item_code,item_name,barcode,scanned_uom,scanned_uom_label,qty_entered,qty_base,qty_master,pallet_ref,location_ref,scanned_by_name,scanned_at,updated_at,updated_by_name")
        .eq("session_id", sessionId)
        .order("scanned_at", { ascending: false })
        .limit(500);
      if (linesRes.error && isMissingSchemaColumn(linesRes.error)) {
        linesRes = await admin
          .from("stock_take_lines")
          .select("id,item_code,item_name,barcode,scanned_uom,scanned_uom_label,qty_entered,qty_base,qty_master,pallet_ref,location_ref,scanned_by_name,scanned_at")
          .eq("session_id", sessionId)
          .order("scanned_at", { ascending: false })
          .limit(500);
      }
      if (linesRes.error) {
        if (missingSetup(linesRes.error)) {
          return NextResponse.json({ success: false, error: setupMessage() }, { status: 400 });
        }
        throw linesRes.error;
      }
      const items = await loadAllItems(admin).catch(() => []);
      const withQty = attachQtyMidToLines(linesRes.data || [], items);
      const changes = await loadChangesForLineIds(admin, withQty.map((line) => line.id));
      return NextResponse.json({ success: true, lines: attachStockTakeLineChanges(withQty, changes) });
    }

    const warehouse = normalizeWarehouseName(url.searchParams.get("warehouse"));
    const userId = String(url.searchParams.get("userId") || "").trim();
    let query = admin
      .from("stock_take_lines")
      .select(lineSelectColumns())
      .order("scanned_at", { ascending: false })
      .limit(3000);

    if (warehouse) query = query.eq("warehouse_key", warehouseKey(warehouse));
    if (userId) query = query.eq("scanned_by", userId);

    let { data: lines, error } = await query;
    if (error && isMissingSchemaColumn(error)) {
      query = admin
        .from("stock_take_lines")
        .select("id,session_id,warehouse_name,item_code,item_name,barcode,scanned_uom,scanned_uom_label,qty_entered,qty_base,qty_master,pallet_ref,location_ref,scanned_by,scanned_by_name,scanned_at")
        .order("scanned_at", { ascending: false })
        .limit(3000);
      if (warehouse) query = query.eq("warehouse_key", warehouseKey(warehouse));
      if (userId) query = query.eq("scanned_by", userId);
      const fallback = await query;
      lines = fallback.data;
      error = fallback.error;
    }
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

    const changeRows = await loadChangesForLineIds(admin, (lines || []).map((line) => line.id));
    const deletedLog = await loadDeletedLineChanges(admin, warehouse);
    const reportLines = attachStockTakeLineChanges(
      (lines || []).map((line) => {
        const system = systemRows.find((row) => String(row.item_code).toUpperCase() === String(line.item_code).toUpperCase());
        return {
          ...line,
          system_qty_base: system ? Number(system.qty_base) : null,
        };
      }),
      changeRows,
    );

    return NextResponse.json({
      success: true,
      lines: reportLines,
      deletedLog,
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
      const key = warehouseKey(warehouseName);
      const existingRes = await admin
        .from("stock_take_sessions")
        .select("id,warehouse_name,started_by,started_by_name,started_at,status")
        .eq("status", "OPEN")
        .eq("warehouse_key", key)
        .order("started_at", { ascending: true })
        .limit(1);
      if (existingRes.error) {
        if (missingSetup(existingRes.error)) {
          return NextResponse.json({ success: false, error: setupMessage() }, { status: 400 });
        }
        throw existingRes.error;
      }
      const existing = existingRes.data?.[0];
      if (existing) {
        const { ids } = await loadSharedSessionIds(admin, access.profile.id);
        if (canAccessStockTakeSession({ session: existing, userId: access.profile.id, sharedSessionIds: ids })) {
          return NextResponse.json({
            success: true,
            adopted: true,
            session: {
              ...existing,
              accessKind: String(existing.started_by) === String(access.profile.id) ? "mine" : "shared",
            },
          });
        }
        return NextResponse.json({
          success: false,
          error: duplicateOpenWarehouseMessage({
            warehouseName,
            existing,
            userId: access.profile.id,
            sharedSessionIds: ids,
          }),
          existingSession: existing,
        }, { status: 409 });
      }
      const startedByName = access.profile.salesman_name || access.profile.salesman_code || access.user.email || "";
      const insertRow = {
        warehouse_name: warehouseName,
        warehouse_key: warehouseKey(warehouseName),
        started_by: access.profile.id,
        started_by_name: startedByName,
        status: "OPEN",
      };
      const clientSessionId = String(body?.clientSessionId || "").trim();
      if (isUuid(clientSessionId)) insertRow.id = clientSessionId;
      const { data, error } = await admin
        .from("stock_take_sessions")
        .insert(insertRow)
        .select("id,warehouse_name,started_by,started_by_name,started_at,status")
        .single();
      if (error) {
        if (missingSetup(error)) {
          return NextResponse.json({ success: false, error: setupMessage() }, { status: 400 });
        }
        throw error;
      }
      return NextResponse.json({ success: true, session: { ...data, accessKind: "mine" } });
    }

    if (mode === "share-session") {
      const sessionId = String(body?.sessionId || "").trim();
      const sharedWith = String(body?.userId || "").trim();
      if (!sessionId || !sharedWith) {
        return NextResponse.json({ success: false, error: "Choose an inventory and a user to share with." }, { status: 400 });
      }
      if (sharedWith === access.profile.id) {
        return NextResponse.json({ success: false, error: "You already own this inventory." }, { status: 400 });
      }
      const { data: session, error: sessionError } = await admin
        .from("stock_take_sessions")
        .select("id,started_by,status")
        .eq("id", sessionId)
        .maybeSingle();
      if (sessionError) throw sessionError;
      if (!session) {
        return NextResponse.json({ success: false, error: "Inventory not found." }, { status: 404 });
      }
      if (String(session.started_by) !== String(access.profile.id)) {
        return NextResponse.json({ success: false, error: "Only the user who opened this inventory can share it." }, { status: 403 });
      }
      if (!isOpenStockTakeSession(session)) {
        return NextResponse.json({ success: false, error: "Archived inventories cannot be shared." }, { status: 400 });
      }
      const shareUsers = await loadShareUsers(admin, access.profile.id);
      if (!shareUsers.some((person) => person.id === sharedWith)) {
        return NextResponse.json({ success: false, error: "That user does not have Stock Take access." }, { status: 400 });
      }
      const { error } = await admin
        .from("stock_take_session_shares")
        .upsert({
          session_id: sessionId,
          shared_with: sharedWith,
          shared_by: access.profile.id,
          shared_by_name: personLabel(access.profile),
        }, { onConflict: "session_id,shared_with" });
      if (error) {
        if (missingSharesTable(error) || missingSetup(error)) {
          return NextResponse.json({ success: false, error: setupMessage() }, { status: 400 });
        }
        throw error;
      }
      return NextResponse.json({ success: true });
    }

    if (mode === "archive-session") {
      const sessionId = String(body?.sessionId || "").trim();
      if (!sessionId) {
        return NextResponse.json({ success: false, error: "Choose an inventory to archive." }, { status: 400 });
      }
      const { data: session, error: sessionError } = await admin
        .from("stock_take_sessions")
        .select("id,warehouse_name,started_by,status")
        .eq("id", sessionId)
        .maybeSingle();
      if (sessionError) throw sessionError;
      if (!session) {
        return NextResponse.json({ success: false, error: "Inventory not found." }, { status: 404 });
      }
      if (!canArchiveStockTakeSession({ session, userId: access.profile.id, role: access.profile.role })) {
        return NextResponse.json({ success: false, error: "Only the user who opened this inventory can archive it." }, { status: 403 });
      }
      const { error } = await admin
        .from("stock_take_sessions")
        .update({ status: "ARCHIVED" })
        .eq("id", sessionId);
      if (error) {
        if (missingSetup(error)) {
          return NextResponse.json({ success: false, error: setupMessage() }, { status: 400 });
        }
        throw error;
      }
      return NextResponse.json({ success: true, sessionId });
    }

    if (mode === "update-line") {
      const lineId = String(body?.lineId || "").trim();
      if (!lineId) {
        return NextResponse.json({ success: false, error: "Choose a scan to edit." }, { status: 400 });
      }
      const { data: line, error: lineError } = await admin
        .from("stock_take_lines")
        .select("*")
        .eq("id", lineId)
        .maybeSingle();
      if (lineError) {
        if (missingSetup(lineError)) {
          return NextResponse.json({ success: false, error: setupMessage() }, { status: 400 });
        }
        throw lineError;
      }
      if (!line) {
        return NextResponse.json({ success: false, error: "Scan not found." }, { status: 404 });
      }

      const items = await loadAllItems(admin);
      const item = findItemByItemCode(items, line.item_code);
      const next = applyStockTakeLineEdit(line, {
        qty: body?.qty,
        scannedUom: body?.scannedUom,
        pallet: body?.pallet,
        location: body?.location,
        item,
      });
      const diffs = diffStockTakeLineSnapshots(line, next);
      if (!diffs.length) {
        return NextResponse.json({ success: false, error: "No changes to save." }, { status: 400 });
      }

      const actorName = personLabel(access.profile) || access.user.email || "";
      await recordStockTakeLineChange(admin, {
        line_id: line.id,
        session_id: line.session_id || null,
        warehouse_name: line.warehouse_name,
        warehouse_key: line.warehouse_key || warehouseKey(line.warehouse_name),
        item_code: line.item_code,
        item_name: line.item_name,
        action: "UPDATE",
        changed_by: access.profile.id,
        changed_by_name: actorName,
        summary: summarizeStockTakeLineChange({ action: "UPDATE", before: line, after: next, actorName }),
        diffs,
        before_snapshot: stockTakeLineSnapshot(line),
        after_snapshot: stockTakeLineSnapshot(next),
      });

      const updatePayload = {
        scanned_uom: next.scanned_uom,
        scanned_uom_label: next.scanned_uom_label,
        qty_entered: next.qty_entered,
        qty_base: next.qty_base,
        qty_master: next.qty_master,
        pallet_ref: next.pallet_ref,
        location_ref: next.location_ref,
        updated_at: new Date().toISOString(),
        updated_by: access.profile.id,
        updated_by_name: actorName,
      };
      let updateRes = await admin
        .from("stock_take_lines")
        .update(updatePayload)
        .eq("id", lineId)
        .select("id,session_id,item_code,item_name,barcode,scanned_uom,scanned_uom_label,qty_entered,qty_base,qty_master,pallet_ref,location_ref,scanned_by_name,scanned_at,updated_at,updated_by_name")
        .single();
      if (updateRes.error && isMissingSchemaColumn(updateRes.error)) {
        delete updatePayload.updated_at;
        delete updatePayload.updated_by;
        delete updatePayload.updated_by_name;
        updateRes = await admin
          .from("stock_take_lines")
          .update(updatePayload)
          .eq("id", lineId)
          .select("id,session_id,item_code,item_name,barcode,scanned_uom,scanned_uom_label,qty_entered,qty_base,qty_master,pallet_ref,location_ref,scanned_by_name,scanned_at")
          .single();
      }
      if (updateRes.error) {
        if (missingSetup(updateRes.error)) {
          return NextResponse.json({ success: false, error: setupMessage() }, { status: 400 });
        }
        throw updateRes.error;
      }

      const lineChanges = await loadChangesForLineIds(admin, [lineId]);
      return NextResponse.json({
        success: true,
        line: attachStockTakeLineChanges(attachQtyMidToLines([updateRes.data], item ? [item] : []), lineChanges)[0],
        message: "Scan updated.",
      });
    }

    if (mode === "delete-line") {
      const lineId = String(body?.lineId || "").trim();
      if (!lineId) {
        return NextResponse.json({ success: false, error: "Choose a scan to delete." }, { status: 400 });
      }
      const { data: line, error: lineError } = await admin
        .from("stock_take_lines")
        .select("*")
        .eq("id", lineId)
        .maybeSingle();
      if (lineError) {
        if (missingSetup(lineError)) {
          return NextResponse.json({ success: false, error: setupMessage() }, { status: 400 });
        }
        throw lineError;
      }
      if (!line) {
        return NextResponse.json({ success: false, error: "Scan not found." }, { status: 404 });
      }

      const actorName = personLabel(access.profile) || access.user.email || "";
      await recordStockTakeLineChange(admin, {
        line_id: line.id,
        session_id: line.session_id || null,
        warehouse_name: line.warehouse_name,
        warehouse_key: line.warehouse_key || warehouseKey(line.warehouse_name),
        item_code: line.item_code,
        item_name: line.item_name,
        action: "DELETE",
        changed_by: access.profile.id,
        changed_by_name: actorName,
        summary: summarizeStockTakeLineChange({ action: "DELETE", before: line, actorName }),
        diffs: [],
        before_snapshot: stockTakeLineSnapshot(line),
        after_snapshot: null,
      });

      const { error: deleteError } = await admin.from("stock_take_lines").delete().eq("id", lineId);
      if (deleteError) {
        if (missingSetup(deleteError)) {
          return NextResponse.json({ success: false, error: setupMessage() }, { status: 400 });
        }
        throw deleteError;
      }
      return NextResponse.json({ success: true, lineId, message: "Scan deleted." });
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
      const accessCheck = await loadSessionAccess(admin, sessionId, access.profile.id);
      if (accessCheck.error) return accessCheck.error;
      if (!isOpenStockTakeSession(accessCheck.session)) {
        return NextResponse.json({ success: false, error: "This inventory is archived. Open or start an active count." }, { status: 400 });
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
