import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  OUTSTANDING_DATASET_KEY,
  customerCodeCandidates,
  findOutstandingForCustomer,
  resolveOutstandingCustomerOwnership,
  summarizeOutstandingBuckets,
} from "../../../lib/outstanding";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function extractEmailLocalPart(email) {
  const raw = String(email || "").trim().toLowerCase();
  if (!raw) return "";
  return raw.includes("@") ? raw.split("@")[0] : raw;
}

function normalizeLooseToken(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function normalizeName(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase();
}

function identitySearchPattern(value) {
  return normalizeCode(value)
    .replace(/[^A-Z0-9]+/g, "%")
    .replace(/^%+|%+$/g, "");
}

function isSalesTeamRole(role) {
  const normalized = normalizeRole(role);
  return ["salesman", "manager", "admin", "invoice_maker", "invoice-maker"].includes(normalized);
}

const MUTUAL_SALESMAN_GROUPS = [["JUNAID", "PARVEZ", "SOYEB"]];

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

function isInvoiceMakerRole(role) {
  const normalized = String(role || "").toLowerCase();
  return normalized === "invoice_maker" || normalized === "invoice-maker";
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

  let members = [];
  if (["admin", "manager"].includes(role)) {
    members = scopedProfiles;
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

    // Keep self-scope even when profile role text is dirty (case/spacing mismatch).
    if (!members.some((profile) => profile.id === currentProfile.id)) {
      members = [currentProfile, ...members];
    }
  }

  const visibleMembers = members.map((profile) => {
    const authUser = authMap.get(profile.id);
    return {
      id: profile.id,
      role: profile.role || "",
      salesman_code: profile.salesman_code || "",
      salesman_name: profile.salesman_name || "",
      email: authUser?.email || "",
    };
  });

  const mutualGroupCodes = resolveMutualGroupCodes(allProfiles, currentProfile);
  const currentAuthUser = authMap.get(currentProfile.id) || user;

  const visibleSalesmanCodes = [...new Set([
    ...members.flatMap((member) => profileCodeCandidates(member)),
    ...authCodeCandidates(currentAuthUser),
    ...fuzzyMatchedProfileCodes(scopedProfiles, currentAuthUser),
    ...mutualGroupCodes,
  ])];
  const identitySearchPatterns = [...new Set(
    visibleSalesmanCodes.map(identitySearchPattern).filter(Boolean),
  )];

  return {
    hasAllAccess: ["admin", "manager"].includes(role) || isInvoiceMakerRole(role),
    visibleSalesmanCodes,
    identitySearchPatterns,
  };
}

async function fetchVisibleCustomers(admin, scope) {
  const pageSize = 1000;
  let from = 0;
  const rows = [];
  const normalizedScopeCodes = new Set((scope.visibleSalesmanCodes || []).map((code) => normalizeCode(code)).filter(Boolean));
  const historyVisibleCustomerCodes = new Set();
  const outstandingAssignedCustomerCodes = new Set();
  const outstandingOwnedCustomerCodes = new Set();

  if (!scope.hasAllAccess && normalizedScopeCodes.size > 0) {
    const salesPageSize = 2000;
    let salesFrom = 0;
    const visibleCodes = Array.from(normalizedScopeCodes);

    while (true) {
      const { data: salesRows, error: salesError } = await admin
        .from("active_sales")
        .select("customer_code,salesman_code")
        .in("salesman_code", visibleCodes)
        .range(salesFrom, salesFrom + salesPageSize - 1);

      if (salesError) throw salesError;

      const chunk = salesRows || [];
      chunk.forEach((row) => {
        const code = normalizeCode(row.customer_code);
        if (code) historyVisibleCustomerCodes.add(code);
      });

      if (chunk.length < salesPageSize) break;
      salesFrom += salesPageSize;
    }
  }

  if (!scope.hasAllAccess && scope.identitySearchPatterns.length > 0) {
    const salesPageSize = 2000;
    let salesFrom = 0;
    const identityFilters = scope.identitySearchPatterns.flatMap((pattern) => [
      `salesman_code.ilike.%${pattern}%`,
      `salesman_name.ilike.%${pattern}%`,
    ]);

    while (true) {
      const { data: salesRows, error: salesError } = await admin
        .from("active_sales")
        .select("customer_code,salesman_code,salesman_name")
        .or(identityFilters.join(","))
        .range(salesFrom, salesFrom + salesPageSize - 1);

      if (salesError) throw salesError;

      const chunk = salesRows || [];
      chunk.forEach((row) => {
        const code = normalizeCode(row.customer_code);
        if (code) historyVisibleCustomerCodes.add(code);
      });

      if (chunk.length < salesPageSize) break;
      salesFrom += salesPageSize;
    }
  }

  if (!scope.hasAllAccess && normalizedScopeCodes.size > 0) {
    const { data: setting, error: outstandingError } = await admin
      .from("system_settings")
      .select("setting_value")
      .eq("setting_key", OUTSTANDING_DATASET_KEY)
      .maybeSingle();

    if (outstandingError) throw outstandingError;

    try {
      const dataset = JSON.parse(setting?.setting_value || "null");
      const ownership = resolveOutstandingCustomerOwnership(dataset, scope.visibleSalesmanCodes);
      ownership.assignedCustomerCodes.forEach((code) => outstandingAssignedCustomerCodes.add(normalizeCode(code)));
      ownership.ownedCustomerCodes.forEach((code) => outstandingOwnedCustomerCodes.add(normalizeCode(code)));
    } catch {
      // Ignore malformed optional outstanding data and retain sales-based visibility.
    }
  }

  while (true) {
    let query = admin
      .from("customers")
      .select("customer_code,customer_name,current_salesman_code,latest_transaction_date,customer_type,city,area,mobile")
      .eq("is_active", true)
      .order("customer_name")
      .range(from, from + pageSize - 1);

    const { data, error } = await query;
    if (error) throw error;

    const chunk = (data || []).filter((row) => {
      if (scope.hasAllAccess) return true;
      if (normalizedScopeCodes.size === 0) return false;
      const codeCandidates = customerCodeCandidates(row.customer_code).map(normalizeCode);
      if (codeCandidates.some((code) => outstandingAssignedCustomerCodes.has(code))) {
        return codeCandidates.some((code) => outstandingOwnedCustomerCodes.has(code));
      }

      const rowSalesmanCode = normalizeCode(row.current_salesman_code);
      if (normalizedScopeCodes.has(rowSalesmanCode)) return true;

      // Fallback: include customers that have sales history under visible salesman codes.
      return codeCandidates.some((code) => historyVisibleCustomerCodes.has(code));
    });
    rows.push(...chunk);

    if ((data || []).length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

async function attachRecentSalesValues(admin, customers) {
  const canonicalCodeByCandidate = new Map();
  const salesValueByCustomer = new Map();

  customers.forEach((customer) => {
    const canonicalCode = normalizeCode(customer.customer_code);
    customerCodeCandidates(customer.customer_code).forEach((candidate) => {
      canonicalCodeByCandidate.set(normalizeCode(candidate), canonicalCode);
    });
  });

  const candidateCodes = [...canonicalCodeByCandidate.keys()];
  const fromDate = new Date();
  fromDate.setUTCMonth(fromDate.getUTCMonth() - 6);

  for (let start = 0; start < candidateCodes.length; start += 200) {
    const codeChunk = candidateCodes.slice(start, start + 200);
    const pageSize = 1000;
    let from = 0;

    while (true) {
      const { data, error } = await admin
        .from("active_sales")
        .select("id,customer_code,sales_amount")
        .gte("transaction_date", fromDate.toISOString().slice(0, 10))
        .in("customer_code", codeChunk)
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) throw error;

      const rows = data || [];
      rows.forEach((row) => {
        const canonicalCode = canonicalCodeByCandidate.get(normalizeCode(row.customer_code));
        if (!canonicalCode) return;
        const currentValue = salesValueByCustomer.get(canonicalCode) || 0;
        salesValueByCustomer.set(canonicalCode, currentValue + Math.max(Number(row.sales_amount || 0), 0));
      });

      if (rows.length < pageSize) break;
      from += pageSize;
    }
  }

  return customers.map((customer) => ({
    ...customer,
    recent_sales_value: salesValueByCustomer.get(normalizeCode(customer.customer_code)) || 0,
  }));
}

async function attachOutstandingValues(admin, customers) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", OUTSTANDING_DATASET_KEY)
    .maybeSingle();

  if (error) throw error;

  let dataset = null;
  try {
    dataset = JSON.parse(data?.setting_value || "null");
  } catch {
    dataset = null;
  }

  return customers.map((customer) => {
    const outstanding = findOutstandingForCustomer(
      dataset,
      customer.customer_code,
      customer.customer_name
    );
    const summary = summarizeOutstandingBuckets(outstanding?.buckets);

    return {
      ...customer,
      outstanding_0_30: summary.days0To30,
      outstanding_30_60: summary.days30To60,
      outstanding_above_60: summary.daysAbove60,
    };
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

    const token = authHeader.replace("Bearer ", "");
    const scope = await resolveScope(admin, token);
    const customers = await fetchVisibleCustomers(admin, scope);
    const searchParams = new URL(request.url).searchParams;
    const includeRecentSales = searchParams.get("includeRecentSales") === "1";
    const includeOutstanding = searchParams.get("includeOutstanding") === "1";
    let responseCustomers = includeRecentSales
      ? await attachRecentSalesValues(admin, customers)
      : customers;
    if (includeOutstanding) {
      responseCustomers = await attachOutstandingValues(admin, responseCustomers);
    }

    return NextResponse.json({
      success: true,
      customers: responseCustomers,
      count: responseCustomers.length,
    }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || "Unable to load visible customers." }, { status: 500 });
  }
}
