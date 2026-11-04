import { randomUUID } from "node:crypto";
import {
  NOT_IN_VOUCHER_EMAIL_KEY_PREFIX,
  buildNotInVoucherEmail,
  notInVoucherEmailRecipients,
} from "./notInVoucherEmail.js";
import {
  NOT_IN_VOUCHER_LABEL,
  groupNotInVoucherVouchers,
  summarizeNotInVoucherVouchers,
} from "./notInVoucherSales.js";
import { getMailerConfig, isEmailConfigured, sendEmail } from "./mailer.js";
import {
  addKsaCalendarDays,
  getKsaDateString,
  getKsaWeekdayIndexForDateString,
} from "./workdayActivity.js";

const PAGE_SIZE = 1000;
const NOT_IN_VOUCHER_SELECT = [
  "transaction_date",
  "voucher_number",
  "voucher_type",
  "customer_code",
  "customer_name",
  "category",
  "quantity",
  "sales_amount",
  "profit_amount",
  "salesman_code",
  "salesman_name",
].join(",");

function truthyFlag(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function normalizeReportDate(value, now = new Date()) {
  const explicit = String(value || "").trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;
  return addKsaCalendarDays(getKsaDateString(now), -1);
}

export function resolveNotInVoucherEmailSchedule(now = new Date(), {
  date = "",
  force = false,
} = {}) {
  const reportDate = normalizeReportDate(date, now);
  if (force || String(date || "").trim()) {
    return { date: reportDate, skipped: false, reason: "" };
  }
  const weekday = getKsaWeekdayIndexForDateString(getKsaDateString(now));
  if (weekday === 5) {
    return { date: reportDate, skipped: true, reason: "friday_holiday" };
  }
  return { date: reportDate, skipped: false, reason: "" };
}

export function resolveNotInVoucherRouteTrigger({ date, force, to, trigger } = {}) {
  if (String(trigger || "").trim()) return String(trigger).trim();
  if (String(to || "").trim() || truthyFlag(force) || String(date || "").trim()) return "manual";
  return "cron";
}

async function fetchNotInVoucherPages(admin) {
  const rows = [];
  let from = 0;
  const label = NOT_IN_VOUCHER_LABEL;
  while (true) {
    const { data, error } = await admin
      .from("active_sales")
      .select(NOT_IN_VOUCHER_SELECT)
      .or(`salesman_code.eq."${label}",salesman_name.eq."${label}"`)
      .order("transaction_date", { ascending: false })
      .order("voucher_number", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

export async function loadNotInVoucherVouchers(admin) {
  const sourceRows = await fetchNotInVoucherPages(admin);
  return groupNotInVoucherVouchers(sourceRows);
}

export async function claimNotInVoucherEmail(admin, date) {
  const settingKey = `${NOT_IN_VOUCHER_EMAIL_KEY_PREFIX}${date}`;
  const claim = JSON.stringify({
    status: "sending",
    token: randomUUID(),
    claimedAt: new Date().toISOString(),
  });
  const { error } = await admin.from("system_settings").insert({
    setting_key: settingKey,
    setting_value: claim,
  });
  if (error?.code === "23505") return null;
  if (error) throw error;
  return { settingKey, claim };
}

export async function finishNotInVoucherEmail(admin, claim, counts = {}) {
  const { error } = await admin.from("system_settings")
    .update({
      setting_value: JSON.stringify({
        status: "sent",
        sentAt: new Date().toISOString(),
        voucherCount: counts.voucherCount || 0,
        salesAmount: counts.salesAmount || 0,
      }),
    })
    .eq("setting_key", claim.settingKey)
    .eq("setting_value", claim.claim);
  if (error) throw error;
}

export async function releaseNotInVoucherEmail(admin, claim) {
  const { error } = await admin.from("system_settings").delete()
    .eq("setting_key", claim.settingKey)
    .eq("setting_value", claim.claim);
  if (error) throw error;
}

export async function runNotInVoucherEmailCycle(admin, {
  date = "",
  now = new Date(),
  env = process.env,
  force = false,
  trigger = "cron",
  send = sendEmail,
  loadVouchers = loadNotInVoucherVouchers,
  claimSend = claimNotInVoucherEmail,
  finishSend = finishNotInVoucherEmail,
  releaseSend = releaseNotInVoucherEmail,
} = {}) {
  const forceSend = truthyFlag(force) || truthyFlag(env.NOT_IN_VOUCHER_EMAIL_FORCE);
  const schedule = resolveNotInVoucherEmailSchedule(now, { date, force: forceSend });
  if (schedule.skipped && !forceSend) {
    return {
      date: schedule.date,
      skipped: true,
      reason: schedule.reason,
      sentCount: 0,
      voucherCount: 0,
      trigger,
    };
  }

  const reportDate = schedule.date;
  const isTestSend = Boolean(String(env.NOT_IN_VOUCHER_EMAIL_TEST_TO || "").trim());
  const to = notInVoucherEmailRecipients(env);
  if (!to.length) {
    return { date: reportDate, skipped: true, reason: "no_recipients", sentCount: 0, voucherCount: 0, trigger };
  }
  if (!isEmailConfigured(getMailerConfig(env))) {
    return { date: reportDate, skipped: true, reason: "email_not_configured", sentCount: 0, voucherCount: 0, trigger };
  }

  let claim = null;
  if (!forceSend && !isTestSend) {
    claim = await claimSend(admin, reportDate);
    if (!claim) {
      return {
        date: reportDate,
        skipped: true,
        reason: "already_claimed_or_sent",
        sentCount: 0,
        voucherCount: 0,
        trigger,
      };
    }
  }

  try {
    const vouchers = await loadVouchers(admin);
    const totals = summarizeNotInVoucherVouchers(vouchers);
    if (!vouchers.length) {
      if (claim) {
        await finishSend(admin, claim, { voucherCount: 0, salesAmount: 0 });
      }
      return {
        date: reportDate,
        skipped: true,
        reason: "no_vouchers",
        sentCount: 0,
        voucherCount: 0,
        salesAmount: 0,
        trigger,
      };
    }

    const message = buildNotInVoucherEmail({
      date: reportDate,
      vouchers,
      env,
    });
    const subject = isTestSend || forceSend ? `[TEST] ${message.subject}` : message.subject;
    await send({
      to,
      subject,
      html: message.html,
      text: message.text,
    }, env);

    if (claim) {
      await finishSend(admin, claim, {
        voucherCount: totals.voucherCount,
        salesAmount: totals.salesAmount,
      });
    }

    return {
      date: reportDate,
      skipped: false,
      sentCount: 1,
      voucherCount: totals.voucherCount,
      lineCount: totals.lineCount,
      salesAmount: totals.salesAmount,
      to,
      trigger,
    };
  } catch (error) {
    if (claim) {
      try {
        await releaseSend(admin, claim);
      } catch (releaseError) {
        console.error("Failed to release not-in-voucher email claim:", releaseError);
      }
    }
    throw error;
  }
}
