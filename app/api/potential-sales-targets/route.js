import { createClient } from "@supabase/supabase-js";
import { canViewManagementReports, isCollectionOnlyAccess } from "../../lib/moduleAccess.js";
import {
  isPotentialSalesTarget,
  potentialSalesTargetMatchesSalesman,
  potentialSalesTargetMonthKeys,
  potentialSalesTargetSalesmanCode,
  potentialSalesTargetVisitedWithinDays,
} from "../../lib/potentialSalesTargets.js";
import { loadPotentialSalesTargetCustomers } from "../../lib/potentialSalesTargetsServer.js";
import { getKsaDateString } from "../../lib/workdayActivity.js";

export const maxDuration = 120;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PAGE_SIZE = 1000;

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function comparableName(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function targetMatchesAllowedSalesmen(row, codes, names) {
  const rowCodes = [row.salesman_code, row.current_salesman_code, row.previous_salesman_code].map(normalizeCode);
  if (rowCodes.some((code) => code && codes.has(code))) return true;
  const rowNames = [row.salesman_name, row.outstanding_salesman].map(comparableName);
  return rowNames.some((name) => name && names.has(name));
}

async function loadAllProfiles(admin) {
  const profiles = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await admin.from("profiles")
      .select("id,role,salesman_code,salesman_name,is_active")
      .order("salesman_name")
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    profiles.push(...(data || []));
    if ((data || []).length < PAGE_SIZE) break;
  }
  return profiles;
}

function salesmanOptionsForTargets(rows, profiles, allowedCodes, allSalesmen) {
  const profileByCode = new Map((profiles || []).map((profile) => [normalizeCode(profile.salesman_code), profile]));
  const codes = new Set();
  if (!allSalesmen) (allowedCodes || []).forEach((code) => codes.add(normalizeCode(code)));
  (rows || []).forEach((row) => {
    [row.salesman_code, row.current_salesman_code, row.previous_salesman_code].forEach((code) => {
      const normalized = normalizeCode(code);
      if (normalized) codes.add(normalized);
    });
  });
  return [...codes]
    .filter(Boolean)
    .map((code) => ({
      code,
      name: String(profileByCode.get(code)?.salesman_name || code).trim(),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return Response.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const authorization = request.headers.get("authorization") || "";
    if (!authorization.startsWith("Bearer ")) {
      return Response.json({ success: false, error: "Not authenticated." }, { status: 401 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await admin.auth.getUser(authorization.slice(7));
    if (authError || !user) {
      return Response.json({ success: false, error: "Invalid login session." }, { status: 401 });
    }

    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("id,role,salesman_code,salesman_name")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile) return Response.json({ success: false, error: "No profile found." }, { status: 403 });

    const role = String(profile.role || "").trim().toLowerCase().replace(/_/g, "-");
    if (isCollectionOnlyAccess({
      role,
      salesmanCode: profile.salesman_code,
      collectionOnlyMetadata: Boolean(user.user_metadata?.collection_only),
    }) || (!canViewManagementReports(role) && role !== "salesman")) {
      return Response.json({ success: false, error: "You do not have access to Potential Sales Targets." }, { status: 403 });
    }

    const managementAccess = canViewManagementReports(role);
    const { getSalesScope, fetchOutstandingAndCollectionRecords } = await import("../payment-collections/route.js");
    const scope = managementAccess
      ? {
        hasAllAccess: true,
        visibleSalesmanCodes: [],
        scopeProfiles: [],
        userRole: role,
        userId: null,
        canSeeAllSchedulers: true,
        visibleSchedulerUserIds: null,
      }
      : await getSalesScope(admin, user.id);
    const [allProfiles, records] = await Promise.all([
      loadAllProfiles(admin),
      fetchOutstandingAndCollectionRecords(admin, scope),
    ]);

    const allowedProfiles = managementAccess
      ? allProfiles
      : [
        profile,
        ...(scope.scopeProfiles || []),
        ...(allProfiles || []).filter((entry) => (scope.visibleSalesmanCodes || [])
          .some((code) => normalizeCode(code) === normalizeCode(entry.salesman_code))),
      ];
    const allowedCodes = new Set(allowedProfiles.map((entry) => normalizeCode(entry.salesman_code)).filter(Boolean));
    const allowedNames = new Set(allowedProfiles.map((entry) => comparableName(entry.salesman_name)).filter(Boolean));
    const scopedRecords = managementAccess
      ? records
      : records.filter((row) => targetMatchesAllowedSalesmen(row, allowedCodes, allowedNames));

    const todayKey = getKsaDateString();
    const targets = await loadPotentialSalesTargetCustomers(admin, {
      records: scopedRecords,
      todayKey,
      includeBrowserDetails: true,
      profiles: allowedProfiles,
    });
    const eligibleTargets = targets
      .filter((row) => isPotentialSalesTarget(row, { todayKey }))
      .filter((row) => !potentialSalesTargetVisitedWithinDays(row, { todayKey, days: 8 }));
    const allowedCodeArray = managementAccess ? null : [...allowedCodes];
    const salesmanOptions = salesmanOptionsForTargets(
      eligibleTargets,
      allProfiles,
      allowedCodeArray,
      managementAccess,
    );
    const params = new URL(request.url).searchParams;
    const requestedSalesmanCode = normalizeCode(params.get("salesmanCode"));
    const selectedSalesmanCode = requestedSalesmanCode || (managementAccess ? "" : normalizeCode(profile.salesman_code));
    if (selectedSalesmanCode && !salesmanOptions.some((entry) => entry.code === selectedSalesmanCode)) {
      return Response.json({ success: false, error: "You do not have access to this salesman's targets." }, { status: 403 });
    }

    const profileByCode = new Map(allProfiles.map((entry) => [normalizeCode(entry.salesman_code), entry]));
    const filteredTargets = eligibleTargets
      .filter((row) => potentialSalesTargetMatchesSalesman(row, selectedSalesmanCode))
      .map((row) => {
        const salesmanCode = selectedSalesmanCode || potentialSalesTargetSalesmanCode(row);
        const salesman = profileByCode.get(normalizeCode(salesmanCode));
        return {
          ...row,
          salesman_code: salesmanCode,
          salesman_name: String(salesman?.salesman_name || row.salesman_name || salesmanCode || "").trim(),
          last_visit_date_by_salesman: row.last_visit_by_salesman?.[normalizeCode(salesmanCode)] || "",
        };
      });
    const monthKeys = potentialSalesTargetMonthKeys(todayKey);
    const monthlyTotals = Object.fromEntries(monthKeys.map((month) => [
      month,
      filteredTargets.reduce((sum, row) => sum + Number(row.sales_by_month?.[month] || 0), 0),
    ]));

    return Response.json({
      success: true,
      asOfDate: todayKey,
      canViewAllSalesmen: managementAccess,
      salesmanOptions,
      selectedSalesmanCode,
      showSalesmanColumn: managementAccess && !selectedSalesmanCode,
      monthKeys,
      rows: filteredTargets,
      summary: {
        customerCount: filteredTargets.length,
        totalOutstanding: filteredTargets.reduce((sum, row) => sum + Number(row.total_outstanding || 0), 0),
        monthlySales: monthlyTotals,
      },
    });
  } catch (error) {
    console.error("Error loading potential sales targets:", error);
    return Response.json({ success: false, error: error.message || "Unable to load potential sales targets." }, { status: 500 });
  }
}
