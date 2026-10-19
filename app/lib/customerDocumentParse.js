export const CUSTOMER_DOCUMENT_TYPES = [
  { id: "CR", compulsory: true, labelEn: "Commercial Registration", labelAr: "السجل التجاري" },
  { id: "VAT", compulsory: true, labelEn: "VAT certificate", labelAr: "شهادة ضريبة القيمة المضافة" },
  { id: "NATIONAL_ADDRESS", compulsory: true, labelEn: "National address", labelAr: "العنوان الوطني" },
  { id: "BALADY", compulsory: false, labelEn: "Balady / shop license", labelAr: "رخصة بلدي" },
  { id: "CREDIT_APPLICATION", compulsory: false, labelEn: "Credit application", labelAr: "طلب تسهيلات ائتمانية" },
];

export const COMPULSORY_DOCUMENT_TYPES = CUSTOMER_DOCUMENT_TYPES
  .filter((entry) => entry.compulsory)
  .map((entry) => entry.id);

export function normalizeDocumentType(value) {
  const type = String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (type === "NATIONALADDRESS" || type === "WASEL") return "NATIONAL_ADDRESS";
  if (type === "CREDIT" || type === "CREDITAPP") return "CREDIT_APPLICATION";
  if (type === "MUNICIPAL" || type === "LICENSE") return "BALADY";
  return CUSTOMER_DOCUMENT_TYPES.some((entry) => entry.id === type) ? type : "";
}

export function normalizeCrNumber(value) {
  const digits = String(value || "").replace(/\D+/g, "");
  if (digits.length === 10) return digits;
  if (digits.length > 10 && digits.endsWith("00003") && digits.length === 15) return "";
  if (digits.length > 10) {
    const ten = digits.match(/(70\d{8}|10\d{8}|\d{10})/);
    return ten ? ten[1].slice(0, 10) : "";
  }
  return "";
}

export function normalizeVatNumber(value) {
  const digits = String(value || "").replace(/\D+/g, "");
  if (digits.length === 15 && digits.startsWith("3")) return digits;
  const match = String(value || "").match(/\b(3\d{14})\b/);
  return match ? match[1] : "";
}

export function parseDocumentDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);

  const dmy = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    let year = Number(dmy[3]);
    if (year < 100) year += 2000;
    return utcDateString(year, month, day);
  }

  const ymd = text.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (ymd) {
    return utcDateString(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
  }

  return "";
}

function utcDateString(year, month, day) {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return "";
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(utc.getTime())) return "";
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    return "";
  }
  return utc.toISOString().slice(0, 10);
}

export function addYearsToIsoDate(isoDate, years = 1) {
  const parsed = parseDocumentDate(isoDate);
  if (!parsed) return "";
  const [year, month, day] = parsed.split("-").map(Number);
  const targetYear = year + Number(years || 1);
  const candidate = utcDateString(targetYear, month, day);
  if (candidate) return candidate;
  return utcDateString(targetYear, month, 28);
}

export function extractCrNumberFromText(text) {
  const source = String(text || "");
  const labeled = source.match(/National\s*Number[^\d]{0,60}(\d{10})/i)
    || source.match(/CR\s*National\s*Number[^\d]{0,80}(\d{10})/i)
    || source.match(/Unified\s*Number[^\d]{0,40}(\d{10})/i)
    || source.match(/الرقم الموحد[^\d]{0,80}(\d{10})/)
    || source.match(/السجل التجاري[^\d]{0,40}(\d{10})/);
  if (labeled) return normalizeCrNumber(labeled[1]);

  const tens = [...source.matchAll(/\b(\d{10})\b/g)].map((match) => match[1]);
  return normalizeCrNumber(
    tens.find((value) => /^(70|10|40)\d{8}$/.test(value)) || tens[0] || "",
  );
}

const DATE_TOKEN = "(\\d{1,2}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{2,4}|\\d{4}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{1,2})";

