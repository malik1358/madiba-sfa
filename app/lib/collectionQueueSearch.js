import { extractLeadingCustomerCodeAndName } from "./outstanding.js";

export function matchesCollectionCustomerQuery(row, customerFilter) {
  const customerQuery = String(customerFilter || "").trim().toLowerCase();
  if (!customerQuery) return true;

  const fields = [
    row?.customer_code,
    row?.customer_name,
    row?.salesman_name,
    extractLeadingCustomerCodeAndName(row?.customer_code).customer_code,
    extractLeadingCustomerCodeAndName(row?.customer_name).customer_code,
    extractLeadingCustomerCodeAndName(row?.customer_name).customer_name,
    ...(row?.invoices || []).flatMap((invoice) => [
      invoice?.customer_name,
      invoice?.customer_code,
      invoice?.ref_no,
    ]),
  ];
  const haystacks = fields.map((value) => String(value || "").toLowerCase());
  if (haystacks.some((value) => value.includes(customerQuery))) return true;

  const tokens = customerQuery.split(/\s+/).filter((token) => token.length >= 2);
  if (tokens.length > 1) {
    const blob = haystacks.join(" ");
    if (tokens.every((token) => blob.includes(token))) return true;
  }

  const compactQuery = customerQuery.replace(/[^a-z0-9]/g, "");
  if (!compactQuery) return false;
  return haystacks.some((value) => value.replace(/[^a-z0-9]/g, "").includes(compactQuery));
}

export function mergeLegalMatchesIntoDueRows(dueRows, legalRows, customerFilter) {
  if (!String(customerFilter || "").trim()) return dueRows || [];

  const merged = [...(dueRows || [])];
  const seen = new Set(merged.map((row) => String(row?.queue_key || row?.customer_code || row?.customer_name || "").trim()));

  (legalRows || []).forEach((row) => {
    const key = String(row?.queue_key || row?.customer_code || row?.customer_name || "").trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(row);
  });

  return merged;
}
