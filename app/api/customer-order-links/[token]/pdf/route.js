import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildCustomerOrderLinkPdf } from "../../../../lib/customerOrderLinksServer.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function adminClient() {
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function GET(_request, context) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json(
        { success: false, error: "Server configuration is incomplete." },
        { status: 500, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const params = await context?.params;
    const token = String(params?.token || "").trim();
    const pdf = await buildCustomerOrderLinkPdf(adminClient(), token);
    return new NextResponse(pdf.content, {
      status: 200,
      headers: {
        "Content-Type": pdf.contentType || "application/pdf",
        "Content-Disposition": `attachment; filename="${pdf.filename.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const status = Number(error?.status) || 500;
    if (status >= 500) {
      console.error("Customer order link PDF failed:", error.message);
    }
    return NextResponse.json({
      success: false,
      error: status >= 500
        ? "Unable to download the order PDF right now."
        : (error.message || "Unable to download the order PDF."),
    }, {
      status,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}
