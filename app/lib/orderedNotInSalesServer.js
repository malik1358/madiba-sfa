import {
  buildOrderedNotInSalesReport,
  normalizeOrderedItemCode,
  resolveOrderedNotInSalesWindow,
} from "./orderedNotInSales.js";

const PAGE_SIZE = 1000;
const CODE_CHUNK = 200;
const LINE_CHUNK = 200;

const ORDERS_SELECT = "id,submitted_at,created_at,status";
const LINES_SELECT = "order_id,item_code,item_name,category,quantity,rate,line_value";

function chunkList(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function fetchPagedRows(admin, table, select, applyFilters) {
  const rows = [];
  let from = 0;
  while (true) {
    let query = admin.from(table).select(select).range(from, from + PAGE_SIZE - 1);
    query = applyFilters(query);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

async function loadSubmittedOrdersInWindow(admin, window) {
  return fetchPagedRows(
    admin,
    "sales_orders",
    ORDERS_SELECT,
    (query) => query
      .eq("status", "SUBMITTED")
      .gte("submitted_at", window.startIso)
      .lte("submitted_at", window.endIso)
      .order("submitted_at", { ascending: true }),
  );
}

async function loadOrderLines(admin, orders = []) {
  const orderById = new Map(
    (orders || [])
      .map((order) => [String(order?.id || "").trim(), order])
      .filter(([id]) => id),
  );
  const orderIds = [...orderById.keys()].map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
  const lines = [];

  for (const chunk of chunkList(orderIds, LINE_CHUNK)) {
    const page = await fetchPagedRows(
      admin,
      "sales_order_items",
      LINES_SELECT,
      (query) => query.in("order_id", chunk),
    );
    page.forEach((line) => {
      const order = orderById.get(String(line.order_id || "").trim());
      lines.push({
        ...line,
        submitted_at: order?.submitted_at || "",
        created_at: order?.created_at || "",
      });
    });
  }

  return lines;
}

async function loadSoldItemCodes(admin, window, itemCodes = []) {
  const codes = new Set();
  (itemCodes || []).forEach((value) => {
    const raw = String(value || "").trim();
    if (!raw) return;
    codes.add(raw);
    codes.add(raw.toUpperCase());
  });
  const sold = new Set();
  if (!codes.size) return sold;

  for (const chunk of chunkList([...codes], CODE_CHUNK)) {
    const rows = await fetchPagedRows(
      admin,
      "active_sales",
      "item_code",
      (query) => query
        .in("item_code", chunk)
        .gte("transaction_date", window.fromDate)
        .lte("transaction_date", window.toDate),
    );
    rows.forEach((row) => {
      const code = normalizeOrderedItemCode(row?.item_code);
      if (code) sold.add(code);
    });
  }

  return sold;
}

export async function loadOrderedNotInSalesReport(admin, options = {}) {
  const window = resolveOrderedNotInSalesWindow(options);
  const orders = await loadSubmittedOrdersInWindow(admin, window);
  const orderLines = await loadOrderLines(admin, orders);
  const orderedCodes = orderLines.map((line) => line.item_code);
  const soldItemCodes = await loadSoldItemCodes(admin, window, orderedCodes);
  return buildOrderedNotInSalesReport({
    orderLines,
    soldItemCodes,
    window: {
      fromDate: window.fromDate,
      toDate: window.toDate,
      days: window.days,
    },
  });
}
