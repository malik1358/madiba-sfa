import { buildDailyReceiptEmail } from "./dailyReceiptEmail.js";
import { getMailerConfig, isEmailConfigured, normalizeDeliverableEmail, parseEmailList, sendEmail } from "./mailer.js";
import { addKsaCalendarDays, getKsaDateString, ksaDayBounds } from "./workdayActivity.js";

export const DAILY_RECEIPT_EMAIL_LAST_SENT_KEY_PREFIX = "daily_receipt_email_last_sent:";
const PAGE_SIZE = 1000;
const BATCH_SIZE = 80;
const FIELD_SALES_ROLES = new Set(["salesman", "product-promoter"]);

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase().replace(/_/g, "-");
}

function chunks(values, size = BATCH_SIZE) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

export function parseDailyReceiptReportDate(value, now = new Date()) {
  const date = String(value || "").trim();
  if (!date) return addKsaCalendarDays(getKsaDateString(now), -1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid report date. Use YYYY-MM-DD.");
  return date;
}

export async function loadDailyReceiptReportData(admin, reportDate) {
  const { startIso, endIso } = ksaDayBounds(reportDate);
  const receiptRows = [];
  let offset = 0;
  while (true) {
    const { data, error } = await admin
      .from("collection_visits")
      .select("id,customer_code,visit_outcome,amount_received,receipt_mode,created_by,saved_at")
      .gt("amount_received", 0)
      .gte("saved_at", startIso)
      .lte("saved_at", endIso)
      .order("saved_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const page = Array.isArray(data) ? data : [];
    receiptRows.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  if (!receiptRows.length) return { profiles: [], receiptsBySalesman: new Map() };

  const customerCodes = [...new Set(receiptRows.map((row) => String(row.customer_code || "").trim()).filter(Boolean))];
  const customers = [];
  for (const batch of chunks(customerCodes)) {
    const { data, error } = await admin
      .from("customers")
      .select("customer_code,customer_name,current_salesman_code")
      .in("customer_code", batch);
    if (error) throw error;
    customers.push(...(data || []));
  }

  const { data: profiles, error: profileError } = await admin
    .from("profiles")
    .select("id,role,salesman_code,salesman_name,email,report_email,is_active");
  if (profileError) throw profileError;

  const customerByCode = new Map(customers.map((customer) => [normalizeCode(customer.customer_code), customer]));
  const profileById = new Map((profiles || []).map((profile) => [String(profile.id), profile]));
  const profileBySalesmanCode = new Map((profiles || [])
    .filter((profile) => normalizeCode(profile.salesman_code))
    .map((profile) => [normalizeCode(profile.salesman_code), profile]));
  const grouped = new Map();

  receiptRows.forEach((receipt) => {
    const customer = customerByCode.get(normalizeCode(receipt.customer_code));
    const salesmanCode = normalizeCode(customer?.current_salesman_code);
    const salesman = profileBySalesmanCode.get(salesmanCode);
    if (!salesman || salesman.is_active !== true || !FIELD_SALES_ROLES.has(normalizeRole(salesman.role))) return;

    const collector = profileById.get(String(receipt.created_by || ""));
    const mappedReceipt = {
      ...receipt,
      customer_name: customer?.customer_name || receipt.customer_code,
      salesman_code: salesmanCode,
      collector_name: collector?.salesman_name || collector?.email || "Unidentified collector",
    };
    const key = normalizeCode(salesman.salesman_code);
    const rows = grouped.get(key) || { salesman, receipts: [] };
    rows.receipts.push(mappedReceipt);
    grouped.set(key, rows);
  });

  return { profiles: profiles || [], receiptsBySalesman: grouped };
}

export async function loadDailyReceiptEmailMarker(admin, reportDate) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", `${DAILY_RECEIPT_EMAIL_LAST_SENT_KEY_PREFIX}${reportDate}`)
    .maybeSingle();
  if (error) throw error;
  try {
    const value = typeof data?.setting_value === "string" ? JSON.parse(data.setting_value) : data?.setting_value;
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export async function saveDailyReceiptEmailMarker(admin, { reportDate, sentAt, sentSalesmanCodes = [] } = {}) {
  const { error } = await admin.from("system_settings").upsert({
    setting_key: `${DAILY_RECEIPT_EMAIL_LAST_SENT_KEY_PREFIX}${reportDate}`,
    setting_value: JSON.stringify({ date: reportDate, sentAt, sentSalesmanCodes, savedAt: new Date().toISOString() }),
  }, { onConflict: "setting_key" });
  if (error) throw error;
}

export async function runDailyReceiptEmailCycle(admin, {
  date,
  now = new Date(),
  env = process.env,
  send = sendEmail,
  loadData = loadDailyReceiptReportData,
  loadMarker = (client, reportDate) => loadDailyReceiptEmailMarker(client, reportDate),
  saveMarker = saveDailyReceiptEmailMarker,
} = {}) {
  const reportDate = parseDailyReceiptReportDate(date, now);
  const testRecipients = parseEmailList(env.DAILY_RECEIPT_EMAIL_TEST_TO);
  const testSend = testRecipients.length > 0;
  if (!isEmailConfigured(getMailerConfig(env))) {
    return { date: reportDate, skipped: true, reason: "email_not_configured", sentCount: 0, receiptCount: 0 };
  }

  const marker = await loadMarker(admin, reportDate);
  if (!testSend && marker.date === reportDate) {
    return { date: reportDate, skipped: true, reason: "already_sent", sentCount: 0, receiptCount: 0 };
  }

  const { receiptsBySalesman } = await loadData(admin, reportDate);
  const sentSalesmanCodes = [];
  const failures = [];
  let receiptCount = 0;
  for (const [salesmanCode, group] of receiptsBySalesman) {
    const { salesman, receipts } = group;
    const message = buildDailyReceiptEmail({ date: reportDate, salesman, receipts });
    const recipient = testSend
      ? testRecipients
      : [normalizeDeliverableEmail(salesman.report_email) || normalizeDeliverableEmail(salesman.email)].filter(Boolean);
    if (!recipient.length) {
      failures.push({ salesmanCode, error: "No deliverable salesman email." });
      continue;
    }
    try {
      await send({ ...message, to: recipient }, env);
      sentSalesmanCodes.push(salesmanCode);
      receiptCount += message.receiptCount;
    } catch (error) {
      failures.push({ salesmanCode, error: String(error?.message || error) });
    }
  }

  if (!testSend && !failures.length) {
    await saveMarker(admin, { reportDate, sentAt: now.toISOString(), sentSalesmanCodes });
  }
  return {
    date: reportDate,
    skipped: false,
    sentCount: sentSalesmanCodes.length,
    receiptCount,
    failedCount: failures.length,
    failures,
  };
}