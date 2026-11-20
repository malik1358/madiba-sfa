import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { readCustomerOrderLinkPhoto } from "../../../../lib/customerOrderLinksServer.js";

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

export async function GET(request, context) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return json({ success: false, error: "Server configuration is incomplete." }, 500);
    }
    const params = await context?.params;
    const token = String(params?.token || "").trim();
    const photoId = String(new URL(request.url).searchParams.get("photoId") || "").trim();
    if (!photoId) return json({ success: false, error: "Photo id is required." }, 400);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const photo = await readCustomerOrderLinkPhoto(admin, token, photoId);
    return new NextResponse(photo.bytes, {
      status: 200,
      headers: {
        "Content-Type": photo.contentType || "image/jpeg",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const status = Number(error?.status) || 500;
    if (status >= 500) {
      console.error("Customer order link photo failed:", error.message);
    }
    return json({
      success: false,
      error: status >= 500
        ? "Unable to load this photo."
        : (error.message || "Unable to load this photo."),
    }, status);
  }
}
