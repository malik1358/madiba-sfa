import {
  buildCategoryGrowthReport,
  createCategoryGrowthAccumulator,
  createGrowthCatalogs,
  finalizeGrowthCatalogs,
  hasActiveGrowthFilters,
  ingestCategoryGrowthRows,
  normalizeGrowthFilters,
} from "./categoryGrowth.js";
import { applyCustomerSalesmanOwnershipToRows } from "./customerSalesmanOwnership.js";
import { loadCustomerSalesmanOwnershipMap } from "./customerSalesmanOwnershipServer.js";
import { isMissingSchemaColumn } from "./performanceKpis.js";
import { buildCustomerCohortReport } from "./customerCohorts.js";
import { buildSalesMixReport } from "./salesMix.js";
import { cubeSupportsFilters, monthAlignGrowthFilters, salesBiFactToGrowthRow } from "./salesBiCube.js";
import { loadSalesBiCube, pageActiveSales, rebuildSalesBiCube } from "./salesBiCubeServer.js";
import { rollupTeamGrowthFromRows, rollupTeamGrowthGroups } from "./salesmanTeamMom.js";
import { loadSalesmanTeamMembers } from "./salesmanTeamMomServer.js";

const SALES_SELECTS = [
  "transaction_date,category,sales_amount,profit_amount,quantity,salesman_code,salesman_name,customer_code,customer_name,item_code,item_name,voucher_type,voucher_number,reference,local_import,abc_class",
  "transaction_date,category,sales_amount,quantity,salesman_code,salesman_name,customer_code,customer_name,item_code,item_name,voucher_type,voucher_number,reference,local_import,abc_class",
  "transaction_date,category,sales_amount,quantity,salesman_code,salesman_name,customer_code,customer_name,item_code,item_name,voucher_type,voucher_number,reference",
  "transaction_date,category,sales_amount,salesman_code,salesman_name,customer_code,customer_name,item_code,item_name,voucher_type,voucher_number,reference",
];

function isMissingTableError(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42P01"
    || message.includes("could not find the table")
    || (message.includes("relation") && message.includes("does not exist"));
}

function packReport(acc, { asOfDate, filters, extraMeta = {} }) {
  const report = buildCategoryGrowthReport(acc, { asOfDate });
  return {
    ...report,
    filters,
    catalogs: finalizeGrowthCatalogs(extraMeta.catalogs || createGrowthCatalogs()),
    meta: {
      ...report.meta,
      source: extraMeta.source || "active_sales",
      groupBy: filters.groupBy,
      filtered: extraMeta.filtered === true,
      preparedAt: extraMeta.preparedAt || null,
      stale: extraMeta.stale === true,
      ...extraMeta,
      catalogs: undefined,
    },
  };
}

function measureSlice(report) {
  return {
    firstDate: report.firstDate,
    lastDate: report.lastDate,
    years: report.years,
    recentMonths: report.recentMonths,
    currentMonth: report.currentMonth,
    recentQuarters: report.recentQuarters,
    currentQuarter: report.currentQuarter,
    latestCompleteMonth: report.latestCompleteMonth,
    latestMonthIsPartial: report.latestMonthIsPartial,
    lifetimeTotal: report.lifetimeTotal,
    currentYtd: report.currentYtd,
    priorYtd: report.priorYtd,
    yoyPercent: report.yoyPercent,
    groups: report.groups,
    categories: report.categories,
    teamGroups: report.teamGroups,
    alerts: report.alerts,
    meta: report.meta,
  };
}

function reportFromRows(rows, {
  asOfDate,
  filters,
  extraMeta = {},
  alignDates = false,
  includeCohorts = true,
  includeSalesMix = true,
  includeCatalogs = true,
  catalogMatchedOnly = false,
  includeProfit = true,
} = {}) {
  const applied = alignDates ? monthAlignGrowthFilters(filters) : filters;
  function build(measure) {
    const acc = createCategoryGrowthAccumulator();
    const catalogs = includeCatalogs ? createGrowthCatalogs() : null;
    ingestCategoryGrowthRows(acc, rows, {
      filters: applied,
      catalogs,
      measure,
      catalogMatchedOnly,
    });
    return packReport(acc, {
      asOfDate,
      filters,
      extraMeta: {
        ...extraMeta,
        filtered: extraMeta.filtered === true || hasActiveGrowthFilters(filters) || acc.sourceRowCount !== acc.rowCount,
        catalogs: catalogs || createGrowthCatalogs(),
        measure,
      },
    });
  }
  const sales = build("sales");
  const measures = { sales: measureSlice(sales) };
  if (includeProfit) {
    const profit = build("profit");
    measures.profit = measureSlice(profit);
  }
  return {
    ...sales,
    ...(includeCohorts && filters.groupBy === "customer" ? {
      customerCohorts: buildCustomerCohortReport(rows, { filters: applied, asOfDate }),
      customerMonthlyCohorts: buildCustomerCohortReport(rows, { filters: applied, asOfDate, period: "month" }),
      customerBimonthlyCohorts: buildCustomerCohortReport(rows, { filters: applied, asOfDate, period: "bimonth" }),
    } : {}),
    ...(includeSalesMix ? { salesMix: buildSalesMixReport(rows, applied) } : {}),
    measures,
  };
}

