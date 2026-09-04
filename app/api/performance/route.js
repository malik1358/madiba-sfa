import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCollectionOnlyAccess, normalizeAccessRole } from "../../lib/moduleAccess.js";
import { normalizeSalesmanCode } from "../../lib/performanceKpis.js";
import { loadPerformanceSnapshot } from "../../lib/performanceKpisServer.js";
import { getKsaDateString } from "../../lib/workdayActivity.js";
import { resolveSalesScopeForUserId } from "../user/sales-scope/route.js";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function parseReportDate(value) {
  const raw = String(value || getKsaDateString()).trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error("Invalid date. Use YYYY-MM-DD.");
  }
  return raw;
}

async function getAuthUser(admin, request) {
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("Please login again.");
  }

  const token = authHeader.slice(7);
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) throw new Error("Please login again.");
  return user;
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete" }, { status: 500 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const user = await getAuthUser(admin, request);
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id,role,salesman_code,salesman_name")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ success: false, error: "Profile not found." }, { status: 403 });
    }

    const role = normalizeAccessRole(profile.role);
    if (isCollectionOnlyAccess({ role, salesmanCode: profile.salesman_code })) {
      return NextResponse.json({ success: false, error: "Performance is not available for collectors." }, { status: 403 });
    }

    const url = new URL(request.url);
    const reportDate = parseReportDate(url.searchParams.get("date") || url.searchParams.get("month"));
    const requestedCode = normalizeSalesmanCode(url.searchParams.get("salesmanCode"));
    const ownCode = normalizeSalesmanCode(profile.salesman_code);
    const canPickSalesman = role === "admin" || role === "manager";

    let salesmanCode = ownCode;
    let salesmanName = profile.salesman_name || "";

    if (requestedCode) {
      if (!canPickSalesman && requestedCode !== ownCode) {
        return NextResponse.json({ success: false, error: "You can only view your own KPIs." }, { status: 403 });
      }

      const scope = await resolveSalesScopeForUserId(admin, user.id);
      const allowed = scope.hasAllAccess
        || (scope.visibleSalesmanCodes || []).map(normalizeSalesmanCode).includes(requestedCode);
      if (!allowed) {
        return NextResponse.json({ success: false, error: "That salesman is outside your team." }, { status: 403 });
      }

      salesmanCode = requestedCode;
      const { data: selected } = await admin
        .from("profiles")
        .select("salesman_name,salesman_code")
        .eq("salesman_code", requestedCode)
        .maybeSingle();
      salesmanName = selected?.salesman_name || requestedCode;
    }

    const snapshot = await loadPerformanceSnapshot(admin, {
      salesmanCode,
      salesmanName,
      reportDate,
    });

    return NextResponse.json({
      success: true,
      canManageTargets: role === "admin" || role === "manager",
      snapshot,
    });
  } catch (error) {
    const message = error.message || "Unable to load performance KPIs.";
    const status = message.includes("login") ? 401 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
