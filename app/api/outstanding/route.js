import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import {
  OUTSTANDING_DATASET_KEY,
  buildOutstandingRow,
  combineOutstandingHeaderRows,
  detectOutstandingPendingAmountColumn,
  extractLeadingCustomerCodeAndName,
  findOutstandingForCustomer,
  findOutstandingHeaderRow,
  findOutstandingInvoiceDayColumn,
  isSameOutstandingCustomer,
  isOutstandingAmountHeader,
  normalizeCode,
  normalizeOutstandingHeader,
  normalizeName,
  parseBucketLabelFromHeader,
  prioritizeOutstandingSheets,
  sortBucketLabels,
  sanitizeStoredOverdueDays,
  toNumber,
} from "../../lib/outstanding";

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

function roleCanUpload(role) {
  const normalized = String(role || "").trim().toLowerCase();
  return ["admin", "manager", "invoice-maker", "invoice_maker"].includes(normalized);
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
  };
}

async function readDataset(admin) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", OUTSTANDING_DATASET_KEY)
    .maybeSingle();

  if (error) throw error;

  const parsed = parseJson(data?.setting_value);
  if (!parsed || typeof parsed !== "object") {
    return {
      uploadedAt: "",
      fileName: "",
      bucketLabels: [],
      rows: [],
      invoices: [],
    };
  }

  return {
    uploadedAt: String(parsed.uploadedAt || ""),
    fileName: String(parsed.fileName || ""),
    bucketLabels: sortBucketLabels(parsed.bucketLabels || []),
    rows: Array.isArray(parsed.rows) ? parsed.rows.map(buildOutstandingRow) : [],
    invoices: Array.isArray(parsed.invoices) ? parsed.invoices : [],
  };
}

function formatSheetDateValue(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number") {
    const parsed = XLSX.SSF?.parse_date_code?.(value);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      const utc = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
      if (!Number.isNaN(utc.getTime())) return utc.toISOString().slice(0, 10);
    }
  }

  const text = String(value || "").trim();
  if (!text) return "";

  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);

  const dmyMatch = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (dmyMatch) {
    const day = Number(dmyMatch[1]);
    const month = Number(dmyMatch[2]);
    let year = Number(dmyMatch[3]);
    if (year < 100) year += 2000;

    if (Number.isFinite(day) && Number.isFinite(month) && Number.isFinite(year)) {
      const utc = new Date(Date.UTC(year, month - 1, day));
      if (!Number.isNaN(utc.getTime())) return utc.toISOString().slice(0, 10);
    }
  }

  return text;
}

function detectColumnIndexes(headerRow) {
  const indexes = {
    customerCode: -1,
    customerName: -1,
    openInvoices: -1,
    pendingAmount: -1,
    date: -1,
    refNo: -1,
    dueDate: -1,
    overdueDays: -1,
    invoiceDay: -1,
    salesman: -1,
    buckets: [],
  };

  const codeAliases = ["customer code", "customer_code", "cust code", "customer no", "account code", "code"];
  const nameAliases = ["customer name", "customer", "party name", "name", "account name"];

  headerRow.forEach((cell, idx) => {
    const text = String(cell || "").trim();
    const normalized = normalizeOutstandingHeader(text);

    if (indexes.customerCode < 0 && codeAliases.some((alias) => normalized === alias || normalized.includes(alias))) {
      indexes.customerCode = idx;
    }

    if (indexes.customerName < 0 && nameAliases.some((alias) => normalized === alias || normalized.includes(alias))) {
      indexes.customerName = idx;
    }

    if (indexes.date < 0 && (normalized === "date" || normalized.startsWith("date "))) {
      indexes.date = idx;
    }

    if (indexes.refNo < 0 && (normalized.includes("ref") || normalized.includes("invoice no") || normalized.includes("voucher"))) {
      indexes.refNo = idx;
    }

    if (indexes.dueDate < 0 && normalized.includes("due")) {
      indexes.dueDate = idx;
    }

    if (indexes.overdueDays < 0 && normalized.includes("overd")) {
      indexes.overdueDays = idx;
    }

    if (indexes.salesman < 0 && normalized.includes("salesman")) {
      indexes.salesman = idx;
    }

    const bucketLabel = parseBucketLabelFromHeader(text);
    if (!bucketLabel) return;

    if (bucketLabel === "open_invoices") {
      indexes.openInvoices = idx;
      return;
    }

    indexes.buckets.push({ idx, label: bucketLabel });
  });

  indexes.invoiceDay = findOutstandingInvoiceDayColumn(
    headerRow,
    indexes.overdueDays,
    indexes.salesman
  );

  indexes.pendingAmount = detectOutstandingPendingAmountColumn(headerRow);

  return indexes;
}