function reportFromFacts(facts, {
  asOfDate,
  filters,
  extraMeta = {},
  ownershipMap = null,
  includeCohorts = true,
  includeSalesMix = true,
  includeCatalogs = true,
  catalogMatchedOnly = false,
  includeProfit = true,
} = {}) {
  const growthRows = applyCustomerSalesmanOwnershipToRows(
    (facts || []).map((fact) => salesBiFactToGrowthRow(fact)),
    ownershipMap,
  );
  return reportFromRows(growthRows, {
    asOfDate,
    filters,
    extraMeta: {
      ...extraMeta,
      source: extraMeta.source || "sales_bi_cube",
    },
    alignDates: true,
    includeCohorts,
    includeSalesMix,
    includeCatalogs,
    catalogMatchedOnly,
    includeProfit,
  });
}

async function reportFromLiveSales(admin, {
  asOfDate,
  filters,
  ownershipMap = null,
  catalogMatchedOnly = false,
  includeProfit = true,
}) {
  let lastError = null;

  for (const select of SALES_SELECTS) {
    try {
      const rows = [];
      await pageActiveSales(admin, select, (page) => {
        rows.push(...applyCustomerSalesmanOwnershipToRows(page || [], ownershipMap));
      });
      return {
        report: reportFromRows(rows, {
          asOfDate,
          filters,
          catalogMatchedOnly,
          includeProfit,
          extraMeta: {
            missingTable: false,
            source: "active_sales",
          },
        }),
        rows,
      };
    } catch (error) {
      lastError = error;
      if (isMissingTableError(error)) {
        return {
          report: packReport(createCategoryGrowthAccumulator(), {
            asOfDate,
            filters,
            extraMeta: { missingTable: true, filtered: false, source: "active_sales" },
          }),
          rows: [],
        };
      }
      if (!isMissingSchemaColumn(error)) throw error;
    }
  }

  if (lastError) throw lastError;
  return {
    report: packReport(createCategoryGrowthAccumulator(), {
      asOfDate,
      filters,
      extraMeta: { missingTable: false, filtered: false, source: "active_sales" },
    }),
    rows: [],
  };
}

function attachSalesmanTeams(report, {
  sourceRows = [],
  members = [],
  filters,
  asOfDate = "",
} = {}) {
  if (!report) return report;
  function attachTeams(target, measure) {
    if (!target) return;
    target.teamGroups = sourceRows.length
      ? rollupTeamGrowthFromRows(sourceRows, members, {
        filters,
        measure,
        report: target,
        asOfDate,
      })
      : rollupTeamGrowthGroups(target.groups || target.categories || [], members, target);
    target.meta = {
      ...target.meta,
      teamCount: target.teamGroups.length,
    };
  }
  attachTeams(report, report.measure || "sales");
  attachTeams(report.measures?.sales, "sales");
  attachTeams(report.measures?.profit, "profit");
  return report;
}

function cubeExtraMeta(cube) {
  return {
    preparedAt: cube.builtAt || null,
    stale: cube.stale === true,
    source: cube.source === "rebuild" ? "sales_bi_cube_rebuild" : "sales_bi_cube",
    cubeFactCount: cube.factCount || cube.facts?.length || 0,
    cubeSourceRows: cube.sourceRowCount || 0,
  };
}

export async function loadCategoryGrowthReport(admin, {
  asOfDate = "",
  filters,
  includeCohorts = true,
  includeSalesMix = true,
  includeCatalogs = true,
  catalogMatchedOnly = false,
  includeProfit = true,
} = {}) {
  const normalized = normalizeGrowthFilters(filters);
  let report;
  let sourceRows = [];
  const ownershipMap = await loadCustomerSalesmanOwnershipMap(admin).catch((error) => {
    console.error("Customer salesman ownership unavailable for category growth:", error);
    return new Map();
  });

  if (cubeSupportsFilters(normalized)) {
    try {
      const cube = await loadSalesBiCube(admin, { allowStale: true });
      if (cube?.missingTable) {
        report = packReport(createCategoryGrowthAccumulator(), {
          asOfDate,
          filters: normalized,
          extraMeta: { missingTable: true, filtered: false, source: "sales_bi_cube" },
        });
      } else if (cube?.facts) {
        sourceRows = applyCustomerSalesmanOwnershipToRows(
          (cube.facts || []).map((fact) => salesBiFactToGrowthRow(fact)),
          ownershipMap,
        );
        report = reportFromFacts(cube.facts, {
          asOfDate,
          filters: normalized,
          ownershipMap,
          includeCohorts,
          includeSalesMix,
          includeCatalogs,
          catalogMatchedOnly,
          includeProfit,
          extraMeta: cubeExtraMeta(cube),
        });
      }
    } catch (error) {
      console.error("Prepared sales cube unavailable, scanning live sales:", error);
    }
  }

  if (!report) {
    const live = await reportFromLiveSales(admin, {
      asOfDate,
      filters: normalized,
      ownershipMap,
      catalogMatchedOnly,
      includeProfit,
    });
    report = live.report;
    sourceRows = live.rows || [];
  }

  // BI customer history must stay complete — do not hide overdue/legal-transfer accounts.

  if (normalized.groupBy === "salesman") {
    try {
      const members = await loadSalesmanTeamMembers(admin);
      attachSalesmanTeams(report, {
        sourceRows,
        members,
        filters: normalized,
        asOfDate,
      });
    } catch (error) {
      console.error("Team month-on-month grouping failed:", error);
    }
  }

  return report;
}

