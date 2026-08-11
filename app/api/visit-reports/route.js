import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeName(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function isInvoiceMakerRole(role) {
  const normalized = String(role || "").toLowerCase();
  return normalized === "invoice-maker" || normalized === "invoice_maker";
}

const MUTUAL_SALESMAN_GROUPS = [["JUNAID", "PARVEZ", "SOYEB"]];

function resolveMutualGroupCodes(allProfiles, currentProfile) {
  const currentName = normalizeName(currentProfile?.salesman_name);
  const matchedGroup = MUTUAL_SALESMAN_GROUPS.find((group) => group.includes(currentName));
  if (!matchedGroup) return [];

  return allProfiles
    .filter((profile) => matchedGroup.includes(normalizeName(profile.salesman_name)))
    .map((profile) => normalizeCode(profile.salesman_code))
    .filter(Boolean);
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

  const { data: currentProfile, error: profileError } = await admin
    .from("profiles")
    .select("id,role,salesman_code,salesman_name")
    .eq("id", user.id)
    .single();

  if (profileError || !currentProfile) {
    throw new Error("Profile not found.");
  }

  const role = String(currentProfile.role || "").toLowerCase();
  const currentSalesmanCode = normalizeCode(currentProfile.salesman_code);

  const [profilesRes, usersRes] = await Promise.all([
    admin
      .from("profiles")
      .select("id,role,salesman_code,salesman_name")
      .in("role", ["salesman", "manager", "admin", "invoice-maker", "invoice_maker"]),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  if (profilesRes.error) throw profilesRes.error;
  if (usersRes.error) throw usersRes.error;

  const authUsers = usersRes.data?.users || [];
  const subordinateIds = new Set();

  if (!["admin", "manager"].includes(role) && !isInvoiceMakerRole(role)) {
    authUsers.forEach((authUser) => {
      const metadata = authUser?.user_metadata || authUser?.app_metadata || {};
      if (normalizeCode(metadata.head_salesman_code) === currentSalesmanCode) {
        subordinateIds.add(authUser.id);
      }
    });
  }

  const allProfiles = profilesRes.data || [];
  const visibleProfiles = allProfiles.filter((profile) => {
    if (["admin", "manager"].includes(role) || isInvoiceMakerRole(role)) return true;
    return profile.id === currentProfile.id || subordinateIds.has(profile.id);
  });

  const mutualGroupCodes = resolveMutualGroupCodes(allProfiles, currentProfile);

  return {
    userId: user.id,
    hasAllAccess: ["admin", "manager"].includes(role) || isInvoiceMakerRole(role),
    visibleSalesmanCodes: [...new Set([
      ...visibleProfiles.map((profile) => normalizeCode(profile.salesman_code)).filter(Boolean),
      ...mutualGroupCodes,
    ])],
  };
}

async function ensureCustomerVisible(admin, customerCode, scope) {
  const { data: customer, error } = await admin
    .from("customers")
    .select("customer_code,current_salesman_code")
    .eq("customer_code", customerCode)
    .maybeSingle();

  if (error) throw error;
  if (!customer) {
    throw new Error("Customer not found.");
  }

  if (!scope.hasAllAccess && !scope.visibleSalesmanCodes.includes(normalizeCode(customer.current_salesman_code))) {
    throw new Error("You do not have access to this customer.");
  }

  return customer;
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
    await ensureCustomerVisible(admin, customerCode, scope);

    const { data: updatedCustomer, error: updateError } = await admin
      .from("customers")
      .update({ is_active: body?.isActive !== false })
      .eq("customer_code", customerCode)
      .select("customer_code,is_active")
      .maybeSingle();

    if (updateError) throw updateError;
    if (!updatedCustomer) throw new Error("Customer status was not updated.");

    if (updatedCustomer.is_active === false) {
      const inactiveMetaValue = {
        customer_code: customerCode,
        marked_at: new Date().toISOString(),
        marked_by_user_id: scope.userId,
      };

      const { error: inactiveMetaError } = await admin
        .from("system_settings")
        .upsert(
          {
            setting_key: inactiveMetaKey(customerCode),
            setting_value: JSON.stringify(inactiveMetaValue),
          },
          { onConflict: "setting_key" }
        );

      if (inactiveMetaError) throw inactiveMetaError;
    } else {
      const { error: clearMetaError } = await admin
        .from("system_settings")
        .delete()
        .eq("setting_key", inactiveMetaKey(customerCode));

      if (clearMetaError) throw clearMetaError;
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
    await ensureCustomerVisible(admin, customerCode, scope);

    const value = {
      customer_code: customerCode,
      customer_name: String(body?.customerName || "").trim(),
      outcome: String(body?.outcome || "").trim(),
      next_visit_at: body?.nextVisitAt ? String(body.nextVisitAt) : null,
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

    return NextResponse.json({ success: true, customerCode, value });
  } catch (error) {
    const message = error.message || "Unable to save visit report.";
    const status = /access|session|customer not found/i.test(message) ? 403 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
