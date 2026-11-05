import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCollectionOnlyAccess } from "../../lib/moduleAccess.js";
import { resolveTallySalesChannel, resolveTallySalesRouting } from "../../lib/tallyItemUnits.js";
import { allocateTallyVoucherNumberForOrder } from "../../lib/tallyVoucherNumbers.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function adminClient() {
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireExportAccess(admin, request) {
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
    .select("id,role,salesman_code")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    return { error: NextResponse.json({ success: false, error: "Profile not found." }, { status: 403 }) };
  }

  const role = String(profile.role || "").toLowerCase();
  if (isCollectionOnlyAccess({ role, salesmanCode: profile.salesman_code })) {
    return {
      error: NextResponse.json({
        success: false,
        error: "Collection-only users cannot assign Tally voucher numbers.",
      }, { status: 403 }),
    };
  }

  return { user, profile, role };
}

export async function POST(request) {
  try {
    const admin = adminClient();
    const access = await requireExportAccess(admin, request);
    if (access.error) return access.error;

    const body = await request.json().catch(() => ({}));
    const orderId = Number(body?.orderId ?? body?.order_id);
    const pricingRegion = body?.pricingRegion ?? body?.pricing_region;
    const paymentType = body?.paymentType ?? body?.payment_type;

    const { data: order, error: orderError } = await admin
      .from("sales_orders")
      .select("id,salesman_code,salesman_name")
      .eq("id", orderId)
      .maybeSingle();
    if (orderError) throw orderError;
    if (!order) {
      return NextResponse.json({ success: false, error: "Order not found." }, { status: 404 });
    }

    const routing = resolveTallySalesRouting(order, pricingRegion);
    const channel = resolveTallySalesChannel(order);
    const result = await allocateTallyVoucherNumberForOrder(admin, {
      orderId,
      pricingRegion,
      paymentType,
      routing,
      channel,
    });

    return NextResponse.json({
      success: true,
      voucherNumber: result.voucherNumber,
      seriesKey: result.seriesKey,
      prefix: result.prefix,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error?.message || "Unable to assign a Tally voucher number." },
      { status: 500 },
    );
  }
}
