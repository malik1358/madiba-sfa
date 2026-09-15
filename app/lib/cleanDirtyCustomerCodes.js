/**
 * Remove customer master duplicates where code is "123C  Company Name"
 * and a clean twin "123C" already exists. Remaps sales/invoice refs first,
 * then rebuilds the BI cube so dashboards pick up the change.
 */

import { clearSalesBiCubeMemory, rebuildSalesBiCube } from "./salesBiCubeServer.js";

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function extractCleanCode(dirtyCode) {
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
    // Some environments may not expose every table; skip missing ones.
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
  const twins = buildDirtyCustomerTwinMap(customers);
  if (!twins.length) {
    return {
      removed: 0,
      remappedSalesRaw: 0,
      remappedSalesOrders: 0,
      remappedInvoices: 0,
      remappedActiveSales: 0,
      biRebuilt: false,
      scannedCustomers: customers.length,
      twins: [],
      message: "No dirty duplicate customer codes found.",
    };
  }

  let remappedSalesRaw = 0;
  let remappedSalesOrders = 0;
  let remappedInvoices = 0;
  let remappedActiveSales = 0;

  for (const twin of twins) {
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

    if (twin.dirtyLatestTxn) {
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

  const dirtyIds = twins.map((twin) => twin.dirtyId).filter(Boolean);
  const { error: deleteError, count: removedCount } = await admin
    .from("customers")
    .delete({ count: "exact" })
    .in("id", dirtyIds);

  if (deleteError) throw new Error(deleteError.message || "Unable to delete dirty customers.");

  let biRebuilt = false;
  if (rebuildBi) {
    clearSalesBiCubeMemory();
    await rebuildSalesBiCube(admin);
    biRebuilt = true;
  }

  const removed = Number(removedCount || dirtyIds.length);
  return {
    removed,
    remappedSalesRaw,
    remappedSalesOrders,
    remappedInvoices,
    remappedActiveSales,
    biRebuilt,
    scannedCustomers: customers.length,
    twins: twins.map((twin) => ({
      dirtyCode: twin.dirtyCode,
      cleanCode: twin.cleanCode,
    })),
    message: `Removed ${removed} dirty duplicate customer code(s). Remapped sales/invoices and rebuilt BI.`,
  };
}
