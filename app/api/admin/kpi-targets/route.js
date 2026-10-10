import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCollectionOnlyAccess } from "../../../lib/moduleAccess.js";
import { isMissingSchemaColumn, monthStartDate, normalizePerformanceTargets, normalizeSalesmanCode, PERFORMANCE_KPI_LABELS } from "../../../lib/performanceKpis.js";
import { loadKpiTargetsBySalesman, loadPerformanceSnapshotsForSalesmen } from "../../../lib/performanceKpisServer.js";
import { isKpiTargetProfile, isTeamTargetSalesmanCode, mergeKpiTargetProfiles, teamTargetSalesmanCode, uniqueBossesFromRows } from "../../../lib/kpiTargetsTable.js";
import { changedKpiTargetKeys } from "../../../lib/kpiTargetsEmail.js";
import { runKpiTargetsEmailCycle } from "../../../lib/kpiTargetsEmailServer.js";
import { findHeadProfile } from "../../../lib/salesHierarchy.js";
import { normalizeReportSalesmanCode } from "../../../lib/salesmanReportIdentity.js";
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
  return isMissingSchemaColumn(error);
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
    || !["admin", "report-user", "report_user", "manager"].includes(role)
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
    .order("salesman_name");

  if (error) throw error;

  return mergeKpiTargetProfiles((data || []).filter(isKpiTargetProfile));
}

async function attachBosses(admin, salesmen) {
  const usersRes = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersRes.error) throw usersRes.error;

  const authById = new Map((usersRes.data?.users || []).map((user) => [user.id, user]));
  const { data: profiles, error } = await admin
    .from("profiles")
    .select("id,salesman_code,salesman_name");
  if (error) throw error;

  return (salesmen || []).map((row) => {
    const auth = authById.get(row.id);
    const metadata = auth?.user_metadata || auth?.app_metadata || {};
    const head = findHeadProfile(metadata, profiles || []);
    const bossCode = normalizeSalesmanCode(head?.salesman_code || metadata.head_salesman_code);
    const bossName = String(head?.salesman_name || metadata.head_salesman_name || "").trim();
    return {
      ...row,
      bossCode,
      bossName: bossName || bossCode || "",
    };
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
    const salesmen = await attachBosses(admin, await listFieldSalesmen(admin));
    const snapshots = await loadPerformanceSnapshotsForSalesmen(admin, {
      salesmen: salesmen.map((row) => ({
        salesmanCode: row.salesman_code,
        salesmanName: row.salesman_name,
      })),
      reportDate,
    });
    const bossByCode = new Map(
      salesmen.map((row) => [normalizeSalesmanCode(row.salesman_code), row]),
    );
    const rows = snapshots.map((snapshot) => {
      const boss = bossByCode.get(normalizeSalesmanCode(snapshot.salesmanCode));
      return {
        ...snapshot,
        bossCode: boss?.bossCode || "",
        bossName: boss?.bossName || "",
      };
    });
    const bosses = uniqueBossesFromRows(rows);
    const teamTargetCodes = bosses.map((boss) => teamTargetSalesmanCode(boss.bossCode)).filter(Boolean);
    const teamTargetsByCode = await loadKpiTargetsBySalesman(admin, {
      salesmanCodes: teamTargetCodes,
      reportDate,
    });

    return NextResponse.json({
      success: true,
      month: monthStartDate(reportDate),
      reportDate,
      rows,
      teamTargets: bosses.map((boss) => {
        const stored = teamTargetsByCode.get(teamTargetSalesmanCode(boss.bossCode));
        return {
          bossCode: boss.bossCode,
          bossName: boss.bossName,
          salesmanCode: teamTargetSalesmanCode(boss.bossCode),
          targets: stored?.targets || {
            officeSupplies: 0,
            otherSales: 0,
            totalSales: 0,
            collection: 0,
            newCustomers: 0,
            repeatCustomers: 0,
          },
        };
      }),
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
      const rawCode = row.salesmanCode || row.salesman_code;
      const salesmanCode = isTeamTargetSalesmanCode(rawCode)
        ? String(rawCode || "").trim().toUpperCase().replace(/\s+/g, " ")
        : normalizeReportSalesmanCode(rawCode);
      if (!salesmanCode) {
        throw new Error("Each row needs a salesman code.");
      }
      const targets = normalizePerformanceTargets(row.targets || row);
      return {
        salesman_code: salesmanCode,
        target_month: targetMonth,
        sales_target: targets.totalSales,
        office_supplies_sales_target: targets.officeSupplies,
        local_item_sales_target: targets.localItemSales,
        other_sales_target: targets.otherSales,
        collection_target: targets.collection,
        new_buying_customers_target: Math.round(targets.newCustomers),
        existing_customers_buying_target: Math.round(targets.repeatCustomers),
        is_approved: true,
        updated_by: access.user.id,
      };
    });

    const previousTargets = await loadKpiTargetsBySalesman(admin, {
      salesmanCodes: rows.map((row) => row.salesman_code),
      reportDate,
    });
    const changedRows = rows.map((row) => {
      const previous = previousTargets.get(row.salesman_code)?.targets || {};
      const next = normalizePerformanceTargets(row);
      return {
        salesmanCode: row.salesman_code,
        changedKeys: changedKpiTargetKeys(previous, next),
      };
    }).filter((row) => row.changedKeys.length);

    const payloads = [
      rows,
      rows.map(({ collection_target, updated_by, ...rest }) => rest),
    ];

    let result = { error: new Error("Unable to save KPI targets.") };
    for (const payload of payloads) {
      result = await admin
        .from("kpi_targets")
        .upsert(payload, { onConflict: "salesman_code,target_month" });
      if (!result.error) break;
      if (!isMissingColumnError(result.error)) throw result.error;
    }

    if (result.error) {
      if (
        isMissingColumnError(result.error)
        && String(result.error.message || result.error.details || "").includes("local_item_sales_target")
      ) {
        throw new Error("Apply supabase/migrations/20261009120000_kpi_targets_local_item_sales.sql before saving Local item sales targets.");
      }
      throw new Error(
        "Unable to save KPI targets. Apply sql/setup_kpi_targets_collection.sql and the KPI target migrations so all target columns exist.",
      );
    }

    let email = { sentCount: 0, failedCount: 0, skippedCount: 0, results: [] };
    const changedSalesmanRows = changedRows.filter((row) => !isTeamTargetSalesmanCode(row.salesmanCode));
    if (changedSalesmanRows.length) {
      try {
        email = await runKpiTargetsEmailCycle(admin, {
          month: targetMonth.slice(0, 7),
          salesmanCodes: changedSalesmanRows.map((row) => row.salesmanCode),
          changedLabelsBySalesman: Object.fromEntries(changedSalesmanRows.map((row) => [
            row.salesmanCode,
            row.changedKeys.map((key) => PERFORMANCE_KPI_LABELS[key] || key),
          ])),
          trigger: "target_update",
        });
        email.changedTargets = changedSalesmanRows.map((row) => ({
          salesmanCode: row.salesmanCode,
          labels: row.changedKeys.map((key) => PERFORMANCE_KPI_LABELS[key] || key),
        }));
      } catch (error) {
        email = {
          sentCount: 0,
          failedCount: 1,
          skippedCount: 0,
          error: error.message || "KPI targets were saved, but email notification failed.",
          results: [],
        };
      }
    }

    return NextResponse.json({
      success: true,
      month: targetMonth,
      savedCount: rows.length,
      changedCount: changedRows.length,
      email,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "Unable to save KPI targets." },
      { status: 400 },
    );
  }
}
