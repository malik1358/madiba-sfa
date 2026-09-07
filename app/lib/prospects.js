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

export function createOfflineProspectId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function extractOfflineIdFromRemarks(remarks) {
  const match = String(remarks || "").match(/OfflineId:\s*([A-Za-z0-9]+)/i);
  return match?.[1] || "";
}

export function withOfflineIdRemarks(remarks, offlineId) {
  const id = String(offlineId || "").trim();
  if (!id) return remarks || null;
  if (extractOfflineIdFromRemarks(remarks)) return remarks || null;
  return [String(remarks || "").trim(), `OfflineId: ${id}`].filter(Boolean).join("\n");
}

export function buildOfflineProspectCustomerCode(offlineId) {
  const id = String(offlineId || "").trim();
  return id ? `PROSPECT-OFF-${id}` : "";
}

export function parseOfflineProspectIdFromCustomerCode(customerCode) {
  const match = String(customerCode || "").trim().match(/^PROSPECT-OFF-([A-Za-z0-9]+)$/i);
  return match?.[1] || "";
}

export async function findProspectByOfflineId(admin, offlineId) {
  const id = String(offlineId || "").trim();
  if (!id) return null;

  const { data: byColumn, error: columnError } = await admin
    .from("prospects")
    .select("id,salesman_code,company_name,remarks,status,follow_up_date")
    .eq("offline_id", id)
    .maybeSingle();

  if (!columnError && byColumn?.id) return byColumn;

  const { data: byRemarks } = await admin
    .from("prospects")
    .select("id,salesman_code,company_name,remarks,status,follow_up_date")
    .ilike("remarks", `%OfflineId: ${id}%`)
    .limit(5);

  return Array.isArray(byRemarks) && byRemarks.length > 0 ? byRemarks[0] : null;
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

export function buildProspectCustomerCode(prospectId) {
  const id = Number(prospectId);
  if (!Number.isFinite(id) || id <= 0) return "";
  return `PROSPECT-${id}`;
}

export function resolveProspectCustomerCode(prospect) {
  if (prospect && typeof prospect === "object") {
    const liveCode = buildProspectCustomerCode(prospect.id);
    if (liveCode) return liveCode;
    const offlineId = String(prospect.offline_id || extractOfflineIdFromRemarks(prospect.remarks) || "").trim();
    if (offlineId) return buildOfflineProspectCustomerCode(offlineId);
    return "";
  }
  return buildProspectCustomerCode(prospect);
}

export function prospectCustomerCodes(prospect) {
  const codes = [];
  const liveCode = buildProspectCustomerCode(prospect?.id);
  if (liveCode) codes.push(liveCode);
  const offlineId = String(prospect?.offline_id || extractOfflineIdFromRemarks(prospect?.remarks) || "").trim();
  const offlineCode = buildOfflineProspectCustomerCode(offlineId);
  if (offlineCode) codes.push(offlineCode);
  return [...new Set(codes.map((code) => String(code).trim().toUpperCase()).filter(Boolean))];
}

export function parseProspectIdFromCustomerCode(customerCode) {
  const match = String(customerCode || "").trim().match(/^PROSPECT-(\d+)$/i);
  if (!match) return null;

  const id = Number(match[1]);
  if (!Number.isFinite(id) || id <= 0) return null;
  return id;
}

export function formatProspectOrderLabel(order) {
  const orderNumber = String(order?.order_number || "").trim();
  if (orderNumber) return orderNumber;
  const id = Number(order?.id);
  return Number.isFinite(id) && id > 0 ? String(id) : "";
}

export function mapProspectOrderNumbers(orders) {
  const byCustomerCode = new Map();

  (orders || []).forEach((order) => {
    const code = String(order?.customer_code || "").trim().toUpperCase();
    if (!/^PROSPECT-(?:OFF-)?[A-Z0-9]+$/i.test(code)) return;

    const label = formatProspectOrderLabel(order);
    if (!label) return;

    if (!byCustomerCode.has(code)) {
      byCustomerCode.set(code, []);
    }

    byCustomerCode.get(code).push({
      id: order.id,
      order_number: label,
      status: String(order?.status || "").trim(),
      created_at: order?.created_at || "",
    });
  });

  byCustomerCode.forEach((rows) => {
    rows.sort((left, right) => new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime());
  });

  return byCustomerCode;
}

export function enrichProspectsWithOrders(prospects, orders) {
  const orderMap = mapProspectOrderNumbers(orders);

  return (prospects || []).map((prospect) => {
    const codes = prospectCustomerCodes(prospect);
    const seen = new Set();
    const prospectOrders = codes
      .flatMap((code) => orderMap.get(code) || [])
      .filter((order) => {
        const key = String(order?.id || "");
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((left, right) => new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime());
    const orderNumbers = prospectOrders.map((order) => order.order_number).filter(Boolean);

    return {
      ...prospect,
      orders: prospectOrders,
      order_numbers: orderNumbers,
      latest_order_id: prospectOrders[0]?.id || null,
      latest_order_number: prospectOrders[0]?.order_number || null,
    };
  });
}

export async function listProspectsForScope(admin, scope) {
  let query = admin
    .from("prospects")
    .select("*")
    .order("created_at", { ascending: false });

  if (!scope?.hasAllAccess) {
    const visibleCodes = (Array.isArray(scope?.visibleSalesmanCodes) ? scope.visibleSalesmanCodes : [])
      .map((code) => normalizeProspectSalesmanCode(code))
      .filter(Boolean);

    if (visibleCodes.length > 0) {
      query = query.in("salesman_code", visibleCodes);
    } else if (scope?.currentSalesmanCode) {
      query = query.eq("salesman_code", normalizeProspectSalesmanCode(scope.currentSalesmanCode));
    }
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function fetchProspectOrders(admin, prospectsOrIds) {
  const prospects = (prospectsOrIds || []).map((value) => (
    value && typeof value === "object" ? value : { id: value }
  ));
  const allowedCodes = new Set(
    prospects.flatMap((row) => prospectCustomerCodes(row)),
  );

  if (allowedCodes.size === 0) return [];

  const { data, error } = await admin
    .from("sales_orders")
    .select("id,order_number,customer_code,status,created_at")
    .like("customer_code", "PROSPECT-%")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data || []).filter((order) => (
    allowedCodes.has(String(order.customer_code || "").trim().toUpperCase())
  ));
}

export async function listProspectsWithOrdersForScope(admin, scope) {
  const prospects = await listProspectsForScope(admin, scope);
  const orders = await fetchProspectOrders(admin, prospects);
  return enrichProspectsWithOrders(prospects, orders);
}