export function extractIssueDateFromText(text) {
  const source = String(text || "");
  const labeled = source.match(new RegExp(`Release date\\s*[:：]?\\s*${DATE_TOKEN}`, "i"))
    || source.match(new RegExp(`Effective Registration Date[^\\d]{0,40}${DATE_TOKEN}`, "i"))
    || source.match(new RegExp(`VAT registered on\\s*${DATE_TOKEN}`, "i"))
    || source.match(new RegExp(`is VAT registered on\\s*${DATE_TOKEN}`, "i"))
    || source.match(new RegExp(`تاريخ الإصدار[^\\d]{0,40}${DATE_TOKEN}`))
    || source.match(new RegExp(`تاريخ الاصدار[^\\d]{0,40}${DATE_TOKEN}`));
  return parseDocumentDate(labeled?.[1]);
}

export function extractExpiryDateFromText(text) {
  const source = String(text || "");
  const labeled = source.match(new RegExp(`تاريخ الانتهاء[^\\d]{0,40}${DATE_TOKEN}`))
    || source.match(new RegExp(`ساري\\s*إ?لى[^\\d]{0,40}${DATE_TOKEN}`))
    || source.match(new RegExp(`Valid until[^\\d]{0,40}${DATE_TOKEN}`, "i"))
    || source.match(new RegExp(`Expir(?:y|ation)\\s*Date[^\\d]{0,40}${DATE_TOKEN}`, "i"));
  if (labeled) return parseDocumentDate(labeled[1]);

  const afterNational = source.match(new RegExp(`(70\\d{8})[\\s\\S]{0,120}${DATE_TOKEN}`));
  if (afterNational) return parseDocumentDate(afterNational[2]);

  const beforeNational = source.match(new RegExp(`${DATE_TOKEN}[\\s\\S]{0,80}(70\\d{8})`));
  if (beforeNational) return parseDocumentDate(beforeNational[1]);
  return "";
}

export function normalizeCreditLimit(value) {
  const digits = String(value || "").replace(/[^\d]/g, "");
  if (!digits) return 0;
  const amount = Number(digits);
  if (!Number.isFinite(amount) || amount < 100 || amount > 100000000) return 0;
  return amount;
}

export function extractCreditLimitFromText(text) {
  const source = String(text || "");
  const labeled = source.match(/Credit Limit required[^\d]{0,80}([\d.,\s]{3,18})/i)
    || source.match(/Credit Limit[^\d]{0,50}([\d.,\s]{3,18})/i)
    || source.match(/المبلغ المطلوب[^\d]{0,50}([\d.,\s]{3,18})/)
    || source.match(/الائتمان المطلوب[^\d]{0,80}([\d.,\s]{3,18})/);
  if (labeled) {
    const amount = normalizeCreditLimit(labeled[1]);
    if (amount) return amount;
  }

  const commaAmounts = [...source.matchAll(/\b(\d{1,3}(?:[,\s]\d{3})+)\b/g)]
    .map((match) => normalizeCreditLimit(match[1]))
    .filter((amount) => amount >= 1000);
  return commaAmounts[0] || 0;
}

export function extractVatNumberFromText(text) {
  const source = String(text || "");
  const labeled = source.match(/VAT Registration Number[\s\S]{0,160}?(\d{15})/i)
    || source.match(/رقم التسجيل الضريبي[\s\S]{0,160}?(\d{15})/)
    || source.match(/VAT(?:\s+Registration)?\s*(?:No\.?|Number)[\s\S]{0,80}?(\d{15})/i);
  if (labeled) return normalizeVatNumber(labeled[1]);

  const spaced = source.match(/\b(3(?:[\s-]*\d){14})\b/);
  if (spaced) return normalizeVatNumber(spaced[1]);

  const raw = source.match(/\b(3\d{14})\b/);
  return normalizeVatNumber(raw ? raw[1] : "");
}

export function extractCompanyNameFromText(text) {
  const source = String(text || "");
  const english = source.match(/Taxpayer Name[^\n]*\n?\s*([A-Za-z][^\n]{3,80})/i);
  if (english) return english[1].trim();
  const arabic = source.match(/Taxpayer Name[\s\S]{0,60}?([\u0600-\u06FF][^\n]{4,120})/i);
  if (arabic) return arabic[1].trim();
  const labeled = source.match(/Company(?: name)?\s*[:：]\s*([^\n]{3,80})/i);
  return labeled ? labeled[1].trim() : "";
}

