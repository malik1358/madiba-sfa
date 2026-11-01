import {
  attachAvgPayingDaysToGrowthReport,
  buildCategoryGrowthReport,
  createCategoryGrowthAccumulator,
  createGrowthCatalogs,
  finalizeGrowthCatalogs,
  hasActiveGrowthFilters,
  ingestCategoryGrowthRows,
  normalizeGrowthFilters,
} from "./categoryGrowth.js";
import { customerAvgPayingDaysFromOutstandingDataset } from "./biAvgPayingDays.js";
import { readOutstandingDataset } from "./customerMasterQuery.js";
import {
  BI_OVERVIEW_BUNDLE_KEY,
  canServePreparedOverviewSlice,
  deserializePreparedOverviewBundle,
  isPreparedOverviewFilters,
  pickPreparedOverviewSlice,
  preparedOverviewBundleIsFresh,
  preparedOverviewFingerprint,
  serializePreparedOverviewBundle,
} from "./biPreparedBundle.js";
import { applyCustomerSalesmanOwnershipToRows } from "./customerSalesmanOwnership.js";
import { loadCustomerSalesmanOwnershipMap } from "./customerSalesmanOwnershipServer.js";
import { isMissingSchemaColumn } from "./performanceKpis.js";
import { buildCustomerCohortReport } from "./customerCohorts.js";
import { buildSalesMixReport } from "./salesMix.js";
import { cubeSupportsFilters, monthAlignGrowthFilters, salesBiFactToGrowthRow } from "./salesBiCube.js";
import { loadSalesBiCube, pageActiveSales, rebuildSalesBiCube } from "./salesBiCubeServer.js";
import { rollupTeamGrowthFromRows, rollupTeamGrowthGroups } from "./salesmanTeamMom.js";
import { loadSalesmanTeamMembers } from "./salesmanTeamMomServer.js";
import { getKsaDateString } from "./workdayActivity.js";

const MAX_PREPARED_BUNDLE_CHARS = 3500000;
let memoryPreparedOverview = null;

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

  // Default all-time (and MADIBA) tabs open from the prepared overview bundle —
  // avoid reloading/re-aggregating the full sales cube on every tab.
  // Salesman-scoped calls (catalogMatchedOnly / no profit) must not reuse the company bundle.
  if (
    canServePreparedOverviewSlice(normalized)
    && catalogMatchedOnly !== true
    && includeProfit !== false
  ) {
    try {
      const bundle = await loadBiOverviewBundle(admin, {
        asOfDate,
        filters: {},
        catalogMatchedOnly,
        includeProfit,
      });
      const slice = pickPreparedOverviewSlice(bundle, normalized);
      if (slice && (Array.isArray(slice.groups) || Array.isArray(slice.categories))) {
        return {
          ...slice,
          filters: normalized,
          catalogs: includeCatalogs
            ? (bundle.catalogs || slice.catalogs || finalizeGrowthCatalogs(createGrowthCatalogs()))
            : finalizeGrowthCatalogs(createGrowthCatalogs()),
          meta: {
            ...slice.meta,
            source: bundle.meta?.source || slice.meta?.source || "bi_overview_bundle",
            preparedAt: bundle.meta?.preparedAt || slice.meta?.preparedAt || null,
            stale: bundle.meta?.stale === true || slice.meta?.stale === true,
            servedFromPrepared: bundle.meta?.servedFromPrepared === true,
            groupBy: normalized.groupBy,
            filtered: false,
          },
        };
      }
    } catch (error) {
      console.error("Prepared BI overview slice unavailable, falling back to cube:", error);
    }
  }

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

  try {
    if (sourceRows.length) {
      const outstanding = await readOutstandingDataset(admin);
      const customerDays = customerAvgPayingDaysFromOutstandingDataset(outstanding);
      report = attachAvgPayingDaysToGrowthReport(report, sourceRows, customerDays);
    }
  } catch (error) {
    console.error("Avg paying days enrichment failed for category growth:", error);
  }

  return report;
}

