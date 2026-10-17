import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "../../../lib/cronAuth.js";
import { readR2Config } from "../../../lib/storage/r2Guard.js";
import { getObject, putObject } from "../../../lib/storage/providers/r2Provider.js";
import { getSignedReadUrl } from "../../../lib/storage/attachmentStorage.js";
import { authorizeAttachmentRead, resolveAttachmentTarget } from "../../../lib/storage/attachmentAccess.js";
import {
  COPY_CONCURRENCY,
  RECEIPT_R2_BUCKET,
  assessCopiedBytes,
  contentTypeForPayment,
  copyReceiptBatch,
  newUploadAssociation,
  paymentDestinationKey,
} from "../../../lib/storage/copyReceiptsToR2.js";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const PAYMENT_COPY_PREFIX = "payment-copies/";
const PAYMENT_COPY_PROGRESS_KEY = "payment_r2_copy_progress_v1";
const MIN_SOURCE_FILES = 250;
const NEW_R2_UPLOADS = [
  { category: "payment_copy", objectKey: "payment-collections/payment-copies/2026/10/1222C/20261017-23be3770-c70a-48a5-bcc8-ca3d15da6182.jpg" },
  { category: "payment_copy", objectKey: "payment-collections/payment-copies/2026/10/1222C/20261017-794b4d31-98b7-4b8e-8bc1-4071fc11f130.jpg" },
  { category: "receipt_copy", objectKey: "payment-collections/receipt-copies/2026/10/1222C/20261017-9f339f6b-8cf3-475e-ab0c-9b25f0c2d9cd.jpg" },
  { category: "receipt_copy", objectKey: "payment-collections/receipt-copies/2026/10/1222C/20261017-bb410107-5bea-4d86-a9f8-8f56f0f2e9e4.jpg" },
];

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

