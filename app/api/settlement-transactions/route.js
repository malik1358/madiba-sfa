import { NextResponse } from "next/server";
import { after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { canDeleteSettlementTransaction } from "../../lib/moduleAccess.js";
import { hashOfflineDataContent, publishOfflineDataUpdate } from "../../lib/offlineDataBroadcast.js";
import { removeReceiptRowsFromDataset } from "../../lib/receiptRegister.js";
import {
  OUTSTANDING_DATASET_KEY,
  RECEIPT_DATASET_KEY,
  RECEIPT_DATASET_STAMP_KEY,
  SETTLEMENT_DELETION_LOG_KEY,
  appendSettlementDeletionLog,
  buildSettlementDeletionEntry,
  classifySettlementDeleteSource,
  normalizeSettlementDeleteKind,
  removeOutstandingInvoiceFromDataset,
  summarizeSalesRowsForAudit,
  vouchersMatch,
} from "../../lib/settlementTransactionDelete.js";

export const runtime = "nodejs";
export const maxDuration = 120;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function parseJson(value) {
  try {
    return JSON.parse(value || "null");
  } catch {
    return null;
  }
}

function normalizeCustomerCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

async function resolveProfile(admin, token) {
  const {
    data: { user },
    error: userError,
  } = await admin.auth.getUser(token);

  if (userError || !user) {
    throw new Error("Invalid login session");
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,role,salesman_code,salesman_name")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    throw new Error("Profile not found.");
  }

  return {
    id: profile.id,
    role: String(profile.role || "").toLowerCase(),
    salesmanCode: String(profile.salesman_code || "").trim(),
    salesmanName: String(profile.salesman_name || "").trim(),
  };
}

async function clearCustomerHistoryCache(admin, customerCode) {
  const code = normalizeCustomerCode(customerCode);
  if (!code) return 0;
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_key")
    .like("setting_key", `customer_history_cache:${code}%`);
  if (error) throw error;
  const keys = (data || []).map((row) => row.setting_key).filter(Boolean);
  if (!keys.length) return 0;
  const { error: deleteError } = await admin
    .from("system_settings")
    .delete()
    .in("setting_key", keys);
  if (deleteError) throw deleteError;
  return keys.length;
}

async function readSettingObject(admin, key) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", key)
    .maybeSingle();
  if (error) throw error;
  const parsed = parseJson(data?.setting_value);
  return parsed && typeof parsed === "object" ? parsed : {};
}

async function upsertSettings(admin, rows) {
  const { error } = await admin
    .from("system_settings")
    .upsert(rows, { onConflict: "setting_key" });
  if (error) throw error;
}

async function appendDeletionAudit(admin, entry) {
  const existing = await readSettingObject(admin, SETTLEMENT_DELETION_LOG_KEY);
  const payload = appendSettlementDeletionLog(existing, entry);
  await upsertSettings(admin, [{
    setting_key: SETTLEMENT_DELETION_LOG_KEY,
    setting_value: JSON.stringify(payload),
  }]);
  return payload;
}

async function readActiveBatchId(admin) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", "active_sales_batch_id")
    .maybeSingle();
  if (error) throw error;
  const batchId = Number(data?.setting_value);
  if (!Number.isFinite(batchId) || batchId <= 0) {
    throw new Error("No active sales batch is configured.");
  }
  return batchId;
}

function salesRowMatchesCustomer(row, customerCode, customerName) {
  const code = normalizeCustomerCode(customerCode);
  const rowCode = normalizeCustomerCode(row?.customer_code);
  if (code && rowCode === code) return true;
  if (code && rowCode.startsWith(`${code} `)) return true;
  const name = String(customerName || "").trim().toUpperCase().replace(/\s+/g, " ");
  const rowName = String(row?.customer_name || "").trim().toUpperCase().replace(/\s+/g, " ");
  if (name && rowName && name === rowName) return true;
  return false;
}

async function loadMatchingSalesRows(admin, {
  batchId,
  customerCode,
  customerName,
  voucher,
  transactionDate,
}) {
  const { data, error } = await admin
    .from("sales_raw")
    .select("id,import_batch_id,voucher_number,voucher_type,transaction_date,customer_code,customer_name,sales_amount,created_at,reference")
    .eq("import_batch_id", batchId)
    .eq("transaction_date", transactionDate)
    .limit(5000);
  if (error) throw error;

  return (data || []).filter((row) => (
    salesRowMatchesCustomer(row, customerCode, customerName)
    && vouchersMatch(row.voucher_number, voucher)
  ));
}

