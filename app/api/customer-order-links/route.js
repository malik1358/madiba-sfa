import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createCustomerOrderLink } from "../../lib/customerOrderLinksServer.js";
import { resolveSalesScopeForUserId } from "../user/sales-scope/route.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(payload, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

async function getAuthUser(admin, token) {
  const {
    data: { user },
    error,
  } = await admin.auth.getUser(token);
  if (error || !user) throw Object.assign(new Error("Not authenticated"), { status: 401 });
  return user;
}

export async function POST(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return json({ success: false, error: "Server configuration is incomplete." }, 500);
    }

    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ success: false, error: "Not authenticated" }, 401);
    }

    const body = await request.json().catch(() => ({}));
    const customerCode = String(body?.customerCode || body?.customer_code || "").trim();
    const customerName = String(body?.customerName || body?.customer_name || "").trim();
    if (!customerCode) {
      return json({ success: false, error: "Customer is required." }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const user = await getAuthUser(admin, authHeader.replace("Bearer ", ""));
    const scope = await resolveSalesScopeForUserId(admin, user.id);
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("role,salesman_code,salesman_name")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) throw profileError;

    const link = await createCustomerOrderLink(admin, {
      scope,
      userId: user.id,
      profile,
      customerCode,
      customerName,
      pricingRegion: body?.pricingRegion || scope?.pricingRegion || "",
      paymentType: body?.paymentType || "credit",
      pricingType: body?.pricingType || "wholesale",
    });

    return json({ success: true, link });
  } catch (error) {
    const status = Number(error?.status) || 500;
    if (status >= 500) {
      console.error("Create customer order link failed:", error.message);
    }
    return json({
      success: false,
      error: status >= 500
        ? "Unable to create the order link. Please try again."
        : (error.message || "Unable to create the order link."),
    }, status);
  }
}
