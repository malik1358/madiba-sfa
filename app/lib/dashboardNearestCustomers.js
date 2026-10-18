function canAccessModule(access, moduleKey) {
  if (typeof access?.canAccess === "function") return Boolean(access.canAccess(moduleKey));
  return Boolean(access?.modules?.[moduleKey]);
}

export function customerQuery(customer) {
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

  if (canAccessModule(access, "paymentCollections") || canAccessModule(access, "myCollections")) {
    const collectionHref = canAccessModule(access, "paymentCollections")
      ? `/management/payment-collections?customer=${encodeURIComponent(code)}`
      : `/management/my-collections?customer=${encodeURIComponent(code)}`;
    actions.push({
      key: "collection",
      label: labels.collection || "Collection",
      href: collectionHref,
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

/** Prefer click handlers over Link soft-nav for field phones (Capacitor / Safari). */
export function buildNearestCustomerNavigateHandlers(router, access = {}) {
  if (!router || typeof router.push !== "function") return {};
  const preferPaymentCollections = canAccessModule(access, "paymentCollections");
  return {
    visit: (customer) => {
      const query = customerQuery(customer);
      if (!query) return;
      router.push(`/management/visit-without-order?${query}`);
    },
    order: (customer) => {
      const query = customerQuery(customer);
      if (!query) return;
      router.push(`/management/new-order?${query}`);
    },
    collection: (customer) => {
      const code = String(customer?.customer_code || "").trim();
      if (!code) return;
      const href = preferPaymentCollections || !canAccessModule(access, "myCollections")
        ? `/management/payment-collections?customer=${encodeURIComponent(code)}`
        : `/management/my-collections?customer=${encodeURIComponent(code)}`;
      router.push(href);
    },
  };
}
