import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "../../../lib/cronAuth.js";
import { readR2Config } from "../../../lib/storage/r2Guard.js";
import { getSignedReadUrl } from "../../../lib/storage/providers/r2Provider.js";
import {
  HISTORICAL_R2_BUCKET,
  SIGN_BATCH_LIMIT,
  assertSignBatch,
  historicalBackupPlan,
} from "../../../lib/storage/historicalCollectionBackup.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROJECT_HOST = "ynmtlzyqvmurpmfretji.supabase.co";

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function safeError(error) {
  return String(error?.message || "Historical backup inventory failed.").replace(/https?:\/\/\S+/g, "[url]");
}

async function listBucket(admin) {
  const files = [];
  async function walk(prefix) {
    for (let offset = 0; offset < 20000; offset += 100) {
      const { data, error } = await admin.storage.from("payment-collections").list(prefix, {
        limit: 100,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw error;
      const page = data || [];
      for (const entry of page) {
        if (!entry?.name || entry.name === "." || entry.name === "..") continue;
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.id) {
          files.push({ path, bytes: Number(entry.metadata?.size) });
        } else {
          await walk(path);
        }
      }
      if (page.length < 100) break;
    }
  }
  await walk("");
  return files;
}

async function loadSetting(admin, settingKey) {
  const { data, error } = await admin.from("system_settings").select("setting_value").eq("setting_key", settingKey).maybeSingle();
  if (error) throw error;
  return data?.setting_value;
}

async function loadPlan(admin) {
  const [files, receiptProgress, paymentProgress] = await Promise.all([
    listBucket(admin),
    loadSetting(admin, "receipt_r2_copy_progress_v1"),
    loadSetting(admin, "payment_r2_copy_progress_v1"),
  ]);
  return historicalBackupPlan({ files, receiptProgress, paymentProgress });
}

export async function POST(request) {
  if (!isCronAuthorized(request)) return json({ success: false, error: "Unauthorized" }, 401);
  if (process.env.VERCEL_ENV !== "production") {
    return json({ success: false, stop: true, stopReason: "not-production" }, 409);
  }
  if (!supabaseUrl || !serviceKey || !supabaseUrl.includes(PROJECT_HOST)) {
    return json({ success: false, stop: true, stopReason: "server-config" }, 500);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const mode = body?.mode === "sign" ? "sign" : "inventory";

  try {
    const r2 = readR2Config();
    if (r2.bucket !== HISTORICAL_R2_BUCKET) {
      return json({ success: false, stop: true, stopReason: "wrong-bucket" }, 409);
    }
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const plan = await loadPlan(admin);
    if (!plan.ok) {
      return json({
        success: false,
        stop: true,
        stopReason: "inventory",
        mode,
        issues: plan.issues,
        counts: plan.counts,
      }, 409);
    }

    if (mode === "inventory") {
      return json({
        success: true,
        stop: false,
        mode,
        counts: plan.counts,
        entries: plan.entries.map(({ name, sha256, supabaseBytes, key }) => ({ name, sha256, supabaseBytes, key })),
      });
    }

    const names = Array.isArray(body.names) ? body.names : [];
    if (names.length > SIGN_BATCH_LIMIT) {
      return json({ success: false, stop: true, stopReason: "bad-batch" }, 400);
    }
    const batch = assertSignBatch(plan.entries, names);
    const signed = [];
    for (const entry of batch) {
      const url = await getSignedReadUrl(null, { key: entry.key, expiresIn: 600 });
      signed.push({ name: entry.name, url });
    }
    return json({ success: true, stop: false, mode, count: signed.length, signed });
  } catch (error) {
    const code = error?.code === "bad-batch" || error?.code === "outside-inventory" ? error.code : "unexpected";
    return json({ success: false, stop: true, stopReason: code, error: safeError(error) }, code === "unexpected" ? 500 : 400);
  }
}
