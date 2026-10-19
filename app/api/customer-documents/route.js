import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { extractCustomerDocumentTextSafe } from "../../lib/extractCustomerDocumentText.js";
import {
  buildCustomerDocumentCompliance,
  canonicalCrFromDocuments,
  normalizeDocumentType,
  normalizeVatNumber,
  parseCustomerDocumentText,
  relinkCustomerDocuments,
  resolveDocumentLinkStatus,
  findDuplicateVatHolder,
  formatVatConflictError,
  validateDocumentDates,
} from "../../lib/customerDocumentParse.js";
import { isMissingRelationError } from "../../lib/schemaGuards.js";

export const runtime = "nodejs";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const CUSTOMER_DOCUMENTS_BUCKET = "customer-documents";
const DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];

function adminClient() {
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function safeFileName(name) {
  return String(name || "document.pdf")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "document.pdf";
}

async function requireUser(admin, request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw Object.assign(new Error("Not authenticated"), { status: 401 });
  }

  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: userError } = await admin.auth.getUser(token);
  if (userError || !user) {
    throw Object.assign(new Error("Invalid login session"), { status: 401 });
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,role,salesman_code")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    throw Object.assign(new Error("Profile not found."), { status: 403 });
  }

  return { user, profile, role: String(profile.role || "").toLowerCase() };
}

function isManagerRole(role) {
  return ["admin", "manager"].includes(String(role || "").toLowerCase());
}

async function ensureBucket(admin) {
  const { data: bucket, error: bucketError } = await admin.storage.getBucket(CUSTOMER_DOCUMENTS_BUCKET);
  if (!bucketError && bucket) return;

  const { error: createError } = await admin.storage.createBucket(CUSTOMER_DOCUMENTS_BUCKET, {
    public: true,
    fileSizeLimit: 20 * 1024 * 1024,
    allowedMimeTypes: DOCUMENT_MIME_TYPES,
  });

  if (createError && !String(createError.message || "").toLowerCase().includes("already exists")) {
    throw createError;
  }
}

function publicUrlFor(path) {
  if (!path) return "";
  return `${supabaseUrl}/storage/v1/object/public/${CUSTOMER_DOCUMENTS_BUCKET}/${path}`;
}

function withFileUrl(row) {
  if (!row) return row;
  return {
    ...row,
    file_url: publicUrlFor(row.file_path),
  };
}

async function loadCustomer(admin, customerCode) {
  const code = String(customerCode || "").trim();
  if (!code) throw Object.assign(new Error("Customer code is required."), { status: 400 });

  const full = await admin
    .from("customers")
    .select("customer_code,customer_name,vat_number,cr_number,current_salesman_code")
    .eq("customer_code", code)
    .maybeSingle();

  if (!full.error) {
    if (!full.data) throw Object.assign(new Error("Customer not found."), { status: 404 });
    return full.data;
  }

  if (!isMissingRelationError(full.error) && !/cr_number/i.test(full.error.message || "")) {
    throw full.error;
  }

  const fallback = await admin
    .from("customers")
    .select("customer_code,customer_name,vat_number,current_salesman_code")
    .eq("customer_code", code)
    .maybeSingle();

  if (fallback.error) throw fallback.error;
  if (!fallback.data) throw Object.assign(new Error("Customer not found."), { status: 404 });
  return { ...fallback.data, cr_number: "" };
}

async function loadDocuments(admin, customerCode) {
  const { data, error } = await admin
    .from("customer_documents")
    .select("id,customer_code,document_type,file_path,expiry_date,uploaded_by_salesman_code,created_at,extracted_json,parsed_cr_number,parsed_vat_number,issue_date,link_status,link_message,original_file_name")
    .eq("customer_code", customerCode)
    .order("created_at", { ascending: false });

  if (error) {
    if (isMissingRelationError(error)) {
      throw Object.assign(new Error("Run the customer documents SQL migration in Supabase first."), { status: 500 });
    }
    throw error;
  }

  return data || [];
}

async function persistRelinkedDocuments(admin, documents, customerCr) {
  const linked = relinkCustomerDocuments(documents, customerCr);
  await Promise.all(linked.map(async (row) => {
    const previous = (documents || []).find((entry) => entry.id === row.id);
    if (!row?.id || !previous) return;
    if (previous.link_status === row.link_status && previous.link_message === row.link_message) return;
    await admin
      .from("customer_documents")
      .update({
        link_status: row.link_status,
        link_message: row.link_message,
      })
      .eq("id", row.id);
  }));
  return linked;
}

