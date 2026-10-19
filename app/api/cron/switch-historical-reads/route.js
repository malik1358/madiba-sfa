import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "../../../lib/cronAuth.js";
import { readR2Config } from "../../../lib/storage/r2Guard.js";
import { getObject as getR2Object } from "../../../lib/storage/providers/r2Provider.js";
import { getSignedReadUrl, readAttachmentStorageConfig } from "../../../lib/storage/attachmentStorage.js";
import { authorizeAttachmentRead, resolveAttachmentTarget } from "../../../lib/storage/attachmentAccess.js";
import { handleAttachmentUrlRequest } from "../../attachments/[id]/url/route.js";
import { RECEIPT_R2_BUCKET, sha256Hex } from "../../../lib/storage/copyReceiptsToR2.js";
import { legacyCollectionCopyRef } from "../../../lib/storage/attachmentRecords.js";
import { legacyCollectionReadObject, loadVerifiedCopyNames } from "../../../lib/storage/legacyCollectionRead.js";
import {
  isHistoricalReadSwitchRow,
  isSwitchedHistoricalRow,
  sameIdSet,
  signedHostKind,
} from "../../../lib/storage/switchHistoricalReads.js";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const CHECK_KEY = "historical_r2_read_check_v1";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function safeError(error) {
  return String(error?.message || "Historical read check failed.").replace(/https?:\/\/\S+/g, "[url]");
}

function parseProgress(value) {
  let payload = value;
  if (typeof value === "string") {
    try { payload = JSON.parse(value); } catch { payload = {}; }
  }
  return {
    ids: Array.isArray(payload?.ids) ? payload.ids.map(String) : [],
    checked: payload?.checked && typeof payload.checked === "object" ? payload.checked : {},
    probes: payload?.probes && typeof payload.probes === "object" ? payload.probes : null,
    failures: Array.isArray(payload?.failures) ? payload.failures.slice(0, 20) : [],
  };
}

async function loadProgress(admin) {
  const { data, error } = await admin.from("system_settings").select("setting_value").eq("setting_key", CHECK_KEY).maybeSingle();
  if (error) throw error;
  return parseProgress(data?.setting_value);
}

async function saveProgress(admin, progress) {
  const { error } = await admin.from("system_settings").upsert({
    setting_key: CHECK_KEY,
    setting_value: JSON.stringify(progress),
  }, { onConflict: "setting_key" });
  if (error) throw error;
}

async function loadEligible(admin) {
  const { data, error } = await admin
    .from("attachments")
    .select("id,category,storage_provider,object_key,verified_at")
    .in("category", ["receipt_copy", "payment_copy"])
    .eq("storage_provider", "supabase")
    .not("verified_at", "is", null);
  if (error) throw error;
  return (data || []).filter(isHistoricalReadSwitchRow);
}

async function downloadSupabase(admin, objectKey) {
  const path = objectKey.replace(/^payment-collections\//, "");
  const { data, error } = await admin.storage.from("payment-collections").download(path);
  if (error || !data) throw error || new Error("Supabase original is missing.");
  return Buffer.from(await data.arrayBuffer());
}

async function compareRow(admin, row) {
  const source = await downloadSupabase(admin, row.object_key);
  const remote = Buffer.from(await getR2Object(null, { key: row.object_key }));
  const sourceSha = sha256Hex(source);
  if (sha256Hex(remote) !== sourceSha) {
    throw Object.assign(new Error("R2 bytes do not match the Supabase original."), { integrity: true });
  }
  const signed = await getSignedReadUrl(admin, { provider: "r2", key: row.object_key, expiresIn: 60 });
  if (signedHostKind(signed.url) !== "r2") {
    throw Object.assign(new Error("R2 signed read used an unexpected host."), { integrity: true });
  }
  const response = await fetch(signed.url);
  if (!response.ok) throw new Error("R2 signed read failed.");
  const signedBytes = Buffer.from(await response.arrayBuffer());
  if (sha256Hex(signedBytes) !== sourceSha) {
    throw Object.assign(new Error("R2 signed bytes do not match the Supabase original."), { integrity: true });
  }
  return sourceSha;
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
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => run()));
}