async function loadMatchingSalesRowsWithoutDate(admin, {
  batchId,
  customerCode,
  customerName,
  voucher,
}) {
  const code = normalizeCustomerCode(customerCode);
  const select = "id,import_batch_id,voucher_number,voucher_type,transaction_date,customer_code,customer_name,sales_amount,created_at,reference";
  const [exact, prefixed] = await Promise.all([
    admin
      .from("sales_raw")
      .select(select)
      .eq("import_batch_id", batchId)
      .eq("customer_code", code)
      .limit(5000),
    admin
      .from("sales_raw")
      .select(select)
      .eq("import_batch_id", batchId)
      .ilike("customer_code", `${code} %`)
      .limit(5000),
  ]);
  if (exact.error) throw exact.error;
  if (prefixed.error) throw prefixed.error;

  const byId = new Map();
  [...(exact.data || []), ...(prefixed.data || [])].forEach((row) => {
    if (!row?.id) return;
    byId.set(row.id, row);
  });

  return [...byId.values()].filter((row) => (
    salesRowMatchesCustomer(row, customerCode, customerName)
    && vouchersMatch(row.voucher_number, voucher)
  ));
}

async function deleteSalesVoucher(admin, profile, body) {
  const customerCode = String(body.customerCode || body.customer_code || "").trim();
  const customerName = String(body.customerName || body.customer_name || "").trim();
  const voucher = String(body.voucher || body.vchNo || body.vch_no || "").trim();
  const transactionDate = String(body.transactionDate || body.transaction_date || body.date || "").slice(0, 10);
  const kind = String(body.kind || "Invoice").trim() || "Invoice";

  if (!customerCode || !voucher) {
    return NextResponse.json({
      success: false,
      error: "customerCode and voucher are required.",
    }, { status: 400 });
  }

  const batchId = await readActiveBatchId(admin);
  let matched = [];
  if (/^\d{4}-\d{2}-\d{2}$/.test(transactionDate)) {
    matched = await loadMatchingSalesRows(admin, {
      batchId,
      customerCode,
      customerName,
      voucher,
      transactionDate,
    });
  }
  if (!matched.length) {
    matched = await loadMatchingSalesRowsWithoutDate(admin, {
      batchId,
      customerCode,
      customerName,
      voucher,
    });
    if (/^\d{4}-\d{2}-\d{2}$/.test(transactionDate) && matched.length) {
      const dated = matched.filter((row) => String(row.transaction_date || "").slice(0, 10) === transactionDate);
      if (dated.length) matched = dated;
    }
  }

  const salesSummary = summarizeSalesRowsForAudit(matched);
  let outstandingRemoval = { removedCount: 0, removed: [], customerDropped: false };
  const nowIso = new Date().toISOString();

  if (matched.length) {
    const ids = matched.map((row) => row.id).filter(Boolean);
    const { error: deleteError } = await admin
      .from("sales_raw")
      .delete()
      .in("id", ids);
    if (deleteError) throw deleteError;
  }

  const outstanding = await readSettingObject(admin, OUTSTANDING_DATASET_KEY);
  outstandingRemoval = removeOutstandingInvoiceFromDataset(outstanding, {
    customerCode,
    customerName,
    voucher,
    transactionDate: salesSummary.transactionDate || transactionDate,
  });

  if (outstandingRemoval.removedCount) {
    await upsertSettings(admin, [{
      setting_key: OUTSTANDING_DATASET_KEY,
      setting_value: JSON.stringify({
        ...outstandingRemoval.dataset,
        uploadedAt: outstanding.uploadedAt || nowIso,
        lastDeletedAt: nowIso,
        lastDeletedBy: profile.id,
        lastDeletedVoucher: {
          customerCode: normalizeCustomerCode(customerCode),
          voucher,
          transactionDate: salesSummary.transactionDate || transactionDate,
          removedCount: outstandingRemoval.removedCount,
        },
      }),
    }]);
  }

  if (!matched.length && !outstandingRemoval.removedCount) {
    return NextResponse.json({
      success: false,
      error: `Voucher ${voucher} was not found in sales or outstanding for this customer.`,
    }, { status: 404 });
  }

  const uploadedAt = salesSummary.uploadedAt
    || outstanding.uploadedAt
    || null;
  const audit = buildSettlementDeletionEntry({
    deletedAt: nowIso,
    deletedBy: profile,
    source: matched.length ? "sales_raw" : "outstanding",
    kind,
    customerCode,
    customerName,
    voucher,
    transactionDate: salesSummary.transactionDate || transactionDate,
    uploadedAt,
    removedCount: matched.length || outstandingRemoval.removedCount,
    amountExclVat: salesSummary.amountExclVat,
    amount: outstandingRemoval.removed[0]?.pending_amount ?? null,
    summary: matched.length
      ? `Deleted ${matched.length} sales line(s) for ${voucher}`
      : `Deleted outstanding-only ${voucher}`,
  });
  await appendDeletionAudit(admin, audit);

  const clearedCacheKeys = await clearCustomerHistoryCache(admin, customerCode);

  after(async () => {
    try {
      if (!supabaseUrl || !serviceKey) return;
      await publishOfflineDataUpdate(createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }), {
        trigger: "settlement-transaction-delete",
        kinds: ["outstanding", "sales"],
        contentHash: hashOfflineDataContent({
          customerCode: normalizeCustomerCode(customerCode),
          voucher,
          removedSales: matched.length,
          removedOutstanding: outstandingRemoval.removedCount,
          deletedAt: nowIso,
        }),
      });
    } catch (broadcastError) {
      console.error("Offline data broadcast after settlement delete failed:", broadcastError);
    }
  });

  return NextResponse.json({
    success: true,
    source: matched.length ? "sales" : "outstanding",
    removedSalesCount: matched.length,
    removedOutstandingCount: outstandingRemoval.removedCount,
    customerDropped: outstandingRemoval.customerDropped,
    uploadedAt,
    deletedAt: nowIso,
    clearedCacheKeys,
    audit,
    message: matched.length
      ? `Deleted ${kind} ${voucher} (${matched.length} sales line(s)${outstandingRemoval.removedCount ? `, ${outstandingRemoval.removedCount} outstanding` : ""}).`
      : `Deleted outstanding-only ${voucher}.`,
  });
}

