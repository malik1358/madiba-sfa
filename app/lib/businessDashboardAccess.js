import { canViewManagementReports, normalizeAccessRole } from "./moduleAccess.js";
import { emptyGrowthFilters, normalizeGrowthFilters } from "./categoryGrowth.js";
import { withSalesScopeMatchers } from "./customerAccess.js";
import {
  buildOutstandingRow,
  resolveOutstandingCustomerOwnership,
  customerMatchesOutstandingCodeSet,
} from "./outstanding.js";
import { summarizeOutstandingRows } from "./businessDashboard.js";
import {
  deriveActivityStatus,
  filterLogsByKsaEventDate,
  logEventIso,
} from "./workdayActivity.js";
import { formatCollectorDisplayName } from "./geo.js";

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

export function canViewBusinessDashboard(profile) {
  const role = normalizeAccessRole(profile?.role);
  return canViewManagementReports(role) || role === "salesman";
}

/** Salesmen (not management-report roles) only see self + team, sales amounts. */
export function isBiTeamScopedViewer(profile) {
  const role = normalizeAccessRole(profile?.role);
  return role === "salesman" && !canViewManagementReports(role);
}

export function canViewBiProfit(profile) {
  return canViewManagementReports(profile?.role);
}

export function buildBiViewerMeta(profile) {
  const scoped = isBiTeamScopedViewer(profile);
  return {
    canViewProfit: canViewBiProfit(profile),
    scoped,
  };
}

/**
 * Force growth filters onto the caller's visible salesman codes.
 * Returns { filters, empty } where empty means the viewer has no codes (show blank report).
 */
export function applyBiSalesmanScope(filters, scope, profile = null) {
  const normalized = normalizeGrowthFilters(filters || emptyGrowthFilters());

  if (profile ? !isBiTeamScopedViewer(profile) : scope?.hasAllAccess) {
    return { filters: normalized, empty: false };
  }

  const visible = [...new Set(
    (scope?.visibleSalesmanCodes || []).map(normalizeCode).filter(Boolean),
  )];

  if (visible.length === 0) {
    return {
      filters: {
        ...normalized,
        values: {
          ...normalized.values,
          salesman_code: ["__no_bi_access__"],
        },
      },
      empty: true,
    };
  }

  const visibleSet = new Set(visible);
  const requested = (normalized.values.salesman_code || [])
    .map(normalizeCode)
    .filter(Boolean);

  if (requested.length > 0) {
    const outOfScope = requested.filter((code) => !visibleSet.has(code));
    if (outOfScope.length > 0) {
      throw new Error("You do not have access to that salesman's data.");
    }
    return {
      filters: {
        ...normalized,
        values: {
          ...normalized.values,
          salesman_code: requested,
        },
      },
      empty: false,
    };
  }

  return {
    filters: {
      ...normalized,
      values: {
        ...normalized.values,
        salesman_code: visible,
      },
    },
    empty: false,
  };
}

export function stripBiProfit(report) {
  if (!report || typeof report !== "object") return report;

  const next = { ...report };
  if (next.measures && typeof next.measures === "object") {
    const { profit: _omit, ...rest } = next.measures;
    next.measures = { ...rest };
    if (rest.sales) {
      next.measures.sales = rest.sales;
    }
  }
  if (String(next.measure || "") === "profit") {
    next.measure = "sales";
  }
  return next;
}

export function filterRowsBySalesmanCodes(rows, salesmanCodes) {
  const allowed = new Set((salesmanCodes || []).map(normalizeCode).filter(Boolean));
  if (allowed.size === 0) return [];
  return (rows || []).filter((row) => allowed.has(normalizeCode(row?.salesman_code)));
}

export function filterRowsByUserIds(rows, userIds, idKey = "user_id") {
  const allowed = new Set((userIds || []).map((id) => String(id || "").trim()).filter(Boolean));
  if (allowed.size === 0) return [];
  return (rows || []).filter((row) => allowed.has(String(row?.[idKey] || "").trim()));
}

export function sumAmountField(rows, field = "sales_amount") {
  return (rows || []).reduce((sum, row) => sum + Number(row?.[field] || 0), 0);
}

/**
 * Keep outstanding customer rows owned by the viewer's team.
 */