async function probeRollback(admin, row) {
  const source = await downloadSupabase(admin, row.object_key);
  const forced = await getSignedReadUrl(admin, {
    provider: "r2",
    key: row.object_key,
    expiresIn: 60,
    config: { ...readAttachmentStorageConfig(), forceSupabaseReads: true },
  });
  if (signedHostKind(forced.url) !== "supabase") {
    throw Object.assign(new Error("Supabase rollback did not sign the original."), { integrity: true });
  }
  const response = await fetch(forced.url);
  if (!response.ok) throw new Error("Supabase rollback read failed.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256Hex(bytes) !== sha256Hex(source)) {
    throw Object.assign(new Error("Supabase rollback bytes do not match the original."), { integrity: true });
  }
}

async function authorizedRead(admin, attachmentId, searchParams = new URLSearchParams()) {
  const authClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: profile, error } = await admin.from("profiles").select("id").eq("role", "admin").eq("is_active", true).limit(1).maybeSingle();
  if (error || !profile?.id) throw new Error("No active admin is available for the read probe.");
  const userResult = await admin.auth.admin.getUserById(profile.id);
  const email = userResult.data?.user?.email;
  if (!email) throw new Error("The admin probe account has no email.");
  const link = await authClient.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error || !link.data?.properties?.hashed_token) throw new Error("Could not open a short-lived read probe.");
  const otp = await authClient.auth.verifyOtp({ type: "magiclink", token_hash: link.data.properties.hashed_token });
  const token = otp.data?.session?.access_token;
  if (otp.error || !token) throw new Error("The read probe login was rejected.");
  try {
    const result = await handleAttachmentUrlRequest({
      admin,
      token,
      id: attachmentId,
      searchParams,
    });
    if (result.status !== 200 || !result.body?.url) return { ok: false, status: result.status, host: "" };
    const response = await fetch(result.body.url);
    return { ok: response.ok, status: result.status, host: signedHostKind(result.body.url), bytes: Number(response.headers.get("content-length") || 0) };
  } finally {
    await authClient.auth.admin.signOut(token).catch(() => {});
  }
}

async function linkedId(admin, column, eligibleIds) {
  const { data, error } = await admin
    .from("collection_visits")
    .select(column)
    .not(column, "is", null)
    .limit(200);
  if (error) throw error;
  const allowed = new Set(eligibleIds);
  return (data || []).map((row) => row[column]).find((id) => allowed.has(id)) || "";
}

async function runProbes(admin, rows) {
  const config = readAttachmentStorageConfig();
  if (config.forceSupabaseReads) {
    return { ok: false, reason: "force-supabase-reads-already-on", writeProvider: config.writeProvider };
  }
  const ids = rows.map((row) => row.id);
  const receiptId = await linkedId(admin, "receipt_attachment_id", ids);
  const paymentId = await linkedId(admin, "payment_attachment_id", ids);
  if (!receiptId || !paymentId) return { ok: false, reason: "missing-linked-sample", writeProvider: config.writeProvider };
  const receiptRow = rows.find((row) => row.id === receiptId);
  await probeRollback(admin, receiptRow);
  const target = await resolveAttachmentTarget(admin, { id: receiptId });
  const anonymous = await authorizeAttachmentRead(admin, { user: null, token: "", target });
  if (anonymous.allowed) return { ok: false, reason: "anonymous-allowed", writeProvider: config.writeProvider };
  const authorized = await authorizedRead(admin, receiptId);
  const paymentRead = await authorizedRead(admin, paymentId);
  const r2Direct = await compareRow(admin, receiptRow);
  const authorizedOk = authorized.ok && authorized.host === "supabase" && paymentRead.ok && paymentRead.host === "supabase";
  return {
    ok: authorizedOk && Boolean(r2Direct),
    reason: authorizedOk ? "" : "authorized-historical-read",
    writeProvider: config.writeProvider,
    anonymousRejected: true,
    authorizedHost: authorized.host,
    rollback: "supabase",
    receiptId,
    paymentId,
  };
}

