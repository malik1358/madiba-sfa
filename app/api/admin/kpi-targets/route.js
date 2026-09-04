import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCollectionOnlyAccess } from "../../../lib/moduleAccess.js";
import { monthStartDate, normalizePerformanceTargets, normalizeSalesmanCode } from "../../../lib/performanceKpis.js";
import { loadPerformanceSnapshotsForSalesmen } from "../../../lib/performanceKpisServer.js";
import { getKsaDateString } from "../../../lib/workdayActivity.js";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function parseReportDate(value) {
  const raw = String(value || getKsaDateString()).trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error("Invalid month. Use YYYY-MM or YYYY-MM-DD.");
  }
  return raw;
}

function isMissingColumnError(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42703" || (message.includes("column") && message.includes("does not exist"));
}

async function requireManager(admin, request) {
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return { error: NextResponse.json({ success: false, error: "Please login again." }, { status: 401 }) };
  }

  const token = authHeader.slice(7);
  const { data: { user }, error: userError } = await admin.auth.getUser(token);
  if (userError || !user) {
    return { error: NextResponse.json({ success: false, error: "Please login again." }, { status: 401 }) };
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,role,salesman_code,salesman_name")
    .eq("id", user.id)
    .single();

  const role = String(profile?.role || "").toLowerCase();
  if (
    profileError
    || !profile
    || !["admin", "manager"].includes(role)
    || isCollectionOnlyAccess({ role, salesmanCode: profile.salesman_code })
  ) {
    return { error: NextResponse.json({ success: false, error: "Only admin or manager can update KPI targets." }, { status: 403 }) };
  }

  return { user, profile, role };
}

async function listFieldSalesmen(admin) {
  const { data, error } = await admin
    .from("profiles")
    .select("id,salesman_code,salesman_name,role,is_active")
    .eq("is_active", true)
    .order("salesman_name");

  if (error) throw error;

  return (data || []).filter((row) => {
    const code = normalizeSalesmanCode(row.salesman_code);
    if (!code) return false;
    return !isCollectionOnlyAccess({ role: row.role, salesmanCode: code });
  });
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete" }, { status: 500 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const access = await requireManager(admin, request);
    if (access.error) return access.error;

    const url = new URL(request.url);
    const reportDate = parseReportDate(url.searchParams.get("month") || url.searchParams.get("date"));
    const salesmen = await listFieldSalesmen(admin);
    const snapshots = await loadPerformanceSnapshotsForSalesmen(admin, {
      salesmen: salesmen.map((row) => ({
        salesmanCode: row.salesman_code,
        salesmanName: row.salesman_name,
      })),
      reportDate,
    });

    return NextResponse.json({
      success: true,
      month: monthStartDate(reportDate),
      reportDate,
      rows: snapshots,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "Unable to load KPI targets." },
      { status: 400 },
    );
  }
}

export async function PUT(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete" }, { status: 500 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const access = await requireManager(admin, request);
    if (access.error) return access.error;

    const body = await request.json().catch(() => ({}));
    const reportDate = parseReportDate(body.month || body.date);
    const targetMonth = monthStartDate(reportDate);
    const incoming = Array.isArray(body.rows) ? body.rows : [];

    if (!incoming.length) {
      return NextResponse.json({ success: false, error: "No KPI targets to save." }, { status: 400 });
    }

    const rows = incoming.map((row) => {
      const salesmanCode = normalizeSalesmanCode(row.salesmanCode || row.salesman_code);
      if (!salesmanCode) {
        throw new Error("Each row needs a salesman code.");
      }
      const targets = normalizePerformanceTargets(row.targets || row);
      return {
        salesman_code: salesmanCode,
        target_month: targetMonth,
        sales_target: targets.officeSupplies + targets.otherSales,
        office_supplies_sales_target: targets.officeSupplies,
        other_sales_target: targets.otherSales,
        collection_target: targets.collection,
        new_buying_customers_target: Math.round(targets.newCustomers),
        existing_customers_buying_target: Math.round(targets.repeatCustomers),
        is_approved: true,
        updated_by: access.user.id,
      };
    });

    let result = await admin
      .from("kpi_targets")
      .upsert(rows, { onConflict: "salesman_code,target_month" });

    if (result.error && isMissingColumnError(result.error)) {
      result = await admin
        .from("kpi_targets")
        .upsert(
          rows.map(({ office_supplies_sales_target, other_sales_target, collection_target, updated_by, ...rest }) => rest),
          { onConflict: "salesman_code,target_month" },
        );
    }

    if (result.error) throw result.error;

    return NextResponse.json({
      success: true,
      month: targetMonth,
      savedCount: rows.length,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "Unable to save KPI targets." },
      { status: 400 },
    );
  }
}
