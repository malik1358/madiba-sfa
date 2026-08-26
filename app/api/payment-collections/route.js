import { createClient } from "@supabase/supabase-js";
import { buildCollectionQueues, customerMatchesCollectionScope, filterCollectionQueueInvoices, redactCollectionVisitScheduleForViewer } from "../../lib/paymentCollections.js";
import { buildGpsActivityNote, normalizeGpsCapturePlatform } from "../../lib/geo.js";
import { shouldRequireTransactionGps } from "../../lib/moduleAccess.js";
import { queueTransactionBossAlerts } from "../../lib/transactionBossAlerts.js";
import { resolveMutualGroupProfiles, buildSalesmanScopeMatchers, normalizeSalesmanCode } from "../../lib/mutualSalesmanGroups.js";
import {
  OUTSTANDING_DATASET_KEY,
  extractLeadingCustomerCodeAndName,
  findOutstandingForCustomer,
  hydrateOutstandingInvoices,
  isPlaceholderSalesmanValue,
  mergeOutstandingInvoiceSources,
  pickOutstandingSalesmanName,
  customerAccountCodesMatch,
  resolveCustomerAccountCode,
  resolveCollectionOutstandingBuckets,
  resolveOutstandingInvoiceCustomerCode,
  toNumber,
} from "../../lib/outstanding.js";
import { needsEnglishTranslation, translateText } from "../../lib/translateText.js";
import { formatCollectionUserDisplayName } from "../../lib/geo.js";
import { patchCollectionVisitSummaryVisitNumber } from "../../lib/collectionVisitSummary.js";
import { getKsaDateString, ksaDayBounds } from "../../lib/workdayActivity.js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const COLLECTION_FILES_BUCKET = "payment-collections";
const COLLECTION_FILE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
];

export const maxDuration = 60;

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

// Customer codes in uploads appear as "1114C SOME NAME" or "1442-MADAR SOME NAME".
function canonicalCustomerCode(value) {
  return resolveCustomerAccountCode(value);
}

function preferMatchingCustomerKey(candidates, targetCode) {
  const normalizedTarget = canonicalCustomerCode(targetCode);
  if (!normalizedTarget) return "";

  let bestMatch = "";
  (candidates || []).forEach((candidate) => {
    const normalizedCandidate = canonicalCustomerCode(candidate);
    if (!normalizedCandidate) return;
    if (!customerAccountCodesMatch(normalizedCandidate, normalizedTarget)) return;

    if (
      !bestMatch
      || normalizedCandidate.length > bestMatch.length
      || (normalizedCandidate.length === bestMatch.length && normalizedCandidate.localeCompare(bestMatch) < 0)
    ) {
      bestMatch = normalizedCandidate;
    }
  });

  return bestMatch || normalizedTarget;
}

function findScopedCollectionRecord(records, customerCode) {
  const target = canonicalCustomerCode(customerCode);
  if (!target) return null;

  return (records || []).find((record) => customerAccountCodesMatch(record?.customer_code, target)) || null;
}

async function readOutstandingInvoicesFromTable(admin) {
  const { data: invoiceRows, error } = await admin
    .from("invoices")
    .select("invoice_number,customer_code,due_date,pending_amount,ref_no,salesman_code")
    .gt("pending_amount", 0);

  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }

  if (!Array.isArray(invoiceRows) || invoiceRows.length === 0) return [];

  const { data: customers, error: customersError } = await admin
    .from("customers")
    .select("customer_code,customer_name,current_salesman_code");

  if (customersError) throw customersError;

  const customerByCode = new Map();
  (customers || []).forEach((customer) => {
    const key = canonicalCustomerCode(customer.customer_code);
    if (key) customerByCode.set(key, customer);
  });

  const { data: salesmen, error: salesmenError } = await admin
    .from("profiles")
    .select("salesman_code,salesman_name");

  if (salesmenError) throw salesmenError;

  const salesmanNameByCode = new Map();
  (salesmen || []).forEach((salesman) => {
    const key = normalizeCode(salesman.salesman_code);
    if (key) salesmanNameByCode.set(key, String(salesman.salesman_name || "").trim());
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return invoiceRows.map((row) => {
    const customerCode = canonicalCustomerCode(row.customer_code);
    const customer = customerByCode.get(customerCode);
    const salesmanCode = normalizeCode(row.salesman_code || customer?.current_salesman_code || "");
    const dueDateText = String(row.due_date || "").slice(0, 10);
    let overdueDays = null;

    if (dueDateText) {
      const dueDate = new Date(`${dueDateText}T00:00:00`);
      if (!Number.isNaN(dueDate.getTime())) {
        overdueDays = Math.max(0, Math.floor((today - dueDate) / (24 * 60 * 60 * 1000)));
      }
    }

    return {
      customer_code: customerCode || row.customer_code,
      customer_name: customer?.customer_name || customerCode || row.customer_code,
      ref_no: String(row.ref_no || row.invoice_number || "").trim(),
      invoice_date: "",
      due_date: dueDateText,
      pending_amount: row.pending_amount,
      overdue_days: overdueDays,
      salesman: salesmanNameByCode.get(salesmanCode) || salesmanCode,
    };
  });
}

async function readOutstandingDataset(admin) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", OUTSTANDING_DATASET_KEY)
    .maybeSingle();

  if (error) return { invoices: [], rows: [] };

  let parsed = null;
  try {
    parsed = typeof data?.setting_value === "string" ? JSON.parse(data.setting_value) : data?.setting_value;
  } catch {
    return { invoices: [], rows: [] };
  }

  const hasUploadedDataset = Boolean(
    (Array.isArray(parsed?.invoices) && parsed.invoices.length > 0)
    || (Array.isArray(parsed?.rows) && parsed.rows.length > 0),
  );

  if (hasUploadedDataset) {
    const hydrated = hydrateOutstandingInvoices(parsed);
    const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
    if (hydrated.length > 0) {
      const tableInvoices = await readOutstandingInvoicesFromTable(admin);
      return {
        invoices: mergeOutstandingInvoiceSources(hydrated, tableInvoices),
        rows,
      };
    }
  }

  // Staging/dev fallback when no outstanding workbook has been uploaded yet.
  return {
    invoices: await readOutstandingInvoicesFromTable(admin),
    rows: [],
  };
}

