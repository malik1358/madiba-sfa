import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "../../../lib/cronAuth.js";
import { readR2Config } from "../../../lib/storage/r2Guard.js";
import { getObject as getR2Object } from "../../../lib/storage/providers/r2Provider.js";
import { getSignedReadUrl, readAttachmentStorageConfig } from "../../../lib/storage/attachmentStorage.js";
import { authorizeAttachmentRead, resolveAttachmentTarget } from "../../../lib/storage/attachmentAccess.js";
import { handleAttachmentUrlRequest } from "../../attachments/[id]/url/route.js";
import { RECEIPT_R2_BUCKET } from "../../../lib/storage/copyReceiptsToR2.js";
import {
  COLLECTION_UPLOAD_VERIFY_KEY,
  assessStoredCollectionUpload,
  classifyCollectionAttachmentLinks,
  isPermanentVerificationFailure,
  verificationFailureDetail,
} from "../../../lib/storage/verifyCollectionUploads.js";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TIME_BUDGET_MS = 20000;
const CONCURRENCY = 3;

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
  const failures = payload?.failures && typeof payload.failures === "object" ? payload.failures : {};
  return { failures };
}

async function loadProgress(admin) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", COLLECTION_UPLOAD_VERIFY_KEY)
    .maybeSingle();
  if (error) throw error;
  return parseProgress(data?.setting_value);
}

async function saveProgress(admin, progress) {
  const { error } = await admin.from("system_settings").upsert({
    setting_key: COLLECTION_UPLOAD_VERIFY_KEY,
    setting_value: JSON.stringify({ failures: progress.failures }),
  }, { onConflict: "setting_key" });
  if (error) throw error;
}

async function listRows(admin, verifiedAt) {
  const rows = [];
  for (let from = 0; from < 5000; from += 500) {
    let query = admin
      .from("attachments")
      .select("id,category,storage_provider,object_key,content_type,size_bytes,sha256,entity_id,verified_at,created_at")
      .in("category", ["receipt_copy", "payment_copy"])
      .eq("storage_provider", "r2")
      .order("created_at", { ascending: true });
    query = verifiedAt === "set" ? query.not("verified_at", "is", null) : query.is("verified_at", null);
    const { data, error } = await query.range(from, from + 499);
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < 500) break;
  }
  return rows;
}

async function mapPool(items, limit, worker) {
  let next = 0;
  async function run() {
    while (next < items.length) {
      const current = next;
      next += 1;
      await worker(items[current]);
    }
  }
  const width = Math.max(1, Math.min(limit, items.length || 1));
  await Promise.all(Array.from({ length: items.length ? width : 0 }, () => run()));
}

async function stampVerified(admin, record) {
  const verifiedAt = new Date().toISOString();
  const { data, error } = await admin
    .from("attachments")
    .update({ verified_at: verifiedAt })
    .eq("id", record.id)
    .eq("category", record.category)
    .eq("object_key", record.object_key)
    .eq("storage_provider", "r2")
    .is("verified_at", null)
    .select("id");
  if (error) throw error;
  return (data || []).length === 1;
}

async function verifyRecord(admin, record) {
  const reasons = [];
  const target = await resolveAttachmentTarget(admin, { id: record.id });
  const anonymous = await authorizeAttachmentRead(admin, { user: null, token: "", target });
  if (target.status !== 200 || target.object?.provider !== "r2" || target.object?.key !== record.object_key || anonymous.allowed) {
    reasons.push("download-gate");
  }
  let bytes = Buffer.alloc(0);
  let signedBytes = Buffer.alloc(0);
  if (!reasons.length) {
    try {
      bytes = Buffer.from(await getR2Object(null, { key: record.object_key }));
    } catch (error) {
      return { ok: false, reasons: verificationFailureDetail(error), kind: "", bytes: 0 };
    }
    const signed = await getSignedReadUrl(admin, { provider: "r2", key: record.object_key, expiresIn: 60 });
    const host = new URL(signed.url).hostname;
    if (!host.endsWith(".r2.cloudflarestorage.com")) reasons.push("signed-host");
    const response = await fetch(signed.url);
    if (!response.ok) reasons.push("signed-read");
    else signedBytes = Buffer.from(await response.arrayBuffer());
  }
  const assessed = assessStoredCollectionUpload({ record, bytes, signedBytes });
  const allReasons = [...reasons, ...assessed.reasons.filter((reason) => !reasons.includes(reason))];
  return { ok: allReasons.length === 0, reasons: allReasons, kind: assessed.kind, bytes: assessed.bytes };
}

