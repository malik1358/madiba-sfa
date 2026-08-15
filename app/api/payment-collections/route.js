import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  OUTSTANDING_DATASET_KEY,
  customerCodeCandidates,
  extractLeadingCustomerCodeAndName,
  resolveOutstandingCustomerOwnership,
  summarizeOutstandingBuckets,
} from "../../lib/outstanding";
import { buildCollectionQueues, invoiceHasCashRef, normalizeWhatsappNumber } from "../../lib/paymentCollections";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const COLLECTION_BUCKET = "payment-collection-files";
const WHATSAPP_API_VERSION = process.env.WHATSAPP_API_VERSION || "v21.0";
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const WHATSAPP_API_TOKEN = process.env.WHATSAPP_API_TOKEN || "";
const WHATSAPP_GROUP_ID = process.env.WHATSAPP_GROUP_ID || "";
const MUTUAL_SALESMAN_GROUPS = [["JUNAID", "PARVEZ", "SOYEB"]];

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function normalizeName(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function normalizeLooseToken(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function normalizeDateOnly(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const matched = text.match(/^\d{4}-\d{2}-\d{2}/);
  if (matched) return matched[0];
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase();
}

function extractEmailLocalPart(email) {
  const raw = String(email || "").trim().toLowerCase();
  if (!raw) return "";
  return raw.includes("@") ? raw.split("@")[0] : raw;
}

function identitySearchPattern(value) {
  return normalizeCode(value)
    .replace(/[^A-Z0-9]+/g, "%")
    .replace(/^%+|%+$/g, "");
}

function isProductPromoterRole(role) {
  const normalized = normalizeRole(role);
  return normalized === "product-promoter" || normalized === "product_promoter";
}

function isInvoiceMakerRole(role) {
  const normalized = normalizeRole(role);
  return normalized === "invoice-maker" || normalized === "invoice_maker";
}

function isCollectorRole(role) {
  return normalizeRole(role) === "collector";
}

function isCollectionOnlyCode(code) {
  return /^CL\d+$/i.test(String(code || "").trim());
}

function isSalesTeamRole(role) {
  const normalized = normalizeRole(role);
  return ["salesman", "manager", "admin", "invoice-maker", "invoice_maker", "product-promoter", "product_promoter", "collector"].includes(normalized);
}

function resolveMutualGroupCodes(allProfiles, currentProfile) {
  const currentName = normalizeName(currentProfile?.salesman_name);
  const matchedGroup = MUTUAL_SALESMAN_GROUPS.find((group) => group.includes(currentName));
  if (!matchedGroup) return [];

  return allProfiles
    .filter((profile) => matchedGroup.includes(normalizeName(profile.salesman_name)))
    .map((profile) => normalizeCode(profile.salesman_code))
    .filter(Boolean);
}

function profileCodeCandidates(profile) {
  return [normalizeCode(profile?.salesman_code), normalizeCode(profile?.salesman_name)].filter(Boolean);
}

function authCodeCandidates(authUser) {
  const metadata = authUser?.user_metadata || authUser?.app_metadata || {};
  const localPart = extractEmailLocalPart(authUser?.email);

  return [
    normalizeCode(metadata.salesman_code),
    normalizeCode(metadata.salesman_name),
    normalizeCode(metadata.head_salesman_code),
    normalizeCode(metadata.head_salesman_name),
    normalizeCode(localPart),
    normalizeCode(localPart.replace(/[._-]+/g, " ")),
    normalizeCode(localPart.replace(/[._-]+/g, "")),
  ].filter(Boolean);
}

function fuzzyMatchedProfileCodes(allProfiles, authUser) {
  const localPart = extractEmailLocalPart(authUser?.email);
  const localToken = normalizeLooseToken(localPart);
  if (!localToken) return [];

  return allProfiles
    .filter((profile) => {
      const nameToken = normalizeLooseToken(profile?.salesman_name);
      const codeToken = normalizeLooseToken(profile?.salesman_code);
      return (
        (nameToken && (nameToken.includes(localToken) || localToken.includes(nameToken)))
        || (codeToken && (codeToken.includes(localToken) || localToken.includes(codeToken)))
      );
    })
    .flatMap((profile) => profileCodeCandidates(profile));
}

function latestCollectionKey(customerCode) {
  return `payment_collection_latest:${normalizeCode(customerCode)}`;
}

function historyCollectionKey(customerCode) {
  return `payment_collection_history:${normalizeCode(customerCode)}:${Date.now()}`;
}

function legalTransferKey(customerCode) {
  return `payment_collection_legal:${normalizeCode(customerCode)}`;
}

function parseJson(value) {
  try {
    return JSON.parse(value || "null");
  } catch {
    return null;
  }
}

function compareSavedAtDesc(left, right) {
  const leftTs = new Date(left?.saved_at || 0).getTime();
  const rightTs = new Date(right?.saved_at || 0).getTime();
  return rightTs - leftTs;
}

function safeFileName(name) {
  return String(name || "attachment")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "attachment";
}

function getBearerToken(request) {
  const authHeader = request.headers.get("authorization");
  return authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
}

function invoiceCustomerCode(invoice) {
  const storedCode = normalizeCode(invoice?.customer_code);
  const extractedFromCode = normalizeCode(extractLeadingCustomerCodeAndName(storedCode).customer_code);
  const extractedFromName = normalizeCode(extractLeadingCustomerCodeAndName(invoice?.customer_name).customer_code);
  return extractedFromCode || (storedCode && !/\s/.test(storedCode) ? storedCode : "") || extractedFromName;
}

function invoiceCustomerName(invoice) {
  const rawName = String(invoice?.customer_name || "").trim();
  const extractedFromCode = extractLeadingCustomerCodeAndName(invoice?.customer_code).customer_name;
  const extractedFromName = extractLeadingCustomerCodeAndName(rawName).customer_name;
  return extractedFromName || extractedFromCode || rawName;
}

async function resolveScope(admin, token) {
  const {
    data: { user },
    error: userError,
  } = await admin.auth.getUser(token);

  if (userError || !user) {
    throw new Error("Invalid login session");
  }

  const { data: currentProfile, error: profileError } = await admin
    .from("profiles")
    .select("id,role,salesman_code,salesman_name")
    .eq("id", user.id)
    .single();

  if (profileError || !currentProfile) {
    throw new Error("Profile not found.");
  }

  const role = normalizeRole(currentProfile.role);
  const currentSalesmanCode = normalizeCode(currentProfile.salesman_code);

  const [profilesRes, usersRes] = await Promise.all([
    admin
      .from("profiles")
      .select("id,role,salesman_code,salesman_name")
      .order("salesman_name"),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  if (profilesRes.error) throw profilesRes.error;
  if (usersRes.error) throw usersRes.error;

  const allProfiles = profilesRes.data || [];
  const scopedProfiles = allProfiles.filter((profile) => isSalesTeamRole(profile.role));
  const authUsers = usersRes.data?.users || [];
  const authMap = new Map(authUsers.map((entry) => [entry.id, entry]));
  const currentAuthUser = authMap.get(currentProfile.id) || user;
  const currentMetadata = currentAuthUser?.user_metadata || currentAuthUser?.app_metadata || {};
  const collectionOnlyAccess = Boolean(currentMetadata.collection_only)
    || isCollectorRole(role)
    || isCollectionOnlyCode(currentSalesmanCode);
  const inheritedHeadCode = normalizeCode(currentMetadata.head_salesman_code);

  let members = [];
  if (["admin", "manager"].includes(role)) {
    members = scopedProfiles;
  } else if (isProductPromoterRole(role) && inheritedHeadCode) {
    const subordinateIds = new Set();

    authUsers.forEach((authUser) => {
      const metadata = authUser?.user_metadata || authUser?.app_metadata || {};
      const headCode = normalizeCode(metadata.head_salesman_code);
      if (headCode && headCode === inheritedHeadCode) {
        subordinateIds.add(authUser.id);
      }
    });

    members = scopedProfiles.filter((profile) => {
      const profileCode = normalizeCode(profile.salesman_code);
      return profileCode === inheritedHeadCode || subordinateIds.has(profile.id);
    });
  } else {
    const subordinateIds = new Set();

    authUsers.forEach((authUser) => {
      const metadata = authUser?.user_metadata || authUser?.app_metadata || {};
      const headCode = normalizeCode(metadata.head_salesman_code);
      if (headCode && headCode === currentSalesmanCode) {
        subordinateIds.add(authUser.id);
      }
    });

    members = scopedProfiles.filter((profile) => profile.id === currentProfile.id || subordinateIds.has(profile.id));
    if (!members.some((profile) => profile.id === currentProfile.id)) {
      members = [currentProfile, ...members];
    }
  }

  const mutualGroupCodes = resolveMutualGroupCodes(allProfiles, currentProfile);
  const visibleSalesmanCodes = [...new Set([
    ...members.flatMap((member) => profileCodeCandidates(member)),
    ...authCodeCandidates(currentAuthUser),
    ...fuzzyMatchedProfileCodes(scopedProfiles, currentAuthUser),
    ...mutualGroupCodes,
  ])];

  return {
    userId: currentProfile.id,
    role,
    hasAllAccess: ["admin", "manager"].includes(role) || isInvoiceMakerRole(role) || collectionOnlyAccess,
    visibleSalesmanCodes,
  };
}

async function readOutstandingDataset(admin) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", OUTSTANDING_DATASET_KEY)
    .maybeSingle();

  if (error) throw error;
  const parsed = parseJson(data?.setting_value);

  return parsed && typeof parsed === "object"
    ? {
        uploadedAt: String(parsed.uploadedAt || ""),
        fileName: String(parsed.fileName || ""),
        rows: Array.isArray(parsed.rows) ? parsed.rows : [],
        invoices: Array.isArray(parsed.invoices) ? parsed.invoices : [],
      }
    : { uploadedAt: "", fileName: "", rows: [], invoices: [] };
}

async function readSettingsByPattern(admin, pattern) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_key,setting_value")
    .like("setting_key", pattern);

  if (error) throw error;
  return data || [];
}

async function ensureBucket(admin) {
  const { data: bucket, error: bucketError } = await admin.storage.getBucket(COLLECTION_BUCKET);
  if (!bucketError && bucket) return;

  const { error: createError } = await admin.storage.createBucket(COLLECTION_BUCKET, {
    public: false,
    fileSizeLimit: 20 * 1024 * 1024,
    allowedMimeTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/jpg"],
  });

  if (createError && !String(createError.message || "").toLowerCase().includes("already exists")) {
    throw createError;
  }
}

async function signedUrlForPath(admin, storagePath) {
  if (!storagePath) return "";
  const signed = await admin.storage.from(COLLECTION_BUCKET).createSignedUrl(storagePath, 60 * 60 * 24 * 30);
  return signed?.data?.signedUrl || "";
}

async function hydrateCollectionRecord(admin, record) {
  if (!record || typeof record !== "object") return null;
  const hydrated = { ...record };
  if (hydrated.payment_copy_path) hydrated.payment_copy_url = await signedUrlForPath(admin, hydrated.payment_copy_path);
  if (hydrated.receipt_copy_path) hydrated.receipt_copy_url = await signedUrlForPath(admin, hydrated.receipt_copy_path);
  return hydrated;
}

function customerMatchesScope(customerCode, ownership) {
  const candidates = customerCodeCandidates(customerCode).map(normalizeCode);
  return candidates.some((candidate) => ownership.ownedCustomerCodes.has(candidate));
}

async function fetchCustomerMasterMap(admin, customerCodes) {
  const map = new Map();
  const uniqueCodes = [...new Set((customerCodes || []).map(normalizeCode).filter(Boolean))];

  for (let start = 0; start < uniqueCodes.length; start += 200) {
    const chunk = uniqueCodes.slice(start, start + 200);
    const { data, error } = await admin
      .from("customers")
      .select("customer_code,customer_name,current_salesman_code,city,area,mobile,latest_transaction_date")
      .in("customer_code", chunk);

    if (error) throw error;
    (data || []).forEach((row) => {
      map.set(normalizeCode(row.customer_code), row);
    });
  }

  return map;
}

async function fetchSalesmanNameMap(admin, salesmanCodes) {
  const map = new Map();
  const uniqueCodes = [...new Set((salesmanCodes || []).map(normalizeCode).filter(Boolean))];

  for (let start = 0; start < uniqueCodes.length; start += 200) {
    const chunk = uniqueCodes.slice(start, start + 200);
    const { data, error } = await admin
      .from("profiles")
      .select("salesman_code,salesman_name")
      .in("salesman_code", chunk);

    if (error) throw error;
    (data || []).forEach((row) => {
      map.set(normalizeCode(row.salesman_code), String(row.salesman_name || "").trim());
    });
  }

  return map;
}

function buildQueueRecords(dataset, customerMasterMap, salesmanNameMap, latestMap, legalMap, historyMap, scope) {
  const ownership = scope.hasAllAccess
    ? { ownedCustomerCodes: new Set((dataset.invoices || []).map((invoice) => normalizeCode(invoiceCustomerCode(invoice))).filter(Boolean)) }
    : resolveOutstandingCustomerOwnership(dataset, scope.visibleSalesmanCodes);
  const grouped = new Map();

  (dataset.invoices || []).forEach((invoice) => {
    const customerCode = invoiceCustomerCode(invoice);
    if (!customerCode) return;
    if (!scope.hasAllAccess && !customerMatchesScope(customerCode, ownership)) return;

    const key = normalizeCode(customerCode);
    const current = grouped.get(key) || {
      customer_code: customerCode,
      customer_name: invoiceCustomerName(invoice),
      invoices: [],
    };
    current.invoices.push(invoice);
    grouped.set(key, current);
  });

  return [...grouped.values()].map((entry) => {
    const customerCode = normalizeCode(entry.customer_code);
    const master = customerMasterMap.get(customerCode) || {};
    const salesmanCode = normalizeCode(master.current_salesman_code);
    const fallbackInvoiceSalesman = (entry.invoices || [])
      .map((invoice) => String(invoice?.salesman || "").trim())
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right))[0] || "";
    const salesmanName = salesmanNameMap.get(salesmanCode)
      || String(master.current_salesman_code || "").trim()
      || fallbackInvoiceSalesman;
    const latestCollection = latestMap.get(customerCode) || null;
    const collectionHistory = historyMap.get(customerCode) || [];
    const legalTransfer = legalMap.get(customerCode) || null;
    const bucketTotals = (entry.invoices || []).reduce((acc, invoice) => {
      const invoiceDay = Number(invoice?.invoice_day || invoice?.overdue_days || 0);
      const pending = Number(invoice?.pending_amount || 0);
      if (invoiceHasCashRef(invoice)) {
        acc.cash += pending;
      } else if (invoiceDay <= 30) acc.days0To30 += pending;
      else if (invoiceDay <= 60) acc.days31To60 += pending;
      else if (invoiceDay <= 90) acc.days61To90 += pending;
      else if (invoiceDay <= 120) acc.days91To120 += pending;
      else acc.daysAbove120 += pending;
      return acc;
    }, {
      cash: 0,
      days0To30: 0,
      days31To60: 0,
      days61To90: 0,
      days91To120: 0,
      daysAbove120: 0,
    });

    const buckets = summarizeOutstandingBuckets({
      "0-30": bucketTotals.days0To30,
      "31-60": bucketTotals.days31To60,
      ">60": bucketTotals.days61To90 + bucketTotals.days91To120 + bucketTotals.daysAbove120,
    });

    return {
      customer_code: customerCode,
      customer_name: master.customer_name || entry.customer_name || customerCode,
      salesman_code: master.current_salesman_code || fallbackInvoiceSalesman || "",
      salesman_name: salesmanName || "",
      city: master.city || "",
      area: master.area || "",
      mobile: master.mobile || "",
      latest_transaction_date: master.latest_transaction_date || "",
      outstanding_cash: bucketTotals.cash,
      outstanding_0_30: buckets.days0To30,
      outstanding_30_60: buckets.days30To60,
      outstanding_61_90: bucketTotals.days61To90,
      outstanding_91_120: bucketTotals.days91To120,
      outstanding_above_120: bucketTotals.daysAbove120,
      outstanding_above_60: buckets.daysAbove60,
      total_outstanding: (entry.invoices || []).reduce((sum, invoice) => sum + Number(invoice?.pending_amount || 0), 0),
      invoices: entry.invoices,
      latest_collection: latestCollection,
      collection_history: collectionHistory,
      legal_transfer: legalTransfer,
    };
  });
}

