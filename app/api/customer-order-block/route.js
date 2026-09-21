import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ensureCustomerVisibleToScope } from "../../lib/customerAccess.js";
import { normalizeAccessRole } from "../../lib/moduleAccess.js";
import { resolveTrustedAvgDaysToPayForCustomer } from "../../lib/customerOrderBlockServer.js";
import { resolveSalesScopeForUserId } from "../user/sales-scope/route.js";
import {
  ORDER_BLOCK_AVG_DAYS_THRESHOLD,
  blockedByAvgDaysMessage,
  normalizeOrderBlockCustomerCode,
  orderBlockOverrideKey,
  parseOrderBlockOverride,
  resolveOrderBlockStatus,
} from "../../lib/customerOrderBlock.js";

export const runtime = "nodejs";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function resolveAuth(admin, request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Not authenticated");
  }

  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error,
  } = await admin.auth.getUser(token);
  if (error || !user) throw new Error("Invalid login session");

  const scope = await resolveSalesScopeForUserId(admin, user.id);
  return { user, scope };
}

async function readOverride(admin, customerCode) {
  const key = orderBlockOverrideKey(customerCode);
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", key)
    .maybeSingle();
  if (error) throw error;
  return parseOrderBlockOverride(data?.setting_value);
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const url = new URL(request.url);
    const customerCode = normalizeOrderBlockCustomerCode(url.searchParams.get("customerCode"));
    const customerName = String(url.searchParams.get("customerName") || "").trim();
    if (!customerCode) {
      return NextResponse.json({ success: false, error: "Customer code is required." }, { status: 400 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { scope } = await resolveAuth(admin, request);
    await ensureCustomerVisibleToScope(admin, customerCode, {
      hasAllAccess: scope.hasAllAccess,
      visibleSalesmanCodes: scope.visibleSalesmanCodes || [],
      visibleMembers: scope.visibleMembers || [],
    });

    const authHeader = request.headers.get("authorization");
    const avgDaysToPay = await resolveTrustedAvgDaysToPayForCustomer({
      request,
      authHeader,
      customerCode,
      customerName,
    });
    const override = await readOverride(admin, customerCode);
    const status = resolveOrderBlockStatus({ avgDaysToPay, override });
    return NextResponse.json({
      success: true,
      customerCode,
      ...status,
      override,
      message: status.blocked
        ? blockedByAvgDaysMessage({ threshold: status.threshold, avgDaysToPay: status.avgDaysToPay })
        : "",
      canAdminOverride: normalizeAccessRole(scope.role) === "admin",
    });
  } catch (error) {
    const message = error.message || "Unable to load customer order block status.";
    const status = /not authenticated|invalid login session|access|customer not found/i.test(message) ? 403 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function POST(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { user, scope } = await resolveAuth(admin, request);
    if (normalizeAccessRole(scope.role) !== "admin") {
      return NextResponse.json({ success: false, error: "Only admin can change customer order unblock status." }, { status: 403 });
    }

    const body = await request.json();
    const customerCode = normalizeOrderBlockCustomerCode(body?.customerCode);
    const isUnblocked = body?.isUnblocked === true;
    const note = String(body?.note || "").trim();
    const customerName = String(body?.customerName || "").trim();

    if (!customerCode) {
      return NextResponse.json({ success: false, error: "Customer code is required." }, { status: 400 });
    }

    await ensureCustomerVisibleToScope(admin, customerCode, {
      hasAllAccess: scope.hasAllAccess,
      visibleSalesmanCodes: scope.visibleSalesmanCodes || [],
      visibleMembers: scope.visibleMembers || [],
    });

    const key = orderBlockOverrideKey(customerCode);
    if (isUnblocked) {
      const value = {
        customer_code: customerCode,
        is_unblocked: true,
        note,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      };
      const { error } = await admin
        .from("system_settings")
        .upsert(
          { setting_key: key, setting_value: JSON.stringify(value) },
          { onConflict: "setting_key" },
        );
      if (error) throw error;
    } else {
      const { error } = await admin
        .from("system_settings")
        .delete()
        .eq("setting_key", key);
      if (error) throw error;
    }

    const override = await readOverride(admin, customerCode);
    const authHeader = request.headers.get("authorization");
    const avgDaysToPay = await resolveTrustedAvgDaysToPayForCustomer({
      request,
      authHeader,
      customerCode,
      customerName,
    });
    const status = resolveOrderBlockStatus({
      avgDaysToPay,
      override,
      threshold: ORDER_BLOCK_AVG_DAYS_THRESHOLD,
    });
    return NextResponse.json({ success: true, customerCode, ...status, override });
  } catch (error) {
    const message = error.message || "Unable to update customer order unblock status.";
    const status = /not authenticated|invalid login session|access|customer not found/i.test(message) ? 403 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
