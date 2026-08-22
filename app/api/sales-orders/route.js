import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { GPS_REQUIRED_ERROR, hasGpsCoordinates } from "../../lib/geo.js";
import { shouldRequireTransactionGps } from "../../lib/moduleAccess.js";

export const runtime = "nodejs";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function toNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildChangeSet(beforeLines = [], afterLines = []) {
  const beforeMap = new Map();
  const afterMap = new Map();

  beforeLines.forEach((line) => {
    const code = normalizeCode(line.item_code);
    if (!code) return;
    beforeMap.set(code, {
      item_code: code,
      item_name: String(line.item_name || code),
      quantity: toNumber(line.quantity),
      rate: toNumber(line.rate),
    });
  });

  afterLines.forEach((line) => {
    const code = normalizeCode(line.item_code);
    if (!code) return;
    afterMap.set(code, {
      item_code: code,
      item_name: String(line.item_name || code),
      quantity: toNumber(line.quantity),
      rate: toNumber(line.rate),
    });
  });

  const allCodes = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const changes = [];

  allCodes.forEach((code) => {
    const before = beforeMap.get(code) || null;
    const after = afterMap.get(code) || null;

    if (!before && after) {
      changes.push({
        type: "ADDED",
        item_code: code,
        item_name: after.item_name,
        before_quantity: 0,
        after_quantity: after.quantity,
        before_rate: 0,
        after_rate: after.rate,
      });
      return;
    }

    if (before && !after) {
      changes.push({
        type: "REMOVED",
        item_code: code,
        item_name: before.item_name,
        before_quantity: before.quantity,
        after_quantity: 0,
        before_rate: before.rate,
        after_rate: 0,
      });
      return;
    }

    if (!before || !after) return;

    const qtyChanged = before.quantity !== after.quantity;
    const rateChanged = before.rate !== after.rate;
    if (!qtyChanged && !rateChanged) return;

    changes.push({
      type: "UPDATED",
      item_code: code,
      item_name: after.item_name || before.item_name,
      before_quantity: before.quantity,
      after_quantity: after.quantity,
      before_rate: before.rate,
      after_rate: after.rate,
    });
  });

  return changes.sort((a, b) => String(a.item_code).localeCompare(String(b.item_code)));
}

function latestKey(orderId) {
  return `order_history_latest:${String(orderId || "").trim()}`;
}

function historyKey(orderId, changedAt) {
  return `order_history:${String(orderId || "").trim()}:${String(changedAt || new Date().toISOString())}`;
}

function parseValue(value) {
  try {
    return JSON.parse(value || "null");
  } catch {
    return null;
  }
}

async function readHistory(admin, orderId) {
  const [latestRes, historyRes] = await Promise.all([
    admin.from("system_settings").select("setting_value").eq("setting_key", latestKey(orderId)).maybeSingle(),
    admin.from("system_settings").select("setting_key,setting_value").like("setting_key", `order_history:${orderId}:%`),
  ]);

  if (latestRes.error) throw latestRes.error;
  if (historyRes.error) throw historyRes.error;

  const history = (historyRes.data || [])
    .map((row) => ({ ...parseValue(row.setting_value), historyKey: row.setting_key }))
    .filter(Boolean)
    .sort((a, b) => String(a.changedAt || "").localeCompare(String(b.changedAt || "")));

  return history;
}

async function appendOrderHistory(admin, {
  orderId,
  customerCode,
  userId,
  action,
  previousStatus,
  nextStatus,
  changes,
  changedAt,
}) {
  const entry = {
    orderId,
    customerCode,
    action,
    previousStatus,
    nextStatus,
    changes: Array.isArray(changes) ? changes : [],
    changedAt,
    changedBy: userId,
  };

  const { error: latestError } = await admin.from("system_settings").upsert({
    setting_key: latestKey(orderId),
    setting_value: JSON.stringify(entry),
  }, { onConflict: "setting_key" });
  if (latestError) throw latestError;

  const { error: historyError } = await admin.from("system_settings").upsert({
    setting_key: historyKey(orderId, changedAt),
    setting_value: JSON.stringify(entry),
  }, { onConflict: "setting_key" });
  if (historyError) throw historyError;

  return readHistory(admin, orderId);
}

function buildGpsActivityNote(entryType, location, extra = {}) {
  return JSON.stringify({
    action: entryType,
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
    accuracy: location?.accuracy ?? null,
    ...extra,
  });
}

async function insertGpsActivityLog(admin, userId, entryType, location, extra = {}) {
  const { error } = await admin.from("daily_activity_logs").insert({
    user_id: userId,
    entry_type: entryType,
    note: buildGpsActivityNote(entryType, location, extra),
  });
  if (error) throw error;
}

async function getAuthUser(admin, token) {
  const {
    data: { user },
    error,
  } = await admin.auth.getUser(token);
  if (error || !user) throw new Error("Invalid login session");
  return user;
}

async function ensureOrderAccess(admin, orderId, userId) {
  const { data: order, error } = await admin
    .from("sales_orders")
    .select("id,created_by,status,customer_code")
    .eq("id", orderId)
    .maybeSingle();

  if (error) throw error;
  if (!order) throw new Error("Order not found.");
  if (order.created_by !== userId) throw new Error("You do not have access to edit this order.");
  return order;
}