async function checkBatch(admin) {
  const config = readAttachmentStorageConfig();
  const rows = await loadEligible(admin);
  const progress = await loadProgress(admin);
  const eligibleIds = rows.map((row) => row.id).sort();
  if (!progress.ids.length) progress.ids = eligibleIds;
  if (!sameIdSet(progress.ids, eligibleIds)) {
    return { success: false, stop: true, stopReason: "eligible-set-changed", eligible: eligibleIds.length, checked: Object.keys(progress.checked).length };
  }
  if (!progress.probes) {
    progress.probes = await runProbes(admin, rows);
    await saveProgress(admin, progress);
    if (!progress.probes.ok) {
      return { success: false, stop: true, stopReason: progress.probes.reason || "probes", eligible: eligibleIds.length, probes: publicProbes(progress.probes) };
    }
  }

  const pending = rows.filter((row) => !progress.checked[row.id]);
  const started = Date.now();
  let integrity = false;
  await mapPool(pending, 3, async (row) => {
    if (integrity || Date.now() - started > 20000) return;
    try {
      progress.checked[row.id] = await compareRow(admin, row);
    } catch (error) {
      progress.failures.push({ id: row.id, reason: error?.integrity ? "integrity" : "read-failed" });
      if (error?.integrity) integrity = true;
    }
  });
  progress.failures = progress.failures.slice(0, 20);
  await saveProgress(admin, progress);
  const checked = Object.keys(progress.checked).length;
  const remaining = eligibleIds.filter((id) => !progress.checked[id]).length;
  if (integrity || progress.failures.length) {
    return { success: false, stop: true, stopReason: integrity ? "integrity" : "read-failed", eligible: eligibleIds.length, checked, remaining, failures: progress.failures };
  }
  return {
    success: true,
    stop: false,
    done: remaining === 0,
    eligible: eligibleIds.length,
    checked,
    remaining,
    probes: publicProbes(progress.probes),
  };
}

function publicProbes(probes) {
  if (!probes) return null;
  return {
    ok: Boolean(probes.ok),
    writeProvider: probes.writeProvider || "",
    anonymousRejected: Boolean(probes.anonymousRejected),
    authorizedHost: probes.authorizedHost || "",
    rollback: probes.rollback || "",
    reason: probes.reason || "",
  };
}

async function linkedSwitched(admin, column, category) {
  const { data, error } = await admin.from("collection_visits").select(column).not(column, "is", null).limit(300);
  if (error) throw error;
  const ids = [...new Set((data || []).map((row) => row[column]).filter(Boolean))];
  if (!ids.length) return null;
  const loaded = await admin
    .from("attachments")
    .select("id,category,storage_provider,object_key,verified_at,entity_id")
    .in("id", ids)
    .eq("category", category);
  if (loaded.error) throw loaded.error;
  return (loaded.data || []).find(isSwitchedHistoricalRow) || null;
}