async function activeSalesBatchId(admin) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", "active_sales_batch_id")
    .maybeSingle();
  if (error && !isMissingTableError(error)) throw error;
  return String(data?.setting_value || "").trim();
}

async function readPreparedOverviewBundle(admin) {
  if (memoryPreparedOverview?.bundle) return memoryPreparedOverview;
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", BI_OVERVIEW_BUNDLE_KEY)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  if (!data?.setting_value) return null;
  try {
    const prepared = deserializePreparedOverviewBundle(JSON.parse(String(data.setting_value)));
    if (prepared) memoryPreparedOverview = prepared;
    return prepared;
  } catch {
    return null;
  }
}

async function writePreparedOverviewBundle(admin, prepared) {
  const payload = JSON.stringify(prepared);
  if (payload.length > MAX_PREPARED_BUNDLE_CHARS) {
    console.error("Prepared BI overview bundle exceeds settings size limit:", payload.length);
    memoryPreparedOverview = prepared;
    return false;
  }
  const { error } = await admin.from("system_settings").upsert({
    setting_key: BI_OVERVIEW_BUNDLE_KEY,
    setting_value: payload,
  }, { onConflict: "setting_key" });
  if (error) {
    if (isMissingTableError(error) || isMissingSchemaColumn(error)) {
      memoryPreparedOverview = prepared;
      return false;
    }
    throw error;
  }
  memoryPreparedOverview = prepared;
  return true;
}

export function clearPreparedBiOverviewMemory() {
  memoryPreparedOverview = null;
}