async function sendWhatsappMessage(targetNumber, body) {
  if (!WHATSAPP_API_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    return { sent: false, error: "WhatsApp Business API is not configured." };
  }
  if (!targetNumber) {
    return { sent: false, error: "WhatsApp number is missing." };
  }

  const response = await fetch(`https://graph.facebook.com/${WHATSAPP_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: targetNumber,
      type: "text",
      text: {
        preview_url: false,
        body,
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { sent: false, error: String(payload?.error?.message || payload?.message || "WhatsApp send failed.") };
  }

  return {
    sent: true,
    messageId: Array.isArray(payload?.messages) ? payload.messages[0]?.id || "" : "",
  };
}

async function ensureCustomerVisible(admin, customerCode, customerName, scope, dataset) {
  const { data: customer, error } = await admin
    .from("customers")
    .select("customer_code,current_salesman_code")
    .eq("customer_code", customerCode)
    .maybeSingle();

  if (error) throw error;
  if (scope.hasAllAccess) {
    return customer || { customer_code: customerCode, current_salesman_code: "" };
  }

  if (customer && scope.visibleSalesmanCodes.includes(normalizeCode(customer.current_salesman_code))) {
    return customer;
  }

  const ownership = resolveOutstandingCustomerOwnership(dataset, scope.visibleSalesmanCodes);
  const matchesOutstanding = customerCodeCandidates(customerCode)
    .map(normalizeCode)
    .some((candidate) => ownership.ownedCustomerCodes.has(candidate));

  if (matchesOutstanding) {
    return customer || { customer_code: customerCode, current_salesman_code: "" };
  }

  const normalizedName = normalizeLooseToken(customerName);
  const hasNamedInvoice = (dataset.invoices || []).some((invoice) => {
    const invoiceCode = normalizeCode(invoiceCustomerCode(invoice));
    const invoiceName = normalizeLooseToken(invoiceCustomerName(invoice));
    return invoiceName && normalizedName && (invoiceName === normalizedName || invoiceName.includes(normalizedName) || normalizedName.includes(invoiceName))
      && ownership.ownedCustomerCodes.has(invoiceCode);
  });

  if (hasNamedInvoice) {
    return customer || { customer_code: customerCode, current_salesman_code: "" };
  }

  throw new Error("You do not have access to this customer.");
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const token = getBearerToken(request);
    if (!token) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const scope = await resolveScope(admin, token);
    const dataset = await readOutstandingDataset(admin);
    const [latestRows, historyRows, legalRows] = await Promise.all([
      readSettingsByPattern(admin, "payment_collection_latest:%"),
      readSettingsByPattern(admin, "payment_collection_history:%"),
      readSettingsByPattern(admin, "payment_collection_legal:%"),
    ]);

    const latestMap = new Map();
    for (const row of latestRows) {
      const payload = await hydrateCollectionRecord(admin, parseJson(row.setting_value));
      if (!payload?.customer_code) continue;
      latestMap.set(normalizeCode(payload.customer_code), payload);
    }

    const legalMap = new Map();
    for (const row of legalRows) {
      const payload = parseJson(row.setting_value);
      if (!payload?.customer_code) continue;
      legalMap.set(normalizeCode(payload.customer_code), payload);
    }

    const historyMap = new Map();
    for (const row of historyRows) {
      const payload = parseJson(row.setting_value);
      if (!payload?.customer_code) continue;
      const customerCode = normalizeCode(payload.customer_code);
      const items = historyMap.get(customerCode) || [];
      items.push(payload);
      historyMap.set(customerCode, items);
    }
    for (const [customerCode, items] of historyMap.entries()) {
      historyMap.set(customerCode, items.sort(compareSavedAtDesc).slice(0, 3));
    }

    const scopedOwnership = scope.hasAllAccess
      ? { ownedCustomerCodes: new Set((dataset.invoices || []).map((invoice) => normalizeCode(invoiceCustomerCode(invoice))).filter(Boolean)) }
      : resolveOutstandingCustomerOwnership(dataset, scope.visibleSalesmanCodes);
    const visibleCodes = [...new Set((dataset.invoices || [])
      .map((invoice) => normalizeCode(invoiceCustomerCode(invoice)))
      .filter((code) => code && (scope.hasAllAccess || scopedOwnership.ownedCustomerCodes.has(code))))];
    const customerMasterMap = await fetchCustomerMasterMap(admin, visibleCodes);
    const salesmanCodes = [...new Set([...customerMasterMap.values()]
      .map((row) => normalizeCode(row.current_salesman_code))
      .filter(Boolean))];
    const salesmanNameMap = await fetchSalesmanNameMap(admin, salesmanCodes);

    const queueRecords = buildQueueRecords(dataset, customerMasterMap, salesmanNameMap, latestMap, legalMap, historyMap, scope);
    const queues = buildCollectionQueues(queueRecords, new Date().toISOString());

    return NextResponse.json({
      success: true,
      uploadedAt: dataset.uploadedAt,
      fileName: dataset.fileName,
      role: scope.role,
      dueCustomers: queues.dueCustomers,
      legalCustomers: queues.legalCustomers,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || "Unable to load payment collection queue." }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const token = getBearerToken(request);
    if (!token) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const customerCode = normalizeCode(body?.customerCode);
    const customerName = String(body?.customerName || "").trim();
    if (!customerCode) {
      return NextResponse.json({ success: false, error: "Customer code is required." }, { status: 400 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const scope = await resolveScope(admin, token);
    const dataset = await readOutstandingDataset(admin);
    await ensureCustomerVisible(admin, customerCode, customerName, scope, dataset);

    const action = String(body?.action || "transfer").trim().toLowerCase();
    if (action === "remove") {
      const { error } = await admin.from("system_settings").delete().eq("setting_key", legalTransferKey(customerCode));
      if (error) throw error;
      return NextResponse.json({ success: true, customerCode, legalTransfer: null });
    }

    const value = {
      customer_code: customerCode,
      customer_name: customerName,
      is_transferred: true,
      note: String(body?.note || "").trim(),
      transferred_at: new Date().toISOString(),
      transferred_by_user_id: scope.userId,
    };

    const { error } = await admin.from("system_settings").upsert({
      setting_key: legalTransferKey(customerCode),
      setting_value: JSON.stringify(value),
    }, { onConflict: "setting_key" });
    if (error) throw error;

    return NextResponse.json({ success: true, customerCode, legalTransfer: value });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || "Unable to update legal transfer status." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const token = getBearerToken(request);
    if (!token) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      return NextResponse.json({ success: false, error: "Multipart form data is required." }, { status: 400 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const scope = await resolveScope(admin, token);
    const dataset = await readOutstandingDataset(admin);
    const form = await request.formData();

    const customerCode = normalizeCode(form.get("customerCode"));
    const customerName = String(form.get("customerName") || "").trim();
    const paymentStatus = String(form.get("paymentStatus") || "").trim().toUpperCase();
    const amountReceived = Number(form.get("amountReceived") || 0);
    const receiptMode = String(form.get("receiptMode") || "").trim();
    const nonPaymentReason = String(form.get("nonPaymentReason") || "").trim();
    const nextVisitAt = normalizeDateOnly(form.get("nextVisitAt"));
    const visitOutcome = String(form.get("visitOutcome") || "").trim().toUpperCase();
    const remarkArabic = String(form.get("remarkArabic") || "").trim();
    const remarkEnglish = String(form.get("remarkEnglish") || "").trim();
    const summaryText = String(form.get("summaryText") || "").trim();
    const note = String(form.get("note") || "").trim();
    const whatsappNumberInput = normalizeWhatsappNumber(form.get("whatsappNumber"));
    const whatsappTarget = String(WHATSAPP_GROUP_ID || whatsappNumberInput || "").trim();
    const whatsappMessage = String(form.get("whatsappMessage") || "").trim();

    if (!customerCode) {
      return NextResponse.json({ success: false, error: "Customer code is required." }, { status: 400 });
    }
    if (!["PAID", "PARTIAL", "NOT_PAID", "PROMISED"].includes(paymentStatus)) {
      return NextResponse.json({ success: false, error: "Payment status is required." }, { status: 400 });
    }
    if (["PAID", "PARTIAL"].includes(paymentStatus) && amountReceived <= 0) {
      return NextResponse.json({ success: false, error: "Amount received must be greater than zero." }, { status: 400 });
    }
    if (["PAID", "PARTIAL"].includes(paymentStatus) && !receiptMode) {
      return NextResponse.json({ success: false, error: "Mode of receipt is required." }, { status: 400 });
    }
    if (paymentStatus !== "PAID" && !nextVisitAt) {
      return NextResponse.json({ success: false, error: "Next visit is required when full overdue is not received." }, { status: 400 });
    }

    await ensureCustomerVisible(admin, customerCode, customerName, scope, dataset);
    await ensureBucket(admin);

    let paymentCopyPath = "";
    let receiptCopyPath = "";
    const paymentCopy = form.get("paymentCopy");
    const receiptCopy = form.get("receiptCopy");

    if (paymentCopy instanceof File && paymentCopy.size > 0) {
      const path = `${customerCode}/${Date.now()}-payment-${safeFileName(paymentCopy.name)}`;
      const arrayBuffer = await paymentCopy.arrayBuffer();
      const uploadRes = await admin.storage.from(COLLECTION_BUCKET).upload(path, arrayBuffer, {
        contentType: paymentCopy.type || "application/octet-stream",
        upsert: true,
      });
      if (uploadRes.error) throw uploadRes.error;
      paymentCopyPath = path;
    }

    if (receiptCopy instanceof File && receiptCopy.size > 0) {
      const path = `${customerCode}/${Date.now()}-receipt-${safeFileName(receiptCopy.name)}`;
      const arrayBuffer = await receiptCopy.arrayBuffer();
      const uploadRes = await admin.storage.from(COLLECTION_BUCKET).upload(path, arrayBuffer, {
        contentType: receiptCopy.type || "application/octet-stream",
        upsert: true,
      });
      if (uploadRes.error) throw uploadRes.error;
      receiptCopyPath = path;
    }

    const value = {
      customer_code: customerCode,
      customer_name: customerName,
      payment_status: paymentStatus,
      amount_received: amountReceived,
      receipt_mode: receiptMode,
      non_payment_reason: nonPaymentReason,
      next_visit_at: nextVisitAt || null,
      visit_outcome: visitOutcome || null,
      remark_arabic: remarkArabic || null,
      remark_english: remarkEnglish || null,
      summary_text: summaryText || null,
      note: note || null,
      whatsapp_number: whatsappTarget || null,
      payment_copy_path: paymentCopyPath || null,
      receipt_copy_path: receiptCopyPath || null,
      saved_by_user_id: scope.userId,
      saved_at: new Date().toISOString(),
      source: "system_settings_fallback",
    };

    let whatsapp = null;
    if (whatsappMessage) {
      whatsapp = await sendWhatsappMessage(whatsappTarget, whatsappMessage);
      value.whatsapp_sent = Boolean(whatsapp?.sent);
      value.whatsapp_error = whatsapp?.error || null;
      value.whatsapp_message = whatsappMessage;
      value.whatsapp_sent_at = whatsapp?.sent ? new Date().toISOString() : null;
    }

    const { error: latestError } = await admin.from("system_settings").upsert({
      setting_key: latestCollectionKey(customerCode),
      setting_value: JSON.stringify(value),
    }, { onConflict: "setting_key" });
    if (latestError) throw latestError;

    const { error: historyError } = await admin.from("system_settings").insert({
      setting_key: historyCollectionKey(customerCode),
      setting_value: JSON.stringify(value),
    });
    if (historyError) {
      console.error("payment collection history insert failed", historyError);
    }

    const hydrated = await hydrateCollectionRecord(admin, value);
    return NextResponse.json({ success: true, customerCode, value: hydrated, whatsapp });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || "Unable to save payment collection visit." }, { status: 500 });
  }
}