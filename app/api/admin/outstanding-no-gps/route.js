import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { normalizeCustomerMasterSearch } from "../../../lib/customerMasterQuery.js";
import {
  customerMatchesSalesmanFilter,
  fetchOutstandingNoGpsCustomers,
  outstandingNoGpsExportRows,
  uniqueOutstandingNoGpsSalesmen,
} from "../../../lib/outstandingNoGps.js";

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
    return { error: NextResponse.json({ success: false, error: "Only admin or manager can access this report." }, { status: 403 }) };
  }

  return { user, role };
}

function parseSort(rawValue) {
  const value = String(rawValue || "outstanding").toLowerCase();
  if (value === "invoice" || value === "visit" || value === "name") return value;
  return "outstanding";
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
    const salesmanFilter = String(url.searchParams.get("salesman") || "").trim();
    const sort = parseSort(url.searchParams.get("sort"));
    const format = String(url.searchParams.get("format") || "").toLowerCase();
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const limit = Math.min(200, Math.max(10, Number(url.searchParams.get("limit") || 50)));
    const from = (page - 1) * limit;

    const allCustomers = await fetchOutstandingNoGpsCustomers(admin, {
      search,
      sort,
    });
    const salesmen = uniqueOutstandingNoGpsSalesmen(allCustomers);
    const customers = allCustomers.filter((row) => customerMatchesSalesmanFilter(row, salesmanFilter));

    if (format === "xlsx") {
      const worksheet = XLSX.utils.json_to_sheet(outstandingNoGpsExportRows(customers));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Outstanding No GPS");
      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      return new NextResponse(buffer, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="outstanding-no-gps-${stamp}.xlsx"`,
        },
      });
    }

    return NextResponse.json({
      success: true,
      customers: customers.slice(from, from + limit),
      salesmen,
      filters: { search, salesman: salesmanFilter, sort },
      pagination: {
        page,
        limit,
        total: customers.length,
        totalPages: Math.max(1, Math.ceil(customers.length / limit)),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "Unable to load outstanding customers without GPS." },
      { status: 400 },
    );
  }
}
