import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "../../../lib/cronAuth.js";
import { readR2Config } from "../../../lib/storage/r2Guard.js";
import { getObject, putObject } from "../../../lib/storage/providers/r2Provider.js";
import {
  COPY_CONCURRENCY,
  RECEIPT_COPY_PREFIX,
  RECEIPT_COPY_PROGRESS_KEY,
  RECEIPT_R2_BUCKET,
  copyReceiptBatch,
  receiptDestinationKey,
} from "../../../lib/storage/copyReceiptsToR2.js";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MIN_SOURCE_FILES = 1200;

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function parseProgress(value) {
  let payload = value;
  if (typeof value === "string") {
    try {
      payload = JSON.parse(value);
    } catch {
      payload = {};
    }
  }
  return {
    verified: payload?.verified && typeof payload.verified === "object" ? payload.verified : {},
    reconciled: payload?.reconciled && typeof payload.reconciled === "object" ? payload.reconciled : {},
    copied: Number(payload?.copied || 0),
    already: Number(payload?.already || 0),
    verifiedRows: Number(payload?.verifiedRows || 0),
    failures: Array.isArray(payload?.failures) ? payload.failures.slice(0, 100) : [],
  };
}

async function listReceiptNames(admin) {
  const names = [];
    for (let offset = 0; offset < 20000; offset += 100) {
    const { data, error } = await admin.storage.from("payment-collections").list(RECEIPT_COPY_PREFIX.slice(0, -1), {
      limit: 100,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw error;
    const page = data || [];
    for (const entry of page) {
      if (!entry?.name || !entry.id) continue;
      names.push(`${RECEIPT_COPY_PREFIX}${entry.name}`);
    }
    if (page.length < 100) break;
  }
  return [...new Set(names)].sort();
}

async function loadProgress(admin) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", RECEIPT_COPY_PROGRESS_KEY)
    .maybeSingle();
  if (error) throw error;
  return parseProgress(data?.setting_value);
}

async function saveProgress(admin, progress) {
  const { error } = await admin.from("system_settings").upsert({
    setting_key: RECEIPT_COPY_PROGRESS_KEY,
    setting_value: JSON.stringify(progress),
  }, { onConflict: "setting_key" });
  if (error) throw error;
}

export async function POST(request) {
  if (!isCronAuthorized(request)) return json({ success: false, error: "Unauthorized" }, 401);
  if (process.env.VERCEL_ENV !== "production") {
    return json({ success: false, stop: true, stopReason: "not-production" }, 409);
  }
  if (!supabaseUrl || !serviceKey) return json({ success: false, stop: true, stopReason: "server-config" }, 500);
  return json({ success: false, stop: true, stopReason: "supabase-originals-retired" }, 409);

  let mode = "copy";
  try {
    const body = await request.json();
    if (body?.mode === "reconcile") mode = "reconcile";
  } catch {
    mode = "copy";
  }

  try {
    const r2 = readR2Config();
    if (r2.bucket !== RECEIPT_R2_BUCKET) {
      return json({ success: false, stop: true, stopReason: "wrong-bucket" }, 409);
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const names = await listReceiptNames(admin);
    const invalid = names.filter((name) => {
      try {
        receiptDestinationKey(name);
        return false;
      } catch {
        return true;
      }
    });
    if (invalid.length || names.length < MIN_SOURCE_FILES) {
      return json({
        success: false,
        stop: true,
        stopReason: invalid.length ? "unexpected-key" : "short-inventory",
        sourceCount: names.length,
        invalid: invalid.length,
      }, 409);
    }

    const progress = await loadProgress(admin);
    const doneSet = mode === "reconcile" ? progress.reconciled : progress.verified;
    const batch = await copyReceiptBatch({
      names,
      verifiedNames: new Set(Object.keys(doneSet)),
      concurrency: COPY_CONCURRENCY,
      timeBudgetMs: 20000,
      download: async (name) => {
        const { data, error } = await admin.storage.from("payment-collections").download(name);
        if (error || !data) throw error || new Error("Source file is missing.");
        return Buffer.from(await data.arrayBuffer());
      },
      put: (key, body, contentType, sha256) => putObject(null, {
        key,
        body,
        contentType,
        metadata: { sha256, category: "receipt_copy" },
      }),
      get: async (key) => Buffer.from(await getObject(null, { key })),
      markVerified: async (key) => {
        const verifiedAt = new Date().toISOString();
        const { data, error } = await admin
          .from("attachments")
          .update({ verified_at: verifiedAt })
          .eq("category", "receipt_copy")
          .eq("object_key", key)
          .select("id");
        if (error) throw error;
        return data?.length || 0;
      },
    });

    if (batch.stop) {
      progress.failures = [...progress.failures, ...batch.failures].slice(0, 100);
      await saveProgress(admin, progress);
      return json({
        success: false,
        stop: true,
        stopReason: batch.stopReason,
        mode,
        sourceCount: names.length,
        batch,
        copied: progress.copied,
        already: progress.already,
        failed: progress.failures.length,
        failures: batch.failures.slice(0, 5).map(({ reason, status, detail }) => ({ reason, status, detail })),
        remaining: names.filter((name) => !progress.verified[name]).length,
      }, 409);
    }

    for (const item of batch.verified) {
      if (mode === "reconcile") progress.reconciled[item.name] = item.sha256;
      else if (!progress.verified[item.name]) {
        progress.verified[item.name] = item.sha256;
        if (item.copied) progress.copied += 1;
        else progress.already += 1;
      }
    }
    if (mode === "copy") progress.verifiedRows += batch.verifiedRows;
    progress.failures = [...progress.failures, ...batch.failures].slice(0, 100);
    progress.updatedAt = new Date().toISOString();
    progress.sourceCount = names.length;
    await saveProgress(admin, progress);

    const verifiedCount = Object.keys(progress.verified).length;
    const reconciledCount = Object.keys(progress.reconciled).length;
    const remaining = names.filter((name) => !(mode === "reconcile" ? progress.reconciled[name] : progress.verified[name])).length;
    const done = mode === "reconcile" ? reconciledCount >= names.length && remaining === 0 : false;

    return json({
      success: true,
      done,
      stop: false,
      mode,
      sourceCount: names.length,
      copied: progress.copied,
      already: progress.already,
      failed: progress.failures.length,
      failures: progress.failures,
      verifiedRows: progress.verifiedRows,
      verifiedCount,
      reconciledCount,
      remaining,
      batchAttempted: batch.attempted,
    });
  } catch (error) {
    return json({
      success: false,
      stop: true,
      stopReason: "unexpected",
      error: String(error?.message || "Receipt copy failed.").replace(/https?:\/\/\S+/g, "[url]"),
    }, 500);
  }
}