async function readOutstandingInvoices(admin) {
  const { invoices } = await readOutstandingDataset(admin);
  return invoices;
}

function isMissingTableError(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42P01"
    || message.includes("could not find the table")
    || message.includes("relation") && message.includes("does not exist");
}

function isMissingColumnError(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42703" || (message.includes("column") && message.includes("does not exist"));
}

async function countCollectionVisitsForUserDay(admin, userId, dateString = getKsaDateString()) {
  const { startIso, endIso } = ksaDayBounds(dateString);
  const { count, error } = await admin
    .from("collection_visits")
    .select("id", { count: "exact", head: true })
    .eq("created_by", userId)
    .gte("saved_at", startIso)
    .lte("saved_at", endIso);

  if (error) throw error;
  return Number(count || 0);
}

function storageExtension(file) {
  const name = String(file?.name || "").toLowerCase();
  if (name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".png")) return "png";
  if (name.endsWith(".webp")) return "webp";
  if (name.endsWith(".heic")) return "heic";
  if (name.endsWith(".heif")) return "heif";
  const mime = String(file?.type || "").toLowerCase();
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/heic") return "heic";
  if (mime === "image/heif") return "heif";
  return "jpg";
}

function uploadContentType(file) {
  const mime = String(file?.type || "").trim();
  if (mime) return mime;
  const ext = storageExtension(file);
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "heic") return "image/heic";
  if (ext === "heif") return "image/heif";
  return "image/jpeg";
}

async function ensureCollectionFilesBucket(admin) {
  const bucketConfig = {
    public: true,
    fileSizeLimit: 20 * 1024 * 1024,
    allowedMimeTypes: COLLECTION_FILE_MIME_TYPES,
  };

  const { data: bucket, error: bucketError } = await admin.storage.getBucket(COLLECTION_FILES_BUCKET);
  if (bucketError && !String(bucketError.message || "").toLowerCase().includes("not found")) {
    throw bucketError;
  }

  if (!bucket) {
    const { error: createError } = await admin.storage.createBucket(COLLECTION_FILES_BUCKET, bucketConfig);
    if (createError && !String(createError.message || "").toLowerCase().includes("already exists")) {
      throw createError;
    }
    return;
  }

  const { error: updateError } = await admin.storage.updateBucket(COLLECTION_FILES_BUCKET, bucketConfig);
  if (updateError) throw updateError;
}

function formatRouteError(error) {
  const message = String(
    error?.message
    || error?.details
    || error?.error
    || error?.hint
    || "",
  ).trim();
  const lower = message.toLowerCase();

  if (lower.includes("foreign key") || lower.includes("collection_visits_customer_code_fkey")) {
    return "Customer record is missing in the master list. Ask admin to add this customer in Customer Master.";
  }
  if (lower.includes("mime type") || lower.includes("invalid file type") || lower.includes("not allowed")) {
    return "This photo format is not supported. Retake the photo or choose JPG/PNG/PDF.";
  }
  if (lower.includes("payload too large") || lower.includes("entity too large") || lower.includes("too large")) {
    return "The uploaded file is too large. Retake the photo or choose a smaller file.";
  }
  if (message) return message;
  return "Unable to save collection visit";
}

async function ensureCollectionCustomerRecord(admin, customerCode, customerName) {
  const code = canonicalCustomerCode(customerCode);
  if (!code) throw new Error("Customer code is required");

  const { data: existing, error: lookupError } = await admin
    .from("customers")
    .select("customer_code")
    .eq("customer_code", code)
    .maybeSingle();

  if (lookupError) throw lookupError;
  if (existing) return code;

  const name = String(customerName || code).trim() || code;
  const { error: insertError } = await admin
    .from("customers")
    .insert({
      customer_code: code,
      customer_name: name,
      is_active: true,
    });

  if (insertError) {
    const duplicate = String(insertError.message || "").toLowerCase().includes("duplicate");
    if (duplicate) return code;
    throw insertError;
  }

  return code;
}

