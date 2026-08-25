import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveSalesScopeForUserId } from "../user/sales-scope/route.js";
import {
  canAccessProspectSalesmanCode,
  insertProspectWithColumnFallback,
  normalizeProspectSalesmanCode,
} from "../../lib/prospects.js";
import { linkProspectToCustomer } from "../../lib/prospectCustomerLink.js";

export const runtime = "nodejs";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function createAdminClient() {
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function resolveRequestScope(request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Not authenticated");
  }

  const admin = createAdminClient();
  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: userError,
  } = await admin.auth.getUser(token);

  if (userError || !user) {
    throw new Error("Invalid login session");
  }

  const scope = await resolveSalesScopeForUserId(admin, user.id);
  return { admin, user, scope, token };
}

function resolveSalesmanCode(scope, requestedCode) {
  const normalizedRequest = normalizeProspectSalesmanCode(requestedCode);
  const ownCode = normalizeProspectSalesmanCode(scope.currentSalesmanCode);

  if (!normalizedRequest) {
    return ownCode;
  }

  if (canAccessProspectSalesmanCode(scope, normalizedRequest)) {
    return normalizedRequest;
  }

  throw new Error("You do not have permission to register prospects for this salesman.");
}

export async function POST(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const { admin, scope } = await resolveRequestScope(request);
    const body = await request.json().catch(() => ({}));

    const salesmanCode = resolveSalesmanCode(scope, body.salesman_code);
    const companyName = String(body.company_name || "").trim();
    if (!companyName) {
      return NextResponse.json({ success: false, error: "Company name is required." }, { status: 400 });
    }

    const payload = {
      company_name: companyName,
      company_name_ar: String(body.company_name_ar || "").trim() || null,
      contact_person: String(body.contact_person || "").trim() || null,
      mobile: String(body.mobile || "").trim() || null,
      city: String(body.city || "").trim() || null,
      area: String(body.area || "").trim() || null,
      latitude: body.latitude == null ? null : Number(body.latitude),
      longitude: body.longitude == null ? null : Number(body.longitude),
      salesman_code: salesmanCode,
      remarks: String(body.remarks || "").trim() || null,
    };

    const { data, removedColumns } = await insertProspectWithColumnFallback(admin, payload);

    return NextResponse.json({
      success: true,
      data,
      removedColumns,
    });
  } catch (error) {
    const message = String(error?.message || "Unable to register prospect.");
    const status = message.includes("authenticated") || message.includes("login session") ? 401 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function PATCH(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const { admin, scope } = await resolveRequestScope(request);
    const body = await request.json().catch(() => ({}));
    const prospectId = Number(body.id);
    if (!Number.isFinite(prospectId) || prospectId <= 0) {
      return NextResponse.json({ success: false, error: "Prospect id is required." }, { status: 400 });
    }

    const { data: existing, error: loadError } = await admin
      .from("prospects")
      .select("id,salesman_code")
      .eq("id", prospectId)
      .maybeSingle();

    if (loadError) throw loadError;
    if (!existing?.id) {
      return NextResponse.json({ success: false, error: "Prospect not found." }, { status: 404 });
    }

    if (!canAccessProspectSalesmanCode(scope, existing.salesman_code)) {
      return NextResponse.json({ success: false, error: "You do not have access to this prospect." }, { status: 403 });
    }

    const action = String(body.action || "schedule_follow_up").trim().toLowerCase();
    if (action === "link_customer") {
      const customerCode = String(body.customer_code || "").trim();
      const result = await linkProspectToCustomer(admin, {
        prospectId,
        customerCode,
        copyGps: body.copy_gps !== false,
        overwriteCustomerGps: Boolean(body.overwrite_customer_gps),
      });

      return NextResponse.json({
        success: true,
        data: result.prospect,
        linkedCustomer: {
          customer_code: result.customerCode,
          customer_name: result.customer.customer_name,
          gpsCopied: result.gpsCopied,
        },
      });
    }

    const followUpDate = String(body.follow_up_date || "").trim();
    if (!followUpDate) {
      return NextResponse.json({ success: false, error: "Next visit date is required." }, { status: 400 });
    }

    const { data, error: updateError } = await admin
      .from("prospects")
      .update({ status: "FOLLOW_UP", follow_up_date: followUpDate })
      .eq("id", prospectId)
      .select("id,status,follow_up_date,salesman_code")
      .single();

    if (updateError) throw updateError;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = String(error?.message || "Unable to update prospect.");
    const status = message.includes("authenticated") || message.includes("login session") ? 401 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
