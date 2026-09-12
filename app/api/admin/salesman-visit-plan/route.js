import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCollectionOnlyAccess, isSalesmanVisitPlanSalesmanAccessApproved } from "../../../lib/moduleAccess.js";
import {
  DEFAULT_VISITS_PER_SALESMAN,
  isSalesmanVisitPlanEmailEnabled,
  isSalesmanVisitPlanSendToUsersEnabled,
} from "../../../lib/salesmanVisitPlan.js";
import {
  buildAndStoreSalesmanVisitPlanSnapshot,
  formatSupabaseError,
  loadSalesmanVisitPlanFromSnapshot,
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

async function requireVisitPlanAccess(admin, request, { forEmail = false, forRebuild = false } = {}) {
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
        { success: false, error: "You do not have access to salesman visit plans." },
        { status: 403 },
      ),
    };
  }

  if (role === "admin") {
    return { user, profile, role, forceOwnSalesman: false };
  }

  if (forEmail || forRebuild) {
    return {
      error: NextResponse.json(
        { success: false, error: "Only admin can rebuild or email visit plans." },
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
      { success: false, error: "You do not have access to salesman visit plans." },
      { status: 403 },
    ),
  };
}

function accessMeta() {
  return {
    adminOnly: !isSalesmanVisitPlanSalesmanAccessApproved(),
    salesmanAccessApproved: isSalesmanVisitPlanSalesmanAccessApproved(),
    emailEnabled: isSalesmanVisitPlanEmailEnabled(),
    sendToUsersEnabled: isSalesmanVisitPlanSendToUsersEnabled(),
  };
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
    const limit = Number(url.searchParams.get("limit") || 0);
    const payload = await loadSalesmanVisitPlanFromSnapshot(admin, {
      salesmanCode,
      limit,
    });

    return NextResponse.json({
      success: true,
      ...payload,
      access: accessMeta(),
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

    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const action = String(body.action || "email").trim().toLowerCase();
    const admin = createAdminClient();
    const access = await requireVisitPlanAccess(admin, request, {
      forEmail: action === "email",
      forRebuild: action === "rebuild",
    });
    if (access.error) return access.error;

    if (action === "rebuild") {
      const snapshot = await buildAndStoreSalesmanVisitPlanSnapshot(admin, {
        actorUserId: access.user.id,
        limit: Number(body.limit || DEFAULT_VISITS_PER_SALESMAN),
      });
      return NextResponse.json({
        success: true,
        rebuilt: true,
        ...snapshot,
        access: accessMeta(),
      });
    }

    const salesmanCode = String(body.salesman || body.salesmanCode || "").trim();
    const forcePreview = body.forcePreview === true;
    const payload = await loadSalesmanVisitPlanFromSnapshot(admin, {
      salesmanCode,
      limit: Number(body.limit || 0),
    });

    if (payload.missingSnapshot) {
      return NextResponse.json({
        success: false,
        error: "No midnight visit plan is ready yet. Rebuild the snapshot first, or wait for the nightly job.",
        access: accessMeta(),
      }, { status: 404 });
    }

    const result = await sendSalesmanVisitPlanEmailsFromPayload(payload, {
      salesmanCode,
      forcePreview,
    });

    return NextResponse.json({
      success: result.failedCount === 0 && !result.skipped,
      ...result,
      access: accessMeta(),
    }, {
      status: result.skipped ? 200 : (result.failedCount ? 500 : 200),
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: formatSupabaseError(error) || "Unable to process salesman visit plan request." },
      { status: 500 },
    );
  }
}