async function deleteReceiptRegisterVoucher(admin, profile, body) {
  const customerCode = String(body.customerCode || body.customer_code || "").trim();
  const customerName = String(body.customerName || body.customer_name || "").trim();
  const receiptDate = String(
    body.transactionDate || body.transaction_date || body.receiptDate || body.receipt_date || body.date || "",
  ).slice(0, 10);
  const vchNo = String(body.voucher || body.vchNo || body.vch_no || "").trim();
  const kind = String(body.kind || "Receipt").trim() || "Receipt";

  if (!customerCode || !/^\d{4}-\d{2}-\d{2}$/.test(receiptDate) || !vchNo) {
    return NextResponse.json({
      success: false,
      error: "customerCode, transactionDate (YYYY-MM-DD), and voucher are required.",
    }, { status: 400 });
  }

  const existing = await readSettingObject(admin, RECEIPT_DATASET_KEY);
  const rows = Array.isArray(existing.rows) ? existing.rows : [];
  const removal = removeReceiptRowsFromDataset(rows, {
    customerCode,
    customerName,
    receiptDate,
    vchNo,
  });

  if (!removal.removedCount) {
    return NextResponse.json({
      success: false,
      error: `${kind} ${vchNo} on ${receiptDate} was not found for this customer.`,
    }, { status: 404 });
  }

  const nowIso = new Date().toISOString();
  const liveMatched = removal.rows.filter((row) => row.matched || row.customer_code).length;
  const payload = {
    ...existing,
    uploadedAt: nowIso,
    rows: removal.rows,
    rowsCount: removal.rows.length,
    matchedCount: liveMatched,
    unmatchedCount: removal.rows.length - liveMatched,
    lastDeletedAt: nowIso,
    lastDeletedBy: profile.id,
    lastDeletedVoucher: {
      customerCode: normalizeCustomerCode(customerCode),
      receiptDate,
      vchNo,
      removedCount: removal.removedCount,
      kind,
    },
  };

  const originalUploadedAt = String(existing.uploadedAt || existing.uploaded_at || "").trim() || null;
  const amount = removal.removed.reduce((total, row) => total + Number(row.amount || 0), 0);
  const audit = buildSettlementDeletionEntry({
    deletedAt: nowIso,
    deletedBy: profile,
    source: "receipt_register",
    kind,
    customerCode,
    customerName,
    voucher: vchNo,
    transactionDate: receiptDate,
    uploadedAt: originalUploadedAt,
    removedCount: removal.removedCount,
    amount,
    summary: `Deleted ${kind} ${vchNo} on ${receiptDate} (${removal.removedCount} row(s))`,
  });

  const deletionLog = appendSettlementDeletionLog(
    await readSettingObject(admin, SETTLEMENT_DELETION_LOG_KEY),
    audit,
  );

  await upsertSettings(admin, [
    {
      setting_key: RECEIPT_DATASET_KEY,
      setting_value: JSON.stringify(payload),
    },
    {
      setting_key: RECEIPT_DATASET_STAMP_KEY,
      setting_value: nowIso,
    },
    {
      setting_key: SETTLEMENT_DELETION_LOG_KEY,
      setting_value: JSON.stringify(deletionLog),
    },
  ]);

  const clearedCacheKeys = await clearCustomerHistoryCache(admin, customerCode);

  after(async () => {
    try {
      if (!supabaseUrl || !serviceKey) return;
      await publishOfflineDataUpdate(createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }), {
        trigger: "settlement-transaction-delete",
        kinds: ["outstanding"],
        contentHash: hashOfflineDataContent({
          customerCode: normalizeCustomerCode(customerCode),
          receiptDate,
          vchNo,
          removedCount: removal.removedCount,
          deletedAt: nowIso,
        }),
      });
    } catch (broadcastError) {
      console.error("Offline data broadcast after settlement delete failed:", broadcastError);
    }
  });

  return NextResponse.json({
    success: true,
    source: "receipt_register",
    removedCount: removal.removedCount,
    removed: removal.removed.map((row) => ({
      receipt_date: row.receipt_date,
      vch_no: row.vch_no,
      vch_type: row.vch_type,
      amount: row.amount,
      customer_code: row.customer_code,
    })),
    uploadedAt: originalUploadedAt,
    deletedAt: nowIso,
    clearedCacheKeys,
    audit,
    message: `Deleted ${kind} ${vchNo} on ${receiptDate} (${removal.removedCount} row(s)).`,
  });
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const profile = await resolveProfile(admin, authHeader.replace("Bearer ", ""));
    if (!canDeleteSettlementTransaction(profile)) {
      return NextResponse.json({
        success: false,
        error: "Only admin or Chaina can view settlement deletion history.",
      }, { status: 403 });
    }

    const url = new URL(request.url);
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 50) || 50));
    const customerCode = normalizeCustomerCode(url.searchParams.get("customerCode") || "");
    const log = await readSettingObject(admin, SETTLEMENT_DELETION_LOG_KEY);
    let entries = Array.isArray(log.entries) ? log.entries : [];
    if (customerCode) {
      entries = entries.filter((entry) => normalizeCustomerCode(entry.customerCode) === customerCode);
    }

    return NextResponse.json({
      success: true,
      updatedAt: log.updatedAt || null,
      entries: entries.slice(0, limit),
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message || "Unable to load deletion history.",
    }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const profile = await resolveProfile(admin, authHeader.replace("Bearer ", ""));
    if (!canDeleteSettlementTransaction(profile)) {
      return NextResponse.json({
        success: false,
        error: "Only admin or Chaina can delete a settlement transaction.",
      }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const source = classifySettlementDeleteSource(body.kind || body.source || "");
    const kind = String(body.kind || "").trim() || (
      source === "receipt_register" ? "Receipt" : "Invoice"
    );

    if (source === "receipt_register") {
      return deleteReceiptRegisterVoucher(admin, profile, { ...body, kind });
    }

    if (!normalizeSettlementDeleteKind(kind) && !body.voucher && !body.vchNo) {
      return NextResponse.json({
        success: false,
        error: "kind and voucher are required.",
      }, { status: 400 });
    }

    return deleteSalesVoucher(admin, profile, { ...body, kind });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message || "Unable to delete settlement transaction.",
    }, { status: 500 });
  }
}
