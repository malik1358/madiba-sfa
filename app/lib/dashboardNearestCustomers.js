function canAccessModule(access, moduleKey) {
  if (typeof access?.canAccess === "function") return Boolean(access.canAccess(moduleKey));
  return Boolean(access?.modules?.[moduleKey]);
}

function customerQuery(customer) {
  const params = new URLSearchParams();
  const code = String(customer?.customer_code || "").trim();
  const name = String(customer?.customer_name || "").trim();
  const salesman = String(customer?.current_salesman_code || customer?.salesman_code || "").trim();
  if (code) params.set("customer_code", code);
  if (name) params.set("customer_name", name);
  if (salesman) params.set("salesman_code", salesman);
  return params.toString();
}

export function buildNearestCustomerActionLinks(customer, access, labels = {}) {
  const code = String(customer?.customer_code || "").trim();
  if (!code) return [];

  const query = customerQuery(customer);
  const actions = [];

  if (canAccessModule(access, "visitWithoutOrder")) {
    actions.push({
      key: "visit",
      label: labels.visit || "Visit without order",
      href: `/management/visit-without-order?${query}`,
    });
  }

  if (canAccessModule(access, "newOrder")) {
    actions.push({
      key: "order",
      label: labels.order || "New order",
      href: `/management/new-order?${query}`,
    });
  }

  if (canAccessModule(access, "myCollections")) {
    actions.push({
      key: "collection",
      label: labels.collection || "Collection",
      href: `/management/my-collections?customer=${encodeURIComponent(code)}`,
    });
  } else if (canAccessModule(access, "paymentCollections")) {
    actions.push({
      key: "collection",
      label: labels.collection || "Collection",
      href: `/management/payment-collections?customer=${encodeURIComponent(code)}`,
    });
  }

  return actions;
}

export function buildNearestCustomerActions(customer, access, labels = {}, handlers = {}) {
  return buildNearestCustomerActionLinks(customer, access, labels).map((action) => {
    if (typeof handlers[action.key] !== "function") return action;
    return {
      key: action.key,
      label: action.label,
      onClick: () => handlers[action.key](customer),
    };
  });
}