function bucketLabelForInvoiceDay(dayValue) {
  const day = toNumber(dayValue);
  if (!Number.isFinite(day) || day <= 0) return "0-30";
  if (day <= 30) return "0-30";
  if (day <= 60) return "31-60";
  if (day <= 90) return "61-90";
  if (day <= 120) return "91-120";
  return ">120";
}

function parseOutstandingRows(rows, headerRowIndex) {
  const headerRow = combineOutstandingHeaderRows(rows, headerRowIndex);
  const columns = detectColumnIndexes(headerRow);
  const ageColumnIndex = columns.invoiceDay >= 0 ? columns.invoiceDay : columns.overdueDays;

  const hasInvoiceDayLayout = columns.pendingAmount >= 0 && ageColumnIndex >= 0;

  if (!hasInvoiceDayLayout && columns.buckets.length === 0 && columns.openInvoices < 0) {
    throw new Error("Could not detect bucket columns or open invoices column in uploaded file.");
  }

  const aggregate = new Map();
  const invoices = [];
  const bucketLabels = hasInvoiceDayLayout
    ? ["0-30", "31-60", "61-90", "91-120", ">120"]
    : sortBucketLabels(columns.buckets.map((bucket) => bucket.label));

  for (let r = headerRowIndex + 1; r < rows.length; r += 1) {
    const row = Array.isArray(rows[r]) ? rows[r] : [];
    const rawCustomerCode = columns.customerCode >= 0 ? String(row[columns.customerCode] || "").trim() : "";
    const rawCustomerName = columns.customerName >= 0 ? String(row[columns.customerName] || "").trim() : "";
    const extractedCode = extractLeadingCustomerCodeAndName(rawCustomerCode);
    const extractedName = extractLeadingCustomerCodeAndName(rawCustomerName);
    const customerCode = extractedCode.customer_code || rawCustomerCode || extractedName.customer_code;
    const customerName = extractedName.customer_name || extractedCode.customer_name || rawCustomerName;

    if (!customerCode && !customerName) continue;

    const rowBuckets = {};
    let hasAnyValue = false;

    if (hasInvoiceDayLayout) {
      const pendingValue = toNumber(row[columns.pendingAmount]);
      const dayBucket = bucketLabelForInvoiceDay(row[ageColumnIndex]);
      bucketLabels.forEach((label) => {
        rowBuckets[label] = label === dayBucket ? pendingValue : 0;
      });
      hasAnyValue = pendingValue !== 0;
    } else {
      columns.buckets.forEach((bucket) => {
        const value = toNumber(row[bucket.idx]);
        rowBuckets[bucket.label] = value;
        if (value !== 0) hasAnyValue = true;
      });
    }

    const openInvoices = hasInvoiceDayLayout
      ? (toNumber(row[columns.pendingAmount]) > 0 ? 1 : 0)
      : (columns.openInvoices >= 0 ? toNumber(row[columns.openInvoices]) : 0);
    if (openInvoices !== 0) hasAnyValue = true;

    if (!hasAnyValue) continue;

    const key = normalizeCode(customerCode) || normalizeName(customerName);
    if (!key) continue;

    const current = aggregate.get(key) || {
      customer_code: customerCode,
      customer_name: customerName,
      open_invoices: 0,
      buckets: {},
    };

    if (!current.customer_code && customerCode) current.customer_code = customerCode;
    if (!current.customer_name && customerName) current.customer_name = customerName;

    current.open_invoices += openInvoices;
    bucketLabels.forEach((label) => {
      current.buckets[label] = toNumber(current.buckets[label]) + toNumber(rowBuckets[label]);
    });

    aggregate.set(key, current);

    const pendingAmount = columns.pendingAmount >= 0
      ? toNumber(row[columns.pendingAmount])
      : Object.values(rowBuckets).reduce((sum, value) => sum + toNumber(value), 0);
    if (pendingAmount > 0) {
      invoices.push({
        customer_code: customerCode,
        customer_name: customerName,
        invoice_date: columns.date >= 0 ? formatSheetDateValue(row[columns.date]) : "",
        ref_no: columns.refNo >= 0 ? String(row[columns.refNo] || "").trim() : "",
        pending_amount: pendingAmount,
        due_date: columns.dueDate >= 0 ? formatSheetDateValue(row[columns.dueDate]) : "",
        overdue_days: columns.overdueDays >= 0
          ? sanitizeStoredOverdueDays(
            row[columns.overdueDays],
            ageColumnIndex >= 0 ? toNumber(row[ageColumnIndex]) : 0,
          )
          : 0,
        invoice_day: ageColumnIndex >= 0 ? toNumber(row[ageColumnIndex]) : 0,
        salesman: columns.salesman >= 0 ? String(row[columns.salesman] || "").trim() : "",
      });
    }
  }

  const parsedRows = Array.from(aggregate.values())
    .map((row) => buildOutstandingRow(row))
    .sort((a, b) => normalizeName(a.customer_name).localeCompare(normalizeName(b.customer_name)));

  return {
    rows: parsedRows,
    bucketLabels,
    invoices,
  };
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

    await resolveProfile(admin, authHeader.replace("Bearer ", ""));
    const dataset = await readDataset(admin);

    const url = new URL(request.url);
    const customerCode = String(url.searchParams.get("customerCode") || "").trim();
    const customerName = String(url.searchParams.get("customerName") || "").trim();

    const customer = (customerCode || customerName)
      ? findOutstandingForCustomer(dataset, customerCode, customerName)
      : null;
    const hasInvoiceRowsInDataset = Array.isArray(dataset.invoices) && dataset.invoices.length > 0;
    const customerInvoices = (customerCode || customerName)
      ? dataset.invoices
        .filter((row) => isSameOutstandingCustomer(row.customer_code, row.customer_name, customerCode, customerName))
        .sort((a, b) => {
          const aDue = String(a?.due_date || "");
          const bDue = String(b?.due_date || "");
          if (aDue !== bDue) return aDue.localeCompare(bDue);
          return String(a?.ref_no || "").localeCompare(String(b?.ref_no || ""));
        })
      : [];

    return NextResponse.json({
      success: true,
      uploadedAt: dataset.uploadedAt,
      fileName: dataset.fileName,
      bucketLabels: dataset.bucketLabels,
      customer,
      customerInvoices,
      needsInvoiceRowsReupload: !hasInvoiceRowsInDataset,
      rowsCount: dataset.rows.length,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || "Unable to load outstanding data." }, { status: 500 });
  }
}

