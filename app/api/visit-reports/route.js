import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ensureCustomerVisibleToScope, withSalesScopeMatchers } from "../../lib/customerAccess.js";
import { shouldRequireTransactionGps } from "../../lib/moduleAccess.js";
import { buildGpsActivityNote, normalizeGpsCapturePlatform } from "../../lib/geo.js";
import { queueTransactionBossAlerts } from "../../lib/transactionBossAlerts.js";
import { resolveSalesScopeForUserId } from "../user/sales-scope/route.js";

export const runtime = "nodejs";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function latestSettingKey(customerCode) {
  return `visit_report_latest:${normalizeCode(customerCode)}`;
}

function historySettingKey(customerCode) {
  return `visit_report_history:${normalizeCode(customerCode)}:${Date.now()}`;
}

function inactiveMetaKey(customerCode) {
  return `customer_inactive_meta:${normalizeCode(customerCode)}`;
}

async function resolveScope(admin, token) {
  const {
    data: { user },
    error: userError,
  } = await admin.auth.getUser(token);

  if (userError || !user) {
    throw new Error("Invalid login session");
  }

  const payload = await resolveSalesScopeForUserId(admin, user.id);
  return withSalesScopeMatchers({
    userId: user.id,
    role: payload.role,
    hasAllAccess: payload.hasAllAccess,
    visibleSalesmanCodes: payload.visibleSalesmanCodes || [],
    visibleMembers: payload.visibleMembers || [],
  });
}

async function ensureCustomerVisible(admin, customerCode, scope) {
  return ensureCustomerVisibleToScope(admin, customerCode, scope);
}

function getBearerToken(request) {
  const authHeader = request.headers.get("authorization");
  return authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
}