async function confirmReads(admin) {
  const config = readAttachmentStorageConfig();
  const { data, error } = await admin
    .from("attachments")
    .select("id,category,storage_provider,object_key,verified_at,entity_id")
    .in("category", ["receipt_copy", "payment_copy"]);
  if (error) throw error;
  const rows = data || [];
  const switched = rows.filter(isSwitchedHistoricalRow);
  const historicalSupabase = rows.filter(isHistoricalReadSwitchRow);
  const newVerified = rows.filter((row) => row.storage_provider === "r2" && row.verified_at && !isSwitchedHistoricalRow(row));
  const newUnverified = rows.filter((row) => row.storage_provider === "r2" && !row.verified_at);
  const samples = {
    historicalReceipt: await linkedSwitched(admin, "receipt_attachment_id", "receipt_copy"),
    historicalPayment: await linkedSwitched(admin, "payment_attachment_id", "payment_copy"),
    newReceipt: rows.find((row) => row.category === "receipt_copy" && row.storage_provider === "r2" && !isSwitchedHistoricalRow(row) && row.entity_id),
    newPayment: rows.find((row) => row.category === "payment_copy" && row.storage_provider === "r2" && !isSwitchedHistoricalRow(row) && row.entity_id),
  };
  const reads = {};
  for (const [name, row] of Object.entries(samples)) {
    if (!row) {
      reads[name] = { ok: false, reason: "missing" };
      continue;
    }
    const authorized = await authorizedRead(admin, row.id);
    const target = await resolveAttachmentTarget(admin, { id: row.id });
    const anonymous = await authorizeAttachmentRead(admin, { user: null, token: "", target });
    reads[name] = {
      ok: authorized.ok && authorized.host === "r2" && !anonymous.allowed && target.object?.provider === "r2",
      host: authorized.host,
      status: authorized.status || 0,
      anonymousRejected: !anonymous.allowed,
      provider: target.object?.provider || "",
    };
  }

  const legacy = {};
  for (const kind of ["receipt", "payment"]) {
    const column = kind === "payment" ? "payment_attachment_id" : "receipt_attachment_id";
    const urlColumn = kind === "payment" ? "payment_copy_url" : "receipt_copy_url";
    const { data: visit, error: visitError } = await admin
      .from("collection_visits")
      .select(`id,${urlColumn}`)
      .is(column, null)
      .not(urlColumn, "is", null)
      .neq(urlColumn, "")
      .limit(1)
      .maybeSingle();
    if (visitError) throw visitError;
    const target = visit ? await resolveAttachmentTarget(admin, { id: "legacy", legacyKind: `${kind}_copy`, legacyRef: String(visit.id) }) : { status: 404 };
    let bytesOk = false;
    if (target.status === 200 && target.object?.provider === "r2") {
      const source = await downloadSupabase(admin, target.object.key);
      const remote = Buffer.from(await getR2Object(null, { key: target.object.key }));
      bytesOk = sha256Hex(source) === sha256Hex(remote);
    }
    legacy[kind] = { ok: target.object?.provider === "r2" && bytesOk, provider: target.object?.provider || "" };
  }

  const rollbackRow = samples.historicalReceipt;
  let rollbackOk = false;
  if (rollbackRow) {
    await probeRollback(admin, rollbackRow);
    rollbackOk = true;
  }
  const failed = Object.values(reads).some((item) => !item.ok) || Object.values(legacy).some((item) => !item.ok) || !rollbackOk;
  return {
    success: !failed,
    stop: failed,
    stopReason: failed ? "confirm-failed" : "",
    mode: "confirm",
    switched: switched.length,
    historicalStillSupabase: historicalSupabase.length,
    newVerified: newVerified.length,
    newUnverified: newUnverified.length,
    writeProvider: config.writeProvider,
    forceSupabaseReads: config.forceSupabaseReads,
    reads,
    legacy,
    rollbackOk,
  };
}

