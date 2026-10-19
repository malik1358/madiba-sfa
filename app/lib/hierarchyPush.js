import { isFcmConfigured, sendPushToUser } from "./fcm.js";
import { resolveReportingChain } from "./salesHierarchy.js";

export { resolveReportingChain };

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
