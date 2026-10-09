import { NextResponse } from "next/server";
import { after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { salesmanValueMatchesScope } from "../../lib/mutualSalesmanGroups.js";
import { summarizeOutstandingBillMismatches, summarizeOutstandingReconcileRows } from "../../lib/outstandingReconcile.js";
import {
  readOutstandingReconcileDataset,
  rebuildOutstandingReconcileDataset,
} from "../../lib/outstandingReconcileServer.js";
import { runOutstandingReconcileCycle } from "../../lib/outstandingReconcileEmailServer.js";
import { resolveScopeForUserId } from "../customers/visible/route.js";

export const runtime = "nodejs";
export const maxDuration = 300;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function roleCanRebuild(role) {
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

  return { id: profile.id, role: String(profile.role || "").toLowerCase() };
}

function adminClient() {
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
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

    const admin = adminClient();
    const profile = await resolveProfile(admin, authHeader.replace("Bearer ", ""));
    const dataset = await readOutstandingReconcileDataset(admin);

    let rows = dataset.rows;
    let mismatchRows = dataset.mismatchRows;
    const scope = await resolveScopeForUserId(admin, profile.id).catch(() => null);
    if (scope && !scope.hasAllAccess) {
      rows = rows.filter((row) => salesmanValueMatchesScope(row.salesman_name, scope.scopeMatchers));
      mismatchRows = mismatchRows.filter((row) => salesmanValueMatchesScope(row.salesman_name, scope.scopeMatchers));
    }

    return NextResponse.json({
      success: true,
      builtAt: dataset.builtAt,
      trigger: dataset.trigger,
      scannedCount: dataset.scannedCount,
      failedCount: dataset.failedCount,
      outstandingUploadedAt: dataset.outstandingUploadedAt,
      receiptUploadedAt: dataset.receiptUploadedAt,
      rows,
      summary: rows === dataset.rows ? dataset.summary : summarizeOutstandingReconcileRows(rows),
      mismatchRows,
      mismatchSummary: mismatchRows === dataset.mismatchRows
        ? dataset.mismatchSummary
        : summarizeOutstandingBillMismatches(mismatchRows),
      coverageGaps: dataset.coverageGaps,
      coverageSummary: dataset.coverageSummary,
    });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return NextResponse.json({
      success: false,
      error: error.message || "Unable to load outstanding reconciliation.",
    }, { status });
  }
}

export async function POST(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    const admin = adminClient();
    const profile = await resolveProfile(admin, authHeader.replace("Bearer ", ""));
    if (!roleCanRebuild(profile.role)) {
      return NextResponse.json({
        success: false,
        error: "Only admin/manager/invoice-maker can rebuild the reconciliation.",
      }, { status: 403 });
    }

    const url = new URL(request.url);
    const withEmail = ["1", "true", "yes"].includes(
      String(url.searchParams.get("email") || "").trim().toLowerCase(),
    );

    if (withEmail) {
      after(async () => {
        try {
          await runOutstandingReconcileCycle(adminClient(), { trigger: "manual", sendWhenEmpty: true });
        } catch (error) {
          console.error("Outstanding reconcile email cycle failed:", error);
        }
      });
      return NextResponse.json({ success: true, queued: true });
    }

    const dataset = await rebuildOutstandingReconcileDataset(admin, { trigger: "manual" });
    return NextResponse.json({
      success: true,
      builtAt: dataset.builtAt,
      scannedCount: dataset.scannedCount,
      failedCount: dataset.failedCount,
      differenceCount: dataset.rows.length,
    });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return NextResponse.json({
      success: false,
      error: error.message || "Unable to rebuild outstanding reconciliation.",
    }, { status });
  }
}
