export function normalizeProspectSalesmanCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

export function extractMissingProspectsColumn(errorMessage) {
  const text = String(errorMessage || "");
  const postgresStyle = text.match(/column\s+(?:\w+\.)?"?(\w+)"?\s+of\s+relation\s+"?prospects"?\s+does\s+not\s+exist/i);
  if (postgresStyle?.[1]) return postgresStyle[1];

  const genericPostgresStyle = text.match(/column\s+(?:\w+\.)?"?(\w+)"?\s+does\s+not\s+exist/i);
  if (genericPostgresStyle?.[1]) return genericPostgresStyle[1];

  const schemaCacheStyle = text.match(/Could not find the ['"](\w+)['"] column of ['"]prospects['"] in the schema cache/i);
  return schemaCacheStyle?.[1] || "";
}

export async function insertProspectWithColumnFallback(admin, payload) {
  const workingPayload = { ...payload };
  const removedColumns = [];
  const maxAttempts = Object.keys(workingPayload).length + 2;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { data, error } = await admin
      .from("prospects")
      .insert(workingPayload)
      .select("id,salesman_code,company_name,created_at,status,follow_up_date")
      .single();

    if (!error) {
      return { data, removedColumns };
    }

    const missingColumn = extractMissingProspectsColumn(error.message);
    if (!missingColumn || !Object.prototype.hasOwnProperty.call(workingPayload, missingColumn)) {
      throw error;
    }

    removedColumns.push(missingColumn);
    delete workingPayload[missingColumn];
  }

  throw new Error("Unable to save prospect because table columns do not match the app form.");
}

export function canAccessProspectSalesmanCode(scope, salesmanCode) {
  if (!scope) return false;
  if (scope.hasAllAccess) return true;

  const target = normalizeProspectSalesmanCode(salesmanCode);
  if (!target) return false;

  const allowed = new Set(
    (Array.isArray(scope.visibleSalesmanCodes) ? scope.visibleSalesmanCodes : [])
      .map((code) => normalizeProspectSalesmanCode(code))
      .filter(Boolean)
  );

  if (allowed.has(target)) return true;

  return normalizeProspectSalesmanCode(scope.currentSalesmanCode) === target;
}
