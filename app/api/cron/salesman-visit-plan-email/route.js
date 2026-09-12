import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "../../../lib/cronAuth.js";
import {
  DEFAULT_VISITS_PER_SALESMAN,
  isSalesmanVisitPlanEmailEnabled,
} from "../../../lib/salesmanVisitPlan.js";
import {
  buildSalesmanVisitPlanPayload,
  formatSupabaseError,
  loadSalesmanVisitPlanProfiles,
  sendSalesmanVisitPlanEmailsFromPayload,
} from "../../../lib/salesmanVisitPlanServer.js";
import { buildVisibleCustomersForScope } from "../../customers/visible/route.js";
import {
  fetchOutstandingAndCollectionRecords,
  getSalesScope,
} from "../../payment-collections/route.js";

export const runtime = "nodejs";
export const maxDuration = 120;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function createAdminClient() {
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function handleRequest(request) {
  try {
    if (!isCronAuthorized(request)) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    if (!isSalesmanVisitPlanEmailEnabled()) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: "email_disabled_until_approved",
        sentCount: 0,
        failedCount: 0,
      });
    }

    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const admin = createAdminClient();
    const profiles = await loadSalesmanVisitPlanProfiles(admin);
    const actor = profiles.find((row) => String(row.role || "").toLowerCase() === "admin") || profiles[0];
    if (!actor?.id) {
      return NextResponse.json({ success: false, error: "No admin profile available to build visit plans." }, { status: 500 });
    }

    const scope = await getSalesScope(admin, actor.id);
    const visibleScope = {
      ...scope,
      hasAllAccess: true,
      visibleSalesmanCodes: [],
      identitySearchPatterns: scope.identitySearchPatterns || [],
      outstandingSalesmanIdentities: scope.outstandingSalesmanIdentities || [],
    };

    const [visibleResult, collectionRecords] = await Promise.all([
      buildVisibleCustomersForScope(admin, visibleScope, {
        includeRecentSales: true,
        includeOutstanding: true,
        excludeBuildingMaterial: true,
      }),
      fetchOutstandingAndCollectionRecords(admin, scope),
    ]);

    const payload = buildSalesmanVisitPlanPayload({
      visibleCustomers: visibleResult?.customers || [],
      collectionRecords: collectionRecords || [],
      salesmanProfiles: profiles,
      limit: DEFAULT_VISITS_PER_SALESMAN,
      warnings: visibleResult?.warnings || [],
    });

    const result = await sendSalesmanVisitPlanEmailsFromPayload(payload, {
      forcePreview: false,
    });

    return NextResponse.json(
      { success: result.failedCount === 0, ...result },
      { status: result.failedCount ? 500 : 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: formatSupabaseError(error) || "Salesman visit plan email cycle failed.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request) {
  return handleRequest(request);
}

export async function GET(request) {
  return handleRequest(request);
}