export async function POST(request) {
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
    if (!roleCanUpload(profile.role)) {
      return NextResponse.json({ success: false, error: "Only admin/manager/invoice-maker can upload outstanding file." }, { status: 403 });
    }

    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: "Excel file is required." }, { status: 400 });
    }

    const fileName = String(file.name || "").trim();
    if (!/\.(xlsx|xls)$/i.test(fileName)) {
      return NextResponse.json({ success: false, error: "Only .xlsx or .xls files are supported." }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(Buffer.from(arrayBuffer), { type: "buffer" });

    if (!Array.isArray(workbook.SheetNames) || workbook.SheetNames.length === 0) {
      throw new Error("Excel file does not contain any sheet.");
    }

    const candidateSheetNames = prioritizeOutstandingSheets(workbook.SheetNames);
    let rows = [];
    let headerRowIndex = -1;
    let workbookHasRows = false;
    const sheetPreviews = [];

    for (const sheetName of candidateSheetNames) {
      const sheetRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
      if (Array.isArray(sheetRows) && sheetRows.length > 0) workbookHasRows = true;
      const previewRows = (sheetRows || [])
        .filter((row) => Array.isArray(row) && row.some((cell) => String(cell || "").trim()))
        .slice(0, 8)
        .map((row) => row.map((cell) => String(cell || "").trim()).filter(Boolean).slice(0, 12).join(" | "));
      sheetPreviews.push(`${sheetName}: ${previewRows.join(" / ")}`);
      const sheetHeaderRowIndex = findOutstandingHeaderRow(sheetRows);
      if (sheetHeaderRowIndex < 0) continue;
      rows = sheetRows;
      headerRowIndex = sheetHeaderRowIndex;
      break;
    }

    if (!workbookHasRows) {
      throw new Error("Excel file is empty.");
    }

    if (headerRowIndex < 0) {
      const preview = sheetPreviews.join("; ").slice(0, 1200);
      throw new Error(`Unable to detect header row. Found: ${preview || "no readable cells"}`);
    }

    const parsed = parseOutstandingRows(rows, headerRowIndex);
    const nowIso = new Date().toISOString();

    const payload = {
      uploadedAt: nowIso,
      fileName,
      bucketLabels: parsed.bucketLabels,
      rows: parsed.rows,
      invoices: parsed.invoices,
      rowsCount: parsed.rows.length,
      uploadedBy: profile.id,
    };

    const { error: upsertError } = await admin
      .from("system_settings")
      .upsert({
        setting_key: OUTSTANDING_DATASET_KEY,
        setting_value: JSON.stringify(payload),
      }, { onConflict: "setting_key" });

    if (upsertError) throw upsertError;

    return NextResponse.json({
      success: true,
      uploadedAt: payload.uploadedAt,
      fileName: payload.fileName,
      rowsCount: payload.rowsCount,
      bucketLabels: payload.bucketLabels,
      customerPreview: payload.rows.slice(0, 5),
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || "Unable to upload outstanding file." }, { status: 500 });
  }
}