async function listPaymentNames(admin) {
  const names = [];
  for (let offset = 0; offset < 20000; offset += 100) {
    const { data, error } = await admin.storage.from("payment-collections").list(PAYMENT_COPY_PREFIX.slice(0, -1), {
      limit: 100,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw error;
    const page = data || [];
    for (const entry of page) {
      if (!entry?.name || !entry.id) continue;
      names.push(`${PAYMENT_COPY_PREFIX}${entry.name}`);
    }
    if (page.length < 100) break;
  }
  return [...new Set(names)].sort();
}

async function loadProgress(admin) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", PAYMENT_COPY_PROGRESS_KEY)
    .maybeSingle();
  if (error) throw error;
  return parseProgress(data?.setting_value);
}

async function saveProgress(admin, progress) {
  const { error } = await admin.from("system_settings").upsert({
    setting_key: PAYMENT_COPY_PROGRESS_KEY,
    setting_value: JSON.stringify(progress),
  }, { onConflict: "setting_key" });
  if (error) throw error;
}

async function verifyNewUploads(admin) {
  const results = [];
  for (const expected of NEW_R2_UPLOADS) {
    const item = { category: expected.category, file: expected.objectKey.split("/").pop(), ok: false, association: "", reasons: [] };
    const { data: record, error } = await admin
      .from("attachments")
      .select("id,category,storage_provider,object_key,content_type,size_bytes,customer_code,entity_type,entity_id,verified_at")
      .eq("category", expected.category)
      .eq("object_key", expected.objectKey)
      .maybeSingle();
    if (error) throw error;
    if (!record || record.storage_provider !== "r2") {
      item.reasons.push(record ? "provider" : "missing-record");
      results.push(item);
      continue;
    }

    const target = await resolveAttachmentTarget(admin, { id: record.id });
    const anonymous = await authorizeAttachmentRead(admin, { user: null, token: "", target });
    if (target.status !== 200 || target.object?.provider !== "r2" || target.object?.key !== record.object_key || anonymous.allowed) {
      item.reasons.push("download-gate");
    }

    let visit = null;
    if (record.entity_id) {
      const loaded = await admin
        .from("collection_visits")
        .select("id,customer_code,receipt_attachment_id,payment_attachment_id")
        .eq("id", record.entity_id)
        .maybeSingle();
      if (loaded.error) throw loaded.error;
      visit = loaded.data;
    }
    const association = newUploadAssociation(record, visit);
    item.association = association.state;
    if (!association.ok) item.reasons.push("association");

    const bytes = Buffer.from(await getObject(null, { key: record.object_key }));
    const signed = await getSignedReadUrl(admin, { provider: "r2", key: record.object_key, expiresIn: 60 });
    const signedHost = new URL(signed.url).hostname;
    if (!signedHost.endsWith(".r2.cloudflarestorage.com")) item.reasons.push("signed-host");
    const signedResponse = await fetch(signed.url);
    if (!signedResponse.ok) item.reasons.push("signed-read");
    const signedBytes = Buffer.from(await signedResponse.arrayBuffer());
    const assessed = assessCopiedBytes({
      bytes,
      signedBytes,
      sizeBytes: record.size_bytes,
      contentType: record.content_type,
    });
    item.bytes = assessed.bytes;
    item.kind = assessed.kind;
    item.reasons.push(...assessed.reasons);
    item.ok = item.reasons.length === 0;
    if (item.ok) {
      const verifiedAt = new Date().toISOString();
      const updated = await admin
        .from("attachments")
        .update({ verified_at: verifiedAt })
        .eq("id", record.id)
        .eq("category", expected.category)
        .eq("object_key", expected.objectKey)
        .eq("storage_provider", "r2")
        .select("id");
      if (updated.error) throw updated.error;
      item.verifiedAtSet = (updated.data || []).length === 1;
      if (!item.verifiedAtSet) {
        item.ok = false;
        item.reasons.push("verified-at");
      }
    }
    results.push(item);
  }
  const failed = results.filter((item) => !item.ok).length;
  return {
    success: failed === 0,
    stop: failed > 0,
    stopReason: failed > 0 ? "new-upload-verification" : "",
    mode: "verify-new",
    checked: results.length,
    verified: results.filter((item) => item.verifiedAtSet).length,
    failed,
    results,
  };
}

export async function POST(request) {
  if (!isCronAuthorized(request)) return json({ success: false, error: "Unauthorized" }, 401);
  if (process.env.VERCEL_ENV !== "production") {
    return json({ success: false, stop: true, stopReason: "not-production" }, 409);
  }
  if (!supabaseUrl || !serviceKey) return json({ success: false, stop: true, stopReason: "server-config" }, 500);

  let mode = "copy";
  try {
    const body = await request.json();
    if (body?.mode === "reconcile" || body?.mode === "verify-new") mode = body.mode;
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
    if (mode === "verify-new") return json(await verifyNewUploads(admin), 200);

    const names = await listPaymentNames(admin);
    const invalid = names.filter((name) => {
      try {
        paymentDestinationKey(name);
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
      destinationKeyFor: paymentDestinationKey,
      contentTypeFor: contentTypeForPayment,
      download: async (name) => {
        const { data, error } = await admin.storage.from("payment-collections").download(name);
        if (error || !data) throw error || new Error("Source file is missing.");
        return Buffer.from(await data.arrayBuffer());
      },
      put: (key, body, contentType, sha256) => putObject(null, {
        key,
        body,
        contentType,
        metadata: { sha256, category: "payment_copy" },
      }),
      get: async (key) => Buffer.from(await getObject(null, { key })),
      markVerified: async (key) => {
        const verifiedAt = new Date().toISOString();
        const { data, error } = await admin
          .from("attachments")
          .update({ verified_at: verifiedAt })
          .eq("category", "payment_copy")
          .eq("storage_provider", "supabase")
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

    return json({
      success: true,
      done: mode === "reconcile" ? reconciledCount >= names.length && remaining === 0 : false,
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
      error: String(error?.message || "Payment copy failed.").replace(/https?:\/\/\S+/g, "[url]"),
    }, 500);
  }
}
