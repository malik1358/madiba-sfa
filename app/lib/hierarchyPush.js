import { isFcmConfigured, sendPushToUser } from "./fcm.js";

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

export async function resolveReportingChain(admin, actorUserId) {
  const [profilesRes, usersRes] = await Promise.all([
    admin
      .from("profiles")
      .select("id,salesman_code,salesman_name,role")
      .order("salesman_name"),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  if (profilesRes.error) throw profilesRes.error;
  if (usersRes.error) throw usersRes.error;

  const profileByCode = new Map();
  (profilesRes.data || []).forEach((profile) => {
    const code = normalizeCode(profile.salesman_code);
    if (code) profileByCode.set(code, profile);
  });

  const authById = new Map((usersRes.data?.users || []).map((entry) => [entry.id, entry]));
  const chain = [];
  const seen = new Set();

  let currentAuth = authById.get(actorUserId);
  while (currentAuth) {
    const metadata = currentAuth.user_metadata || currentAuth.app_metadata || {};
    const headCode = normalizeCode(metadata.head_salesman_code);
    if (!headCode) break;

    const headProfile = profileByCode.get(headCode);
    if (!headProfile || seen.has(headProfile.id)) break;

    seen.add(headProfile.id);
    chain.push({
      id: headProfile.id,
      salesman_code: headProfile.salesman_code || "",
      salesman_name: headProfile.salesman_name || "",
      role: headProfile.role || "",
    });

    currentAuth = authById.get(headProfile.id);
  }

  return chain;
}

async function hasDuplicateReference(admin, referenceKey) {
  if (!referenceKey) return false;

  const { count, error } = await admin
    .from("push_notification_log")
    .select("id", { count: "exact", head: true })
    .eq("reference_key", referenceKey);

  if (error) throw error;
  return Number(count || 0) > 0;
}

export async function notifyReportingChain(admin, {
  actorUserId,
  transactionType,
  title,
  body,
  referenceKey = "",
  data = {},
}) {
  if (!isFcmConfigured()) {
    return { skipped: true, reason: "fcm_not_configured", sent: 0, bosses: 0 };
  }

  const dedupeKey = String(referenceKey || "").trim();
  if (dedupeKey && await hasDuplicateReference(admin, dedupeKey)) {
    return { skipped: true, reason: "duplicate", sent: 0, bosses: 0 };
  }

  const chain = await resolveReportingChain(admin, actorUserId);
  if (chain.length === 0) {
    return { skipped: true, reason: "no_reporting_chain", sent: 0, bosses: 0 };
  }

  const payloadData = {
    ...data,
    transactionType: String(transactionType || ""),
    actorUserId: String(actorUserId || ""),
  };

  let sent = 0;
  const results = [];

  for (const boss of chain) {
    const result = await sendPushToUser(admin, boss.id, {
      title,
      body,
      data: payloadData,
    });

    const { error: logError } = await admin.from("push_notification_log").insert({
      user_id: boss.id,
      notification_type: `transaction_${transactionType}`,
      title,
      body,
      success_count: result.successCount,
      failure_count: result.failureCount,
      reference_key: dedupeKey || null,
    });

    if (logError) {
      console.error("push_notification_log insert failed", logError);
    }

    if (result.successCount > 0) sent += 1;

    results.push({
      bossId: boss.id,
      bossName: boss.salesman_name,
      successCount: result.successCount,
      failureCount: result.failureCount,
    });
  }

  return {
    skipped: false,
    sent,
    bosses: chain.length,
    results,
  };
}
