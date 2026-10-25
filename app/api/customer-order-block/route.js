import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ensureCustomerVisibleToScope } from "../../lib/customerAccess.js";
import { isAdminRole } from "../../lib/moduleAccess.js";
import { resolveSalesScopeForUserId } from "../user/sales-scope/route.js";
import {
  buildOrderBlockOverrideSettingValue,
  normalizeOrderBlockCustomerCode,
  orderBlockOverrideKey,
  parseOrderBlockOverride,
} from "../../lib/customerOrderBlock.js";
import { getKsaDateString } from "../../lib/workdayActivity.js";

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

function statusForCustomerOrderBlockError(message) {
  if (/customer code is required/i.test(message)) return 400;
  if (/not authenticated|invalid login session|access|customer not found/i.test(message)) return 403;
  return 500;
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const url = new URL(request.url);
    const customerCode = normalizeOrderBlockCustomerCode(url.searchParams.get("customerCode"));
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

    const override = await readOverride(admin, customerCode);
    return NextResponse.json({
      success: true,
      customerCode,
      override,
      isAdminUnblocked: override.isUnblocked,
      unblockedOnKsaDate: override.unblockedOnKsaDate || "",
      expiresNextKsaDay: override.expiresNextKsaDay === true,
      canAdminOverride: isAdminRole(scope.role),
    });
  } catch (error) {
    const message = error.message || "Unable to load customer order block status.";
    const status = statusForCustomerOrderBlockError(message);
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
    if (!isAdminRole(scope.role)) {
      return NextResponse.json({ success: false, error: "Only admin can change customer order unblock status." }, { status: 403 });
    }

    const body = await request.json();
    const customerCode = normalizeOrderBlockCustomerCode(body?.customerCode);
    const isUnblocked = body?.isUnblocked === true;
    const note = String(body?.note || "").trim();

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
      const value = buildOrderBlockOverrideSettingValue({
        customerCode,
        note,
        updatedBy: user.id,
        updatedAt: new Date().toISOString(),
        todayKsa: getKsaDateString(),
      });
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
    return NextResponse.json({
      success: true,
      customerCode,
      override,
      isAdminUnblocked: override.isUnblocked,
      unblockedOnKsaDate: override.unblockedOnKsaDate || "",
      expiresNextKsaDay: override.expiresNextKsaDay === true,
      canAdminOverride: true,
    });
  } catch (error) {
    const message = error.message || "Unable to update customer order unblock status.";
    const status = statusForCustomerOrderBlockError(message);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