export function filterOutstandingForSalesScope(outstanding, scope, { scoped = false } = {}) {
  const uploadedAt = String(outstanding?.uploadedAt || "");
  const fileName = String(outstanding?.fileName || "");
  const allRows = Array.isArray(outstanding?.rows) ? outstanding.rows : [];

  if (!scoped) {
    return {
      uploadedAt,
      fileName,
      rows: allRows,
      summary: outstanding?.summary || summarizeOutstandingRows(allRows),
    };
  }

  const matchedScope = withSalesScopeMatchers(scope);
  const identities = (matchedScope.visibleMembers || []).flatMap((member) => [
    member?.salesman_name,
    member?.salesman_code,
  ].filter(Boolean));

  const dataset = {
    rows: allRows,
    invoices: Array.isArray(outstanding?.invoices) ? outstanding.invoices : undefined,
  };

  const { ownedCustomerCodes } = resolveOutstandingCustomerOwnership(
    dataset,
    identities,
    matchedScope.scopeMatchers,
  );

  const rows = allRows
    .map(buildOutstandingRow)
    .filter((row) => customerMatchesOutstandingCodeSet(row.customer_code, ownedCustomerCodes));

  return {
    uploadedAt,
    fileName,
    rows,
    summary: summarizeOutstandingRows(rows),
  };
}

/**
 * Build attendance KPI inputs for a team from profiles + activity rows (no user-activity API).
 */
export function summarizeTeamAttendance({
  profiles = [],
  logs = [],
  collections = [],
  orders = [],
  reportDate,
  isToday = false,
} = {}) {
  const fieldProfiles = profiles || [];
  const users = fieldProfiles.map((profile) => {
    const userId = profile.id;
    const userLogs = filterLogsByKsaEventDate(
      (logs || []).filter((row) => row.user_id === userId),
      reportDate,
    );
    const userCollections = (collections || []).filter((row) => row.created_by === userId);
    const userOrders = (orders || []).filter((row) => row.created_by === userId);
    const loginLog = userLogs.find((row) => row.entry_type === "MORNING_ATTENDANCE");
    const logoutLog = [...userLogs].reverse().find((row) => row.entry_type === "END_OF_DAY");
    const loginAt = loginLog ? logEventIso(loginLog) : null;
    const logoutAt = logoutLog ? logEventIso(logoutLog) : null;
    const activityStatus = deriveActivityStatus({
      loginAt,
      logoutAt,
      userLogs,
      collections: userCollections,
      orders: userOrders,
      reportDate,
    });
    const displayName = formatCollectorDisplayName(profile)
      || profile.salesman_name
      || profile.email
      || profile.salesman_code
      || "User";

    return {
      userId,
      userName: displayName,
      role: profile.role || "",
      salesmanCode: profile.salesman_code || "",
      activityStatus,
    };
  });

  const notLoggedInUsers = users
    .filter((row) => row.activityStatus === "not_logged_in")
    .map((row) => row.userName);
  const idleUsers = users
    .filter((row) => row.activityStatus === "idle")
    .map((row) => row.userName);
  const loggedInCount = users.filter((row) => row.activityStatus !== "not_logged_in").length;
  const idleNow = isToday ? users.filter((row) => row.activityStatus === "idle").length : 0;
  const activeNow = isToday ? users.filter((row) => row.activityStatus === "active").length : 0;

  return {
    users,
    notLoggedInUsers,
    idleUsers,
    loggedInCount,
    idleNow,
    activeNow,
    fieldHeadcount: fieldProfiles.length,
  };
}

export function emptyCategoryGrowthPayload({ asOfDate = "", filters = null } = {}) {
  const normalized = normalizeGrowthFilters(filters || emptyGrowthFilters());
  return {
    firstDate: "",
    lastDate: "",
    years: [],
    recentMonths: [],
    currentMonth: "",
    recentQuarters: [],
    currentQuarter: "",
    latestCompleteMonth: "",
    latestMonthIsPartial: false,
    lifetimeTotal: 0,
    currentYtd: 0,
    priorYtd: 0,
    yoyPercent: null,
    groups: [],
    categories: [],
    alerts: [],
    measure: "sales",
    filters: normalized,
    catalogs: Object.fromEntries(
      Object.keys(normalized.values || {}).map((key) => [key, []]),
    ),
    measures: {
      sales: {
        firstDate: "",
        lastDate: "",
        years: [],
        recentMonths: [],
        currentMonth: "",
        recentQuarters: [],
        currentQuarter: "",
        latestCompleteMonth: "",
        latestMonthIsPartial: false,
        lifetimeTotal: 0,
        currentYtd: 0,
        priorYtd: 0,
        yoyPercent: null,
        groups: [],
        categories: [],
        alerts: [],
        meta: { filtered: true, emptyScope: true },
      },
    },
    meta: {
      filtered: true,
      emptyScope: true,
      asOfDate,
      groupBy: normalized.groupBy,
    },
  };
}
