import {
  buildCategoryGrowthReport,
  createCategoryGrowthAccumulator,
  createGrowthCatalogs,
  finalizeGrowthCatalogs,
  hasActiveGrowthFilters,
  ingestCategoryGrowthRows,
  normalizeGrowthFilters,
} from "./categoryGrowth.js";
import { isMissingSchemaColumn } from "./performanceKpis.js";
import { cubeSupportsFilters, monthAlignGrowthFilters, salesBiFactToGrowthRow } from "./salesBiCube.js";
import { loadSalesBiCube, pageActiveSales, rebuildSalesBiCube } from "./salesBiCubeServer.js";
import { rollupTeamGrowthGroups } from "./salesmanTeamMom.js";
import { loadSalesmanTeamMembers } from "./salesmanTeamMomServer.js";

const SALES_SELECTS = [
  "transaction_date,category,sales_amount,profit_amount,quantity,salesman_code,salesman_name,customer_code,customer_name,item_code,item_name,voucher_type,voucher_number,reference,local_import,abc_class",
  "transaction_date,category,sales_amount,quantity,salesman_code,salesman_name,customer_code,customer_name,item_code,item_name,voucher_type,voucher_number,reference,local_import,abc_class",
  "transaction_date,category,sales_amount,quantity,salesman_code,salesman_name,customer_code,customer_name,item_code,item_name,voucher_type,voucher_number,reference",
  "transaction_date,category,sales_amount,salesman_code,salesman_name,customer_code,customer_name,item_code,item_name,voucher_type",
  "transaction_date,category,sales_amount,salesman_code,salesman_name,customer_code,customer_name,item_code,item_name",
  "transaction_date,category,sales_amount",
  "transaction_date,sales_amount",
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

function reportFromRows(rows, { asOfDate, filters, extraMeta = {}, alignDates = false }) {
  const applied = alignDates ? monthAlignGrowthFilters(filters) : filters;
  function build(measure) {
    const acc = createCategoryGrowthAccumulator();
    const catalogs = createGrowthCatalogs();
    ingestCategoryGrowthRows(acc, rows, { filters: applied, catalogs, measure });
    return packReport(acc, {
      asOfDate,
      filters,
      extraMeta: {
        ...extraMeta,
        filtered: extraMeta.filtered === true || hasActiveGrowthFilters(filters) || acc.sourceRowCount !== acc.rowCount,
        catalogs,
        measure,
      },
    });
  }
  const sales = build("sales");
  const profit = build("profit");
  return {
    ...sales,
    measures: {
      sales: measureSlice(sales),
      profit: measureSlice(profit),
    },
  };
}

function reportFromFacts(facts, { asOfDate, filters, extraMeta = {} }) {
  return reportFromRows((facts || []).map((fact) => salesBiFactToGrowthRow(fact)), {
    asOfDate,
    filters,
    extraMeta: {
      ...extraMeta,
      source: extraMeta.source || "sales_bi_cube",
    },
    alignDates: true,
  });
}

async function reportFromLiveSales(admin, { asOfDate, filters }) {
  let lastError = null;

  for (const select of SALES_SELECTS) {
    try {
      const rows = [];
      await pageActiveSales(admin, select, (page) => {
        rows.push(...(page || []));
      });
      return reportFromRows(rows, {
        asOfDate,
        filters,
        extraMeta: {
          missingTable: false,
          source: "active_sales",
        },
      });
    } catch (error) {
      lastError = error;
      if (isMissingTableError(error)) {
        return packReport(createCategoryGrowthAccumulator(), {
          asOfDate,
          filters,
          extraMeta: { missingTable: true, filtered: false, source: "active_sales" },
        });
      }
      if (!isMissingSchemaColumn(error)) throw error;
    }
  }

  if (lastError) throw lastError;
  return packReport(createCategoryGrowthAccumulator(), {
    asOfDate,
    filters,
    extraMeta: { missingTable: false, filtered: false, source: "active_sales" },
  });
}

export async function loadCategoryGrowthReport(admin, { asOfDate = "", filters } = {}) {
  const normalized = normalizeGrowthFilters(filters);
  let report;

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
        report = reportFromFacts(cube.facts, {
          asOfDate,
          filters: normalized,
          extraMeta: {
            preparedAt: cube.builtAt || null,
            stale: cube.stale === true,
            source: cube.source === "rebuild" ? "sales_bi_cube_rebuild" : "sales_bi_cube",
            cubeFactCount: cube.factCount || cube.facts.length,
            cubeSourceRows: cube.sourceRowCount || 0,
          },
        });
      }
    } catch (error) {
      console.error("Prepared sales cube unavailable, scanning live sales:", error);
    }
  }

  if (!report) {
    report = await reportFromLiveSales(admin, { asOfDate, filters: normalized });
  }

  if (normalized.groupBy === "salesman") {
    try {
      const members = await loadSalesmanTeamMembers(admin);
      function attachTeams(target) {
        if (!target) return;
        target.teamGroups = rollupTeamGrowthGroups(target.groups || target.categories || [], members, target);
        target.meta = {
          ...target.meta,
          teamCount: target.teamGroups.length,
        };
      }
      attachTeams(report);
      attachTeams(report.measures?.sales);
      attachTeams(report.measures?.profit);
    } catch (error) {
      console.error("Team month-on-month grouping failed:", error);
    }
  }

  return report;
}

export { rebuildSalesBiCube };
