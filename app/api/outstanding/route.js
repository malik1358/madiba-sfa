import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import {
  OUTSTANDING_DATASET_KEY,
  buildOutstandingRow,
  findOutstandingForCustomer,
  normalizeCode,
  normalizeName,
  parseBucketLabelFromHeader,
  sortBucketLabels,
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
    };
  }

  return {
    uploadedAt: String(parsed.uploadedAt || ""),
    fileName: String(parsed.fileName || ""),
    bucketLabels: sortBucketLabels(parsed.bucketLabels || []),
    rows: Array.isArray(parsed.rows) ? parsed.rows.map(buildOutstandingRow) : [],
  };
}

function findHeaderRow(rows) {
  const maxRows = Math.min(rows.length, 25);

  for (let r = 0; r < maxRows; r += 1) {
    const row = Array.isArray(rows[r]) ? rows[r] : [];
    const labels = row.map((cell) => String(cell || "").trim());

    const hasCustomer = labels.some((label) => {
      const normalized = label.toLowerCase();
      return normalized.includes("customer") || normalized.includes("party");
    });

    const hasBucket = labels.some((label) => Boolean(parseBucketLabelFromHeader(label)));

    if (hasCustomer && hasBucket) {
      return r;
    }
  }

  return -1;
}

function detectColumnIndexes(headerRow) {
  const indexes = {
    customerCode: -1,
    customerName: -1,
    openInvoices: -1,
    buckets: [],
  };

  const codeAliases = ["customer code", "customer_code", "cust code", "customer no", "account code", "code"];
  const nameAliases = ["customer name", "customer", "party name", "name", "account name"];

  headerRow.forEach((cell, idx) => {
    const text = String(cell || "").trim();
    const normalized = text.toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ");

    if (indexes.customerCode < 0 && codeAliases.some((alias) => normalized === alias || normalized.includes(alias))) {
      indexes.customerCode = idx;
    }

    if (indexes.customerName < 0 && nameAliases.some((alias) => normalized === alias || normalized.includes(alias))) {
      indexes.customerName = idx;
    }

    const bucketLabel = parseBucketLabelFromHeader(text);
    if (!bucketLabel) return;

    if (bucketLabel === "open_invoices") {
      indexes.openInvoices = idx;
      return;
    }

    indexes.buckets.push({ idx, label: bucketLabel });
  });

  return indexes;
}

function parseOutstandingRows(rows, headerRowIndex) {
  const headerRow = rows[headerRowIndex] || [];
  const columns = detectColumnIndexes(headerRow);

  if (columns.buckets.length === 0 && columns.openInvoices < 0) {
    throw new Error("Could not detect bucket columns or open invoices column in uploaded file.");
  }

  const aggregate = new Map();
  const bucketLabels = sortBucketLabels(columns.buckets.map((bucket) => bucket.label));

  for (let r = headerRowIndex + 1; r < rows.length; r += 1) {
    const row = Array.isArray(rows[r]) ? rows[r] : [];
    const customerCode = columns.customerCode >= 0 ? String(row[columns.customerCode] || "").trim() : "";
    const customerName = columns.customerName >= 0 ? String(row[columns.customerName] || "").trim() : "";

    if (!customerCode && !customerName) continue;

    const rowBuckets = {};
    let hasAnyValue = false;

    columns.buckets.forEach((bucket) => {
      const value = toNumber(row[bucket.idx]);
      rowBuckets[bucket.label] = value;
      if (value !== 0) hasAnyValue = true;
    });

    const openInvoices = columns.openInvoices >= 0 ? toNumber(row[columns.openInvoices]) : 0;
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
  }

  const parsedRows = Array.from(aggregate.values())
    .map((row) => buildOutstandingRow(row))
    .sort((a, b) => normalizeName(a.customer_name).localeCompare(normalizeName(b.customer_name)));

  return {
    rows: parsedRows,
    bucketLabels,
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

    return NextResponse.json({
      success: true,
      uploadedAt: dataset.uploadedAt,
      fileName: dataset.fileName,
      bucketLabels: dataset.bucketLabels,
      customer,
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

    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error("Excel file is empty.");
    }

    const headerRowIndex = findHeaderRow(rows);
    if (headerRowIndex < 0) {
      throw new Error("Unable to detect header row. Ensure file includes customer and bucket columns.");
    }

    const parsed = parseOutstandingRows(rows, headerRowIndex);
    const nowIso = new Date().toISOString();

    const payload = {
      uploadedAt: nowIso,
      fileName,
      bucketLabels: parsed.bucketLabels,
      rows: parsed.rows,
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