function normalizeStorageError(error) {
  const msg = String(error?.message || error || "").toLowerCase();
  if (msg.includes("bucket not found")) {
    return new Error("File storage is not configured for payment collection uploads. Please contact your administrator.");
  }
  if (msg.includes("mime type") || msg.includes("invalid file type") || msg.includes("not allowed")) {
    return new Error("This photo format is not supported. Retake the photo or choose JPG/PNG/PDF.");
  }
  return error instanceof Error ? error : new Error(formatRouteError(error));
}

async function getAuthUser(request) {
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("No authorization header provided");
  }

  const token = authHeader.slice(7);
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Unable to verify user session");
  return user;
}

export async function getSalesScope(admin, userId) {
  const { data: profile, error } = await admin
    .from("profiles")
    .select("id,salesman_code,salesman_name,role")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!profile) throw new Error("No profile found for this user");

  let visibleSalesmanCodes = [profile.salesman_code];
  let scopeProfiles = [profile];
  let hasAllAccess = false;
  let subordinateUserIds = [];
  let visibleSchedulerProfiles = [profile];
  let canSeeAllSchedulers = false;
  let visibleSchedulerUserIds = [userId];

  const userRole = String(profile?.role || "").toLowerCase();
  const normalizedProfileCode = String(profile.salesman_code || "").trim().toUpperCase();

  const isCollectorCode = /^CL\d+$/i.test(normalizedProfileCode);
  const likelyFullAccess = userRole === "admin"
    || userRole === "manager"
    || userRole === "collector"
    || isCollectorCode;

  let collectionOnlyAccess = false;
  if (!likelyFullAccess) {
    try {
      const { data: authData } = await Promise.race([
        admin.auth.admin.getUserById(userId),
        new Promise((_, reject) => setTimeout(() => reject(new Error("AUTH_METADATA_TIMEOUT")), 4000)),
      ]);
      collectionOnlyAccess = Boolean(authData?.user?.user_metadata?.collection_only);
    } catch {
      // Ignore auth metadata lookup failures and fall back to profile role checks.
    }
  }

  if (
    userRole === "admin"
    || userRole === "manager"
    || userRole === "collector"
    || collectionOnlyAccess
    || isCollectorCode
  ) {
    hasAllAccess = true;
    visibleSalesmanCodes = [];
  } else {
    try {
      const { data: allAuthUsers, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });

      if (!usersError && allAuthUsers?.users) {
        const subordinateCodes = [normalizedProfileCode];
        subordinateUserIds = [];

        for (const authU of allAuthUsers.users) {
          const metadata = authU?.user_metadata || authU?.app_metadata || {};
          const subHeadCode = String(metadata.head_salesman_code || "").trim().toUpperCase();

          if (subHeadCode === normalizedProfileCode) {
            subordinateUserIds.push(authU.id);
          }
        }

        if (subordinateUserIds.length > 0) {
          const { data: subProfiles } = await admin
            .from("profiles")
            .select("id,salesman_code,salesman_name,role,email")
            .in("id", subordinateUserIds);

          (subProfiles || []).forEach((subProfile) => {
            if (subProfile?.salesman_code) {
              subordinateCodes.push(subProfile.salesman_code);
            }
            if (subProfile?.id) {
              visibleSchedulerProfiles.push(subProfile);
            }
          });
        }

        visibleSalesmanCodes = subordinateCodes;
      }
    } catch {
      visibleSalesmanCodes = [normalizedProfileCode];
    }

    try {
      const { data: teamProfiles } = await admin
        .from("profiles")
        .select("id,salesman_code,salesman_name");

      const mutualProfiles = resolveMutualGroupProfiles(teamProfiles || [], profile);
      const mutualCodes = mutualProfiles
        .map((entry) => normalizeSalesmanCode(entry.salesman_code))
        .filter(Boolean);
      visibleSalesmanCodes = [...new Set([...visibleSalesmanCodes, ...mutualCodes])];

      const scopeCodeSet = new Set(visibleSalesmanCodes.map((code) => normalizeSalesmanCode(code)).filter(Boolean));
      const scopeProfilesByKey = new Map();
      [profile, ...(teamProfiles || []), ...mutualProfiles].forEach((entry) => {
        if (!entry) return;
        const key = String(entry.id || entry.salesman_code || entry.salesman_name || "").trim();
        if (key) scopeProfilesByKey.set(key, entry);
      });
      (teamProfiles || []).forEach((entry) => {
        if (scopeCodeSet.has(normalizeSalesmanCode(entry.salesman_code))) {
          const key = String(entry.id || entry.salesman_code || entry.salesman_name || "").trim();
          if (key) scopeProfilesByKey.set(key, entry);
        }
      });
      scopeProfiles = [...scopeProfilesByKey.values()];

      visibleSchedulerProfiles = [profile];
      (subordinateUserIds || []).forEach((subordinateId) => {
        const match = (scopeProfiles || []).find((entry) => entry?.id === subordinateId);
        if (match) visibleSchedulerProfiles.push(match);
      });
      mutualProfiles.forEach((entry) => {
        if (entry?.id) visibleSchedulerProfiles.push(entry);
      });

      const schedulerIdSet = new Set();
      visibleSchedulerProfiles.forEach((entry) => {
        if (entry?.id) schedulerIdSet.add(entry.id);
      });
      visibleSchedulerUserIds = [...schedulerIdSet];
    } catch {
      // Keep the existing scope if team profile lookup fails.
    }
  }

  if (userRole === "admin" || userRole === "manager") {
    canSeeAllSchedulers = true;
    visibleSchedulerUserIds = null;
  } else if (hasAllAccess) {
    canSeeAllSchedulers = false;
    visibleSchedulerUserIds = [userId];
    visibleSchedulerProfiles = [profile];
  }

  const visibleSchedulers = canSeeAllSchedulers
    ? null
    : [...new Map(
      visibleSchedulerProfiles
        .filter((entry) => entry?.id)
        .map((entry) => [entry.id, {
          id: entry.id,
          label: formatCollectionUserDisplayName(entry),
        }]),
    ).values()];

  return {
    visibleSalesmanCodes: [...new Set(visibleSalesmanCodes.filter(Boolean))],
    scopeProfiles,
    identitySearchPatterns: [profile.salesman_code],
    hasAllAccess,
    userRole,
    userId,
    canSeeAllSchedulers,
    visibleSchedulerUserIds,
    visibleSchedulers,
  };
}

