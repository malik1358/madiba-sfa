import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCollectionOnlyAccess } from "../../../lib/moduleAccess.js";
import {
  isMissingSchemaColumn,
  monthStartDate,
  normalizePerformanceTargets,
  normalizeSalesmanCode,
  PERFORMANCE_KPI_LABELS,
} from "../../../lib/performanceKpis.js";
import {
  loadKpiTargetsBySalesman,
  loadPerformanceSnapshotsForSalesmen,
  loadStoredKpiActualsByCode,
} from "../../../lib/performanceKpisServer.js";
import { isKpiTargetProfile, isTeamTargetSalesmanCode, mergeKpiTargetProfiles, teamTargetSalesmanCode, uniqueBossesFromRows } from "../../../lib/kpiTargetsTable.js";
import { changedKpiTargetKeys } from "../../../lib/kpiTargetsEmail.js";
import { runKpiTargetsEmailCycle } from "../../../lib/kpiTargetsEmailServer.js";
import { enqueueDeferredTeamEmail } from "../../../lib/deferredTeamEmail.js";
import { isWithinTeamEmailWindow, teamEmailWindowHoldMessage, getKsaDateString } from "../../../lib/workdayActivity.js";
import { findHeadProfile } from "../../../lib/salesHierarchy.js";
import { normalizeReportSalesmanCode } from "../../../lib/salesmanReportIdentity.js";
import { previousMonthKey } from "../../../lib/categoryGrowth.js";

export const runtime = "nodejs";
export const maxDuration = 30;
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

const KPI_BOSS_MAP_KEY = "kpi_targets_boss_map_v1";
const KPI_BOSS_MAP_TTL_MS = 30 * 60 * 1000;

async function listFieldSalesmen(admin) {
  const { data, error } = await admin
    .from("profiles")
    .select("id,salesman_code,salesman_name,role,is_active")
    .order("salesman_name");

  if (error) throw error;

  return mergeKpiTargetProfiles((data || []).filter(isKpiTargetProfile));
}

async function loadBossAttachmentByUserId(admin) {
  const { data: cachedRow, error: cachedError } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", KPI_BOSS_MAP_KEY)
    .maybeSingle();
  if (cachedError) throw cachedError;
  try {
    const cached = JSON.parse(String(cachedRow?.setting_value || "null"));
    const builtAtMs = Date.parse(cached?.builtAt || "");
    if (
      cached?.version === 1
      && Number.isFinite(builtAtMs)
      && (Date.now() - builtAtMs) < KPI_BOSS_MAP_TTL_MS
      && cached.byUserId
      && typeof cached.byUserId === "object"
    ) {
      return cached.byUserId;
    }
  } catch {
    // Rebuild below.
  }

  const usersRes = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersRes.error) throw usersRes.error;

  const { data: profiles, error } = await admin
    .from("profiles")
    .select("id,salesman_code,salesman_name");
  if (error) throw error;

  const byUserId = {};
  (usersRes.data?.users || []).forEach((user) => {
    const metadata = user?.user_metadata || user?.app_metadata || {};
    const head = findHeadProfile(metadata, profiles || []);
    const bossCode = normalizeSalesmanCode(head?.salesman_code || metadata.head_salesman_code);
    const bossName = String(head?.salesman_name || metadata.head_salesman_name || "").trim();
    byUserId[user.id] = {
      bossCode,
      bossName: bossName || bossCode || "",
    };
  });

  await admin.from("system_settings").upsert({
    setting_key: KPI_BOSS_MAP_KEY,
    setting_value: JSON.stringify({
      version: 1,
      builtAt: new Date().toISOString(),
      byUserId,
    }),
  }, { onConflict: "setting_key" });

  return byUserId;
}

function attachBossesFromMap(salesmen, bossByUserId) {
  return (salesmen || []).map((row) => {
    const boss = bossByUserId?.[row.id] || {};
    return {
      ...row,
      bossCode: boss.bossCode || "",
      bossName: boss.bossName || "",
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
    const fieldSalesmen = await listFieldSalesmen(admin);
    const salesmanPayload = fieldSalesmen.map((row) => ({
      salesmanCode: row.salesman_code,
      salesmanName: row.salesman_name,
    }));
    const priorMonth = previousMonthKey(String(monthStartDate(reportDate) || reportDate).slice(0, 7));
    const priorReportDate = priorMonth ? `${priorMonth}-01` : "";
    const [salesmen, snapshots, priorMonthActualsByCode] = await Promise.all([
      loadBossAttachmentByUserId(admin).then((bossByUserId) => attachBossesFromMap(fieldSalesmen, bossByUserId)),
      loadPerformanceSnapshotsForSalesmen(admin, {
        salesmen: salesmanPayload,
        reportDate,
        allowRebuild: false,
      }),
      priorReportDate
        ? loadStoredKpiActualsByCode(admin, priorReportDate)
        : Promise.resolve({}),
    ]);
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

    const salesAsOfDate = String(
      snapshots.find((row) => /^\d{4}-\d{2}-\d{2}$/.test(String(row?.salesAsOfDate || "").slice(0, 10)))?.salesAsOfDate || "",
    ).slice(0, 10);
    const receiptAsOfDate = String(
      snapshots.find((row) => /^\d{4}-\d{2}-\d{2}$/.test(String(row?.receiptAsOfDate || "").slice(0, 10)))?.receiptAsOfDate || "",
    ).slice(0, 10);

    return NextResponse.json({
      success: true,
      month: monthStartDate(reportDate),
      reportDate,
      priorMonth: priorMonth || "",
      priorMonthActualsByCode,
      salesAsOfDate,
      receiptAsOfDate,
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
            newSkusToRepeatCustomers: 0,
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
        new_skus_to_repeat_customers_target: Math.round(targets.newSkusToRepeatCustomers),
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
      rows.map(({ new_skus_to_repeat_customers_target, ...rest }) => rest),
      rows.map(({ collection_target, updated_by, new_skus_to_repeat_customers_target, ...rest }) => rest),
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
      if (
        isMissingColumnError(result.error)
        && String(result.error.message || result.error.details || "").includes("new_skus_to_repeat_customers_target")
      ) {
        throw new Error("Apply supabase/migrations/20261031120000_kpi_targets_new_skus_to_repeat_customers.sql before saving New SKUs to repeat customers targets.");
      }
      throw new Error(
        "Unable to save KPI targets. Apply sql/setup_kpi_targets_collection.sql and the KPI target migrations so all target columns exist.",
      );
    }

    let email = { sentCount: 0, failedCount: 0, skippedCount: 0, results: [] };
    const changedSalesmanRows = changedRows.filter((row) => !isTeamTargetSalesmanCode(row.salesmanCode));
    if (changedSalesmanRows.length) {
      const emailArgs = {
        month: targetMonth.slice(0, 7),
        salesmanCodes: changedSalesmanRows.map((row) => row.salesmanCode),
        changedLabelsBySalesman: Object.fromEntries(changedSalesmanRows.map((row) => [
          row.salesmanCode,
          row.changedKeys.map((key) => PERFORMANCE_KPI_LABELS[key] || key),
        ])),
        trigger: "target_update",
      };
      try {
        if (!isWithinTeamEmailWindow()) {
          await enqueueDeferredTeamEmail(admin, { kind: "kpi_targets", ...emailArgs });
          email = {
            sentCount: 0,
            failedCount: 0,
            skippedCount: changedSalesmanRows.length,
            deferred: true,
            reason: "outside_team_email_window",
            message: teamEmailWindowHoldMessage(),
            results: [],
          };
        } else {
          email = await runKpiTargetsEmailCycle(admin, emailArgs);
        }
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
