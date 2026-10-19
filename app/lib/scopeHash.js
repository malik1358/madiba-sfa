export function buildScopeHash(scope) {
  if (scope?.hasAllAccess) return "all";
  const codes = [...(scope?.visibleSalesmanCodes || [])]
    .map((code) => String(code || "").trim().toUpperCase())
    .filter(Boolean)
    .sort();
  return codes.join("|") || "none";
}

export function buildSnapshotKey(collectionScope, customerScope) {
  return `${buildScopeHash(collectionScope)}::${buildScopeHash(customerScope)}`;
}
