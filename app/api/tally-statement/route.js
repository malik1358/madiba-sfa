import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { parseTallyStatementPdfBuffer } from "../../lib/tallyStatementPdf.js";

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

export async function POST(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const admin = adminClient();
    const access = await requireUser(admin, request);
    if (access.error) return access.error;

    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file.arrayBuffer !== "function") {
      return NextResponse.json({ success: false, error: "Choose a Tally statement file." }, { status: 400 });
    }

    const name = String(file.name || "");
    const type = String(file.type || "");
    const isPdf = type.includes("pdf") || name.toLowerCase().endsWith(".pdf");
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

    const parsed = await parseTallyStatementPdfBuffer(buffer);
    if (!parsed.entries.length) {
      return NextResponse.json({
        success: false,
        error: parsed.error || "No ledger lines found in this PDF.",
      }, { status: 400 });
    }

    return NextResponse.json({ success: true, ...parsed });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error?.message || "Unable to read the Tally statement." },
      { status: 500 },
    );
  }
}
