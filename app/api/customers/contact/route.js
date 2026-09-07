import { createClient } from "@supabase/supabase-js";
import { ensureCustomerVisibleToScope, withSalesScopeMatchers } from "../../../lib/customerAccess.js";
import { resolveCustomerMasterExportFields } from "../../../lib/customerCode.js";
import { isValidKsaMobile, normalizeKsaMobile } from "../../../lib/customerContact.js";
import { resolveSalesScopeForUserId } from "../../user/sales-scope/route.js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

async function getAuthUser(request) {
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("Not authenticated");
  }

  const token = authHeader.slice(7);
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Unable to verify user session");
  return user;
}

async function getProfile(admin, userId) {
  const { data, error } = await admin
    .from("profiles")
    .select("id,role,salesman_code,salesman_name")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("No profile found for this user");
  return data;
}

async function ensureCustomerAccess(admin, profile, customerCode) {
  const role = String(profile.role || "").toLowerCase();
  if (role === "admin" || role === "manager" || role === "collector") {
    const scope = { hasAllAccess: true, visibleSalesmanCodes: [], visibleMembers: [] };
    return ensureCustomerVisibleToScope(admin, customerCode, scope);
  }

  const payload = await resolveSalesScopeForUserId(admin, profile.id);
  const scope = withSalesScopeMatchers({
    hasAllAccess: payload.hasAllAccess,
    visibleSalesmanCodes: payload.visibleSalesmanCodes || [],
    visibleMembers: payload.visibleMembers || [],
  });
  return ensureCustomerVisibleToScope(admin, customerCode, scope);
}

function serializeCustomer(customer) {
  const display = resolveCustomerMasterExportFields(customer);
  return {
    customer_code: display.customer_code || customer.customer_code,
    customer_name: display.customer_name || customer.customer_name,
    mobile: normalizeKsaMobile(customer.mobile) || String(customer.mobile || "").trim(),
    current_salesman_code: customer.current_salesman_code || "",
  };
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return Response.json({ success: false, error: "Server configuration is incomplete" }, { status: 500 });
    }

    const user = await getAuthUser(request);
    const url = new URL(request.url);
    const customerCode = normalizeCode(url.searchParams.get("customerCode") || "");
    if (!customerCode) throw new Error("Customer code is required");

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const profile = await getProfile(admin, user.id);
    const customer = await ensureCustomerAccess(admin, profile, customerCode);

    return Response.json({
      success: true,
      customer: serializeCustomer(customer),
    });
  } catch (error) {
    return Response.json(
      { success: false, error: error.message || "Unable to load customer contact" },
      { status: 400 },
    );
  }
}

export async function PATCH(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return Response.json({ success: false, error: "Server configuration is incomplete" }, { status: 500 });
    }

    const user = await getAuthUser(request);
    const body = await request.json().catch(() => ({}));
    const customerCode = normalizeCode(body.customerCode || "");
    const mobile = normalizeKsaMobile(body.mobile);

    if (!customerCode) throw new Error("Customer code is required");
    if (!isValidKsaMobile(mobile)) {
      throw new Error("Mobile must be a valid KSA number with 10 digits starting with 05.");
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const profile = await getProfile(admin, user.id);
    const customer = await ensureCustomerAccess(admin, profile, customerCode);
    const storedCustomerCode = String(customer.customer_code || customerCode).trim();

    const { data, error } = await admin
      .from("customers")
      .update({
        mobile,
        updated_at: new Date().toISOString(),
      })
      .eq("customer_code", storedCustomerCode)
      .select("customer_code,customer_name,current_salesman_code,mobile")
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error("Customer not found.");

    return Response.json({
      success: true,
      customer: serializeCustomer(data),
    });
  } catch (error) {
    return Response.json(
      { success: false, error: error.message || "Unable to update customer phone number" },
      { status: 400 },
    );
  }
}