async function computeBiOverviewBundle(admin, {
  asOfDate = "",
  filters = {},
  cube = null,
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
  let loadedCube = cube;

  if (cubeSupportsFilters(base)) {
    try {
      if (!loadedCube) loadedCube = await loadSalesBiCube(admin, { allowStale: true });
      if (loadedCube?.missingTable) {
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
      if (loadedCube?.facts) {
        sourceRows = applyCustomerSalesmanOwnershipToRows(
          (loadedCube.facts || []).map((fact) => salesBiFactToGrowthRow(fact)),
          ownershipMap,
        );
        cubeMeta = cubeExtraMeta(loadedCube);
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
  // Customer cohorts are prepared with the default all-time bundle so the Customer growth tab opens without a second scan.
  const customer = reportFromRows(sourceRows, {
    asOfDate,
    filters: normalizeGrowthFilters({ ...base, groupBy: "customer" }),
    extraMeta: cubeMeta,
    alignDates: Boolean(loadedCube?.facts),
    includeCohorts: true,
    includeSalesMix: false,
    includeCatalogs: false,
  });
  const item = buildFromRows("item");
  const salesman = buildFromRows("salesman");
  const madiba = reportFromRows(sourceRows, {
    asOfDate,
    filters: normalizeGrowthFilters({ ...base, groupBy: "category", itemNameContains: "MADIBA" }),
    extraMeta: { ...cubeMeta, brand: "MADIBA" },
    alignDates: Boolean(loadedCube?.facts),
    includeCohorts: false,
    includeSalesMix: false,
    includeCatalogs: false,
  });

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

  let growthWithDays = growth;
  let customerWithDays = customer;
  let itemWithDays = item;
  let salesmanWithDays = salesman;
  let madibaWithDays = madiba;
  try {
    if (sourceRows.length) {
      const outstanding = await readOutstandingDataset(admin);
      const customerDays = customerAvgPayingDaysFromOutstandingDataset(outstanding);
      growthWithDays = attachAvgPayingDaysToGrowthReport(growth, sourceRows, customerDays);
      customerWithDays = attachAvgPayingDaysToGrowthReport(customer, sourceRows, customerDays);
      itemWithDays = attachAvgPayingDaysToGrowthReport(item, sourceRows, customerDays);
      salesmanWithDays = attachAvgPayingDaysToGrowthReport(salesman, sourceRows, customerDays);
      madibaWithDays = attachAvgPayingDaysToGrowthReport(madiba, sourceRows, customerDays);
    }
  } catch (error) {
    console.error("Avg paying days enrichment failed for BI overview:", error);
  }

  return {
    growth: growthWithDays,
    customer: customerWithDays,
    item: itemWithDays,
    salesman: salesmanWithDays,
    madiba: madibaWithDays,
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

export async function rebuildPreparedBiOverviewBundle(admin, {
  asOfDate = "",
  cube = null,
} = {}) {
  const asOf = String(asOfDate || getKsaDateString()).slice(0, 10);
  const filters = normalizeGrowthFilters({});
  const bundle = await computeBiOverviewBundle(admin, { asOfDate: asOf, filters, cube });
  const batchId = String(cube?.batchId || await activeSalesBatchId(admin) || "");
  const prepared = serializePreparedOverviewBundle(bundle, {
    batchId,
    builtAt: new Date().toISOString(),
    asOfDate: asOf,
    cubeBuiltAt: String(cube?.builtAt || bundle?.meta?.preparedAt || ""),
    fingerprint: preparedOverviewFingerprint(filters),
  });
  prepared.bundle = {
    ...prepared.bundle,
    meta: {
      ...prepared.bundle.meta,
      source: "bi_overview_bundle",
      preparedAt: prepared.builtAt,
      stale: false,
      servedFromPrepared: true,
    },
  };
  await writePreparedOverviewBundle(admin, prepared);
  return prepared;
}

export async function loadBiOverviewBundle(admin, {
  asOfDate = "",
  filters = {},
  catalogMatchedOnly = false,
  includeProfit = true,
} = {}) {
  const base = normalizeGrowthFilters(filters);
  const fingerprint = preparedOverviewFingerprint(base);
  // Company-wide prepared bundle is for management all-time only (profit included, full catalogs).
  const canUsePrepared = isPreparedOverviewFilters(base)
    && catalogMatchedOnly !== true
    && includeProfit !== false;

  if (canUsePrepared) {
    try {
      const [batchId, prepared] = await Promise.all([
        activeSalesBatchId(admin),
        readPreparedOverviewBundle(admin),
      ]);
      // Batch id is enough: sales import rebuilds cube + this bundle together.
      if (preparedOverviewBundleIsFresh(prepared, { batchId, fingerprint })) {
        return {
          ...prepared.bundle,
          meta: {
            ...prepared.bundle.meta,
            source: "bi_overview_bundle",
            preparedAt: prepared.builtAt || prepared.bundle?.meta?.preparedAt || null,
            stale: false,
            servedFromPrepared: true,
            asOfDate: prepared.asOfDate || asOfDate || null,
          },
        };
      }
    } catch (error) {
      console.error("Prepared BI overview unavailable, computing from cube:", error);
    }
  }

  const bundle = await computeBiOverviewBundle(admin, {
    asOfDate,
    filters: base,
    catalogMatchedOnly,
    includeProfit,
  });
  if (canUsePrepared && !bundle?.meta?.missingTable) {
    try {
      const batchId = await activeSalesBatchId(admin);
      const prepared = serializePreparedOverviewBundle(bundle, {
        batchId,
        builtAt: new Date().toISOString(),
        asOfDate: String(asOfDate || getKsaDateString()).slice(0, 10),
        cubeBuiltAt: String(bundle?.meta?.preparedAt || ""),
        fingerprint,
      });
      prepared.bundle = {
        ...prepared.bundle,
        meta: {
          ...prepared.bundle.meta,
          source: "bi_overview_bundle",
          preparedAt: prepared.builtAt,
          servedFromPrepared: true,
        },
      };
      await writePreparedOverviewBundle(admin, prepared);
      return {
        ...prepared.bundle,
        meta: {
          ...prepared.bundle.meta,
          servedFromPrepared: false,
          preparedNow: true,
        },
      };
    } catch (error) {
      console.error("Saving prepared BI overview after compute failed:", error);
    }
  }
  return bundle;
}

export { rebuildSalesBiCube };
