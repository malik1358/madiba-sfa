/**
 * Order ownership: salesman on a sales order is the person making the order
 * (logged-in profile), not the customer's master current_salesman_code.
 */

function trimText(value) {
  return String(value || "").trim();
}

export function resolveOrderMakerFromProfile(profile = {}) {
  const salesmanCode = trimText(profile?.salesman_code);
  const salesmanName = trimText(profile?.salesman_name) || salesmanCode;
  return { salesmanCode, salesmanName };
}

export function resolveOrderMakerFromScope(accessScope = null) {
  const currentUserId = trimText(accessScope?.currentUserId);
  const currentCode = trimText(accessScope?.currentSalesmanCode);
  const members = Array.isArray(accessScope?.visibleMembers) ? accessScope.visibleMembers : [];
  const byId = currentUserId
    ? members.find((member) => trimText(member?.id) === currentUserId)
    : null;
  const byCode = !byId && currentCode
    ? members.find((member) => trimText(member?.salesman_code).toUpperCase() === currentCode.toUpperCase())
    : null;
  const member = byId || byCode || null;
  const salesmanCode = currentCode || trimText(member?.salesman_code);
  const salesmanName = trimText(member?.salesman_name) || salesmanCode;
  return { salesmanCode, salesmanName };
}

export function formatOrderSalesmanLabel(orderOrSnapshot = {}) {
  const name = trimText(
    orderOrSnapshot?.salesmanName
    || orderOrSnapshot?.salesman_name
  );
  const code = trimText(
    orderOrSnapshot?.salesmanCode
    || orderOrSnapshot?.salesman_code
  );
  return name || code || "-";
}
