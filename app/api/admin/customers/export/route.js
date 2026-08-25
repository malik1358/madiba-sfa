import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import {
  customerMasterExportRows,
  fetchAllFilteredCustomers,
  normalizeCustomerMasterActiveFilter,
  normalizeCustomerMasterGpsFilter,
  normalizeCustomerMasterOutstandingFilter,
  normalizeCustomerMasterSearch,
} from "../../../../lib/customerMasterQuery.js";

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
    return { error: NextResponse.json({ success: false, error: "Only admin or manager can export customer master." }, { status: 403 }) };
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
    const filters = {
      search: normalizeCustomerMasterSearch(url.searchParams.get("search")),
      gpsFilter: normalizeCustomerMasterGpsFilter(
        url.searchParams.get("gpsFilter"),
        url.searchParams.get("missingGps") === "1",
      ),
      activeFilter: normalizeCustomerMasterActiveFilter(url.searchParams.get("activeFilter")),
      outstandingFilter: normalizeCustomerMasterOutstandingFilter(url.searchParams.get("outstandingFilter")),
    };

    const customers = await fetchAllFilteredCustomers(admin, filters);
    const sheetRows = customerMasterExportRows(customers);
    const worksheet = XLSX.utils.json_to_sheet(sheetRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Customers");

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const filename = `customer-master-${filters.gpsFilter}-${stamp}.xlsx`;

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "Unable to export customers." },
      { status: 400 },
    );
  }
}