export async function PATCH(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const token = getBearerToken(request);
    if (!token) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const customerCode = normalizeCode(body?.customerCode);
    if (!customerCode) {
      return NextResponse.json({ success: false, error: "Customer code is required." }, { status: 400 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const scope = await resolveScope(admin, token);

    const location = body?.location || {};
    const latitude = Number(location.latitude ?? body?.latitude);
    const longitude = Number(location.longitude ?? body?.longitude);
    if (shouldRequireTransactionGps(scope.role) && (!Number.isFinite(latitude) || !Number.isFinite(longitude))) {
      return NextResponse.json(
        { success: false, error: "GPS is required. Allow location access in the browser and try again." },
        { status: 400 },
      );
    }

    const visibleCustomer = await ensureCustomerVisible(admin, customerCode, scope);
    const storedCustomerCode = normalizeCode(visibleCustomer.customer_code || customerCode);

    const { data: updatedCustomer, error: updateError } = await admin
      .from("customers")
      .update({ is_active: body?.isActive !== false })
      .eq("customer_code", storedCustomerCode)
      .select("customer_code,is_active")
      .maybeSingle();

    if (updateError) throw updateError;
    if (!updatedCustomer) throw new Error("Customer status was not updated.");

    if (updatedCustomer.is_active === false) {
      const inactiveMetaValue = {
        customer_code: storedCustomerCode,
        marked_at: new Date().toISOString(),
        marked_by_user_id: scope.userId,
      };

      const { error: inactiveMetaError } = await admin
        .from("system_settings")
        .upsert(
          {
            setting_key: inactiveMetaKey(storedCustomerCode),
            setting_value: JSON.stringify(inactiveMetaValue),
          },
          { onConflict: "setting_key" }
        );

      if (inactiveMetaError) throw inactiveMetaError;
    } else {
      const { error: clearMetaError } = await admin
        .from("system_settings")
        .delete()
        .eq("setting_key", inactiveMetaKey(storedCustomerCode));

      if (clearMetaError) throw clearMetaError;
    }

    const activityNote = buildGpsActivityNote(
      updatedCustomer.is_active === false ? "CUSTOMER_INACTIVE" : "CUSTOMER_ACTIVE",
      Number.isFinite(latitude) && Number.isFinite(longitude)
        ? {
          latitude,
          longitude,
          accuracy: Number(location.accuracy) || null,
        }
        : null,
      {
        customer_code: storedCustomerCode,
        platform: normalizeGpsCapturePlatform(body?.platform),
      },
    );

    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      const { error: gpsLogError } = await admin.from("daily_activity_logs").insert({
        user_id: scope.userId,
        entry_type: "GPS_PING",
        note: activityNote,
      });

      if (gpsLogError) {
        const message = String(gpsLogError.message || "").toLowerCase();
        if (!message.includes("does not exist") && gpsLogError.code !== "42P01") {
          throw gpsLogError;
        }
      }
    }

    return NextResponse.json({ success: true, customer: updatedCustomer });
  } catch (error) {
    const message = error.message || "Unable to update customer status.";
    const status = /access|session|customer not found|not authenticated/i.test(message) ? 403 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function POST(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const token = getBearerToken(request);
    if (!token) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const customerCode = normalizeCode(body?.customerCode);
    if (!customerCode) {
      return NextResponse.json({ success: false, error: "Customer code is required." }, { status: 400 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const scope = await resolveScope(admin, token);

    const visitLocation = body?.location || {};
    const visitLatitude = Number(visitLocation.latitude ?? body?.latitude);
    const visitLongitude = Number(visitLocation.longitude ?? body?.longitude);
    if (shouldRequireTransactionGps(scope.role) && (!Number.isFinite(visitLatitude) || !Number.isFinite(visitLongitude))) {
      return NextResponse.json(
        { success: false, error: "GPS is required. Allow location access in the browser and try again." },
        { status: 400 },
      );
    }

    await ensureCustomerVisible(admin, customerCode, scope);

    const nextVisitAt = String(body?.nextVisitAt || "").trim();
    if (!nextVisitAt) {
      return NextResponse.json({ success: false, error: "Next visit date is required." }, { status: 400 });
    }

    const value = {
      customer_code: customerCode,
      customer_name: String(body?.customerName || "").trim(),
      outcome: String(body?.outcome || "").trim(),
      next_visit_at: nextVisitAt,
      note: body?.note ? String(body.note) : null,
      stock_checks: Array.isArray(body?.stockChecks)
        ? body.stockChecks.map((item) => ({
            itemCode: String(item?.itemCode || "").trim(),
            itemName: String(item?.itemName || "").trim(),
            status: String(item?.status || "").trim(),
          }))
        : [],
      captured_at: body?.capturedAt ? String(body.capturedAt) : new Date().toISOString(),
      location: body?.location || null,
      saved_by_user_id: scope.userId,
      saved_at: new Date().toISOString(),
      source: "system_settings_fallback",
    };

    const { error: upsertLatestError } = await admin
      .from("system_settings")
      .upsert(
        {
          setting_key: latestSettingKey(customerCode),
          setting_value: JSON.stringify(value),
        },
        { onConflict: "setting_key" }
      );

    if (upsertLatestError) throw upsertLatestError;

    const { error: insertHistoryError } = await admin
      .from("system_settings")
      .insert({
        setting_key: historySettingKey(customerCode),
        setting_value: JSON.stringify(value),
      });

    if (insertHistoryError) {
      // Keep success path resilient even if history insert fails.
      console.error("visit report history insert failed", insertHistoryError);
    }

    queueTransactionBossAlerts(admin, {
      actorUserId: scope.userId,
      transactionType: "VISIT_REPORT",
      referenceKey: `visit:${customerCode}:${value.captured_at}`,
      details: {
        customerCode,
        customerName: value.customer_name,
        outcome: value.outcome,
      },
    });

    return NextResponse.json({ success: true, customerCode, value });
  } catch (error) {
    const message = error.message || "Unable to save visit report.";
    const status = /access|session|customer not found/i.test(message) ? 403 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