export function extractAddressFromText(text) {
  const source = String(text || "");
  const labeled = source.match(/Taxpayer Address[^\n]*\n?\s*([^\n]{6,160})/i)
    || source.match(/عنوان المكلف[^\n]*\n?\s*([^\n]{6,160})/);
  return labeled ? labeled[1].trim() : "";
}

export function extractLicenseNumberFromText(text) {
  const match = String(text || "").match(/\b(\d{10,14})\b/);
  const vat = extractVatNumberFromText(text);
  const cr = extractCrNumberFromText(text);
  const candidates = [...String(text || "").matchAll(/\b(\d{10,14})\b/g)].map((entry) => entry[1]);
  return candidates.find((value) => value !== vat && value !== cr && value !== `${cr}`) || match?.[1] || "";
}

export function parseCustomerDocumentText(documentType, text, overrides = {}) {
  const type = normalizeDocumentType(documentType);
  const source = String(text || "");
  const parsedCr = normalizeCrNumber(overrides.crNumber) || extractCrNumberFromText(source);
  const parsedVat = normalizeVatNumber(overrides.vatNumber) || extractVatNumberFromText(source);
  const issueDate = parseDocumentDate(overrides.issueDate) || extractIssueDateFromText(source);
  const labeledExpiry = parseDocumentDate(overrides.expiryDate) || extractExpiryDateFromText(source);
  const expiryDate = labeledExpiry
    || (type === "CREDIT_APPLICATION" && issueDate ? addYearsToIsoDate(issueDate, 1) : "");
  const creditLimit = type === "CREDIT_APPLICATION"
    ? (normalizeCreditLimit(overrides.creditLimit) || extractCreditLimitFromText(source))
    : 0;

  const extracted = {
    documentType: type,
    crNumber: parsedCr,
    vatNumber: parsedVat,
    companyName: String(overrides.companyName || extractCompanyNameFromText(source) || "").trim(),
    issueDate,
    expiryDate,
    creditLimit,
    address: String(overrides.address || extractAddressFromText(source) || "").trim(),
    licenseNumber: type === "BALADY" ? String(overrides.licenseNumber || extractLicenseNumberFromText(source) || "").trim() : "",
    unparsed: !source.trim(),
  };

  return {
    ...extracted,
    parsed_cr_number: parsedCr,
    parsed_vat_number: parsedVat,
    issue_date: issueDate || null,
    expiry_date: expiryDate || null,
    credit_limit: creditLimit || null,
  };
}

export function latestDocumentByType(documents = []) {
  const latest = new Map();
  (documents || []).forEach((row) => {
    const type = normalizeDocumentType(row?.document_type);
    if (!type) return;
    const current = latest.get(type);
    const created = Date.parse(row?.created_at || 0) || 0;
    const currentCreated = Date.parse(current?.created_at || 0) || 0;
    if (!current || created >= currentCreated) latest.set(type, row);
  });
  return latest;
}

export function findDuplicateVatHolder(rows, vatNumber, excludeCustomerCode = "") {
  const vat = normalizeVatNumber(vatNumber);
  const exclude = String(excludeCustomerCode || "").trim();
  if (!vat) return null;
  return (rows || []).find((row) => {
    const code = String(row?.customer_code || "").trim();
    if (!code || code === exclude) return false;
    return normalizeVatNumber(row?.vat_number || row?.parsed_vat_number) === vat;
  }) || null;
}

export function formatVatConflictError(vatNumber, holder) {
  const vat = normalizeVatNumber(vatNumber);
  const code = String(holder?.customer_code || "").trim();
  const name = String(holder?.customer_name || "").trim();
  if (!vat || !code) return "This VAT registration number is already used by another customer.";
  return `VAT ${vat} is already used by customer ${code}${name ? ` ${name}` : ""}.`;
}

export function canonicalCrFromDocuments(documents = [], customerCr = "") {
  const latest = latestDocumentByType(documents);
  return normalizeCrNumber(latest.get("CR")?.parsed_cr_number)
    || normalizeCrNumber(customerCr);
}

