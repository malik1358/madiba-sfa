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

export function buildProspectCustomerCode(prospectId) {
  const id = Number(prospectId);
  if (!Number.isFinite(id) || id <= 0) return "";
  return `PROSPECT-${id}`;
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
    if (!/^PROSPECT-\d+$/i.test(code)) return;

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
    const code = buildProspectCustomerCode(prospect.id);
    const prospectOrders = orderMap.get(code) || [];
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

export async function fetchProspectOrders(admin, prospectIds) {
  const allowedIds = new Set(
    (prospectIds || [])
      .map((prospectId) => Number(prospectId))
      .filter((id) => Number.isFinite(id) && id > 0),
  );

  if (allowedIds.size === 0) return [];

  const { data, error } = await admin
    .from("sales_orders")
    .select("id,order_number,customer_code,status,created_at")
    .like("customer_code", "PROSPECT-%")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data || []).filter((order) => {
    const match = String(order.customer_code || "").trim().match(/^PROSPECT-(\d+)$/i);
    if (!match) return false;
    return allowedIds.has(Number(match[1]));
  });
}

export async function listProspectsWithOrdersForScope(admin, scope) {
  const prospects = await listProspectsForScope(admin, scope);
  const orders = await fetchProspectOrders(admin, prospects.map((row) => row.id));
  return enrichProspectsWithOrders(prospects, orders);
}
