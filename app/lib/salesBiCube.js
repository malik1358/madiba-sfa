import {
  monthKeyFromDateKey,
  normalizeCategoryName,
  salesDateKey,
} from "./categoryGrowth.js";

export const SALES_BI_CUBE_KEY = "sales_bi_cube_v1";
export const SALES_BI_CUBE_VERSION = 2;
export const SALES_BI_TABLE = "sales_bi_monthly";

const CUBE_DIMENSION_FIELDS = [
  "category",
  "salesman_code",
  "salesman_name",
  "customer_code",
  "customer_name",
  "item_code",
  "item_name",
  "voucher_type",
  "local_import",
  "abc_class",
];

function dim(value) {
  return String(value ?? "").trim();
}

export function cubeMonthFromDate(value) {
  return monthKeyFromDateKey(salesDateKey(value));
}

export function createSalesBiCube() {
  return {
    facts: new Map(),
    sourceRowCount: 0,
  };
}

export function cubeFactKey(fact) {
  return [
    fact.month,
    fact.category,
    fact.salesman_code,
    fact.customer_code,
    fact.item_code,
    fact.voucher_type,
    fact.local_import,
    fact.abc_class,
  ].join("\t");
}

export function ingestSalesRowsIntoCube(cube, rows = []) {
  (rows || []).forEach((row) => {
    const month = cubeMonthFromDate(row.transaction_date);
    if (!month) return;
    const amount = Number(row.sales_amount || 0);
    const quantity = Number(row.quantity || 0);
    if (!Number.isFinite(amount) && !Number.isFinite(quantity)) return;

    cube.sourceRowCount += 1;
    const fact = {
      month,
      category: normalizeCategoryName(row.category),
      salesman_code: dim(row.salesman_code),
      salesman_name: dim(row.salesman_name),
      customer_code: dim(row.customer_code),
      customer_name: dim(row.customer_name),
      item_code: dim(row.item_code),
      item_name: dim(row.item_name),
      voucher_type: dim(row.voucher_type),
      local_import: dim(row.local_import),
      abc_class: dim(row.abc_class),
      sales_amount: Number.isFinite(amount) ? amount : 0,
      quantity: Number.isFinite(quantity) ? quantity : 0,
    };
    const key = cubeFactKey(fact);
    const existing = cube.facts.get(key);
    if (!existing) {
      cube.facts.set(key, { ...fact, line_count: 1 });
      return;
    }
    existing.sales_amount += fact.sales_amount;
    existing.quantity += fact.quantity;
    existing.line_count += 1;
    if (!existing.salesman_name && fact.salesman_name) existing.salesman_name = fact.salesman_name;
    if (!existing.customer_name && fact.customer_name) existing.customer_name = fact.customer_name;
    if (!existing.item_name && fact.item_name) existing.item_name = fact.item_name;
  });
  return cube;
}

export function salesBiFactsFromCube(cube) {
  return [...(cube?.facts?.values() || [])];
}

export function salesBiFactToGrowthRow(fact) {
  return {
    transaction_date: `${fact.month}-01`,
    category: fact.category,
    salesman_code: fact.salesman_code,
    salesman_name: fact.salesman_name,
    customer_code: fact.customer_code,
    customer_name: fact.customer_name,
    item_code: fact.item_code,
    item_name: fact.item_name,
    voucher_type: fact.voucher_type,
    local_import: fact.local_import,
    abc_class: fact.abc_class,
    sales_amount: Number(fact.sales_amount || 0),
    quantity: Number(fact.quantity || 0),
  };
}

export function serializeSalesBiCube({ facts = [], batchId = "", builtAt = "", sourceRowCount = 0 } = {}) {
  return {
    version: SALES_BI_CUBE_VERSION,
    batchId: String(batchId || ""),
    builtAt: String(builtAt || new Date().toISOString()),
    sourceRowCount: Number(sourceRowCount || 0),
    factCount: facts.length,
    facts: (facts || []).map((fact) => ({
      m: fact.month,
      c: fact.category,
      sc: fact.salesman_code,
      sn: fact.salesman_name,
      cc: fact.customer_code,
      cn: fact.customer_name,
      ic: fact.item_code,
      iname: fact.item_name,
      vt: fact.voucher_type,
      li: fact.local_import,
      abc: fact.abc_class,
      a: Number(fact.sales_amount || 0),
      q: Number(fact.quantity || 0),
      n: Number(fact.line_count || 0),
    })),
  };
}

export function deserializeSalesBiCube(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (Number(payload.version || 0) !== SALES_BI_CUBE_VERSION) return null;
  const facts = Array.isArray(payload.facts) ? payload.facts : [];
  return {
    version: Number(payload.version || 0),
    batchId: String(payload.batchId || ""),
    builtAt: String(payload.builtAt || ""),
    sourceRowCount: Number(payload.sourceRowCount || 0),
    factCount: facts.length,
    facts: facts.map((fact) => ({
      month: fact.m || fact.month,
      category: fact.c || fact.category,
      salesman_code: fact.sc || fact.salesman_code,
      salesman_name: fact.sn || fact.salesman_name,
      customer_code: fact.cc || fact.customer_code,
      customer_name: fact.cn || fact.customer_name,
      item_code: fact.ic || fact.item_code,
      item_name: fact.iname || fact.in || fact.item_name,
      voucher_type: fact.vt || fact.voucher_type,
      local_import: fact.li || fact.local_import,
      abc_class: fact.abc || fact.abc_class,
      sales_amount: Number(fact.a ?? fact.sales_amount ?? 0),
      quantity: Number(fact.q ?? fact.quantity ?? 0),
      line_count: Number(fact.n ?? fact.line_count ?? 0),
    })),
  };
}

export function monthAlignGrowthFilters(filters = {}) {
  const next = { ...filters };
  if (next.dateFrom) next.dateFrom = `${String(next.dateFrom).slice(0, 7)}-01`;
  if (next.dateTo) next.dateTo = `${String(next.dateTo).slice(0, 7)}-01`;
  return next;
}

export function cubeSupportsFilters(filters = {}) {
  const voucher = filters.values?.voucher_number || [];
  const reference = filters.values?.reference || [];
  return voucher.length === 0 && reference.length === 0;
}

export { CUBE_DIMENSION_FIELDS };