async function verifyPending(admin) {
  const config = readAttachmentStorageConfig();
  if (config.forceSupabaseReads) {
    return { success: false, stop: true, stopReason: "force-supabase-reads", mode: "verify" };
  }
  const progress = await loadProgress(admin);
  const pending = await listRows(admin, "unset");
  const pendingIds = new Set(pending.map((row) => row.id));
  for (const id of Object.keys(progress.failures)) {
    if (!pendingIds.has(id)) delete progress.failures[id];
  }
  const skipped = new Set(Object.keys(progress.failures));
  const queue = pending.filter((row) => !skipped.has(row.id));
  const started = Date.now();
  let attempted = 0;
  let updated = 0;
  let failed = 0;
  const batchFailures = [];

  await mapPool(queue, CONCURRENCY, async (record) => {
    if (Date.now() - started > TIME_BUDGET_MS) return;
    attempted += 1;
    try {
      const result = await verifyRecord(admin, record);
      if (!result.ok) {
        failed += 1;
        const item = { id: record.id, category: record.category, reasons: result.reasons };
        batchFailures.push(item);
        if (isPermanentVerificationFailure(result.reasons)) progress.failures[record.id] = item;
        return;
      }
      const stamped = await stampVerified(admin, record);
      if (stamped) {
        updated += 1;
        return;
      }
      const current = await admin.from("attachments").select("verified_at").eq("id", record.id).maybeSingle();
      if (current.error) throw current.error;
      if (current.data?.verified_at) {
        updated += 1;
        return;
      }
      failed += 1;
      const item = { id: record.id, category: record.category, reasons: ["verified-at"] };
      batchFailures.push(item);
      progress.failures[record.id] = item;
    } catch (error) {
      failed += 1;
      const reasons = verificationFailureDetail(error);
      const item = { id: record.id, category: record.category, reasons };
      batchFailures.push(item);
      if (isPermanentVerificationFailure(reasons)) progress.failures[record.id] = item;
    }
  });

  await saveProgress(admin, progress);
  const remainingRows = await listRows(admin, "unset");
  const permanent = Object.keys(progress.failures).length;
  return {
    success: true,
    stop: false,
    mode: "verify",
    attempted,
    updated,
    failed,
    pending: pending.length,
    remaining: remainingRows.length,
    permanentFailures: permanent,
    done: remainingRows.length === 0,
    failures: batchFailures.slice(0, 20),
    storedFailures: Object.values(progress.failures).slice(0, 20),
  };
}

