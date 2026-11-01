import { OUTSTANDING_DATASET_KEY, buildOutstandingRow } from "./outstanding.js";
import { RECEIPT_DATASET_KEY } from "./receiptRegister.js";
import { buildMisReport } from "./misReport.js";
import { pageActiveSales } from "./salesBiCubeServer.js";

const MIS_INVENTORY_SETTING_KEY = "mis_inventory_physical_v1";
const SALES_SELECT = "transaction_date,category,sales_amount,profit_amount,salesman_code,salesman_name,customer_code,item_code,item_name";

function isMissingTableError(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42P01"
    || message.includes("could not find the table")
    || (message.includes("relation") && message.includes("does not exist"));
}

async function readSettingJson(admin, key) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", key)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  if (!data?.setting_value) return null;
  try {
    return JSON.parse(String(data.setting_value));
  } catch {
    return null;
  }
}

export async function loadMisSalesRows(admin, { toDateExclusive }) {
  const rows = [];
  const selectAttempts = [
    SALES_SELECT,
    "transaction_date,category,sales_amount,salesman_code,salesman_name,customer_code,item_code,item_name",
    "transaction_date,category,sales_amount,customer_code,item_name,salesman_name",
  ];

  let lastError = null;
  for (const select of selectAttempts) {
    try {
      rows.length = 0;
      // Load full active_sales history (needed for first-purchase / repeat), cut off after as-of.
      await pageActiveSales(admin, select, async (page) => {
        for (const row of page || []) {
          const day = String(row.transaction_date || "").slice(0, 10);
          if (!day || day >= toDateExclusive) continue;
          rows.push(row);
        }
      });
      return rows;
    } catch (error) {
      lastError = error;
      const message = String(error?.message || "");
      if (!/column/i.test(message)) throw error;
    }
  }
  throw lastError || new Error("Unable to load active_sales for MIS");
}

export async function loadMisReceiptRows(admin) {
  const payload = await readSettingJson(admin, RECEIPT_DATASET_KEY);
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.receipts)) return payload.receipts;
  return [];
}

export async function loadMisOutstandingRows(admin) {
  const payload = await readSettingJson(admin, OUTSTANDING_DATASET_KEY);
  const rawRows = Array.isArray(payload?.rows) ? payload.rows : [];
  return rawRows.map((row) => buildOutstandingRow(row)).filter(Boolean);
}

export async function loadMisInventoryPhysical(admin, asOfMonth) {
  const payload = await readSettingJson(admin, MIS_INVENTORY_SETTING_KEY);
  if (!payload || typeof payload !== "object") return null;
  if (payload.month && String(payload.month).slice(0, 7) !== asOfMonth) return null;
  const value = Number(payload.physical ?? payload.amount ?? payload.total);
  return Number.isFinite(value) ? value : null;
}

export async function loadLiveMisReport(admin, { asOfDate }) {
  const asOf = String(asOfDate).slice(0, 10);
  const year = asOf.slice(0, 4);
  const asOfYm = asOf.slice(0, 7);
  const nextDay = new Date(`${asOf}T12:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const toDateExclusive = nextDay.toISOString().slice(0, 10);
  const ytdFromDate = `${year}-01-01`;

  const [salesRows, receiptRows, outstandingRows, inventoryPhysical] = await Promise.all([
    loadMisSalesRows(admin, { toDateExclusive }),
    loadMisReceiptRows(admin),
    loadMisOutstandingRows(admin),
    loadMisInventoryPhysical(admin, asOfYm),
  ]);

  const report = buildMisReport({
    salesRows,
    receiptRows,
    outstandingRows,
    asOfDate: asOf,
    inventoryPhysical,
  });

  return {
    ...report,
    meta: {
      salesRowCount: salesRows.length,
      receiptRowCount: receiptRows.length,
      outstandingRowCount: outstandingRows.length,
      inventorySource: inventoryPhysical == null ? null : MIS_INVENTORY_SETTING_KEY,
      ytdFromDate,
      toDateExclusive,
    },
  };
}

export { MIS_INVENTORY_SETTING_KEY };
