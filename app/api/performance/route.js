import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCollectionOnlyAccess, normalizeAccessRole } from "../../lib/moduleAccess.js";
import {
  consolidatePerformanceSnapshots,
  normalizeSalesmanCode,
  TEAM_PERFORMANCE_VIEW,
} from "../../lib/performanceKpis.js";
import { loadPerformanceSnapshotsForSalesmen } from "../../lib/performanceKpisServer.js";
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

function isTeamView(value) {
  const raw = String(value || "").trim().toUpperCase();
  return !raw || raw === TEAM_PERFORMANCE_VIEW || raw === "ALL";
}

function uniqueTeamMembers(scope, profile) {
  const seen = new Set();
  const members = [];

  (scope.visibleMembers || []).forEach((member) => {
    const salesmanCode = normalizeSalesmanCode(member.salesman_code);
    if (!salesmanCode || seen.has(salesmanCode)) return;
    if (isCollectionOnlyAccess({ role: member.role, salesmanCode })) return;
    seen.add(salesmanCode);
    members.push({
      salesmanCode,
      salesmanName: String(member.salesman_name || salesmanCode).trim(),
    });
  });

  const ownCode = normalizeSalesmanCode(profile.salesman_code);
  if (ownCode && !seen.has(ownCode) && !isCollectionOnlyAccess({ role: profile.role, salesmanCode: ownCode })) {
    members.unshift({
      salesmanCode: ownCode,
      salesmanName: String(profile.salesman_name || ownCode).trim(),
    });
  }

  members.sort((left, right) => left.salesmanName.localeCompare(right.salesmanName));
  return members;
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
    const scope = await resolveSalesScopeForUserId(admin, user.id);
    const members = uniqueTeamMembers(scope, profile);
    const canViewTeam = Boolean(scope.hasSubordinates || role === "admin" || role === "manager");
    const wantTeam = canViewTeam && isTeamView(requestedCode);

    if (requestedCode && !wantTeam) {
      const allowed = members.some((member) => member.salesmanCode === requestedCode)
        || scope.hasAllAccess
        || (scope.visibleSalesmanCodes || []).map(normalizeSalesmanCode).includes(requestedCode);
      if (!allowed) {
        return NextResponse.json({ success: false, error: "That salesman is outside your team." }, { status: 403 });
      }
    }

    const snapshots = await loadPerformanceSnapshotsForSalesmen(admin, {
      salesmen: members,
      reportDate,
    });
    const teamSnapshot = canViewTeam
      ? consolidatePerformanceSnapshots(snapshots, {
        reportDate,
        salesmanName: `${profile.salesman_name || "Team"} — team`,
      })
      : null;

    const selectedCode = wantTeam || !requestedCode
      ? (canViewTeam ? TEAM_PERFORMANCE_VIEW : normalizeSalesmanCode(profile.salesman_code))
      : requestedCode;
    const snapshot = selectedCode === TEAM_PERFORMANCE_VIEW
      ? teamSnapshot
      : (snapshots.find((row) => row.salesmanCode === selectedCode) || snapshots[0] || teamSnapshot);

    return NextResponse.json({
      success: true,
      canManageTargets: role === "admin" || role === "manager",
      canViewTeam,
      view: selectedCode === TEAM_PERFORMANCE_VIEW ? "team" : "member",
      selectedCode,
      members,
      snapshot,
      teamSnapshot,
      memberSnapshots: canViewTeam ? snapshots : [],
    });
  } catch (error) {
    const message = error.message || "Unable to load performance KPIs.";
    const status = message.includes("login") ? 401 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
