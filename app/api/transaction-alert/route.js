import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  notifyTransactionBosses,
  TRANSACTION_ALERT_TYPES,
} from "../../lib/transactionBossAlerts.js";

export const runtime = "nodejs";
export const maxDuration = 30;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const authHeader = request.headers.get("authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    const token = authHeader.slice(7);
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: { user }, error: userError } = await admin.auth.getUser(token);
    if (userError || !user) {
      return NextResponse.json({ success: false, error: "Invalid login session" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const transactionType = String(body?.transactionType || "").trim().toUpperCase();

    if (!TRANSACTION_ALERT_TYPES.has(transactionType)) {
      return NextResponse.json({ success: false, error: "Unsupported transaction type." }, { status: 400 });
    }

    const result = await notifyTransactionBosses(admin, {
      actorUserId: user.id,
      transactionType,
      referenceKey: String(body?.referenceKey || "").trim(),
      details: {
        customerCode: body?.customerCode,
        customerName: body?.customerName,
        companyName: body?.companyName,
        outcome: body?.outcome,
        visitOutcome: body?.visitOutcome,
        referenceId: body?.referenceId,
      },
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "Unable to send transaction alert." },
      { status: 500 },
    );
  }
}