async function reconcile(admin) {
  const [unverified, verified, visits] = await Promise.all([
    listRows(admin, "unset"),
    listRows(admin, "set"),
    listVisitLinks(admin),
  ]);
  const rows = [...unverified, ...verified];
  const links = classifyCollectionAttachmentLinks(rows, visits);
  const progress = await loadProgress(admin);
  const datedVerified = verified.filter((row) => /\/[0-9]{4}\/[0-9]{2}\//.test(row.object_key)).length;
  return {
    success: unverified.length === 0 && Object.keys(progress.failures).length === 0,
    stop: unverified.length > 0,
    stopReason: unverified.length > 0 ? "unverified-remain" : "",
    mode: "reconcile",
    unverified: unverified.length,
    unverifiedReceipts: unverified.filter((row) => row.category === "receipt_copy").length,
    unverifiedPayments: unverified.filter((row) => row.category === "payment_copy").length,
    verified: verified.length,
    datedVerified,
    permanentFailures: Object.keys(progress.failures).length,
    failures: Object.values(progress.failures).slice(0, 20),
    links,
    done: unverified.length === 0,
  };
}

async function listVisitLinks(admin) {
  const rows = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await admin
      .from("collection_visits")
      .select("id,receipt_attachment_id,payment_attachment_id")
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

async function anonymousObjectStatus(url) {
  const response = await fetch(url, { method: "GET", redirect: "manual" });
  return response.status;
}

function unsignedR2Url(key) {
  const config = readR2Config();
  const encoded = String(key).split("/").map((part) => encodeURIComponent(part)).join("/");
  return `${config.endpoint}/${encodeURIComponent(config.bucket)}/${encoded}`;
}

async function privacyProbe(admin) {
  const receipt = await admin.storage.from("payment-collections").list("receipt-copies", { limit: 100 });
  if (receipt.error) throw receipt.error;
  const payment = await admin.storage.from("payment-collections").list("payment-copies", { limit: 100 });
  if (payment.error) throw payment.error;
  const receiptName = (receipt.data || []).find((entry) => entry?.id && entry.name && !entry.name.includes("/"))?.name;
  const paymentName = (payment.data || []).find((entry) => entry?.id && entry.name && !entry.name.includes("/"))?.name;
  const receiptStatus = receiptName
    ? await anonymousObjectStatus(`${supabaseUrl}/storage/v1/object/public/payment-collections/receipt-copies/${encodeURIComponent(receiptName)}`)
    : 404;
  const paymentStatus = paymentName
    ? await anonymousObjectStatus(`${supabaseUrl}/storage/v1/object/public/payment-collections/payment-copies/${encodeURIComponent(paymentName)}`)
    : 404;

  const sample = (await listRows(admin, "unset"))[0] || (await listRows(admin, "set")).find((row) => row.object_key.includes("/2026/"));
  const r2Status = sample ? await anonymousObjectStatus(unsignedR2Url(sample.object_key)) : 0;
  const anonymousApp = sample
    ? await handleAttachmentUrlRequest({
      admin,
      token: "",
      id: sample.id,
      searchParams: new URLSearchParams(),
    })
    : { status: 0 };

  const exposed = receiptStatus === 200 || paymentStatus === 200 || r2Status === 200 || anonymousApp.status === 200;
  return {
    success: !exposed && receiptStatus > 0 && paymentStatus > 0 && r2Status > 0 && anonymousApp.status === 401,
    stop: exposed,
    stopReason: exposed ? "anonymous-access" : "",
    mode: "privacy",
    supabaseReceiptStatus: receiptStatus,
    supabasePaymentStatus: paymentStatus,
    r2UnsignedStatus: r2Status,
    attachmentAnonymousStatus: anonymousApp.status,
  };
}

export async function POST(request) {
  if (!isCronAuthorized(request)) return json({ success: false, error: "Unauthorized" }, 401);
  if (process.env.VERCEL_ENV !== "production") {
    return json({ success: false, stop: true, stopReason: "not-production" }, 409);
  }
  if (!supabaseUrl || !serviceKey) return json({ success: false, stop: true, stopReason: "server-config" }, 500);

  let mode = "verify";
  try {
    const body = await request.json();
    if (body?.mode === "reconcile" || body?.mode === "privacy") mode = body.mode;
  } catch {
    mode = "verify";
  }

  try {
    const r2 = readR2Config();
    if (r2.bucket !== RECEIPT_R2_BUCKET) {
      return json({ success: false, stop: true, stopReason: "wrong-bucket" }, 409);
    }
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    if (mode === "reconcile") return json(await reconcile(admin), 200);
    if (mode === "privacy") {
      const result = await privacyProbe(admin);
      return json(result, result.stop ? 409 : 200);
    }
    return json(await verifyPending(admin), 200);
  } catch (error) {
    console.error("Collection upload verification failed.");
    return json({ success: false, stop: true, stopReason: "verify-failed", error: "verify-failed" }, 500);
  }
}
