function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function daysSince(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const diff = Date.now() - date.getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

function statusFromThreshold(value, { red, orange }) {
  const number = Number(value || 0);
  if (number >= red) return "red";
  if (number >= orange) return "orange";
  return "green";
}

function statusFromMinimum(value, { orange, green }) {
  const number = Number(value || 0);
  if (number < orange) return "red";
  if (number < green) return "orange";
  return "green";
}

export function summarizeOutstandingRows(rows = []) {
  let totalOutstanding = 0;
  let above90 = 0;
  let customersWithDue = 0;

  rows.forEach((row) => {
    const total = Number(row.total_outstanding || 0);
    const bucketAbove90 = Number(row.outstanding_61_90 || 0)
      + Number(row.outstanding_91_120 || 0)
      + Number(row.outstanding_above_120 || 0)
      + Number(row.outstanding_above_90 || 0);

    totalOutstanding += total;
    above90 += bucketAbove90;
    if (total > 0) customersWithDue += 1;
  });

  return {
    totalOutstanding,
    above90,
    customersWithDue,
  };
}

export function buildBusinessKpis(input = {}) {
  const {
    salesToday = 0,
    salesMtd = 0,
    collectedToday = 0,
    collectedMtd = 0,
    visitReports = 0,
    collectionsCount = 0,
    ordersSubmitted = 0,
    ordersDraft = 0,
    fieldHeadcount = 0,
    loggedInCount = 0,
    idleNow = 0,
    activeNow = 0,
    pendingOrdersTotal = 0,
    pendingOrdersOlder7 = 0,
    pendingOrdersOlder30 = 0,
    outstandingTotal = 0,
    outstandingAbove90 = 0,
    routeDistanceKm = 0,
    workingHoursMinutes = 0,
  } = input;

  const attendanceRate = fieldHeadcount > 0
    ? Math.round((loggedInCount / fieldHeadcount) * 100)
    : 0;

  return [
    {
      key: "sales_today",
      label: "Sales today",
      value: salesToday,
      display: formatMoney(salesToday),
      status: salesToday > 0 ? "green" : "orange",
    },
    {
      key: "sales_mtd",
      label: "Sales MTD",
      value: salesMtd,
      display: formatMoney(salesMtd),
      status: "neutral",
    },
    {
      key: "collected_today",
      label: "Collected today",
      value: collectedToday,
      display: formatMoney(collectedToday),
      status: collectedToday > 0 ? "green" : "orange",
    },
    {
      key: "collected_mtd",
      label: "Collected MTD",
      value: collectedMtd,
      display: formatMoney(collectedMtd),
      status: "neutral",
    },
    {
      key: "visit_reports",
      label: "Visit reports",
      value: visitReports,
      display: String(visitReports),
      status: visitReports > 0 ? "green" : "orange",
    },
    {
      key: "collections_count",
      label: "Collection visits",
      value: collectionsCount,
      display: String(collectionsCount),
      status: collectionsCount > 0 ? "green" : "neutral",
    },
    {
      key: "orders_submitted",
      label: "Orders submitted",
      value: ordersSubmitted,
      display: String(ordersSubmitted),
      status: ordersSubmitted > 0 ? "green" : "neutral",
    },
    {
      key: "orders_draft",
      label: "Draft orders",
      value: ordersDraft,
      display: String(ordersDraft),
      status: statusFromThreshold(ordersDraft, { red: 20, orange: 5 }),
    },
    {
      key: "attendance_rate",
      label: "Field attendance",
      value: attendanceRate,
      display: `${attendanceRate}%`,
      status: statusFromMinimum(attendanceRate, { orange: 60, green: 80 }),
    },
    {
      key: "idle_now",
      label: "Idle now",
      value: idleNow,
      display: String(idleNow),
      status: idleNow > 0 ? "red" : "green",
    },
    {
      key: "active_now",
      label: "Active now",
      value: activeNow,
      display: String(activeNow),
      status: activeNow > 0 ? "green" : "neutral",
    },
    {
      key: "pending_orders_7d",
      label: "Pending >7 days",
      value: pendingOrdersOlder7,
      display: String(pendingOrdersOlder7),
      status: statusFromThreshold(pendingOrdersOlder7, { red: 1, orange: 0 }),
    },
    {
      key: "pending_orders_30d",
      label: "Pending >30 days",
      value: pendingOrdersOlder30,
      display: String(pendingOrdersOlder30),
      status: statusFromThreshold(pendingOrdersOlder30, { red: 1, orange: 0 }),
    },
    {
      key: "outstanding_total",
      label: "Total outstanding",
      value: outstandingTotal,
      display: formatMoney(outstandingTotal),
      status: "neutral",
    },
    {
      key: "outstanding_90plus",
      label: "Outstanding >90 days",
      value: outstandingAbove90,
      display: formatMoney(outstandingAbove90),
      status: statusFromThreshold(outstandingAbove90, { red: 500000, orange: 250000 }),
    },
    {
      key: "route_distance_km",
      label: "Route distance (km)",
      value: routeDistanceKm,
      display: Number(routeDistanceKm || 0).toFixed(1),
      status: "neutral",
    },
    {
      key: "working_hours",
      label: "Working hours",
      value: workingHoursMinutes,
      display: `${Math.floor(Number(workingHoursMinutes || 0) / 60)}h ${Number(workingHoursMinutes || 0) % 60}m`,
      status: "neutral",
    },
  ];
}

export function buildBusinessAlerts(input = {}) {
  const {
    reportDate,
    isToday = false,
    notLoggedInUsers = [],
    idleUsers = [],
    pendingOrdersOlder7 = 0,
    pendingOrdersOlder30 = 0,
    outstandingStaleDays = null,
    outstandingUploadedAt = "",
    collectorsActive = 0,
    collectedToday = 0,
    collectionVisitsToday = 0,
    attendanceRate = 0,
    fieldHeadcount = 0,
    salesImportStaleDays = null,
    draftOrders = 0,
    outstandingAbove90 = 0,
  } = input;

  const alerts = [];

  if (isToday && notLoggedInUsers.length > 0) {
    alerts.push({
      severity: "red",
      code: "NOT_LOGGED_IN",
      title: "Field users not logged in",
      detail: `${notLoggedInUsers.length} of ${fieldHeadcount} field users have no morning attendance today.`,
      count: notLoggedInUsers.length,
      names: notLoggedInUsers.slice(0, 8),
      actionHref: `/management/user-activity?date=${reportDate}`,
      actionLabel: "Open user activity",
    });
  }

  if (isToday && idleUsers.length > 0) {
    alerts.push({
      severity: "red",
      code: "IDLE_USERS",
      title: "Idle field users (45+ min)",
      detail: `${idleUsers.length} logged-in users have no visit, order, or collection in the last 45 minutes.`,
      count: idleUsers.length,
      names: idleUsers.slice(0, 8),
      actionHref: `/management/user-activity?date=${reportDate}`,
      actionLabel: "Review idle users",
    });
  }

  if (pendingOrdersOlder30 > 0) {
    alerts.push({
      severity: "red",
      code: "PENDING_30D",
      title: "Very old pending orders",
      detail: `${pendingOrdersOlder30} pending order(s) are older than 30 days and need invoicing action.`,
      count: pendingOrdersOlder30,
      actionHref: "/management/pending-orders",
      actionLabel: "Open pending orders",
    });
  } else if (pendingOrdersOlder7 > 0) {
    alerts.push({
      severity: "orange",
      code: "PENDING_7D",
      title: "Aging pending orders",
      detail: `${pendingOrdersOlder7} pending order(s) are older than 7 days.`,
      count: pendingOrdersOlder7,
      actionHref: "/management/pending-orders",
      actionLabel: "Open pending orders",
    });
  }

  if (outstandingStaleDays !== null && outstandingStaleDays > 3) {
    alerts.push({
      severity: outstandingStaleDays > 7 ? "red" : "orange",
      code: "OUTSTANDING_STALE",
      title: "Outstanding file is stale",
      detail: outstandingUploadedAt
        ? `Last outstanding upload was ${outstandingStaleDays} day(s) ago (${outstandingUploadedAt.slice(0, 10)}).`
        : "Outstanding file has not been uploaded yet.",
      count: outstandingStaleDays,
      actionHref: "/management/upload",
      actionLabel: "Upload outstanding",
    });
  }

  if (salesImportStaleDays !== null && salesImportStaleDays > 7) {
    alerts.push({
      severity: "orange",
      code: "SALES_IMPORT_STALE",
      title: "Sales import may be stale",
      detail: `Latest ERP sales import is ${salesImportStaleDays} day(s) old. KPI sales numbers may be outdated.`,
      count: salesImportStaleDays,
      actionHref: "/management/upload",
      actionLabel: "Check imports",
    });
  }

  if (isToday && collectorsActive > 0 && collectionVisitsToday === 0) {
    alerts.push({
      severity: "orange",
      code: "NO_COLLECTION_VISITS",
      title: "No collection visits today",
      detail: `${collectorsActive} collector(s) are active but no collection visit has been saved today.`,
      count: collectorsActive,
      actionHref: "/management/collection-report",
      actionLabel: "Open collection report",
    });
  }

  if (isToday && collectorsActive > 0 && collectionVisitsToday > 0 && collectedToday <= 0) {
    alerts.push({
      severity: "orange",
      code: "ZERO_COLLECTION",
      title: "No funds collected today",
      detail: `${collectionVisitsToday} collection visit(s) logged but amount received is zero.`,
      count: collectionVisitsToday,
      actionHref: "/management/collection-report",
      actionLabel: "Review collections",
    });
  }

  if (isToday && fieldHeadcount > 0 && attendanceRate < 80) {
    alerts.push({
      severity: attendanceRate < 60 ? "red" : "orange",
      code: "LOW_ATTENDANCE",
      title: "Low field attendance",
      detail: `Only ${attendanceRate}% of field users logged in today (${fieldHeadcount - notLoggedInUsers.length}/${fieldHeadcount}).`,
      count: notLoggedInUsers.length,
      actionHref: `/management/user-activity?date=${reportDate}`,
      actionLabel: "Check attendance",
    });
  }

  if (draftOrders >= 10) {
    alerts.push({
      severity: "orange",
      code: "DRAFT_BACKLOG",
      title: "Draft order backlog",
      detail: `${draftOrders} draft orders are waiting to be submitted.`,
      count: draftOrders,
      actionHref: "/management/pending-orders",
      actionLabel: "Review orders",
    });
  }

  if (outstandingAbove90 >= 500000) {
    alerts.push({
      severity: "red",
      code: "HIGH_OVERDUE",
      title: "High overdue exposure",
      detail: `Outstanding above 90 days is SAR ${formatMoney(outstandingAbove90)}. Prioritize collection follow-up.`,
      count: 1,
      actionHref: "/management/payment-collections",
      actionLabel: "Open collections",
    });
  }

  const rank = { red: 0, orange: 1, green: 2 };
  return alerts.sort((left, right) => (rank[left.severity] ?? 9) - (rank[right.severity] ?? 9));
}

export function daysSinceIso(value) {
  return daysSince(value);
}
