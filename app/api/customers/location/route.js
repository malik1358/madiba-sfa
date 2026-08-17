import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

async function getAuthUser(request) {
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("No authorization header provided");
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
  const { data: customer, error } = await admin
    .from("customers")
    .select("customer_code,customer_name,current_salesman_code,latitude,longitude")
    .eq("customer_code", customerCode)
    .maybeSingle();

  if (error) throw error;
  if (!customer) throw new Error("Customer not found.");

  const role = String(profile.role || "").toLowerCase();
  if (role === "admin" || role === "manager" || role === "collector") {
    return customer;
  }

  const visibleCode = normalizeCode(profile.salesman_code);
  const customerSalesman = normalizeCode(customer.current_salesman_code);
  if (visibleCode && customerSalesman && visibleCode !== customerSalesman) {
    throw new Error("You do not have access to this customer.");
  }

  return customer;
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
      customer: {
        customer_code: customer.customer_code,
        customer_name: customer.customer_name,
        latitude: customer.latitude,
        longitude: customer.longitude,
      },
    });
  } catch (error) {
    return Response.json(
      { success: false, error: error.message || "Unable to load customer location" },
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
    const body = await request.json();
    const customerCode = normalizeCode(body.customerCode || "");
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);

    if (!customerCode) throw new Error("Customer code is required");
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error("GPS is required. Allow location access in the browser and try again.");
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const profile = await getProfile(admin, user.id);
    await ensureCustomerAccess(admin, profile, customerCode);

    const { data, error } = await admin
      .from("customers")
      .update({
        latitude,
        longitude,
      })
      .eq("customer_code", customerCode)
      .select("customer_code,customer_name,latitude,longitude")
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error("Customer location was not updated.");

    return Response.json({ success: true, customer: data });
  } catch (error) {
    return Response.json(
      { success: false, error: error.message || "Unable to update customer location" },
      { status: 400 },
    );
  }
}
