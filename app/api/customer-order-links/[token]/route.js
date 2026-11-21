import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  loadCustomerOrderLinkCatalog,
  submitCustomerOrderLinkOrder,
} from "../../../lib/customerOrderLinksServer.js";

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

function adminClient() {
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function GET(_request, context) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return json({ success: false, error: "Server configuration is incomplete." }, 500);
    }
    const params = await context?.params;
    const token = String(params?.token || "").trim();
    const catalog = await loadCustomerOrderLinkCatalog(adminClient(), token);
    return json({ success: true, catalog });
  } catch (error) {
    const status = Number(error?.status) || 500;
    if (status >= 500) {
      console.error("Load customer order link failed:", error.message);
    }
    return json({
      success: false,
      error: status >= 500
        ? "Unable to open this order link. Please try again later."
        : (error.message || "Unable to open this order link."),
    }, status);
  }
}

export async function POST(request, context) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return json({ success: false, error: "Server configuration is incomplete." }, 500);
    }
    const params = await context?.params;
    const token = String(params?.token || "").trim();
    const body = await request.json().catch(() => ({}));
    const result = await submitCustomerOrderLinkOrder(adminClient(), token, {
      lines: Array.isArray(body?.lines) ? body.lines : [],
      requestId: String(body?.requestId || "").trim(),
    });
    return json({ success: true, ...result });
  } catch (error) {
    const status = Number(error?.status) || 500;
    if (status >= 500) {
      console.error("Submit customer order link failed:", error.message);
    }
    return json({
      success: false,
      error: status >= 500
        ? "Unable to submit the order. Please try again later."
        : (error.message || "Unable to submit the order."),
    }, status);
  }
}