export async function loadBiOverviewBundle(admin, {
  asOfDate = "",
  filters = {},
  catalogMatchedOnly = false,
  includeProfit = true,
} = {}) {
  const base = normalizeGrowthFilters(filters);
  const ownershipMap = await loadCustomerSalesmanOwnershipMap(admin).catch((error) => {
    console.error("Customer salesman ownership unavailable for BI overview:", error);
    return new Map();
  });

  let sourceRows = [];
  let cubeMeta = { source: "active_sales", preparedAt: null, stale: false };
  let buildFromRows = null;

  if (cubeSupportsFilters(base)) {
    try {
      const cube = await loadSalesBiCube(admin, { allowStale: true });
      if (cube?.missingTable) {
        const empty = packReport(createCategoryGrowthAccumulator(), {
          asOfDate,
          filters: base,
          extraMeta: { missingTable: true, filtered: false, source: "sales_bi_cube" },
        });
        return {
          growth: empty,
          customer: empty,
          item: empty,
          salesman: empty,
          catalogs: finalizeGrowthCatalogs(createGrowthCatalogs()),
          meta: { missingTable: true, source: "sales_bi_cube", preparedAt: null, stale: false },
        };
      }
      if (cube?.facts) {
        sourceRows = applyCustomerSalesmanOwnershipToRows(
          (cube.facts || []).map((fact) => salesBiFactToGrowthRow(fact)),
          ownershipMap,
        );
        cubeMeta = cubeExtraMeta(cube);
        buildFromRows = (groupBy, options = {}) => reportFromRows(sourceRows, {
          asOfDate,
          filters: normalizeGrowthFilters({ ...base, groupBy }),
          extraMeta: cubeMeta,
          alignDates: true,
          includeCohorts: false,
          includeSalesMix: groupBy === "category",
          includeCatalogs: groupBy === "category",
          catalogMatchedOnly,
          includeProfit,
          ...options,
        });
      }
    } catch (error) {
      console.error("Prepared sales cube unavailable for BI overview, scanning live sales:", error);
    }
  }

  if (!buildFromRows) {
    const live = await reportFromLiveSales(admin, {
      asOfDate,
      filters: normalizeGrowthFilters({ ...base, groupBy: "category" }),
      ownershipMap,
      catalogMatchedOnly,
      includeProfit,
    });
    sourceRows = live.rows || [];
    cubeMeta = { source: "active_sales", preparedAt: null, stale: false };
    buildFromRows = (groupBy, options = {}) => reportFromRows(sourceRows, {
      asOfDate,
      filters: normalizeGrowthFilters({ ...base, groupBy }),
      extraMeta: cubeMeta,
      includeCohorts: false,
      includeSalesMix: groupBy === "category",
      includeCatalogs: groupBy === "category",
      catalogMatchedOnly,
      includeProfit,
      ...options,
    });
  }

  const growth = buildFromRows("category");
  const customer = buildFromRows("customer");
  const item = buildFromRows("item");
  const salesman = buildFromRows("salesman");

  try {
    const members = await loadSalesmanTeamMembers(admin);
    attachSalesmanTeams(salesman, {
      sourceRows,
      members,
      filters: normalizeGrowthFilters({ ...base, groupBy: "salesman" }),
      asOfDate,
    });
  } catch (error) {
    console.error("Team month-on-month grouping failed for BI overview:", error);
  }

  return {
    growth,
    customer,
    item,
    salesman,
    catalogs: growth.catalogs || finalizeGrowthCatalogs(createGrowthCatalogs()),
    meta: {
      source: cubeMeta.source,
      preparedAt: cubeMeta.preparedAt,
      stale: cubeMeta.stale === true,
      cubeFactCount: cubeMeta.cubeFactCount || 0,
      cubeSourceRows: cubeMeta.cubeSourceRows || 0,
    },
  };
}

export { rebuildSalesBiCube };
