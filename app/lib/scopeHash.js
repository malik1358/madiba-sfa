export function buildScopeHash(scope) {
  if (scope?.hasAllAccess) return "all";
  const codes = [...(scope?.visibleSalesmanCodes || [])]
    .map((code) => String(code || "").trim().toUpperCase())
    .filter(Boolean)
    .sort();
  const shared = [...(scope?.sharedCustomerCodes || [])]
    .map((code) => String(code || "").trim().toUpperCase().replace(/\s+/g, " "))
    .filter(Boolean)
    .sort();
  const salesmanPart = codes.join("|") || "none";
  if (!shared.length) return salesmanPart;
  return `${salesmanPart}#share:${shared.join(",")}`;
}

export function buildSnapshotKey(collectionScope, customerScope) {
  return `${buildScopeHash(collectionScope)}::${buildScopeHash(customerScope)}`;
}
