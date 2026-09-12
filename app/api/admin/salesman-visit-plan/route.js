import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildVisibleCustomersForScope } from "../../customers/visible/route.js";
import {
  fetchOutstandingAndCollectionRecords,
  getSalesScope,
} from "../../payment-collections/route.js";
import { isCollectionOnlyAccess, isSalesmanVisitPlanSalesmanAccessApproved } from "../../../lib/moduleAccess.js";
import {
  DEFAULT_VISITS_PER_SALESMAN,
  isSalesmanVisitPlanEmailEnabled,
  isSalesmanVisitPlanSendToUsersEnabled,
} from "../../../lib/salesmanVisitPlan.js";
import {
  buildSalesmanVisitPlanPayload,
  formatSupabaseError,
  loadSalesmanVisitPlanProfiles,
  sendSalesmanVisitPlanEmailsFromPayload,
} from "../../../lib/salesmanVisitPlanServer.js";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function createAdminClient() {
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireVisitPlanAccess(admin, request, { forEmail = false } = {}) {
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return { error: NextResponse.json({ success: false, error: "Please login again." }, { status: 401 }) };
  }

  const token = authHeader.slice(7);
  const { data: { user }, error: userError } = await admin.auth.getUser(token);
  if (userError || !user) {
    return { error: NextResponse.json({ success: false, error: "Please login again." }, { status: 401 }) };
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,role,salesman_code,salesman_name")
    .eq("id", user.id)
    .single();

  const role = String(profile?.role || "").toLowerCase();
  if (profileError || !profile || isCollectionOnlyAccess({ role, salesmanCode: profile.salesman_code })) {
    return {
      error: NextResponse.json(
        { success: false, error: "Only admin can access salesman visit plans until approval." },
        { status: 403 },
      ),
    };
  }

  if (role === "admin") {
    return { user, profile, role, forceOwnSalesman: false };
  }

  // Email controls stay admin-only even after salesman page access is approved.
  if (forEmail) {
    return {
      error: NextResponse.json(
        { success: false, error: "Only admin can send visit plan emails." },
        { status: 403 },
      ),
    };
  }

  if (
    isSalesmanVisitPlanSalesmanAccessApproved()
    && ["salesman", "manager"].includes(role)
    && String(profile.salesman_code || "").trim()
  ) {
    return {
      user,
      profile,
      role,
      forceOwnSalesman: true,
    };
  }

  return {
    error: NextResponse.json(
      { success: false, error: "Only admin can access salesman visit plans until approval." },
      { status: 403 },
    ),
  };
}

async function loadVisitPlanPayload(admin, actorUserId, {
  salesmanCode = "",
  limit = DEFAULT_VISITS_PER_SALESMAN,
  allAccess = true,
} = {}) {
  const [scope, salesmanProfiles] = await Promise.all([
    getSalesScope(admin, actorUserId),
    loadSalesmanVisitPlanProfiles(admin),
  ]);

  const visibleScope = allAccess
    ? {
      ...scope,
      hasAllAccess: true,
      visibleSalesmanCodes: [],
      identitySearchPatterns: scope.identitySearchPatterns || [],
      outstandingSalesmanIdentities: scope.outstandingSalesmanIdentities || [],
    }
    : scope;

  const [visibleResult, collectionRecords] = await Promise.all([
    buildVisibleCustomersForScope(admin, visibleScope, {
      includeRecentSales: true,
      includeOutstanding: true,
      excludeBuildingMaterial: true,
    }),
    fetchOutstandingAndCollectionRecords(admin, scope),
  ]);

  return buildSalesmanVisitPlanPayload({
    visibleCustomers: visibleResult?.customers || [],
    collectionRecords: collectionRecords || [],
    salesmanProfiles,
    salesmanCode,
    limit,
    warnings: visibleResult?.warnings || [],
  });
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const admin = createAdminClient();
    const access = await requireVisitPlanAccess(admin, request);
    if (access.error) return access.error;

    const url = new URL(request.url);
    const requestedSalesman = String(url.searchParams.get("salesman") || "").trim();
    const salesmanCode = access.forceOwnSalesman
      ? String(access.profile.salesman_code || "").trim()
      : requestedSalesman;
    const limit = Number(url.searchParams.get("limit") || DEFAULT_VISITS_PER_SALESMAN);
    const payload = await loadVisitPlanPayload(admin, access.user.id, {
      salesmanCode,
      limit,
      allAccess: !access.forceOwnSalesman,
    });

    return NextResponse.json({
      success: true,
      ...payload,
      access: {
        adminOnly: !isSalesmanVisitPlanSalesmanAccessApproved(),
        salesmanAccessApproved: isSalesmanVisitPlanSalesmanAccessApproved(),
        emailEnabled: isSalesmanVisitPlanEmailEnabled(),
        sendToUsersEnabled: isSalesmanVisitPlanSendToUsersEnabled(),
      },
    }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: formatSupabaseError(error) || "Unable to load salesman visit plans." },
      { status: 500 },
    );
  }
}

export async function POST(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const admin = createAdminClient();
    const access = await requireVisitPlanAccess(admin, request, { forEmail: true });
    if (access.error) return access.error;

    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const salesmanCode = String(body.salesman || body.salesmanCode || "").trim();
    const limit = Number(body.limit || DEFAULT_VISITS_PER_SALESMAN);
    const forcePreview = body.forcePreview === true;
    const payload = await loadVisitPlanPayload(admin, access.user.id, {
      salesmanCode,
      limit,
      allAccess: true,
    });
    const result = await sendSalesmanVisitPlanEmailsFromPayload(payload, {
      salesmanCode,
      forcePreview,
    });

    return NextResponse.json({
      success: result.failedCount === 0 && !result.skipped,
      ...result,
      access: {
        adminOnly: !isSalesmanVisitPlanSalesmanAccessApproved(),
        salesmanAccessApproved: isSalesmanVisitPlanSalesmanAccessApproved(),
        emailEnabled: isSalesmanVisitPlanEmailEnabled(),
        sendToUsersEnabled: isSalesmanVisitPlanSendToUsersEnabled(),
      },
    }, {
      status: result.skipped ? 200 : (result.failedCount ? 500 : 200),
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: formatSupabaseError(error) || "Unable to send salesman visit plan email." },
      { status: 500 },
    );
  }
}
