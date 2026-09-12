import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "../../../lib/cronAuth.js";
import {
  DEFAULT_VISITS_PER_SALESMAN,
  isSalesmanVisitPlanEmailEnabled,
} from "../../../lib/salesmanVisitPlan.js";
import {
  buildAndStoreSalesmanVisitPlanSnapshot,
  formatSupabaseError,
  loadSalesmanVisitPlanProfiles,
  sendSalesmanVisitPlanEmailsFromPayload,
} from "../../../lib/salesmanVisitPlanServer.js";

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

    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const admin = createAdminClient();
    const profiles = await loadSalesmanVisitPlanProfiles(admin);
    const actor = profiles.find((row) => String(row.role || "").toLowerCase() === "admin") || profiles[0];
    if (!actor?.id) {
      return NextResponse.json({ success: false, error: "No admin profile available to build visit plans." }, { status: 500 });
    }

    // Always build and store the midnight snapshot so the page can serve it instantly.
    const snapshot = await buildAndStoreSalesmanVisitPlanSnapshot(admin, {
      actorUserId: actor.id,
      limit: DEFAULT_VISITS_PER_SALESMAN,
    });

    if (!isSalesmanVisitPlanEmailEnabled()) {
      return NextResponse.json({
        success: true,
        stored: true,
        emailed: false,
        skipped: true,
        reason: "email_disabled",
        reportDate: snapshot.reportDate,
        builtAt: snapshot.builtAt,
        salesmanCount: snapshot.salesmanCount,
        visitCount: snapshot.visitCount,
        sentCount: 0,
        failedCount: 0,
      });
    }

    const result = await sendSalesmanVisitPlanEmailsFromPayload(snapshot, {
      forcePreview: false,
    });

    return NextResponse.json(
      {
        success: result.failedCount === 0,
        stored: true,
        emailed: true,
        builtAt: snapshot.builtAt,
        ...result,
      },
      { status: result.failedCount ? 500 : 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: formatSupabaseError(error) || "Salesman visit plan midnight cycle failed.",
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
