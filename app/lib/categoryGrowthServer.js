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

async function ingestPagedSales(admin, select, acc, options) {
  await pageActiveSales(admin, select, (rows) => {
    ingestCategoryGrowthRows(acc, rows || [], options);
  });
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

function reportFromFacts(facts, { asOfDate, filters, extraMeta = {} }) {
  const aligned = monthAlignGrowthFilters(filters);
  const acc = createCategoryGrowthAccumulator();
  const catalogs = createGrowthCatalogs();
  ingestCategoryGrowthRows(acc, (facts || []).map(salesBiFactToGrowthRow), {
    filters: aligned,
    catalogs,
  });
  return packReport(acc, {
    asOfDate,
    filters,
    extraMeta: {
      ...extraMeta,
      source: extraMeta.source || "sales_bi_cube",
      filtered: hasActiveGrowthFilters(filters) || acc.sourceRowCount !== acc.rowCount,
      catalogs,
    },
  });
}

async function reportFromLiveSales(admin, { asOfDate, filters }) {
  let lastError = null;

  for (const select of SALES_SELECTS) {
    const acc = createCategoryGrowthAccumulator();
    const catalogs = createGrowthCatalogs();
    try {
      await ingestPagedSales(admin, select, acc, { filters, catalogs });
      return packReport(acc, {
        asOfDate,
        filters,
        extraMeta: {
          missingTable: false,
          filtered: acc.sourceRowCount !== acc.rowCount,
          catalogs,
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
      report.teamGroups = rollupTeamGrowthGroups(report.groups || report.categories || [], members, report);
      report.meta = {
        ...report.meta,
        teamCount: report.teamGroups.length,
      };
    } catch (error) {
      console.error("Team month-on-month grouping failed:", error);
    }
  }

  return report;
}

export { rebuildSalesBiCube };