async function fetchCustomersForOutstanding(admin, outstandingInvoices) {
  const lookupCodes = new Set();
  (outstandingInvoices || []).forEach((invoice) => {
    const key = resolveOutstandingInvoiceCustomerCode(invoice)
      || canonicalCustomerCode(invoice.customer_code)
      || canonicalCustomerCode(invoice.customer_name);
    if (key) lookupCodes.add(key);
    const rawCode = String(invoice.customer_code || "").trim();
    if (rawCode) lookupCodes.add(rawCode);
  });

  if (lookupCodes.size === 0) return [];

  const codes = [...lookupCodes];
  const batchSize = 200;
  const rows = [];

  for (let index = 0; index < codes.length; index += batchSize) {
    const batch = codes.slice(index, index + batchSize);
    const filters = batch.flatMap((code) => [
      `customer_code.eq.${code}`,
      `customer_code.ilike.${code}%`,
    ]).join(",");
    const { data, error } = await admin
      .from("customers")
      .select("customer_code,customer_name,current_salesman_code,city,area,latitude,longitude")
      .or(filters);

    if (error) throw error;
    if (Array.isArray(data)) rows.push(...data);
  }

  return rows;
}

export async function fetchOutstandingAndCollectionRecords(admin, scope) {
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Server configuration is incomplete");
  }

  const normalizedScopeCodes = new Set((scope.visibleSalesmanCodes || []).map((code) => normalizeCode(code)).filter(Boolean));
  const scopeMatchers = buildSalesmanScopeMatchers(scope.scopeProfiles || []);

  const salesmenQuery = admin
    .from("profiles")
    .select("salesman_code,salesman_name");

  const visitsQuery = admin
    .from("collection_visits")
    .select("customer_code,visit_outcome,payment_status,amount_received,receipt_mode,next_visit_at,remark_arabic,remark_english,saved_at,created_by")
    .order("saved_at", { ascending: false })
    .limit(3000);

  const legalQuery = admin
    .from("legal_transfers")
    .select("customer_code,is_transferred,transferred_at,note");

  const [
    { invoices: outstandingInvoices, rows: outstandingRows },
    { data: salesmen, error: salesmenError },
    { data: visitsData, error: visitsError },
    { data: legalData, error: legalError },
  ] = await Promise.all([
    readOutstandingDataset(admin),
    salesmenQuery,
    visitsQuery,
    legalQuery,
  ]);

  if (salesmenError) throw salesmenError;
  if (visitsError && !isMissingTableError(visitsError)) throw visitsError;
  if (legalError && !isMissingTableError(legalError)) throw legalError;

  const customers = await fetchCustomersForOutstanding(admin, outstandingInvoices);

  const visits = Array.isArray(visitsData) ? visitsData : [];
  const legalTransfers = Array.isArray(legalData) ? legalData : [];

  const creatorIds = [...new Set(visits.map((visit) => visit.created_by).filter(Boolean))];
  const creatorProfileMap = new Map();
  if (creatorIds.length > 0) {
    const { data: creatorProfiles, error: creatorProfilesError } = await admin
      .from("profiles")
      .select("id,role,salesman_code,salesman_name,email")
      .in("id", creatorIds);
    if (creatorProfilesError) throw creatorProfilesError;
    (creatorProfiles || []).forEach((profile) => {
      creatorProfileMap.set(profile.id, profile);
    });
  }

  const salesmanMap = new Map();
  (salesmen || []).forEach((salesman) => {
    const normalizedCode = normalizeCode(salesman.salesman_code);
    salesmanMap.set(normalizedCode, salesman.salesman_name);
  });

  // Build customer records with outstanding and collection data
  const visitsByCustomer = new Map();
  const legalTransfersByCustomer = new Map();

  (visits || []).forEach((visit) => {
    const key = canonicalCustomerCode(visit.customer_code);
    if (!key) return;
    if (!visitsByCustomer.has(key)) {
      visitsByCustomer.set(key, []);
    }
    visitsByCustomer.get(key).push(visit);
  });

  function enrichCollectionVisit(visit) {
    if (!visit) return null;
    const schedulerProfile = visit.created_by ? creatorProfileMap.get(visit.created_by) : null;
    return {
      ...visit,
      scheduled_by_id: visit.created_by || "",
      scheduled_by_name: schedulerProfile
        ? formatCollectionUserDisplayName(schedulerProfile)
        : "",
    };
  }

  function latestCustomerVisits(customerCode, limit = 3) {
    const customerVisits = visitsByCustomer.get(customerCode) || [];
    return customerVisits
      .slice()
      .sort((left, right) => new Date(right.saved_at || 0).getTime() - new Date(left.saved_at || 0).getTime())
      .slice(0, limit)
      .map((visit) => enrichCollectionVisit(visit));
  }

  (legalTransfers || []).forEach((transfer) => {
    const key = canonicalCustomerCode(transfer.customer_code);
    if (!legalTransfersByCustomer.has(key)) {
      legalTransfersByCustomer.set(key, transfer);
    }
  });

  const invoicesByCustomer = new Map();
  const nameByCustomer = new Map();
  outstandingInvoices.forEach((invoice) => {
    const key = resolveOutstandingInvoiceCustomerCode(invoice)
      || canonicalCustomerCode(invoice.customer_code)
      || canonicalCustomerCode(invoice.customer_name);
    if (!key) return;

    if (!invoicesByCustomer.has(key)) {
      invoicesByCustomer.set(key, []);
    }
    invoicesByCustomer.get(key).push({
      invoice_number: String(invoice.ref_no || "").trim(),
      ref_no: String(invoice.ref_no || "").trim(),
      invoice_date: invoice.invoice_date || "",
      due_date: invoice.due_date || "",
      pending_amount: toNumber(invoice.pending_amount),
      invoice_day: invoice.invoice_day === undefined || invoice.invoice_day === null || invoice.invoice_day === ""
        ? null
        : toNumber(invoice.invoice_day),
      overdue_days: invoice.overdue_days === undefined || invoice.overdue_days === null || invoice.overdue_days === ""
        ? null
        : toNumber(invoice.overdue_days),
      salesman: String(invoice.salesman || "").trim(),
    });

    if (!nameByCustomer.has(key)) {
      const label = String(invoice.customer_name || invoice.customer_code || "").trim();
      nameByCustomer.set(key, extractLeadingCustomerCodeAndName(label).customer_name || label);
    }
  });

  const uniqueCustomers = new Map();
  (customers || []).forEach((customer) => {
    const key = canonicalCustomerCode(customer.customer_code);
    if (!key) return;
    const existing = uniqueCustomers.get(key);
    // Prefer the record that carries a salesman assignment.
    if (!existing || (!existing.current_salesman_code && customer.current_salesman_code)) {
      uniqueCustomers.set(key, { ...customer, customer_code: key });
    }
  });

  // Outstanding files often contain codes that are missing or inactive in the customers table.
  invoicesByCustomer.forEach((customerInvoices, key) => {
    const matchedKey = preferMatchingCustomerKey([...uniqueCustomers.keys(), key], key);
    if (uniqueCustomers.has(matchedKey)) {
      if (matchedKey !== key) {
        const existingInvoices = invoicesByCustomer.get(matchedKey) || [];
        invoicesByCustomer.set(matchedKey, [...existingInvoices, ...customerInvoices]);
        invoicesByCustomer.delete(key);
      }
      return;
    }

    uniqueCustomers.set(matchedKey, {
      customer_code: matchedKey,
      customer_name: nameByCustomer.get(key) || matchedKey,
      current_salesman_code: "",
      city: "",
      area: "",
    });
  });

  const records = [];
  uniqueCustomers.forEach((customer) => {
    const allCustomerInvoices = invoicesByCustomer.get(customer.customer_code) || [];
    const customerInvoices = filterCollectionQueueInvoices(allCustomerInvoices);
    if (customerInvoices.length === 0) return;

    const visits = latestCustomerVisits(customer.customer_code).map((visit) => {
      const schedulerProfile = visit?.created_by ? creatorProfileMap.get(visit.created_by) : null;
      return redactCollectionVisitScheduleForViewer(visit, schedulerProfile, {
        userId: scope.userId,
        userRole: scope.userRole,
        canSeeAllSchedulers: scope.canSeeAllSchedulers,
        visibleSchedulerUserIds: scope.visibleSchedulerUserIds,
      });
    });
    const legalTransfer = legalTransfersByCustomer.get(customer.customer_code);

    // The uploaded outstanding file decides who collects when invoice salesman is present.
    const uploadSalesman = pickOutstandingSalesmanName(customerInvoices);
    if (!customerMatchesCollectionScope({
      customer,
      customerInvoices,
      scopeMatchers,
      normalizedScopeCodes: [...normalizedScopeCodes],
      hasAllAccess: scope.hasAllAccess,
    })) {
      return;
    }

    const uploadedOutstanding = findOutstandingForCustomer(
      { rows: outstandingRows },
      customer.customer_code,
      customer.customer_name,
    );
    const todayIso = new Date().toISOString();
    const outstanding = resolveCollectionOutstandingBuckets({
      rowBuckets: uploadedOutstanding?.buckets,
      invoices: customerInvoices,
      todayIso,
    });

    records.push({
      customer_code: customer.customer_code,
      customer_name: customer.customer_name,
      current_salesman_code: customer.current_salesman_code,
      salesman_name: pickOutstandingSalesmanName(customerInvoices)
        || (!isPlaceholderSalesmanValue(customer.current_salesman_code)
          ? (salesmanMap.get(normalizeCode(customer.current_salesman_code)) || customer.current_salesman_code)
          : ""),
      city: customer.city,
      area: customer.area,
      latitude: customer.latitude,
      longitude: customer.longitude,
      invoices: customerInvoices,
      latest_collection: visits[0] || null,
      collection_history: visits,
      legal_transfer: legalTransfer || null,
      ...outstanding,
    });
  });

  return records;
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return Response.json(
        { success: false, error: "Server configuration is incomplete" },
        { status: 500 }
      );
    }

    const user = await getAuthUser(request);
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const scope = await getSalesScope(admin, user.id);
    const records = await fetchOutstandingAndCollectionRecords(admin, scope);
    const queues = buildCollectionQueues(records);

    return Response.json({
      success: true,
      dueCustomers: queues.dueCustomers,
      notDueCustomers: queues.notDueCustomers,
      legalCustomers: queues.legalCustomers,
      schedulerScope: {
        userId: scope.userId,
        canSeeAllSchedulers: scope.canSeeAllSchedulers,
        visibleSchedulerUserIds: scope.visibleSchedulerUserIds,
        visibleSchedulers: scope.visibleSchedulers,
      },
    });
  } catch (error) {
    console.error("Error fetching payment collections:", error);
    return Response.json(
      { success: false, error: error.message || "Unable to load payment collection queue" },
      { status: 400 }
    );
  }
}

