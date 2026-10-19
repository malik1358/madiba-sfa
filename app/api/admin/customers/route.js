import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  fetchAllFilteredCustomers,
  normalizeCustomerMasterActiveFilter,
  normalizeCustomerMasterGpsFilter,
  normalizeCustomerMasterOutstandingFilter,
  normalizeCustomerMasterSearch,
} from "../../../lib/customerMasterQuery.js";
import {
  applyCustomerGpsUpdate,
  CUSTOMER_GPS_SOURCE,
  CUSTOMER_MASTER_GPS_SELECT,
} from "../../../lib/customerGpsHistory.js";

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
      .select("role,salesman_code,salesman_name")
      .eq("id", user.id)
      .single();

    const role = String(profile?.role || "").toLowerCase();
    if (profileError || !profile || !["admin", "manager"].includes(role)) {
      return { error: NextResponse.json({ success: false, error: "Only admin or manager can access customer master." }, { status: 403 }) };
    }

    return { user, role, profile };
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
    const activeFilter = normalizeCustomerMasterActiveFilter(url.searchParams.get("activeFilter"));
    const outstandingFilter = normalizeCustomerMasterOutstandingFilter(url.searchParams.get("outstandingFilter"));
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const limit = Math.min(200, Math.max(10, Number(url.searchParams.get("limit") || 50)));
    const from = (page - 1) * limit;

    const customers = await fetchAllFilteredCustomers(admin, {
      search,
      gpsFilter,
      activeFilter,
      outstandingFilter,
    });
    const pageRows = customers.slice(from, from + limit);

    return NextResponse.json({
      success: true,
      customers: pageRows,
      filters: {
        search,
        gpsFilter,
        activeFilter,
        outstandingFilter,
      },
      pagination: {
        page,
        limit,
        total: customers.length,
        totalPages: Math.max(1, Math.ceil(customers.length / limit)),
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
    const transferToSalesmanCode = String(body.salesmanCode || body.transferToSalesmanCode || "").trim();

    if (!customerCode) throw new Error("Customer code is required");

    if (transferToSalesmanCode) {
      const { data: existing, error: existingError } = await admin
        .from("customers")
        .select("customer_code,customer_name,current_salesman_code,previous_salesman_code,city,area,latitude,longitude,is_active,latest_transaction_date")
        .eq("customer_code", customerCode)
        .maybeSingle();

      if (existingError) throw existingError;
      if (!existing) throw new Error("Customer not found.");

      const nextSalesman = transferToSalesmanCode.toUpperCase().replace(/\s+/g, " ");
      const currentSalesman = String(existing.current_salesman_code || "").trim();
      if (!nextSalesman) throw new Error("Salesman is required.");
      if (nextSalesman.toUpperCase() === currentSalesman.toUpperCase()) {
        throw new Error("Customer is already assigned to this salesman.");
      }

      const { data: salesmanProfiles, error: salesmanError } = await admin
        .from("profiles")
        .select("salesman_code,salesman_name");

      if (salesmanError) throw salesmanError;
      const salesmanProfile = (salesmanProfiles || []).find((row) => {
        const code = String(row.salesman_code || "").trim().toUpperCase().replace(/\s+/g, " ");
        const name = String(row.salesman_name || "").trim().toUpperCase().replace(/\s+/g, " ");
        return code === nextSalesman || name === nextSalesman;
      });

      if (!salesmanProfile?.salesman_code) {
        throw new Error("Salesman not found. Use an existing salesman code.");
      }

      const assignedCode = String(salesmanProfile.salesman_code).trim();
      const { data, error } = await admin
        .from("customers")
        .update({
          previous_salesman_code: currentSalesman || null,
          current_salesman_code: assignedCode,
          updated_at: new Date().toISOString(),
        })
        .eq("customer_code", customerCode)
        .select("customer_code,customer_name,current_salesman_code,previous_salesman_code,city,area,latitude,longitude,is_active,latest_transaction_date")
        .maybeSingle();

      if (error) throw error;
      if (!data) throw new Error("Customer not found.");
      return NextResponse.json({ success: true, customer: data });
    }

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

    const data = await applyCustomerGpsUpdate(admin, {
      customerCode,
      latitude: updatePayload.latitude,
      longitude: updatePayload.longitude,
      actor: {
        id: access.user.id,
        email: access.user.email,
        salesman_code: access.profile?.salesman_code,
        salesman_name: access.profile?.salesman_name,
        role: access.role,
      },
      source: CUSTOMER_GPS_SOURCE.customerMaster,
      selectColumns: CUSTOMER_MASTER_GPS_SELECT,
    });

    return NextResponse.json({ success: true, customer: data });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "Unable to update customer." },
      { status: 400 },
    );
  }
}
