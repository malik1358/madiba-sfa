import { notifyReportingChain } from "./hierarchyPush.js";

export const TRANSACTION_ALERT_TYPES = new Set([
  "ORDER_SUBMITTED",
  "ORDER_DRAFT",
  "ORDER_EDITED",
  "VISIT_REPORT",
  "COLLECTION_VISIT",
  "PROSPECT_REGISTERED",
  "PROSPECT_FOLLOW_UP",
  "MORNING_ATTENDANCE",
  "END_OF_DAY",
  "LUNCH_BREAK_OUT",
  "LUNCH_BREAK_IN",
  "NOTE",
  "LEGAL_TRANSFER",
  "LEGAL_TRANSFER_REMOVE",
]);

function formatActor(actorName, actorCode) {
  const name = String(actorName || "Team member").trim() || "Team member";
  const code = String(actorCode || "").trim();
  return code ? `${name} (${code})` : name;
}

export function buildTransactionAlertMessage({
  transactionType,
  actorName = "",
  actorCode = "",
  details = {},
}) {
  const who = formatActor(actorName, actorCode);
  const customerLabel = String(details.customerName || details.customerCode || details.companyName || "").trim();
  const customerSuffix = customerLabel ? ` for ${customerLabel}` : "";

  switch (transactionType) {
    case "ORDER_SUBMITTED":
      return {
        title: "Order submitted",
        body: `${who} submitted an order${customerSuffix}.`,
      };
    case "ORDER_DRAFT":
      return {
        title: "Order draft saved",
        body: `${who} saved an order draft${customerSuffix}.`,
      };
    case "ORDER_EDITED":
      return {
        title: "Order updated",
        body: `${who} updated an order${customerSuffix}.`,
      };
    case "VISIT_REPORT":
      return {
        title: "Visit report",
        body: `${who} logged a customer visit${customerSuffix}${details.outcome ? ` (${details.outcome})` : ""}.`,
      };
    case "COLLECTION_VISIT":
      return {
        title: "Collection visit",
        body: `${who} saved a collection visit${customerSuffix}${details.visitOutcome ? ` (${details.visitOutcome})` : ""}.`,
      };
    case "PROSPECT_REGISTERED":
      return {
        title: "New prospect",
        body: `${who} registered a new prospect${customerSuffix}.`,
      };
    case "PROSPECT_FOLLOW_UP":
      return {
        title: "Prospect follow-up",
        body: `${who} scheduled a prospect follow-up${customerSuffix}.`,
      };
    case "MORNING_ATTENDANCE":
      return {
        title: "Workday started",
        body: `${who} started the workday.`,
      };
    case "END_OF_DAY":
      return {
        title: "Workday ended",
        body: `${who} ended the workday.`,
      };
    case "LUNCH_BREAK_OUT":
      return {
        title: "Lunch break",
        body: `${who} started lunch break.`,
      };
    case "LUNCH_BREAK_IN":
      return {
        title: "Back from lunch",
        body: `${who} returned from lunch break.`,
      };
    case "NOTE":
      return {
        title: "Field note",
        body: `${who} added a field note.`,
      };
    case "LEGAL_TRANSFER":
      return {
        title: "Legal transfer",
        body: `${who} transferred a customer to legal${customerSuffix}.`,
      };
    case "LEGAL_TRANSFER_REMOVE":
      return {
        title: "Legal transfer removed",
        body: `${who} removed a customer from legal${customerSuffix}.`,
      };
    default:
      return {
        title: "Team activity",
        body: `${who} recorded ${transactionType}.`,
      };
  }
}

export async function notifyTransactionBosses(admin, {
  actorUserId,
  transactionType,
  referenceKey = "",
  details = {},
}) {
  const normalizedType = String(transactionType || "").trim().toUpperCase();
  if (!TRANSACTION_ALERT_TYPES.has(normalizedType)) {
    return { skipped: true, reason: "unsupported_transaction_type", sent: 0, bosses: 0 };
  }

  const { data: actorProfile, error: profileError } = await admin
    .from("profiles")
    .select("salesman_name,salesman_code")
    .eq("id", actorUserId)
    .maybeSingle();

  if (profileError) throw profileError;

  const { title, body } = buildTransactionAlertMessage({
    transactionType: normalizedType,
    actorName: actorProfile?.salesman_name,
    actorCode: actorProfile?.salesman_code,
    details,
  });

  return notifyReportingChain(admin, {
    actorUserId,
    transactionType: normalizedType,
    title,
    body,
    referenceKey,
    data: {
      customerCode: String(details.customerCode || ""),
      customerName: String(details.customerName || details.companyName || ""),
      referenceId: String(details.referenceId || ""),
    },
  });
}

export function queueTransactionBossAlerts(admin, payload) {
  notifyTransactionBosses(admin, payload).catch((error) => {
    console.error("notifyTransactionBosses failed", error);
  });
}