export async function POST(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return Response.json(
        { success: false, error: "Server configuration is incomplete" },
        { status: 500 }
      );
    }

    const user = await getAuthUser(request);
    const formData = await request.formData();

    const customerCodeRaw = String(formData.get("customerCode") || "");
    const customerName = String(formData.get("customerName") || "").trim();
    let customerCode = canonicalCustomerCode(customerCodeRaw);
    const visitOutcome = String(formData.get("visitOutcome") || "").trim();
    const paymentStatus = String(formData.get("paymentStatus") || "").trim();
    const amountReceived = Number(formData.get("amountReceived") || 0);
    const receiptMode = String(formData.get("receiptMode") || "").trim();
    const nextVisitAt = String(formData.get("nextVisitAt") || "").trim();
    const remarkArabic = String(formData.get("remarkArabic") || "").trim();
    let remarkEnglish = String(formData.get("remarkEnglish") || "").trim();
    if (needsEnglishTranslation(remarkArabic, remarkEnglish)) {
      try {
        remarkEnglish = await Promise.race([
          translateText(remarkArabic, { from: "ar", to: "en" }),
          new Promise((resolve) => {
            setTimeout(() => resolve(remarkArabic), 8000);
          }),
        ]) || remarkArabic;
      } catch {
        remarkEnglish = remarkArabic;
      }
    }
    const nonPaymentReason = String(formData.get("nonPaymentReason") || "").trim();
    const legalNote = String(formData.get("legalNote") || "").trim();
    const latitudeRaw = formData.get("latitude");
    const longitudeRaw = formData.get("longitude");
    const gpsAccuracyRaw = formData.get("gpsAccuracyMeters");
    const latitude = latitudeRaw === null || latitudeRaw === undefined || latitudeRaw === ""
      ? null
      : Number(latitudeRaw);
    const longitude = longitudeRaw === null || longitudeRaw === undefined || longitudeRaw === ""
      ? null
      : Number(longitudeRaw);
    const gpsAccuracyMeters = gpsAccuracyRaw === null || gpsAccuracyRaw === undefined || gpsAccuracyRaw === ""
      ? null
      : Number(gpsAccuracyRaw);
    const summaryText = String(formData.get("summaryText") || formData.get("whatsappMessage") || "").trim();
    const queuePriority = Number(formData.get("queuePriority") || 0);
    const probabilityScore = Number(formData.get("probabilityScore") || 0);
    const probabilityLabel = String(formData.get("probabilityLabel") || "").trim();
    const visitNumberForDay = Number(formData.get("visitNumberForDay") || 0);

    if (!customerCode) throw new Error("Customer code is required");
    if (!visitOutcome) throw new Error("Please select visit outcome");

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const scope = await getSalesScope(admin, user.id);
    const requireGps = shouldRequireTransactionGps(scope.userRole);

    if (requireGps && (!Number.isFinite(latitude) || !Number.isFinite(longitude))) {
      throw new Error("GPS is required. Allow location access in the browser and try again.");
    }

    if (visitOutcome === "FUNDS_RECEIVED" && amountReceived <= 0) {
      throw new Error("Amount received is required for funds received outcome");
    }
    if (visitOutcome === "FUNDS_RECEIVED" && !receiptMode) {
      throw new Error("Mode of receipt is required for funds received outcome");
    }
    if (paymentStatus !== "PAID" && visitOutcome !== "TRANSFER_TO_LEGAL" && !nextVisitAt) {
      throw new Error("Next visit date is required when full payment was not received.");
    }

    // Verify user has access to this customer
    if (!scope.hasAllAccess) {
      const records = await fetchOutstandingAndCollectionRecords(admin, scope);
      const matchedRecord = findScopedCollectionRecord(records, customerCode);
      if (!matchedRecord) {
        throw new Error("You do not have access to this customer");
      }
      customerCode = matchedRecord.customer_code;
    }

    await ensureCollectionCustomerRecord(admin, customerCode, customerName);

    // Handle file uploads for payment and receipt copies
    let paymentCopyUrl = null;
    let receiptCopyUrl = null;

    const paymentCopyFile = formData.get("paymentCopy");
    const receiptCopyFile = formData.get("receiptCopy");
    const hasFileUpload = (paymentCopyFile && paymentCopyFile.size > 0)
      || (receiptCopyFile && receiptCopyFile.size > 0);

    if (hasFileUpload) {
      await ensureCollectionFilesBucket(admin);
    }

    if (paymentCopyFile && paymentCopyFile.size > 0) {
      const ext = storageExtension(paymentCopyFile);
      const paymentCopyPath = `payment-copies/${customerCode}-${Date.now()}-payment.${ext}`;
      const { data: paymentData, error: paymentError } = await admin.storage
        .from(COLLECTION_FILES_BUCKET)
        .upload(paymentCopyPath, paymentCopyFile, {
          upsert: true,
          contentType: uploadContentType(paymentCopyFile),
        });

      if (paymentError) throw normalizeStorageError(paymentError);
      paymentCopyUrl = `${supabaseUrl}/storage/v1/object/public/${COLLECTION_FILES_BUCKET}/${paymentData.path}`;
    }

    if (receiptCopyFile && receiptCopyFile.size > 0) {
      const ext = storageExtension(receiptCopyFile);
      const receiptCopyPath = `receipt-copies/${customerCode}-${Date.now()}-receipt.${ext}`;
      const { data: receiptData, error: receiptError } = await admin.storage
        .from(COLLECTION_FILES_BUCKET)
        .upload(receiptCopyPath, receiptCopyFile, {
          upsert: true,
          contentType: uploadContentType(receiptCopyFile),
        });

      if (receiptError) throw normalizeStorageError(receiptError);
      receiptCopyUrl = `${supabaseUrl}/storage/v1/object/public/${COLLECTION_FILES_BUCKET}/${receiptData.path}`;
    }

    // Insert new collection visit
    const existingVisitCount = await countCollectionVisitsForUserDay(admin, user.id);
    const authoritativeVisitNumber = Math.max(visitNumberForDay, existingVisitCount + 1);
    const finalSummaryText = summaryText && authoritativeVisitNumber !== visitNumberForDay
      ? patchCollectionVisitSummaryVisitNumber(summaryText, authoritativeVisitNumber)
      : summaryText;

    const visitInsertBase = {
      customer_code: customerCode,
      visit_outcome: visitOutcome,
      payment_status: paymentStatus,
      amount_received: amountReceived,
      receipt_mode: receiptMode,
      next_visit_at: nextVisitAt || null,
      remark_arabic: remarkArabic,
      remark_english: remarkEnglish,
      non_payment_reason: nonPaymentReason,
      payment_copy_url: paymentCopyUrl,
      receipt_copy_url: receiptCopyUrl,
      summary_text: finalSummaryText || null,
      queue_priority: queuePriority > 0 ? queuePriority : null,
      probability_score: probabilityScore > 0 ? probabilityScore : null,
      probability_label: probabilityLabel || null,
      visit_number_for_day: authoritativeVisitNumber > 0 ? authoritativeVisitNumber : null,
      created_by: user.id,
      saved_at: new Date().toISOString(),
    };

    const visitInsertWithGps = {
      ...visitInsertBase,
      latitude: Number.isFinite(latitude) ? latitude : null,
      longitude: Number.isFinite(longitude) ? longitude : null,
      gps_accuracy_meters: Number.isFinite(gpsAccuracyMeters) ? gpsAccuracyMeters : null,
    };

    let insertData = null;
    let insertError = null;

    ({
      data: insertData,
      error: insertError,
    } = await admin
      .from("collection_visits")
      .insert(visitInsertWithGps)
      .select("id")
      .maybeSingle());

    if (insertError) {
      if (isMissingColumnError(insertError)) {
        const {
          summary_text: _summaryText,
          queue_priority: _queuePriority,
          probability_score: _probabilityScore,
          probability_label: _probabilityLabel,
          visit_number_for_day: _visitNumberForDay,
          ...visitInsertWithoutMeta
        } = visitInsertWithGps;

        ({
          data: insertData,
          error: insertError,
        } = await admin
          .from("collection_visits")
          .insert(visitInsertWithoutMeta)
          .select("id")
          .maybeSingle());
      }
    }

    if (insertError) {
      if (isMissingColumnError(insertError)) {
        throw new Error("GPS columns are not applied in Supabase yet. Run sql/add_collection_visit_gps.sql in SQL Editor.");
      }
      if (isMissingTableError(insertError)) {
        throw new Error("Collection tables are not initialized in this environment yet.");
      }
      throw new Error(formatRouteError(insertError));
    }

    // Update legal transfer if needed
    if (visitOutcome === "TRANSFER_TO_LEGAL") {
      const { error: legalError } = await admin
        .from("legal_transfers")
        .upsert({
          customer_code: customerCode,
          is_transferred: true,
          transferred_at: new Date().toISOString(),
          transferred_by: user.id,
          note: legalNote,
        }, { onConflict: "customer_code" });

      if (legalError) {
        if (isMissingTableError(legalError)) {
          throw new Error("Collection tables are not initialized in this environment yet.");
        }
        throw legalError;
      }
    }

    queueTransactionBossAlerts(admin, {
      actorUserId: user.id,
      transactionType: "COLLECTION_VISIT",
      referenceKey: `collection:${insertData?.id || customerCode}`,
      details: {
        customerCode,
        customerName,
        visitOutcome,
        referenceId: insertData?.id,
      },
    });

    return Response.json({
      success: true,
      message: "Collection visit saved successfully",
      visitId: insertData?.id,
      gpsCaptured: Number.isFinite(latitude) && Number.isFinite(longitude),
    });
  } catch (error) {
    console.error("Error saving collection visit:", error);
    return Response.json(
      { success: false, error: formatRouteError(error) },
      { status: 400 }
    );
  }
}

