import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "../../../lib/cronAuth.js";
import { resendInvoiceUploadNotification } from "../../../lib/invoiceUploadEmailServer.js";

export const runtime = "nodejs";
export const maxDuration = 120;

function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function POST(request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
  }

  try {
    let body = {};
    try { body = await request.json(); } catch { body = {}; }
    const result = await resendInvoiceUploadNotification(createAdminClient(), {
      orderId: body?.orderId,
      extraCc: body?.cc || "malik@pinasz.com",
    });
    return NextResponse.json({
      success: Boolean(result.sent),
      ...result,
    }, { status: result.sent ? 200 : 500 });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error?.message || error) }, { status: 500 });
  }
}

export async function GET(request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const body = {
    orderId: url.searchParams.get("orderId"),
    cc: url.searchParams.get("cc") || "malik@pinasz.com",
  };
  const requestLike = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(body),
  });
  return POST(requestLike);
}
