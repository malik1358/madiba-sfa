import { isProspectCustomerCode } from "./customerCode.js";
import { extractPdfText } from "./extractPdfText.js";
import { extractInvoiceBuyerFromPdfText } from "./invoiceBuyerExtract.js";
import { INVOICE_BUCKET } from "./orderInvoiceComparison.js";
import { linkProspectToCustomer } from "./prospectCustomerLink.js";
import { parseProspectIdFromCustomerCode } from "./prospects.js";

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

    return {
      linked: true,
      prospectId,
      buyer,
      customerCode: result.customerCode,
      customerName: result.customer?.customer_name || buyer.customer_name,
      gpsCopied: result.gpsCopied,
    };
  } catch (error) {
    const message = String(error?.message || error || "").trim();
    if (/already linked/i.test(message)) {
      return {
        linked: false,
        reason: "already_linked",
        prospectId,
        buyer,
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

  try {
    const prospectLink = pdfBuffer
      ? await tryLinkProspectFromInvoiceUpload(admin, order, pdfBuffer)
      : await tryLinkProspectFromStoredInvoice(admin, order, meta?.invoiceFilePath);

    if (!prospectLink?.linked) {
      return { meta, prospectLink };
    }

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
  } catch {
    return { meta, prospectLink: null };
  }
}
