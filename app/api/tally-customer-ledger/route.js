import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { canonicalCustomerCode } from "../../lib/customerCode.js";
import { chooseTallyLedgerName, ledgerNamesFromSalesRows } from "../../lib/tallyItemUnits.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function adminClient() {
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function safeCustomerCode(value) {
  const code = canonicalCustomerCode(value);
  if (!code || !/^[A-Z0-9-]{2,20}$/.test(code)) return "";
  return code;
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

export async function GET(request) {
  try {
    const admin = adminClient();
    const access = await requireUser(admin, request);
    if (access.error) return access.error;

    const code = safeCustomerCode(new URL(request.url).searchParams.get("code"));
    if (!code) {
      return NextResponse.json({ success: true, ledgerName: "" });
    }

    const [rawNames, sourcedRows] = await Promise.all([
      admin
        .from("sales_raw")
        .select("customer_name")
        .is("customer_code", null)
        .ilike("customer_name", `${code} %`)
        .limit(2000),
      admin
        .from("sales_raw")
        .select("customer_name, source_data")
        .eq("customer_code", code)
        .not("source_data", "is", null)
        .limit(400),
    ]);

    if (rawNames.error) throw rawNames.error;
    if (sourcedRows.error) throw sourcedRows.error;

    const ledgerName = chooseTallyLedgerName(code, [
      ...ledgerNamesFromSalesRows(rawNames.data),
      ...ledgerNamesFromSalesRows(sourcedRows.data),
    ]);

    return NextResponse.json({ success: true, ledgerName });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error?.message || "Unable to read the Tally ledger name." },
      { status: 500 },
    );
  }
}
