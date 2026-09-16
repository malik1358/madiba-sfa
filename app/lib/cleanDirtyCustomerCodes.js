/**
 * Remove customer master duplicates where code is "123C  Company Name"
 * and a clean twin "123C" already exists. Also remaps orphan dirty codes
 * still present in sales history after master rows were deleted, then
 * rebuilds the BI cube so dashboards pick up the change.
 */

import { clearSalesBiCubeMemory, rebuildSalesBiCube } from "./salesBiCubeServer.js";

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

export function extractCleanCode(dirtyCode) {
  const match = String(dirtyCode || "").trim().match(/^([0-9]+C?)[\s]+.+/i);
  return match ? normalizeCode(match[1]) : "";
}

export function buildDirtyCustomerTwinMap(customers = []) {
  const byCode = new Map();
  (customers || []).forEach((row) => {
    const code = normalizeCode(row?.customer_code);
    if (!code) return;
    byCode.set(code, row);
  });

  const twins = [];
  byCode.forEach((dirtyRow, dirtyCode) => {
    const cleanCode = extractCleanCode(dirtyCode);
    if (!cleanCode || cleanCode === dirtyCode) return;
    const cleanRow = byCode.get(cleanCode);
    if (!cleanRow) return;
    twins.push({
      dirtyId: dirtyRow.id,
      dirtyCode: dirtyRow.customer_code,
      dirtyLatestTxn: dirtyRow.latest_transaction_date || null,
      cleanId: cleanRow.id,
      cleanCode: cleanRow.customer_code,
      cleanName: cleanRow.customer_name || "",
    });
  });
  return twins;
}

/** Merge master twins with orphan dirty codes found in sales. */
export function buildDirtyCodeRemapTargets(customers = [], salesCodes = []) {
  const byNorm = new Map();
  (customers || []).forEach((row) => {
    const norm = normalizeCode(row?.customer_code);
    if (!norm) return;
    byNorm.set(norm, row);
  });

  const remaps = new Map();

  buildDirtyCustomerTwinMap(customers).forEach((twin) => {
    remaps.set(String(twin.dirtyCode), twin);
  });

  (salesCodes || []).forEach((rawCode) => {
    const dirtyCode = String(rawCode || "").trim();
    if (!dirtyCode || remaps.has(dirtyCode)) return;
    const cleanNorm = extractCleanCode(dirtyCode);
    if (!cleanNorm) return;
    const cleanRow = byNorm.get(cleanNorm);
    if (!cleanRow) return;
    if (normalizeCode(dirtyCode) === cleanNorm) return;

    const dirtyRow = byNorm.get(normalizeCode(dirtyCode));
    remaps.set(dirtyCode, {
      dirtyId: dirtyRow?.id || null,
      dirtyCode,
      dirtyLatestTxn: dirtyRow?.latest_transaction_date || null,
      cleanId: cleanRow.id,
      cleanCode: cleanRow.customer_code,
      cleanName: cleanRow.customer_name || "",
    });
  });

  return [...remaps.values()];
}

