import { resolveCustomerAccountCode } from "./outstanding.js";

export const TALLY_STATEMENT_KEY_PREFIX = "tally_statement_v1:";
const MAX_ENTRIES = 4000;

export function tallyStatementSettingKey(customerCode) {
  const code = resolveCustomerAccountCode(customerCode);
  return code ? `${TALLY_STATEMENT_KEY_PREFIX}${code}` : "";
}

function cleanSide(value) {
  return value === "credit" ? "credit" : "debit";
}

function cleanBalance(balance) {
  const amount = Number(balance?.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, side: cleanSide(balance.side) };
}

export function buildTallyStatementRecord(parsed, {
  fileName = "",
  uploadedBy = "",
  uploadedAt = new Date().toISOString(),
} = {}) {
  const entries = (Array.isArray(parsed?.entries) ? parsed.entries : [])
    .slice(0, MAX_ENTRIES)
    .map((row) => ({
      date: String(row?.date || "").slice(0, 10),
      voucher: String(row?.voucher || "").trim().slice(0, 80),
      particulars: String(row?.particulars || "").trim().slice(0, 180),
      vchType: String(row?.vchType || "").trim().slice(0, 80),
      side: cleanSide(row?.side),
      amount: Number(row?.amount) || 0,
    }))
    .filter((row) => row.date && row.amount > 0);

  if (!entries.length) return null;

  return {
    fileName: String(fileName || "").trim().slice(0, 180),
    uploadedAt: String(uploadedAt || new Date().toISOString()),
    uploadedBy: String(uploadedBy || "").trim().slice(0, 120),
    opening: cleanBalance(parsed?.opening),
    closing: cleanBalance(parsed?.closing),
    report: parsed?.report === "pending_bills" ? "pending_bills" : "",
    entries,
  };
}

export function readTallyStatementRecord(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value || "null") : value;
    return buildTallyStatementRecord(parsed, {
      fileName: parsed?.fileName,
      uploadedBy: parsed?.uploadedBy,
      uploadedAt: parsed?.uploadedAt,
    });
  } catch {
    return null;
  }
}
