import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { OUTSTANDING_DATASET_KEY } from "../../lib/outstanding";
import {
  downloadStoredUpload,
  excelContentType,
  parseUploadFileMeta,
  readSalesUploadFileMeta,
} from "../../lib/uploadFilesStorage";

export const runtime = "nodejs";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function parseJson(value) {
  try {
    return JSON.parse(value || "null");
  } catch {
    return null;
  }
}

function roleCanDownload(role) {
  const normalized = String(role || "").trim().toLowerCase();
  return ["admin", "manager", "invoice-maker", "invoice_maker"].includes(normalized);
}

async function resolveProfile(admin, token) {
  const {
    data: { user },
    error: userError,
  } = await admin.auth.getUser(token);

  if (userError || !user) {
    throw Object.assign(new Error("Invalid login session"), { status: 401 });
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,role")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    throw Object.assign(new Error("Profile not found."), { status: 403 });
  }

  return {
    id: profile.id,
    role: String(profile.role || "").toLowerCase(),
  };
}

async function resolveUploadMeta(admin, kind) {
  if (kind === "sales") {
    return readSalesUploadFileMeta(admin);
  }

  if (kind === "outstanding") {
    const { data, error } = await admin
      .from("system_settings")
      .select("setting_value")
      .eq("setting_key", OUTSTANDING_DATASET_KEY)
      .maybeSingle();

    if (error) throw error;

    const parsed = parseJson(data?.setting_value);
    return parseUploadFileMeta({
      kind: "outstanding",
      fileName: parsed?.fileName || "",
      filePath: parsed?.filePath || "",
      uploadedAt: parsed?.uploadedAt || "",
    });
  }

  return null;
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const profile = await resolveProfile(admin, authHeader.replace("Bearer ", ""));
    if (!roleCanDownload(profile.role)) {
      return NextResponse.json({ success: false, error: "Only admin/manager/invoice-maker can download uploaded files." }, { status: 403 });
    }

    const url = new URL(request.url);
    const kind = String(url.searchParams.get("kind") || "").trim().toLowerCase();
    const metaOnly = url.searchParams.get("meta") === "1";

    if (!["sales", "outstanding"].includes(kind)) {
      return NextResponse.json({ success: false, error: "kind must be sales or outstanding." }, { status: 400 });
    }

    const meta = await resolveUploadMeta(admin, kind);

    if (metaOnly) {
      return NextResponse.json({
        success: true,
        kind,
        available: Boolean(meta?.filePath),
        fileName: meta?.fileName || "",
        uploadedAt: meta?.uploadedAt || "",
      });
    }

    if (!meta?.filePath) {
      return NextResponse.json({
        success: false,
        error: "No stored file is available yet. Upload again to enable download.",
      }, { status: 404 });
    }

    const blob = await downloadStoredUpload(admin, meta.filePath);
    const buffer = Buffer.from(await blob.arrayBuffer());
    const downloadName = meta.fileName || `${kind}.xlsx`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": excelContentType(downloadName),
        "Content-Disposition": `attachment; filename="${downloadName.replace(/"/g, "")}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return NextResponse.json({
      success: false,
      error: error.message || "Unable to download uploaded file.",
    }, { status });
  }
}
