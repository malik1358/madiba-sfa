import { createClient } from "@supabase/supabase-js";
import {
  buildPromoterCoverageReport,
  filterPromoterCoverageSalesRows,
  promoterCoverageCustomerCodeVariants,
  promoterCoverageMonthKeys,
  promoterCoverageSalesmanMatches,
} from "../../lib/promoterCoverage.js";
import { isCreditNoteTransaction } from "../../lib/paymentBehavior.js";
import { OUTSTANDING_DATASET_KEY, resolveOutstandingCustomerOwnership } from "../../lib/outstanding.js";
import { buildSalesmanScopeMatchers } from "../../lib/mutualSalesmanGroups.js";
import { resolvePeersUnderSameHeadUserIds } from "../../lib/salesHierarchy.js";
import { getKsaDateString, ksaDayBounds } from "../../lib/workdayActivity.js";

export const runtime = "nodejs";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PAGE_SIZE = 2000;

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function escapeIlikePattern(value) {
  return String(value || "").replace(/[\\%_]/g, "\\$&");
}

function isPromoter(role) {
  return ["product-promoter", "product_promoter"].includes(String(role || "").trim().toLowerCase());
}

function shiftMonth(monthKey, offset) {
  const date = new Date(`${monthKey}-01T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function loadAllRows(buildQuery, orderColumn) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery()
      .order(orderColumn, { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function loadCustomersForSalesmen(admin, salesmanCodes) {
  const rows = [];
  for (const column of ["current_salesman_code", "previous_salesman_code"]) {
    const page = await loadAllRows(
      () => admin.from("customers")
        .select("customer_code,customer_name,current_salesman_code,previous_salesman_code,is_active")
        .in(column, salesmanCodes),
      "customer_code",
    );
    rows.push(...page);
  }
  return rows;
}

async function loadSalesMembership(admin, salesmanCodes) {
  const identities = [...new Set(salesmanCodes.map((value) => String(value || "").trim()).filter(Boolean))];
  const rowGroups = await Promise.all(identities.map((identity) => loadAllRows(
    () => admin.from("active_sales")
      .select("customer_code,customer_name,salesman_code,transaction_date")
      .ilike("salesman_code", escapeIlikePattern(identity)),
    "transaction_date",
  )));
  return rowGroups.flat().filter((row) => promoterCoverageSalesmanMatches(row.salesman_code, identities));
}

async function loadOutstandingCustomerCodes(admin, teamProfiles) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", OUTSTANDING_DATASET_KEY)
    .maybeSingle();
  if (error) throw error;

  try {
    const dataset = JSON.parse(String(data?.setting_value || "null"));
    const identities = teamProfiles.flatMap((profile) => [profile.salesman_code, profile.salesman_name]).filter(Boolean);
    const ownership = resolveOutstandingCustomerOwnership(
      dataset,
      identities,
      buildSalesmanScopeMatchers(teamProfiles),
    );
    return [...ownership.ownedCustomerCodes].map(normalizeCode).filter(Boolean);
  } catch {
    return [];
  }
}

async function loadSalesTrendRows(admin, customerCodes, fromMonth, toMonth) {
  const queryCodes = [...new Set(customerCodes.flatMap(promoterCoverageCustomerCodeVariants))];
  const codeBatches = [];
  for (let index = 0; index < queryCodes.length; index += 200) {
    codeBatches.push(queryCodes.slice(index, index + 200));
  }
  const rowGroups = await Promise.all(codeBatches.map((codes) => loadAllRows(
    () => admin.from("active_sales")
      .select("customer_code,customer_name,salesman_code,transaction_date,voucher_number,voucher_type,reference,item_code,sales_amount")
      .in("customer_code", codes)
      .gte("transaction_date", `${fromMonth}-01`)
      .lt("transaction_date", `${shiftMonth(toMonth, 1)}-01`),
    "transaction_date",
  )));
  const rows = filterPromoterCoverageSalesRows(rowGroups.flat(), customerCodes);
  return rows.map((row) => ({
    ...row,
    is_credit_note: isCreditNoteTransaction(row),
    net_sales_amount: isCreditNoteTransaction(row)
      ? -Math.abs(Number(row.sales_amount || 0))
      : Number(row.sales_amount || 0),
  }));
}

async function loadPromoterVisits(admin, userId, firstVisitDate) {
  return loadAllRows(
    () => admin.from("daily_activity_logs")
      .select("id,user_id,entry_type,note,created_at")
      .eq("user_id", userId)
      .eq("entry_type", "VISIT_REPORT")
      .gte("created_at", ksaDayBounds(firstVisitDate).startIso),
    "created_at",
  ).then((logs) => logs.flatMap((log) => {
    try {
      const note = JSON.parse(String(log.note || ""));
      const customerCode = normalizeCode(note.customer_code);
      if (!customerCode) return [];
      return [{
        customerCode,
        customerName: String(note.customer_name || "").trim(),
        savedAt: log.created_at,
        outcome: String(note.outcome || "").trim(),
      }];
    } catch {
      return [];
    }
  }));
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return Response.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const authHeader = request.headers.get("authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return Response.json({ success: false, error: "Not authenticated." }, { status: 401 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await admin.auth.getUser(authHeader.slice(7));
    if (authError || !user) {
      return Response.json({ success: false, error: "Invalid login session." }, { status: 401 });
    }

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id,role,salesman_code,salesman_name")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile) {
      return Response.json({ success: false, error: "No profile found for this account." }, { status: 403 });
    }

    const [profilesResult, usersResult] = await Promise.all([
      admin
        .from("profiles")
        .select("id,role,salesman_code,salesman_name")
        .in("role", ["salesman", "manager", "admin", "report-user", "report_user", "invoice-maker", "invoice_maker", "product-promoter", "product_promoter"]),
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);
    if (profilesResult.error) throw profilesResult.error;
    if (usersResult.error) throw usersResult.error;

    const profiles = profilesResult.data || [];
    const authUsers = usersResult.data?.users || [];
    const promoterProfiles = profiles.filter((candidate) => isPromoter(candidate.role));
    const promoterOptions = promoterProfiles.map((candidate) => ({
      userId: candidate.id,
      salesmanCode: String(candidate.salesman_code || "").trim(),
      salesmanName: String(candidate.salesman_name || "").trim(),
    }));
    const requestedPromoterId = String(new URL(request.url).searchParams.get("promoterId") || "").trim();
    const selectedPromoterId = requestedPromoterId || (isPromoter(profile.role) ? user.id : "");
    if (!selectedPromoterId) {
      return Response.json({
        success: true,
        reportDate: getKsaDateString(),
        promoterOptions,
        promoter: null,
        requiresPromoterSelection: true,
      });
    }

    const promoterProfile = promoterProfiles.find((candidate) => candidate.id === selectedPromoterId);
    if (!promoterProfile) {
      return Response.json({ success: false, error: "Select a valid product promoter." }, { status: 400 });
    }
    const promoterAuthUser = authUsers.find((candidate) => candidate.id === selectedPromoterId);
    if (!promoterAuthUser) {
      return Response.json({ success: false, error: "Unable to load the selected promoter account." }, { status: 404 });
    }

    const metadata = promoterAuthUser.user_metadata || promoterAuthUser.app_metadata || {};
    const headCode = normalizeCode(metadata.head_salesman_code);
    if (!headCode) {
      return Response.json({ success: false, error: "Your account is not assigned to a head salesman." }, { status: 403 });
    }
    const headProfile = profiles.find((member) => normalizeCode(member.salesman_code) === headCode) || {
      salesman_code: headCode,
      salesman_name: metadata.head_salesman_name || headCode,
    };
    const peers = resolvePeersUnderSameHeadUserIds(authUsers, headProfile);
    const teamMembers = profiles
      .filter((member) => normalizeCode(member.salesman_code) === headCode || peers.has(member.id))
      .filter((member) => !isPromoter(member.role));
    const teamCodes = [...new Set([
      headCode,
      ...teamMembers.map((member) => normalizeCode(member.salesman_code)),
    ].filter(Boolean))];
    const teamSalesmanValues = [...new Set([
      ...teamCodes,
      ...teamMembers.map((member) => normalizeCode(member.salesman_name)),
      normalizeCode(headProfile.salesman_name),
    ].filter(Boolean))];
    const teamProfiles = [headProfile, ...teamMembers].filter((member, index, list) => (
      !member.id || list.findIndex((candidate) => candidate.id === member.id) === index
    ));
    if (!teamCodes.length) {
      return Response.json({ success: false, error: "No team members were found for your head salesman." }, { status: 403 });
    }

    const currentMonth = getKsaDateString().slice(0, 7);
    const params = new URL(request.url).searchParams;
    const fromMonth = params.get("fromMonth") || shiftMonth(currentMonth, -6);
    const toMonth = params.get("toMonth") || shiftMonth(currentMonth, -1);
    const monthKeys = promoterCoverageMonthKeys(fromMonth, toMonth);
    if (!monthKeys.length) {
      return Response.json({ success: false, error: "Select a valid month range." }, { status: 400 });
    }
    const firstVisitDate = `${shiftMonth(currentMonth, -12)}-01`;
    const [customers, membershipRows, visits, outstandingCustomerCodes] = await Promise.all([
      loadCustomersForSalesmen(admin, teamSalesmanValues),
      loadSalesMembership(admin, teamSalesmanValues),
      loadPromoterVisits(admin, promoterProfile.id, firstVisitDate),
      loadOutstandingCustomerCodes(admin, teamProfiles),
    ]);

    const knownCustomers = new Map();
    customers.forEach((row) => {
      const code = normalizeCode(row.customer_code);
      if (code) knownCustomers.set(code, row);
    });
    membershipRows.forEach((row) => {
      const code = normalizeCode(row.customer_code);
      if (!code) return;
      const existing = knownCustomers.get(code) || {};
      knownCustomers.set(code, {
        ...existing,
        customer_code: code,
        customer_name: existing.customer_name || row.customer_name || "",
        current_salesman_code: existing.current_salesman_code || row.salesman_code || "",
      });
    });
    outstandingCustomerCodes.forEach((code) => {
      if (!knownCustomers.has(code)) knownCustomers.set(code, { customer_code: code });
    });

    const salesCustomerCodes = [
      ...customers.map((customer) => customer.customer_code),
      ...membershipRows.map((sale) => sale.customer_code),
      ...outstandingCustomerCodes,
    ];
    const salesRows = await loadSalesTrendRows(admin, salesCustomerCodes, fromMonth, toMonth);

    const report = buildPromoterCoverageReport({
      customers: [...knownCustomers.values()],
      salesRows,
      visits,
      monthKeys,
      currentMonth,
    });

    return Response.json({
      success: true,
      reportDate: getKsaDateString(),
      fromMonth,
      toMonth,
      visitStartDate: firstVisitDate,
      promoterOptions,
      promoter: {
        userId: promoterProfile.id,
        salesmanCode: String(promoterProfile.salesman_code || "").trim(),
        salesmanName: String(promoterProfile.salesman_name || "").trim(),
      },
      requiresPromoterSelection: false,
      headSalesman: {
        code: headCode,
        name: String(metadata.head_salesman_name || headCode).trim(),
      },
      teamSalesmen: teamMembers.map((member) => ({
        code: String(member.salesman_code || "").trim(),
        name: String(member.salesman_name || "").trim(),
      })),
      ...report,
    });
  } catch (error) {
    console.error("Error building promoter coverage report:", error);
    return Response.json({ success: false, error: error.message || "Unable to load promoter coverage report." }, { status: 400 });
  }
}