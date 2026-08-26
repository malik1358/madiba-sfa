import { isProspectCustomerCode } from "./customerCode.js";
import { extractPdfText } from "./extractPdfText.js";
import { extractInvoiceBuyerFromPdfText } from "./invoiceBuyerExtract.js";
import { INVOICE_BUCKET } from "./orderInvoiceComparison.js";
import { findCustomerByCode, formatCustomerLookupPreview, linkProspectToCustomer } from "./prospectCustomerLink.js";
import { parseProspectIdFromCustomerCode } from "./prospects.js";

export function isProspectInvoiceLinkCandidate(order, meta) {
  if (!isProspectCustomerCode(order?.customer_code)) return false;
  if (!meta?.invoiceFilePath) return false;
  if (meta?.prospectLinkedAt) return false;
  return true;
}

async function syncProspectLinkMetaFromDb(admin, prospectId, meta, buyer = null) {
  if (!prospectId) return null;

  const { data: prospect, error } = await admin
    .from("prospects")
    .select("converted_customer_code,company_name,shop_name")
    .eq("id", prospectId)
    .maybeSingle();

  if (error) throw error;
  if (!prospect?.converted_customer_code) return null;

  let customerName = String(meta?.prospectLinkedCustomerName || "").trim();
  if (!customerName && buyer?.customer_name) {
    customerName = buyer.customer_name;
  }
  if (!customerName) {
    customerName = String(prospect.company_name || prospect.shop_name || "").trim();
  }

  const nowIso = meta?.prospectLinkedAt || new Date().toISOString();
  return {
    meta: {
      ...meta,
      prospectLinkedAt: nowIso,
      prospectLinkedCustomerCode: prospect.converted_customer_code,
      prospectLinkedCustomerName: customerName,
      prospectGpsCopied: Boolean(meta?.prospectGpsCopied),
    },
    prospectLink: {
      linked: false,
      reason: "already_linked",
      prospectId,
      customerCode: prospect.converted_customer_code,
      customerName,
    },
  };
}

export async function tryLinkProspectFromInvoiceUpload(admin, order, pdfBuffer) {
  const prospectId = parseProspectIdFromCustomerCode(order?.customer_code);
  if (!prospectId) {
    return { linked: false, reason: "not_prospect_order" };
  }

  const pdfText = await extractPdfText(pdfBuffer);
  const buyer = extractInvoiceBuyerFromPdfText(pdfText);
  if (!buyer.customer_code) {
    return {
      linked: false,
      reason: "buyer_not_found",
      prospectId,
      buyer,
    };
  }

  try {
    const result = await linkProspectToCustomer(admin, {
      prospectId,
      customerCode: buyer.customer_code,
      copyGps: true,
      overwriteCustomerGps: false,
    });

    const preview = formatCustomerLookupPreview(result.customer);

    return {
      linked: true,
      prospectId,
      buyer,
      customerCode: result.customerCode,
      customerName: preview.customer_name || result.customer?.customer_name || buyer.customer_name,
      gpsCopied: result.gpsCopied,
    };
  } catch (error) {
    const message = String(error?.message || error || "").trim();
    if (/already linked/i.test(message)) {
      const customer = await findCustomerByCode(admin, buyer.customer_code);
      const preview = customer ? formatCustomerLookupPreview(customer) : null;
      return {
        linked: false,
        reason: "already_linked",
        prospectId,
        buyer,
        customerCode: preview?.customer_code || buyer.customer_code,
        customerName: preview?.customer_name || buyer.customer_name,
        message,
      };
    }

    return {
      linked: false,
      reason: "link_failed",
      prospectId,
      buyer,
      message,
    };
  }
}

export async function tryLinkProspectFromStoredInvoice(admin, order, invoiceFilePath) {
  if (!invoiceFilePath) {
    return { linked: false, reason: "no_invoice" };
  }

  const { data, error } = await admin.storage.from(INVOICE_BUCKET).download(invoiceFilePath);
  if (error) throw error;

  const buffer = await data.arrayBuffer();
  return tryLinkProspectFromInvoiceUpload(admin, order, buffer);
}

export async function attachProspectLinkToMeta(admin, order, meta, pdfBuffer = null) {
  if (!isProspectCustomerCode(order?.customer_code)) return { meta, prospectLink: null };
  if (meta?.prospectLinkedAt) {
    return {
      meta,
      prospectLink: {
        linked: false,
        reason: "already_recorded",
        customerCode: meta.prospectLinkedCustomerCode || "",
      },
    };
  }

  const prospectId = parseProspectIdFromCustomerCode(order?.customer_code);

  try {
    const prospectLink = pdfBuffer
      ? await tryLinkProspectFromInvoiceUpload(admin, order, pdfBuffer)
      : await tryLinkProspectFromStoredInvoice(admin, order, meta?.invoiceFilePath);

    if (prospectLink?.linked) {
      const nowIso = new Date().toISOString();
      return {
        meta: {
          ...meta,
          prospectLinkedAt: nowIso,
          prospectLinkedCustomerCode: prospectLink.customerCode,
          prospectLinkedCustomerName: prospectLink.customerName || "",
          prospectGpsCopied: Boolean(prospectLink.gpsCopied),
        },
        prospectLink,
      };
    }

    if (prospectLink?.reason === "already_linked") {
      const synced = await syncProspectLinkMetaFromDb(admin, prospectId, meta, prospectLink.buyer);
      if (synced) return synced;
    }

    return { meta, prospectLink };
  } catch {
    const synced = await syncProspectLinkMetaFromDb(admin, prospectId, meta).catch(() => null);
    if (synced) return synced;
    return { meta, prospectLink: null };
  }
}

export async function backfillProspectInvoiceLinks(admin, orders, metaMap, options = {}) {
  const limit = Number(options.limit) > 0 ? Number(options.limit) : 15;
  const results = {};
  const updatedMeta = {};
  let processed = 0;

  for (const order of orders || []) {
    if (processed >= limit) break;

    const orderId = String(order?.id || "").trim();
    if (!orderId) continue;

    const meta = metaMap.get(orderId) || { orderId };
    if (!isProspectInvoiceLinkCandidate(order, meta)) continue;

    processed += 1;
    const linked = await attachProspectLinkToMeta(admin, order, meta);
    results[orderId] = linked.prospectLink || { linked: false, reason: "unknown" };

    if (linked.meta !== meta) {
      updatedMeta[orderId] = linked.meta;
      metaMap.set(orderId, linked.meta);
    }
  }

  return {
    processed,
    results,
    updatedMeta,
  };
}
