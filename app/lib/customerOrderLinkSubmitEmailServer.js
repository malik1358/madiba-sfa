import {
  buildCustomerOrderLinkSubmitEmail,
  resolveCustomerOrderLinkSubmitEmailRecipients,
} from "./customerOrderLinkSubmitEmail.js";
import { resolveUserReportEmail } from "./dailyVisitReportEmail.js";
import { buildOrderCopyPdfAttachment } from "./invoiceUploadEmailServer.js";
import {
  applyEmailRecipientMirrors,
  getMailerConfig,
  isEmailConfigured,
  sendEmail,
} from "./mailer.js";
import { isMissingSchemaColumn } from "./performanceKpis.js";
import { resolveReportingChainFromAuth } from "./salesHierarchy.js";
import { queueTransactionBossAlerts } from "./transactionBossAlerts.js";

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function profileEmail(profile) {
  return resolveUserReportEmail({
    reportEmail: profile?.report_email,
    email: profile?.email,
  });
}

async function listAuthUsers(admin) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  return data?.users || [];
}

async function loadProfiles(admin) {
  const full = "id,salesman_code,salesman_name,role,email,report_email";
  const fallback = "id,salesman_code,salesman_name,role,email";
  let result = await admin.from("profiles").select(full);
  if (result.error && isMissingSchemaColumn(result.error)) {
    result = await admin.from("profiles").select(fallback);
  }
  if (result.error) throw result.error;
  return result.data || [];
}

function findSalesmanProfile({ salesmanCode = "", createdBy = "" } = {}, profiles = []) {
  const code = normalizeCode(salesmanCode);
  if (code) {
    const byCode = profiles.find((profile) => normalizeCode(profile.salesman_code) === code);
    if (byCode) return byCode;
  }
  const actorId = String(createdBy || "").trim();
  if (actorId) {
    return profiles.find((profile) => String(profile.id) === actorId) || null;
  }
  return null;
}

export async function sendCustomerOrderLinkSubmitEmail(admin, {
  orderId,
  orderNumber = "",
  customerCode = "",
  customerName = "",
  salesmanCode = "",
  salesmanName = "",
  createdBy = "",
  totalValue = null,
  lineCount = 0,
  submittedAtIso = "",
  pricingRegion = "",
  pricingType = "",
  isProspect = false,
  env = process.env,
  send = sendEmail,
  now = new Date(),
} = {}) {
  if (!isEmailConfigured(getMailerConfig(env))) {
    return { skipped: true, reason: "email_not_configured", sent: false };
  }

  const id = String(orderId || "").trim();
  if (!id) {
    return { skipped: true, reason: "missing_order_id", sent: false };
  }

  const [profiles, authUsers] = await Promise.all([
    loadProfiles(admin),
    listAuthUsers(admin),
  ]);

  const salesmanProfile = findSalesmanProfile(
    { salesmanCode, createdBy },
    profiles,
  );
  const actorUserId = String(salesmanProfile?.id || createdBy || "").trim();
  const chain = actorUserId
    ? resolveReportingChainFromAuth({
      actorUserId,
      profiles,
      authUsers,
    })
    : [];

  const recipients = resolveCustomerOrderLinkSubmitEmailRecipients({
    salesmanEmail: profileEmail(salesmanProfile),
    hierarchyEmails: chain.map((boss) => profileEmail(boss)).filter(Boolean),
    extraTo: env.CUSTOMER_ORDER_LINK_EMAIL_TO,
    extraCc: env.CUSTOMER_ORDER_LINK_EMAIL_CC,
  });
  const mirrored = applyEmailRecipientMirrors(recipients, env);

  if (!mirrored.to.length) {
    return { skipped: true, reason: "no_recipients", sent: false };
  }

  let orderCopy = null;
  let orderPdfError = "";
  try {
    orderCopy = await buildOrderCopyPdfAttachment(admin, id, { now });
  } catch (error) {
    orderPdfError = String(error?.message || error);
  }

  const message = buildCustomerOrderLinkSubmitEmail({
    orderNumber: orderNumber || orderCopy?.order?.order_number || id,
    customerCode: customerCode || orderCopy?.order?.customer_code || "",
    customerName: customerName || orderCopy?.order?.customer_name || "",
    salesmanName: salesmanName || salesmanProfile?.salesman_name || orderCopy?.order?.salesman_name || "",
    salesmanCode: salesmanCode || salesmanProfile?.salesman_code || orderCopy?.order?.salesman_code || "",
    totalValue,
    lineCount,
    submittedAtIso: submittedAtIso || now.toISOString(),
    pricingRegion,
    pricingType,
    isProspect,
  });

  const attachments = [];
  if (orderCopy?.content?.length) {
    attachments.push({
      filename: orderCopy.filename,
      content: orderCopy.content,
      contentType: orderCopy.contentType || "application/pdf",
    });
  }

  await send({
    to: mirrored.to,
    cc: mirrored.cc,
    subject: message.subject,
    text: message.text,
    html: message.html,
    attachments,
  });

  return {
    skipped: false,
    sent: true,
    to: mirrored.to,
    cc: mirrored.cc,
    orderPdfIncluded: Boolean(orderCopy?.content?.length),
    orderPdfError,
  };
}

/** Fire-and-forget email + push to hierarchy after guest submit. Never throws to caller. */
export function queueCustomerOrderLinkSubmitNotifications(admin, payload = {}) {
  const actorUserId = String(payload.createdBy || "").trim();
  const orderId = String(payload.orderId || "").trim();

  sendCustomerOrderLinkSubmitEmail(admin, payload).catch((error) => {
    console.error("customer order link submit email failed", error);
  });

  if (actorUserId && orderId) {
    queueTransactionBossAlerts(admin, {
      actorUserId,
      transactionType: "ORDER_SUBMITTED",
      referenceKey: `customer-order-link:${orderId}:submit`,
      details: {
        customerCode: payload.customerCode || "",
        customerName: payload.customerName || "",
        referenceId: orderId,
      },
    });
  }
}