async function findExistingVatHolder(admin, vatNumber, excludeCustomerCode) {
  const vat = normalizeVatNumber(vatNumber);
  if (!vat) return null;

  const customers = await admin
    .from("customers")
    .select("customer_code,customer_name,vat_number")
    .neq("customer_code", excludeCustomerCode)
    .or(`vat_number.eq.${vat},vat_number.ilike.%${vat}%`)
    .limit(20);
  if (customers.error) throw customers.error;
  const fromCustomers = findDuplicateVatHolder(customers.data, vat, excludeCustomerCode);
  if (fromCustomers) return fromCustomers;

  const docs = await admin
    .from("customer_documents")
    .select("customer_code,parsed_vat_number")
    .eq("parsed_vat_number", vat)
    .neq("customer_code", excludeCustomerCode)
    .limit(20);
  if (docs.error) {
    if (isMissingRelationError(docs.error)) return null;
    throw docs.error;
  }
  const fromDocs = findDuplicateVatHolder(docs.data, vat, excludeCustomerCode);
  if (!fromDocs) return null;

  const named = await admin
    .from("customers")
    .select("customer_code,customer_name,vat_number")
    .eq("customer_code", fromDocs.customer_code)
    .maybeSingle();
  if (named.error) throw named.error;
  return named.data || fromDocs;
}

