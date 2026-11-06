import {
  RETURNS_ABOVE_SALES_SELECT,
  buildReturnsAboveSalesReport,
  missingReferencedVoucherNumbers,
  pickMissingReferencedSales,
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

const HISTORY_SELECT = `${RETURNS_ABOVE_SALES_SELECT},import_batch_id`;
const VOUCHER_CHUNK = 80;

function chunkList(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function fetchReferencedSales(admin, voucherNumbers) {
  const rows = [];
  for (const chunk of chunkList(voucherNumbers, VOUCHER_CHUNK)) {
    let from = 0;
    while (true) {
      const { data, error } = await admin
        .from("sales_raw")
        .select(HISTORY_SELECT)
        .in("voucher_number", chunk)
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  }
  return rows;
}

export async function loadReturnsAboveSalesReport(admin) {
  try {
    const sourceRows = await fetchActiveSalesPages(admin);
    const voucherNumbers = missingReferencedVoucherNumbers(sourceRows);
    const historyRows = voucherNumbers.length
      ? await fetchReferencedSales(admin, voucherNumbers)
      : [];
    const extraSales = pickMissingReferencedSales(sourceRows, historyRows);
    return buildReturnsAboveSalesReport([...sourceRows, ...extraSales]);
  } catch (error) {
    if (isMissingRelation(error)) {
      throw new Error("Active sales are not available.");
    }
    throw error;
  }
}