async function persistDraftOrder(admin, {
  userId,
  orderId,
  customerCode,
  customerName,
  salesmanCode,
  lines,
  capturedAt,
}) {
  const nowIso = capturedAt || new Date().toISOString();
  let existingLines = [];
  let resolvedOrderId = orderId ? Number(orderId) : null;

  if (resolvedOrderId) {
    await ensureOrderAccess(admin, resolvedOrderId, userId);
    const { data: beforeLines, error: beforeLinesError } = await admin
      .from("sales_order_items")
      .select("item_code,item_name,quantity,rate")
      .eq("order_id", resolvedOrderId);
    if (beforeLinesError) throw beforeLinesError;
    existingLines = beforeLines || [];
  }

  if (!resolvedOrderId) {
    const { data: newOrder, error: orderError } = await admin
      .from("sales_orders")
      .insert({
        customer_code: customerCode,
        customer_name: customerName,
        salesman_code: salesmanCode,
        status: "DRAFT",
        created_by: userId,
        updated_at: nowIso,
      })
      .select("id")
      .single();

    if (orderError) throw orderError;
    resolvedOrderId = newOrder.id;
  } else {
    const { error: updateError } = await admin
      .from("sales_orders")
      .update({
        customer_name: customerName,
        salesman_code: salesmanCode,
        updated_at: nowIso,
      })
      .eq("id", resolvedOrderId);

    if (updateError) throw updateError;
  }

  const { error: deleteError } = await admin
    .from("sales_order_items")
    .delete()
    .eq("order_id", resolvedOrderId);
  if (deleteError) throw deleteError;

  const normalizedLines = (lines || []).map((line) => ({
    order_id: resolvedOrderId,
    item_code: String(line.item_code || "").trim(),
    item_name: String(line.item_name || line.item_code || "").trim(),
    category: String(line.category || "").trim(),
    quantity: toNumber(line.quantity),
    rate: toNumber(line.rate),
    line_value: toNumber(line.line_value),
  }));

  if (normalizedLines.length > 0) {
    const { error: lineError } = await admin.from("sales_order_items").insert(normalizedLines);
    if (lineError) throw lineError;
  }

  const changeSet = buildChangeSet(
    existingLines,
    normalizedLines.map((line) => ({
      item_code: line.item_code,
      item_name: line.item_name,
      quantity: line.quantity,
      rate: line.rate,
    })),
  );

  return {
    orderId: resolvedOrderId,
    existingLines,
    changeSet,
    nowIso,
  };
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

    const body = await request.json();
    const action = String(body?.action || "save_draft").trim().toLowerCase();
    const customerCode = String(body?.customerCode || "").trim();
    const customerName = String(body?.customerName || "").trim();
    const salesmanCode = String(body?.salesmanCode || "").trim();
    const lines = Array.isArray(body?.lines) ? body.lines : [];
    const location = body?.location || null;
    const capturedAt = String(body?.capturedAt || new Date().toISOString());
    const loadedOrderStatus = String(body?.loadedOrderStatus || "DRAFT").trim().toUpperCase();
    const requestedOrderId = body?.orderId ? Number(body.orderId) : null;

    if (!customerCode) {
      return NextResponse.json({ success: false, error: "Customer is required." }, { status: 400 });
    }
    if (lines.length === 0) {
      return NextResponse.json({ success: false, error: "Add at least one item before saving the order." }, { status: 400 });
    }

    const latitude = Number(location?.latitude);
    const longitude = Number(location?.longitude);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const user = await getAuthUser(admin, authHeader.replace("Bearer ", ""));

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) throw profileError;

    const requireGps = shouldRequireTransactionGps(profile?.role);
    if (requireGps && (!Number.isFinite(latitude) || !Number.isFinite(longitude))) {
      return NextResponse.json({ success: false, error: GPS_REQUIRED_ERROR }, { status: 400 });
    }

    const { orderId, changeSet, nowIso } = await persistDraftOrder(admin, {
      userId: user.id,
      orderId: requestedOrderId,
      customerCode,
      customerName,
      salesmanCode,
      lines,
      capturedAt,
    });

    const isNewOrder = !requestedOrderId;
    const draftHistoryAction = isNewOrder ? "CREATED_ORDER" : "EDITED_ORDER";

    let history = await appendOrderHistory(admin, {
      orderId,
      customerCode,
      userId: user.id,
      action: draftHistoryAction,
      previousStatus: loadedOrderStatus || "DRAFT",
      nextStatus: loadedOrderStatus || "DRAFT",
      changes: changeSet,
      changedAt: nowIso,
    });

    if (requireGps && hasGpsCoordinates(location)) {
      await insertGpsActivityLog(
        admin,
        user.id,
        isNewOrder ? "ORDER_DRAFT" : "ORDER_EDITED",
        location,
        {
          order_id: orderId,
          customer_code: customerCode,
          customer_name: customerName,
        },
      );
    }

    let status = "DRAFT";

    if (action === "submit") {
      const { error: submitError } = await admin
        .from("sales_orders")
        .update({
          status: "SUBMITTED",
          submitted_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", orderId);

      if (submitError) throw submitError;

      history = await appendOrderHistory(admin, {
        orderId,
        customerCode,
        userId: user.id,
        action: "SUBMITTED_ORDER",
        previousStatus: loadedOrderStatus || "DRAFT",
        nextStatus: "SUBMITTED",
        changes: [],
        changedAt: nowIso,
      });

      if (requireGps && hasGpsCoordinates(location)) {
        await insertGpsActivityLog(admin, user.id, "ORDER_SUBMITTED", location, {
          order_id: orderId,
          customer_code: customerCode,
        });
      }

      status = "SUBMITTED";
    }

    return NextResponse.json({
      success: true,
      orderId,
      status,
      history,
      action,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message || "Unable to save order.",
    }, { status: 500 });
  }
}