function jsonError(error) {
  const status = Number(error?.status) || 500;
  return NextResponse.json({ success: false, error: error.message || "Unable to process customer documents." }, { status });
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const admin = adminClient();
    await requireUser(admin, request);

    const url = new URL(request.url);
    const customerCode = String(url.searchParams.get("customerCode") || "").trim();
    const customer = await loadCustomer(admin, customerCode);
    const documents = await loadDocuments(admin, customer.customer_code);
    const linked = relinkCustomerDocuments(documents, customer.cr_number);

    return NextResponse.json({
      success: true,
      customer: {
        customer_code: customer.customer_code,
        customer_name: customer.customer_name,
        cr_number: canonicalCrFromDocuments(linked, customer.cr_number) || customer.cr_number || "",
        vat_number: customer.vat_number || "",
      },
      documents: linked.map(withFileUrl),
      compliance: buildCustomerDocumentCompliance(linked, customer),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const admin = adminClient();
    const auth = await requireUser(admin, request);
    if (!isManagerRole(auth.role)) {
      throw Object.assign(new Error("Only admin or manager can upload customer documents."), { status: 403 });
    }

    const formData = await request.formData();
    const customerCode = String(formData.get("customerCode") || "").trim();
    const documentType = normalizeDocumentType(formData.get("documentType"));
    const file = formData.get("file");
    const issueDate = String(formData.get("issueDate") || "").trim();
    const expiryDate = String(formData.get("expiryDate") || "").trim();
    const crNumber = String(formData.get("crNumber") || "").trim();
    const vatNumber = String(formData.get("vatNumber") || "").trim();
    const address = String(formData.get("address") || "").trim();

    if (!documentType) throw Object.assign(new Error("Select a document type."), { status: 400 });
    if (!file || typeof file === "string" || !file.size) {
      throw Object.assign(new Error("Choose a PDF or image file."), { status: 400 });
    }

    const enteredDates = validateDocumentDates({ issueDate, expiryDate });
    if (!enteredDates.ok) {
      throw Object.assign(new Error(enteredDates.error), { status: 400 });
    }

    const customer = await loadCustomer(admin, customerCode);
    await ensureBucket(admin);

    const buffer = Buffer.from(await file.arrayBuffer());
    const mime = String(file.type || "").toLowerCase();
    let text = "";
    try {
      text = await extractCustomerDocumentTextSafe({
        buffer,
        mime,
        fileName: file.name,
        timeoutMs: 40000,
      });
    } catch {
      text = "";
    }

    const parsed = parseCustomerDocumentText(documentType, text, {
      issueDate,
      expiryDate,
      crNumber,
      vatNumber,
      address,
    });
    const dates = validateDocumentDates({
      issueDate: parsed.issue_date,
      expiryDate: parsed.expiry_date,
    });
    if (!dates.ok) {
      throw Object.assign(new Error(dates.error), { status: 400 });
    }

    if (parsed.documentType === "VAT") {
      if (!parsed.parsed_vat_number) {
        throw Object.assign(new Error("Could not read the VAT registration number. Enter it and upload again."), { status: 400 });
      }
      const vatHolder = await findExistingVatHolder(admin, parsed.parsed_vat_number, customer.customer_code);
      if (vatHolder) {
        throw Object.assign(new Error(formatVatConflictError(parsed.parsed_vat_number, vatHolder)), { status: 400 });
      }
    }

    const existing = await loadDocuments(admin, customer.customer_code);
    const canonicalCr = parsed.documentType === "CR"
      ? (parsed.parsed_cr_number || customer.cr_number)
      : canonicalCrFromDocuments(existing, customer.cr_number);
    const link = parsed.documentType === "CR" && parsed.parsed_cr_number
      ? { link_status: "MATCHED", link_message: `Canonical CR ${parsed.parsed_cr_number}.` }
      : resolveDocumentLinkStatus({
        parsedCr: parsed.parsed_cr_number,
        canonicalCr,
        unparsed: parsed.unparsed,
      });

    const stamp = Date.now();
    const fileName = safeFileName(file.name);
    const filePath = `${customer.customer_code}/${parsed.documentType}/${stamp}-${fileName}`;

    const { error: uploadError } = await admin.storage
      .from(CUSTOMER_DOCUMENTS_BUCKET)
      .upload(filePath, buffer, {
        contentType: mime || "application/pdf",
        upsert: true,
      });
    if (uploadError) throw uploadError;

    const insertRow = {
      customer_code: customer.customer_code,
      document_type: parsed.documentType,
      file_path: filePath,
      expiry_date: parsed.expiry_date,
      uploaded_by_salesman_code: auth.profile.salesman_code || null,
      extracted_json: parsed,
      parsed_cr_number: parsed.parsed_cr_number || null,
      parsed_vat_number: parsed.parsed_vat_number || null,
      issue_date: parsed.issue_date,
      link_status: link.link_status,
      link_message: link.link_message,
      original_file_name: String(file.name || fileName),
    };

    const { data: inserted, error: insertError } = await admin
      .from("customer_documents")
      .insert(insertRow)
      .select("id,customer_code,document_type,file_path,expiry_date,uploaded_by_salesman_code,created_at,extracted_json,parsed_cr_number,parsed_vat_number,issue_date,link_status,link_message,original_file_name")
      .single();

    if (insertError) {
      if (isMissingRelationError(insertError)) {
        throw Object.assign(new Error("Run the customer documents SQL migration in Supabase first."), { status: 500 });
      }
      throw insertError;
    }

    const nextCustomer = { ...customer };
    if (parsed.documentType === "CR" && parsed.parsed_cr_number) {
      const { error: crError } = await admin
        .from("customers")
        .update({ cr_number: parsed.parsed_cr_number })
        .eq("customer_code", customer.customer_code);
      if (!crError) nextCustomer.cr_number = parsed.parsed_cr_number;
    }
    if (parsed.documentType === "VAT" && parsed.parsed_vat_number) {
      const { error: vatError } = await admin
        .from("customers")
        .update({ vat_number: parsed.parsed_vat_number })
        .eq("customer_code", customer.customer_code);
      if (vatError) throw vatError;
      nextCustomer.vat_number = parsed.parsed_vat_number;
    }
    const allDocs = await loadDocuments(admin, customer.customer_code);
    const linked = await persistRelinkedDocuments(admin, allDocs, nextCustomer.cr_number);

    return NextResponse.json({
      success: true,
      document: withFileUrl(inserted),
      documents: linked.map(withFileUrl),
      customer: {
        customer_code: nextCustomer.customer_code,
        customer_name: nextCustomer.customer_name,
        cr_number: canonicalCrFromDocuments(linked, nextCustomer.cr_number) || nextCustomer.cr_number || "",
        vat_number: nextCustomer.vat_number || "",
      },
      compliance: buildCustomerDocumentCompliance(linked, nextCustomer),
    });
  } catch (error) {
    return jsonError(error);
  }
}
