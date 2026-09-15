/**
 * Remove customer master duplicates where code is "123C  Company Name"
 * and a clean twin "123C" already exists. Remaps sales/invoice refs first.
 */

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
    throw new Error(`${table}: ${error.message || "update failed"}`);
  }
  return Number(count || 0);
}

export async function cleanDirtyCustomerCodeDuplicates(admin) {
  const { data: customers, error } = await admin
    .from("customers")
    .select("id,customer_code,customer_name,latest_transaction_date");

  if (error) throw new Error(error.message || "Unable to load customers.");

  const twins = buildDirtyCustomerTwinMap(customers || []);
  if (!twins.length) {
    return {
      removed: 0,
      remappedSalesRaw: 0,
      remappedSalesOrders: 0,
      remappedInvoices: 0,
      twins: [],
    };
  }

  let remappedSalesRaw = 0;
  let remappedSalesOrders = 0;
  let remappedInvoices = 0;

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

    if (twin.dirtyLatestTxn) {
      const cleanRow = (customers || []).find((row) => row.id === twin.cleanId);
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

  return {
    removed: Number(removedCount || dirtyIds.length),
    remappedSalesRaw,
    remappedSalesOrders,
    remappedInvoices,
    twins: twins.map((twin) => ({
      dirtyCode: twin.dirtyCode,
      cleanCode: twin.cleanCode,
    })),
  };
}
