import { isMissingSchemaColumn } from "./performanceKpis.js";
import {
  createSalesBiCube,
  deserializeSalesBiCube,
  ingestSalesRowsIntoCube,
  SALES_BI_CUBE_KEY,
  SALES_BI_TABLE,
  salesBiFactsFromCube,
  serializeSalesBiCube,
  salesBiCubeNeedsRebuild,
} from "./salesBiCube.js";

const SALES_SELECTS = [
  "transaction_date,category,sales_amount,profit_amount,quantity,salesman_code,salesman_name,customer_code,customer_name,item_code,item_name,voucher_type,local_import,abc_class",
  "transaction_date,category,sales_amount,quantity,salesman_code,salesman_name,customer_code,customer_name,item_code,item_name,voucher_type,local_import,abc_class",
  "transaction_date,category,sales_amount,quantity,salesman_code,salesman_name,customer_code,customer_name,item_code,item_name,voucher_type",
  "transaction_date,category,sales_amount,salesman_code,salesman_name,customer_code,customer_name,item_code,item_name",
  "transaction_date,category,sales_amount",
  "transaction_date,sales_amount",
];

const MAX_SETTINGS_CHARS = 3500000;

let memoryCube = null;

function isMissingTableError(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42P01"
    || message.includes("could not find the table")
    || (message.includes("relation") && message.includes("does not exist"));
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

export async function pageActiveSales(admin, select, onPage) {
  const pageSize = 1000;
  let from = 0;
  while (true) {
    let query = admin
      .from("active_sales")
      .select(select)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    let { data, error } = await query;
    if (error && /column .*id/i.test(String(error.message || ""))) {
      ({ data, error } = await admin
        .from("active_sales")
        .select(select)
        .order("transaction_date", { ascending: true })
        .range(from, from + pageSize - 1));
    }
    if (error) throw error;
    await onPage(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
}

function rememberCube(cube) {
  memoryCube = cube;
  return cube;
}

export function peekSalesBiCubeMemory() {
  return memoryCube;
}

export function clearSalesBiCubeMemory() {
  memoryCube = null;
}

async function readCubeFromSettings(admin) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", SALES_BI_CUBE_KEY)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  if (!data?.setting_value) return null;
  try {
    return deserializeSalesBiCube(JSON.parse(String(data.setting_value)));
  } catch {
    return null;
  }
}

async function writeCubeToSettings(admin, serialized) {
  const payload = JSON.stringify(serialized);
  if (payload.length > MAX_SETTINGS_CHARS) return false;
  const { error } = await admin.from("system_settings").upsert({
    setting_key: SALES_BI_CUBE_KEY,
    setting_value: payload,
  }, { onConflict: "setting_key" });
  if (error) {
    if (isMissingTableError(error) || isMissingSchemaColumn(error)) return false;
    throw error;
  }
  return true;
}

async function readCubeFromTable(admin) {
  const facts = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await admin
      .from(SALES_BI_TABLE)
      .select("month,category,salesman_code,salesman_name,customer_code,customer_name,item_code,item_name,voucher_type,local_import,abc_class,sales_amount,profit_amount,quantity,line_count")
      .range(from, from + pageSize - 1);
    if (error) {
      if (isMissingTableError(error) || isMissingSchemaColumn(error)) return null;
      throw error;
    }
    facts.push(...(data || []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return {
    version: 1,
    batchId: "",
    builtAt: "",
    sourceRowCount: facts.reduce((sum, row) => sum + Number(row.line_count || 0), 0),
    factCount: facts.length,
    facts,
  };
}

async function writeCubeToTable(admin, facts) {
  const { error: deleteError } = await admin.from(SALES_BI_TABLE).delete().gte("line_count", 0);
  if (deleteError) {
    if (isMissingTableError(deleteError) || isMissingSchemaColumn(deleteError)) return false;
    throw deleteError;
  }

  const chunkSize = 500;
  for (let index = 0; index < facts.length; index += chunkSize) {
    const chunk = facts.slice(index, index + chunkSize);
    const { error } = await admin.from(SALES_BI_TABLE).insert(chunk);
    if (error) {
      if (isMissingTableError(error) || isMissingSchemaColumn(error)) return false;
      throw error;
    }
  }
  return true;
}

async function buildCubeFromActiveSales(admin) {
  const cube = createSalesBiCube();
  let lastError = null;

  for (const select of SALES_SELECTS) {
    cube.facts.clear();
    cube.sourceRowCount = 0;
    try {
      await pageActiveSales(admin, select, (rows) => ingestSalesRowsIntoCube(cube, rows));
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (isMissingTableError(error)) {
        return {
          version: 1,
          batchId: "",
          builtAt: new Date().toISOString(),
          sourceRowCount: 0,
          factCount: 0,
          facts: [],
          missingTable: true,
        };
      }
      if (!isMissingSchemaColumn(error)) throw error;
    }
  }

  if (lastError) throw lastError;
  const facts = salesBiFactsFromCube(cube);
  const batchId = await activeSalesBatchId(admin);
  return {
    version: 1,
    batchId,
    builtAt: new Date().toISOString(),
    sourceRowCount: cube.sourceRowCount,
    factCount: facts.length,
    facts,
  };
}

export async function rebuildSalesBiCube(admin) {
  const cube = await buildCubeFromActiveSales(admin);
  rememberCube(cube);
  if (!cube.missingTable) {
    await writeCubeToTable(admin, cube.facts).catch((error) => {
      console.error("Saving sales BI table failed:", error);
      return false;
    });
    await writeCubeToSettings(admin, serializeSalesBiCube(cube)).catch((error) => {
      console.error("Saving sales BI cube settings failed:", error);
      return false;
    });
  }
  return cube;
}

async function latestActiveImportCompletedAt(admin) {
  const { data, error } = await admin
    .from("import_batches")
    .select("completed_at")
    .eq("status", "ACTIVE")
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error) || isMissingSchemaColumn(error)) return "";
    throw error;
  }
  return String(data?.completed_at || "");
}

async function liveSalesHaveProfit(admin) {
  const { data, error } = await admin
    .from("active_sales")
    .select("profit_amount")
    .neq("profit_amount", 0)
    .limit(1);
  if (error) {
    if (isMissingTableError(error) || isMissingSchemaColumn(error)) return false;
    throw error;
  }
  return Boolean(data?.length);
}

async function shouldRebuildLoadedCube(admin, cube) {
  if (!cube?.facts?.length) return true;
  const [lastImportAt, liveHasProfit] = await Promise.all([
    latestActiveImportCompletedAt(admin),
    liveSalesHaveProfit(admin),
  ]);
  return salesBiCubeNeedsRebuild(cube, { lastImportAt, liveHasProfit });
}

export async function loadSalesBiCube(admin, { allowStale = true } = {}) {
  const batchId = await activeSalesBatchId(admin);

  if (memoryCube && (!batchId || memoryCube.batchId === batchId || allowStale)) {
    const stale = Boolean(batchId && memoryCube.batchId && memoryCube.batchId !== batchId);
    if ((!stale || allowStale) && !(await shouldRebuildLoadedCube(admin, memoryCube))) {
      return { ...memoryCube, stale, source: "memory" };
    }
  }

  const fromSettings = await readCubeFromSettings(admin);
  if (fromSettings?.facts?.length) {
    const stale = Boolean(batchId && fromSettings.batchId && fromSettings.batchId !== batchId);
    if ((!stale || allowStale) && !(await shouldRebuildLoadedCube(admin, fromSettings))) {
      rememberCube(fromSettings);
      return { ...fromSettings, stale, source: "settings" };
    }
  }

  const fromTable = await readCubeFromTable(admin);
  if (fromTable?.facts?.length && !(await shouldRebuildLoadedCube(admin, fromTable))) {
    rememberCube({ ...fromTable, batchId: fromTable.batchId || batchId });
    return {
      ...fromTable,
      batchId: fromTable.batchId || batchId,
      stale: false,
      source: "table",
    };
  }

  const built = await rebuildSalesBiCube(admin);
  return { ...built, stale: false, source: "rebuild" };
}