async function loadAllCustomers(admin) {
  const pageSize = 1000;
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await admin
      .from("customers")
      .select("id,customer_code,customer_name,latest_transaction_date")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message || "Unable to load customers.");
    const chunk = data || [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

/** Distinct customer_code values in active_sales that contain whitespace. */
async function loadSpacedCodesFromActiveSales(admin) {
  const pageSize = 1000;
  const codes = new Set();
  let from = 0;
  while (true) {
    let query = admin
      .from("active_sales")
      .select("customer_code")
      .like("customer_code", "% %")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    let { data, error } = await query;
    if (error && /column .*id/i.test(String(error.message || ""))) {
      ({ data, error } = await admin
        .from("active_sales")
        .select("customer_code")
        .like("customer_code", "% %")
        .order("customer_code", { ascending: true })
        .range(from, from + pageSize - 1));
    }
    if (error) {
      const message = String(error.message || "").toLowerCase();
      if (error.code === "42P01" || message.includes("does not exist") || message.includes("could not find")) {
        return [];
      }
      throw new Error(error.message || "Unable to scan active_sales for dirty codes.");
    }
    const chunk = data || [];
    chunk.forEach((row) => {
      const code = String(row?.customer_code || "").trim();
      if (code) codes.add(code);
    });
    if (chunk.length < pageSize) break;
    from += pageSize;
  }
  return [...codes];
}

async function updateCustomerCodeInTable(admin, table, dirtyCode, cleanCode, { withName = false, cleanName = "" } = {}) {
  const payload = withName
    ? {
      customer_code: cleanCode,
      ...(cleanName ? { customer_name: cleanName } : {}),
    }
    : { customer_code: cleanCode };

  const { error, count } = await admin
    .from(table)
    .update(payload, { count: "exact" })
    .eq("customer_code", dirtyCode);

  if (error) {
    const message = String(error.message || "").toLowerCase();
    if (error.code === "42P01" || message.includes("does not exist") || message.includes("could not find")) {
      return 0;
    }
    throw new Error(`${table}: ${error.message || "update failed"}`);
  }
  return Number(count || 0);
}

export async function cleanDirtyCustomerCodeDuplicates(admin, { rebuildBi = true } = {}) {
  const customers = await loadAllCustomers(admin);
  const spacedSalesCodes = await loadSpacedCodesFromActiveSales(admin);
  const remaps = buildDirtyCodeRemapTargets(customers, spacedSalesCodes);

  if (!remaps.length) {
    return {
      removed: 0,
      remappedSalesRaw: 0,
      remappedSalesOrders: 0,
      remappedInvoices: 0,
      remappedActiveSales: 0,
      biRebuilt: false,
      scannedCustomers: customers.length,
      scannedSpacedSalesCodes: spacedSalesCodes.length,
      twins: [],
      message: "No dirty duplicate customer codes found in master or sales.",
    };
  }

  let remappedSalesRaw = 0;
  let remappedSalesOrders = 0;
  let remappedInvoices = 0;
  let remappedActiveSales = 0;

  for (const twin of remaps) {
    remappedSalesRaw += await updateCustomerCodeInTable(
      admin,
      "sales_raw",
      twin.dirtyCode,
      twin.cleanCode,
      { withName: true, cleanName: twin.cleanName },
    );
    remappedSalesOrders += await updateCustomerCodeInTable(
      admin,
      "sales_orders",
      twin.dirtyCode,
      twin.cleanCode,
      { withName: true, cleanName: twin.cleanName },
    );
    remappedInvoices += await updateCustomerCodeInTable(
      admin,
      "invoices",
      twin.dirtyCode,
      twin.cleanCode,
    );
    remappedActiveSales += await updateCustomerCodeInTable(
      admin,
      "active_sales",
      twin.dirtyCode,
      twin.cleanCode,
      { withName: true, cleanName: twin.cleanName },
    );

    if (twin.dirtyId && twin.dirtyLatestTxn) {
      const cleanRow = customers.find((row) => row.id === twin.cleanId);
      const current = cleanRow?.latest_transaction_date || null;
      if (!current || String(twin.dirtyLatestTxn) > String(current)) {
        const { error: dateError } = await admin
          .from("customers")
          .update({
            latest_transaction_date: twin.dirtyLatestTxn,
            updated_at: new Date().toISOString(),
          })
          .eq("id", twin.cleanId);
        if (dateError) throw new Error(dateError.message || "Unable to update latest transaction.");
      }
    }
  }

  const dirtyIds = [...new Set(remaps.map((twin) => twin.dirtyId).filter(Boolean))];
  let removed = 0;
  if (dirtyIds.length) {
    const { error: deleteError, count: removedCount } = await admin
      .from("customers")
      .delete({ count: "exact" })
      .in("id", dirtyIds);
    if (deleteError) throw new Error(deleteError.message || "Unable to delete dirty customers.");
    removed = Number(removedCount || dirtyIds.length);
  }

  let biRebuilt = false;
  if (rebuildBi) {
    clearSalesBiCubeMemory();
    await rebuildSalesBiCube(admin);
    biRebuilt = true;
  }

  return {
    removed,
    remappedSalesRaw,
    remappedSalesOrders,
    remappedInvoices,
    remappedActiveSales,
    biRebuilt,
    scannedCustomers: customers.length,
    scannedSpacedSalesCodes: spacedSalesCodes.length,
    twins: remaps.map((twin) => ({
      dirtyCode: twin.dirtyCode,
      cleanCode: twin.cleanCode,
    })),
    message: removed > 0 || remappedActiveSales > 0 || remappedSalesRaw > 0
      ? `Removed ${removed} dirty master row(s). Remapped sales/invoices and rebuilt BI.`
      : `Found ${remaps.length} dirty code(s) but no rows needed remapping.`,
  };
}
