import {
  buildCategoryGrowthReport,
  createCategoryGrowthAccumulator,
  createGrowthCatalogs,
  finalizeGrowthCatalogs,
  ingestCategoryGrowthRows,
  normalizeGrowthFilters,
} from "./categoryGrowth.js";
import { isMissingSchemaColumn } from "./performanceKpis.js";

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
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await admin
      .from("active_sales")
      .select(select)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    ingestCategoryGrowthRows(acc, data || [], options);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
}

function packReport(acc, { asOfDate, filters, extraMeta = {} }) {
  const report = buildCategoryGrowthReport(acc, { asOfDate });
  return {
    ...report,
    filters,
    catalogs: finalizeGrowthCatalogs(extraMeta.catalogs || createGrowthCatalogs()),
    meta: {
      ...report.meta,
      source: "active_sales",
      groupBy: filters.groupBy,
      filtered: extraMeta.filtered === true,
      ...extraMeta,
      catalogs: undefined,
    },
  };
}

export async function loadCategoryGrowthReport(admin, { asOfDate = "", filters } = {}) {
  const normalized = normalizeGrowthFilters(filters);

  let lastError = null;

  for (const select of SALES_SELECTS) {
    const acc = createCategoryGrowthAccumulator();
    const catalogs = createGrowthCatalogs();
    try {
      await ingestPagedSales(admin, select, acc, { filters: normalized, catalogs });
      return packReport(acc, {
        asOfDate,
        filters: normalized,
        extraMeta: {
          missingTable: false,
          filtered: acc.sourceRowCount !== acc.rowCount,
          catalogs,
        },
      });
    } catch (error) {
      lastError = error;
      if (isMissingTableError(error)) {
        return packReport(createCategoryGrowthAccumulator(), {
          asOfDate,
          filters: normalized,
          extraMeta: { missingTable: true, filtered: false },
        });
      }
      if (!isMissingSchemaColumn(error)) throw error;
    }
  }

  if (lastError) throw lastError;
  return packReport(createCategoryGrowthAccumulator(), {
    asOfDate,
    filters: normalized,
    extraMeta: { missingTable: false, filtered: false },
  });
}