async function listCollectionVisits(admin) {
  const rows = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await admin
      .from("collection_visits")
      .select("id,receipt_copy_url,payment_copy_url,receipt_attachment_id,payment_attachment_id")
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

async function reconcileLegacyReads(admin) {
  const config = readAttachmentStorageConfig();
  if (config.forceSupabaseReads) {
    return { success: false, stop: true, stopReason: "force-supabase-reads-already-on", mode: "legacy", writeProvider: config.writeProvider };
  }
  const [receiptNames, paymentNames, visits] = await Promise.all([
    loadVerifiedCopyNames(admin, "receipt"),
    loadVerifiedCopyNames(admin, "payment"),
    listCollectionVisits(admin),
  ]);
  const counts = { receiptR2: 0, receiptSupabase: 0, paymentR2: 0, paymentSupabase: 0, receiptBroken: 0, paymentBroken: 0 };
  const samples = {};
  for (const visit of visits) {
    for (const kind of ["receipt", "payment"]) {
      if (visit[`${kind}_attachment_id`]) continue;
      const url = visit[`${kind}_copy_url`];
      if (!String(url || "").trim()) continue;
      const base = legacyCollectionCopyRef(visit, kind);
      if (!base) {
        counts[`${kind}Broken`] += 1;
        continue;
      }
      const chosen = legacyCollectionReadObject(base, kind, kind === "receipt" ? receiptNames : paymentNames, config);
      if (chosen?.provider === "r2") counts[`${kind}R2`] += 1;
      else counts[`${kind}Supabase`] += 1;
      if (!samples[kind] && chosen?.provider === "r2") samples[kind] = { id: visit.id, key: chosen.key };
    }
  }

  const reads = {};
  for (const kind of ["receipt", "payment"]) {
    const sample = samples[kind];
    if (!sample) {
      reads[kind] = { ok: false, reason: "missing" };
      continue;
    }
    const source = await downloadSupabase(admin, sample.key);
    const remote = Buffer.from(await getR2Object(null, { key: sample.key }));
    const authorized = await authorizedRead(admin, "legacy", new URLSearchParams({ kind: `${kind}_copy`, ref: String(sample.id) }));
    const anonymous = await handleAttachmentUrlRequest({
      admin,
      token: "",
      id: "legacy",
      searchParams: new URLSearchParams({ kind: `${kind}_copy`, ref: String(sample.id) }),
    });
    reads[kind] = {
      ok: sha256Hex(source) === sha256Hex(remote) && authorized.ok && authorized.host === "r2" && anonymous.status === 401,
      host: authorized.host,
      anonymousStatus: anonymous.status,
      bytes: source.length,
    };
  }

  const forced = samples.receipt
    ? await getSignedReadUrl(admin, {
      provider: "r2",
      key: samples.receipt.key,
      expiresIn: 60,
      config: { ...config, forceSupabaseReads: true },
    })
    : null;
  const rollbackOk = Boolean(forced) && signedHostKind(forced.url) === "supabase";
  const stillSupabase = counts.receiptSupabase + counts.paymentSupabase;
  const broken = counts.receiptBroken + counts.paymentBroken;
  const failed = stillSupabase > 0 || broken > 0 || !reads.receipt?.ok || !reads.payment?.ok || !rollbackOk;
  return {
    success: !failed,
    stop: failed,
    stopReason: failed ? "legacy-reconciliation" : "",
    mode: "legacy",
    ...counts,
    writeProvider: config.writeProvider,
    forceSupabaseReads: config.forceSupabaseReads,
    reads,
    rollbackOk,
  };
}

export async function POST(request) {
  if (!isCronAuthorized(request)) return json({ success: false, error: "Unauthorized" }, 401);
  if (process.env.VERCEL_ENV !== "production") return json({ success: false, stop: true, stopReason: "not-production" }, 409);
  if (!supabaseUrl || !serviceKey) return json({ success: false, stop: true, stopReason: "server-config" }, 500);

  let mode = "check";
  try {
    const body = await request.json();
    if (body?.mode === "confirm" || body?.mode === "legacy") mode = body.mode;
  } catch {
    mode = "check";
  }

  try {
    const r2 = readR2Config();
    if (r2.bucket !== RECEIPT_R2_BUCKET) return json({ success: false, stop: true, stopReason: "wrong-bucket" }, 409);
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    if (mode === "confirm") return json(await confirmReads(admin));
    if (mode === "legacy") {
      const result = await reconcileLegacyReads(admin);
      return json(result, result.stop ? 409 : 200);
    }
    const result = await checkBatch(admin);
    return json(result, result.stop ? 409 : 200);
  } catch (error) {
    return json({ success: false, stop: true, stopReason: "unexpected", error: safeError(error) }, 500);
  }
}
