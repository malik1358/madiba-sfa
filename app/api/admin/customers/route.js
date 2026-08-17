import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  applyCustomerMasterFilters,
  normalizeCustomerMasterGpsFilter,
  normalizeCustomerMasterSearch,
} from "../../../lib/customerMasterQuery.js";

export const runtime = "nodejs";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function requireAdminAccess(admin, request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 }) };
  }

  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: userError } = await admin.auth.getUser(token);
  if (userError || !user) {
    return { error: NextResponse.json({ success: false, error: "Invalid login session" }, { status: 401 }) };
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const role = String(profile?.role || "").toLowerCase();
  if (profileError || !profile || !["admin", "manager"].includes(role)) {
    return { error: NextResponse.json({ success: false, error: "Only admin or manager can access customer master." }, { status: 403 }) };
  }

  return { user, role };
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete" }, { status: 500 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const access = await requireAdminAccess(admin, request);
    if (access.error) return access.error;

    const url = new URL(request.url);
    const search = normalizeCustomerMasterSearch(url.searchParams.get("search"));
    const gpsFilter = normalizeCustomerMasterGpsFilter(
      url.searchParams.get("gpsFilter"),
      url.searchParams.get("missingGps") === "1",
    );
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const limit = Math.min(200, Math.max(10, Number(url.searchParams.get("limit") || 50)));
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = admin
      .from("customers")
      .select("customer_code,customer_name,current_salesman_code,city,area,latitude,longitude,is_active,latest_transaction_date", { count: "exact" })
      .order("customer_name", { ascending: true });

    query = applyCustomerMasterFilters(query, { search, gpsFilter });

    const { data, error, count } = await query.range(from, to);
    if (error) throw error;

    return NextResponse.json({
      success: true,
      customers: data || [],
      filters: {
        search,
        gpsFilter,
      },
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.max(1, Math.ceil((count || 0) / limit)),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "Unable to load customers." },
      { status: 400 },
    );
  }
}

export async function PATCH(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete" }, { status: 500 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const access = await requireAdminAccess(admin, request);
    if (access.error) return access.error;

    const body = await request.json();
    const customerCode = String(body.customerCode || "").trim().toUpperCase();
    const latitude = body.latitude === null || body.latitude === undefined || body.latitude === ""
      ? null
      : Number(body.latitude);
    const longitude = body.longitude === null || body.longitude === undefined || body.longitude === ""
      ? null
      : Number(body.longitude);

    if (!customerCode) throw new Error("Customer code is required");

    const updatePayload = { updated_at: new Date().toISOString() };
    if (latitude === null && longitude === null) {
      updatePayload.latitude = null;
      updatePayload.longitude = null;
    } else {
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new Error("Latitude and longitude are required.");
      }
      updatePayload.latitude = latitude;
      updatePayload.longitude = longitude;
    }

    const { data, error } = await admin
      .from("customers")
      .update(updatePayload)
      .eq("customer_code", customerCode)
      .select("customer_code,customer_name,current_salesman_code,city,area,latitude,longitude,is_active,latest_transaction_date")
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error("Customer not found.");

    return NextResponse.json({ success: true, customer: data });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "Unable to update customer." },
      { status: 400 },
    );
  }
}