export function resolveDocumentLinkStatus({ parsedCr, canonicalCr, unparsed = false }) {
  const parsed = normalizeCrNumber(parsedCr);
  const canonical = normalizeCrNumber(canonicalCr);
  if (unparsed && !parsed) {
    return { link_status: "UNPARSED", link_message: "Could not read CR number from this file. Enter it if needed." };
  }
  if (!canonical) {
    return { link_status: "MISSING_CR", link_message: "Upload the CR certificate first so other files can be matched." };
  }
  if (!parsed) {
    return { link_status: "MISSING_CR", link_message: "No CR number found on this document." };
  }
  if (parsed !== canonical) {
    return {
      link_status: "MISMATCH",
      link_message: `CR ${parsed} does not match customer CR ${canonical}.`,
    };
  }
  return { link_status: "MATCHED", link_message: `Linked on CR ${canonical}.` };
}

export function relinkCustomerDocuments(documents = [], customerCr = "") {
  const canonicalCr = canonicalCrFromDocuments(documents, customerCr);
  return (documents || []).map((row) => {
    const type = normalizeDocumentType(row?.document_type);
    const unparsed = Boolean(row?.extracted_json?.unparsed);
    const link = type === "CR" && normalizeCrNumber(row?.parsed_cr_number)
      ? { link_status: "MATCHED", link_message: `Canonical CR ${normalizeCrNumber(row.parsed_cr_number)}.` }
      : resolveDocumentLinkStatus({
        parsedCr: row?.parsed_cr_number,
        canonicalCr,
        unparsed,
      });
    return { ...row, ...link };
  });
}

export function validateDocumentDates({
  issueDate,
  expiryDate,
  todayIso = new Date().toISOString().slice(0, 10),
} = {}) {
  const today = String(todayIso || "").slice(0, 10);
  const issue = parseDocumentDate(issueDate);
  const expiry = parseDocumentDate(expiryDate);
  if (issue && expiry && expiry < issue) {
    return { ok: false, error: "Expiry date must be on or after the issue date.", issue, expiry };
  }
  if (expiry && today && expiry < today) {
    return { ok: false, error: `This document expired on ${expiry}. Upload a valid certificate.`, issue, expiry };
  }
  return { ok: true, issue, expiry };
}

export function isCreditApplicationExpired(document, todayIso = new Date().toISOString().slice(0, 10)) {
  if (!document) return true;
  const expiry = parseDocumentDate(document.expiry_date)
    || (parseDocumentDate(document.issue_date) ? addYearsToIsoDate(document.issue_date, 1) : "");
  if (!expiry) return true;
  return expiry < String(todayIso || "").slice(0, 10);
}

export function buildCustomerDocumentCompliance(documents = [], customer = {}, todayIso = new Date().toISOString().slice(0, 10)) {
  const latest = latestDocumentByType(documents);
  const linked = relinkCustomerDocuments(documents, customer?.cr_number);
  const missingCompulsory = COMPULSORY_DOCUMENT_TYPES.filter((type) => !latest.get(type));
  const mismatches = linked.filter((row) => row.link_status === "MISMATCH");
  const credit = latest.get("CREDIT_APPLICATION") || null;
  const creditPresent = Boolean(credit);
  const creditExpired = creditPresent ? isCreditApplicationExpired(credit, todayIso) : true;

  return {
    canonicalCr: canonicalCrFromDocuments(documents, customer?.cr_number),
    vatNumber: normalizeVatNumber(latest.get("VAT")?.parsed_vat_number || customer?.vat_number),
    missingCompulsory,
    mismatches,
    creditApplication: {
      present: creditPresent,
      issueDate: credit?.issue_date || "",
      expiryDate: credit?.expiry_date || (credit?.issue_date ? addYearsToIsoDate(credit.issue_date, 1) : ""),
      expired: creditExpired,
      crNumber: normalizeCrNumber(credit?.parsed_cr_number),
      creditLimit: Number(credit?.extracted_json?.creditLimit || credit?.credit_limit || 0) || 0,
    },
    latestByType: Object.fromEntries(latest.entries()),
  };
}
