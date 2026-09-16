import {
  buildCustomerSalesmanOwnershipMap,
  normalizeSalesmanCode,
} from "./customerSalesmanOwnership.js";

function isMissingTableError(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42P01"
    || message.includes("could not find the table")
    || (message.includes("relation") && message.includes("does not exist"));
}

async function pageCustomersForOwnership(admin) {
  const pageSize = 1000;
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await admin
      .from("customers")
      .select("id,customer_code,current_salesman_code")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) {
      if (isMissingTableError(error)) return [];
      throw error;
    }
    const chunk = data || [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function loadSalesmanProfilesForOwnership(admin) {
  const { data, error } = await admin
    .from("profiles")
    .select("salesman_code,salesman_name,is_active");
  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return (data || []).filter((row) => {
    if (row?.is_active === false) return false;
    return Boolean(normalizeSalesmanCode(row?.salesman_code));
  });
}

/** Load customer-master ownership map used by BI cube + growth reports. */
export async function loadCustomerSalesmanOwnershipMap(admin) {
  const [customers, profiles] = await Promise.all([
    pageCustomersForOwnership(admin),
    loadSalesmanProfilesForOwnership(admin),
  ]);
  return buildCustomerSalesmanOwnershipMap(customers, profiles);
}
