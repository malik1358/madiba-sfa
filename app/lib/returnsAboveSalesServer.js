import {
  RETURNS_ABOVE_SALES_SELECT,
  buildReturnsAboveSalesReport,
} from "./returnsAboveSales.js";

const PAGE_SIZE = 1000;

function isMissingRelation(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42P01" || message.includes("does not exist");
}

async function fetchActiveSalesPages(admin) {
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await admin
      .from("active_sales")
      .select(RETURNS_ABOVE_SALES_SELECT)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

export async function loadReturnsAboveSalesReport(admin) {
  try {
    const sourceRows = await fetchActiveSalesPages(admin);
    return buildReturnsAboveSalesReport(sourceRows);
  } catch (error) {
    if (isMissingRelation(error)) {
      throw new Error("Active sales are not available.");
    }
    throw error;
  }
}
