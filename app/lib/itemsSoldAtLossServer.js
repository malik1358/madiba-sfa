import { isMissingSchemaColumn } from "./performanceKpis.js";
import {
  ITEMS_SOLD_AT_LOSS_SELECT,
  buildItemsSoldAtLossReport,
  normalizeItemsSoldAtLossDate,
} from "./itemsSoldAtLoss.js";

const PAGE_SIZE = 1000;

function isMissingRelation(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42P01" || message.includes("does not exist");
}

async function fetchLossPages(admin, { dateFrom, dateTo, select }) {
  const rows = [];
  let from = 0;
  while (true) {
    let query = admin
      .from("active_sales")
      .select(select)
      .lt("profit_amount", 0)
      .order("transaction_date", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (dateFrom) query = query.gte("transaction_date", dateFrom);
    if (dateTo) query = query.lte("transaction_date", dateTo);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

export async function loadItemsSoldAtLossReport(admin, options = {}) {
  const dateFrom = normalizeItemsSoldAtLossDate(options.dateFrom);
  const dateTo = normalizeItemsSoldAtLossDate(options.dateTo);
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new Error("From date must not be after To date.");
  }

  try {
    const sourceRows = await fetchLossPages(admin, {
      dateFrom,
      dateTo,
      select: ITEMS_SOLD_AT_LOSS_SELECT,
    });
    return buildItemsSoldAtLossReport({ sourceRows, dateFrom, dateTo });
  } catch (error) {
    if (isMissingSchemaColumn(error)) {
      return {
        ...buildItemsSoldAtLossReport({ sourceRows: [], dateFrom, dateTo }),
        profitMissing: true,
        message: "Profit amount is not available on active sales yet. Apply the profit column and re-upload sales.",
      };
    }
    if (isMissingRelation(error)) {
      throw new Error("Active sales are not available.");
    }
    throw error;
  }
}
