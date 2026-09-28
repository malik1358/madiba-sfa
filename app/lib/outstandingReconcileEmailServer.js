import { getMailerConfig, isEmailConfigured, parseEmailList, sendEmail } from "./mailer.js";
import {
  buildOutstandingReconcileEmail,
  resolveOutstandingReconcileEmailCc,
  resolveOutstandingReconcileEmailRecipients,
} from "./outstandingReconcileEmail.js";
import { rebuildOutstandingReconcileDataset } from "./outstandingReconcileServer.js";

export const OUTSTANDING_RECONCILE_EMAIL_LAST_SENT_KEY = "outstanding_reconcile_email_last_sent";

/** Stable fingerprint of the difference rows so repeat uploads with the same gaps do not re-email. */
export function outstandingReconcileSignature(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => `${row.customer_code}:${Number(row.difference || 0).toFixed(2)}:${Number(row.invoice_gap_count || 0)}`)
    .sort()
    .join("|");
}

export async function loadOutstandingReconcileEmailMarker(admin) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", OUTSTANDING_RECONCILE_EMAIL_LAST_SENT_KEY)
    .maybeSingle();
  if (error) throw error;
  try {
    const parsed = JSON.parse(String(data?.setting_value || "null"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function saveOutstandingReconcileEmailMarker(admin, marker) {
  const { error } = await admin.from("system_settings").upsert({
    setting_key: OUTSTANDING_RECONCILE_EMAIL_LAST_SENT_KEY,
    setting_value: JSON.stringify(marker),
  }, { onConflict: "setting_key" });
  if (error) throw error;
}

/**
 * Rebuilds the saved Tally vs SFA difference dataset and emails the differing rows.
 * Called in the background after a sales / receipt / outstanding upload.
 */
export async function runOutstandingReconcileCycle(admin, {
  trigger = "manual",
  env = process.env,
  send = sendEmail,
  rebuild = rebuildOutstandingReconcileDataset,
  loadMarker = loadOutstandingReconcileEmailMarker,
  saveMarker = saveOutstandingReconcileEmailMarker,
  force = false,
  sendWhenEmpty = false,
} = {}) {
  const dataset = await rebuild(admin, { trigger });
  const rows = Array.isArray(dataset.rows) ? dataset.rows : [];
  const base = summarize(dataset);

  if (!rows.length && !sendWhenEmpty) {
    return { ...base, skipped: true, reason: "no_differences", sentCount: 0 };
  }

  if (!isEmailConfigured(getMailerConfig(env))) {
    return { ...base, skipped: true, reason: "email_not_configured", sentCount: 0 };
  }

  const testTo = parseEmailList(env.OUTSTANDING_RECONCILE_EMAIL_TEST_TO);
  const isTestSend = testTo.length > 0;
  const signature = outstandingReconcileSignature(rows);

  if (!force && !isTestSend) {
    const marker = await loadMarker(admin).catch(() => ({}));
    if (marker?.signature && marker.signature === signature) {
      return { ...base, skipped: true, reason: "unchanged", sentCount: 0 };
    }
  }

  const to = isTestSend ? testTo : resolveOutstandingReconcileEmailRecipients(env);
  if (!to.length) {
    return { ...base, skipped: true, reason: "no_recipients", sentCount: 0 };
  }
  const cc = isTestSend ? [] : resolveOutstandingReconcileEmailCc(env, to);

  const message = buildOutstandingReconcileEmail({
    rows,
    summary: dataset.summary || {},
    builtAt: dataset.builtAt,
    trigger,
    env,
  });

  await send({
    to,
    cc,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });

  if (!isTestSend) {
    await saveMarker(admin, {
      signature,
      lastSentAt: new Date().toISOString(),
      trigger: String(trigger || ""),
      differenceCount: rows.length,
    }).catch(() => {});
  }

  return { ...base, skipped: false, sentCount: 1, to, cc };
}

function summarize(dataset) {
  return {
    builtAt: dataset?.builtAt || "",
    trigger: dataset?.trigger || "",
    differenceCount: Array.isArray(dataset?.rows) ? dataset.rows.length : 0,
    scannedCount: Number(dataset?.scannedCount || 0),
    failedCount: Number(dataset?.failedCount || 0),
  };
}
