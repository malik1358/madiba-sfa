import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { parseTallyStatementPdfBuffer } from "../../lib/tallyStatementPdf.js";
import {
  buildTallyStatementRecord,
  readTallyStatementRecord,
  tallyStatementSettingKey,
} from "../../lib/tallyStatementStore.js";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MAX_PDF_BYTES = 8 * 1024 * 1024;

function adminClient() {
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireUser(admin, request) {
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return { error: NextResponse.json({ success: false, error: "Please login again." }, { status: 401 }) };
  }
  const token = authHeader.slice(7);
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) {
    return { error: NextResponse.json({ success: false, error: "Please login again." }, { status: 401 }) };
  }
  return { user };
}

function customerCodeFrom(request) {
  const url = new URL(request.url);
  return String(url.searchParams.get("customerCode") || "").trim();
}

async function readStored(admin, customerCode) {
  const key = tallyStatementSettingKey(customerCode);
  if (!key) return null;
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", key)
    .maybeSingle();
  if (error) throw error;
  return readTallyStatementRecord(data?.setting_value);
}

async function writeStored(admin, customerCode, record) {
  const key = tallyStatementSettingKey(customerCode);
  if (!key || !record) {
    throw new Error("Customer code is required.");
  }
  const { error } = await admin.from("system_settings").upsert({
    setting_key: key,
    setting_value: JSON.stringify(record),
  }, { onConflict: "setting_key" });
  if (error) throw error;
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }
    const admin = adminClient();
    const access = await requireUser(admin, request);
    if (access.error) return access.error;
    const customerCode = customerCodeFrom(request);
    if (!customerCode) {
      return NextResponse.json({ success: false, error: "Customer code is required." }, { status: 400 });
    }
    const statement = await readStored(admin, customerCode);
    return NextResponse.json({ success: true, statement });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error?.message || "Unable to load the Tally statement." },
      { status: 500 },
    );
  }
}

export async function DELETE(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }
    const admin = adminClient();
    const access = await requireUser(admin, request);
    if (access.error) return access.error;
    const customerCode = customerCodeFrom(request);
    const key = tallyStatementSettingKey(customerCode);
    if (!key) {
      return NextResponse.json({ success: false, error: "Customer code is required." }, { status: 400 });
    }
    const { error } = await admin.from("system_settings").delete().eq("setting_key", key);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error?.message || "Unable to clear the Tally statement." },
      { status: 500 },
    );
  }
}

export async function POST(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const admin = adminClient();
    const access = await requireUser(admin, request);
    if (access.error) return access.error;

    const contentType = String(request.headers.get("content-type") || "");
    let customerCode = "";
    let fileName = "";
    let parsed = null;

    if (contentType.includes("application/json")) {
      const body = await request.json();
      customerCode = String(body?.customerCode || "").trim();
      fileName = String(body?.fileName || "").trim();
      parsed = body;
    } else {
      const form = await request.formData();
      customerCode = String(form.get("customerCode") || "").trim();
      const file = form.get("file");
      if (!file || typeof file.arrayBuffer !== "function") {
        return NextResponse.json({ success: false, error: "Choose a Tally statement file." }, { status: 400 });
      }
      fileName = String(file.name || "");
      const type = String(file.type || "");
      const isPdf = type.includes("pdf") || fileName.toLowerCase().endsWith(".pdf");
      if (!isPdf) {
        return NextResponse.json({
          success: false,
          error: "Upload the Tally ledger PDF here. Excel and CSV are read in the browser.",
        }, { status: 400 });
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      if (!buffer.length || buffer.length > MAX_PDF_BYTES) {
        return NextResponse.json({ success: false, error: "The PDF is empty or larger than 8 MB." }, { status: 400 });
      }
      parsed = await parseTallyStatementPdfBuffer(buffer);
    }

    const record = buildTallyStatementRecord(parsed, {
      fileName,
      uploadedBy: access.user?.email || access.user?.id || "",
    });
    if (!record) {
      return NextResponse.json({
        success: false,
        error: parsed?.error || "No ledger lines found in this file.",
      }, { status: 400 });
    }
    if (!customerCode) {
      return NextResponse.json({ success: false, error: "Choose a customer before uploading the statement." }, { status: 400 });
    }
    await writeStored(admin, customerCode, record);

    return NextResponse.json({ success: true, statement: record, entries: record.entries });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error?.message || "Unable to read the Tally statement." },
      { status: 500 },
    );
  }
}