export async function PATCH(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return Response.json(
        { success: false, error: "Server configuration is incomplete" },
        { status: 500 },
      );
    }

    const user = await getAuthUser(request);
    const body = await request.json();
    let customerCode = canonicalCustomerCode(body.customerCode || "");
    const action = String(body.action || "transfer").trim().toLowerCase();
    const note = String(body.note || "").trim();
    const latitude = body.latitude === null || body.latitude === undefined || body.latitude === ""
      ? null
      : Number(body.latitude);
    const longitude = body.longitude === null || body.longitude === undefined || body.longitude === ""
      ? null
      : Number(body.longitude);

    if (!customerCode) throw new Error("Customer code is required");

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const scope = await getSalesScope(admin, user.id);
    const requireGps = shouldRequireTransactionGps(scope.userRole);

    if (requireGps && (!Number.isFinite(latitude) || !Number.isFinite(longitude))) {
      throw new Error("GPS is required. Allow location access in the browser and try again.");
    }

    if (!scope.hasAllAccess) {
      const records = await fetchOutstandingAndCollectionRecords(admin, scope);
      const matchedRecord = findScopedCollectionRecord(records, customerCode);
      if (!matchedRecord) {
        throw new Error("You do not have access to this customer");
      }
      customerCode = matchedRecord.customer_code;
    }

    if (action === "remove") {
      const { error } = await admin
        .from("legal_transfers")
        .delete()
        .eq("customer_code", customerCode);

      if (error) {
        if (isMissingTableError(error)) {
          throw new Error("Collection tables are not initialized in this environment yet.");
        }
        throw error;
      }
    } else if (action === "transfer") {
      const { error } = await admin
        .from("legal_transfers")
        .upsert({
          customer_code: customerCode,
          is_transferred: true,
          transferred_at: new Date().toISOString(),
          transferred_by: user.id,
          note: note || "Transferred to legal",
        }, { onConflict: "customer_code" });

      if (error) {
        if (isMissingTableError(error)) {
          throw new Error("Collection tables are not initialized in this environment yet.");
        }
        throw error;
      }
    } else {
      throw new Error("Unsupported legal transfer action");
    }

    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      const gpsNote = buildGpsActivityNote(
        action === "remove" ? "LEGAL_TRANSFER_REMOVE" : "LEGAL_TRANSFER",
        {
          latitude,
          longitude,
          accuracy: Number(body.gpsAccuracyMeters) || null,
        },
        {
          customer_code: customerCode,
          platform: normalizeGpsCapturePlatform(body?.platform),
        },
      );

      const { error: gpsLogError } = await admin.from("daily_activity_logs").insert({
        user_id: user.id,
        entry_type: "GPS_PING",
        note: gpsNote,
      });

      if (gpsLogError && !isMissingTableError(gpsLogError)) {
        throw gpsLogError;
      }
    }

    queueTransactionBossAlerts(admin, {
      actorUserId: user.id,
      transactionType: action === "remove" ? "LEGAL_TRANSFER_REMOVE" : "LEGAL_TRANSFER",
      referenceKey: `legal:${customerCode}:${action}:${Date.now()}`,
      details: {
        customerCode,
      },
    });

    return Response.json({ success: true });
  } catch (error) {
    console.error("Error updating legal transfer:", error);
    return Response.json(
      { success: false, error: error.message || "Unable to update legal transfer status" },
      { status: 400 },
    );
  }
}
