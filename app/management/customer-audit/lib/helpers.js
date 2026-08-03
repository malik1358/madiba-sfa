export function numberFormat(value) {
  return Number(value || 0).toLocaleString("en-SA", {
    maximumFractionDigits: 0,
  });
}

export function qtyFormat(value) {
  return Number(value || 0).toLocaleString("en-SA", {
    maximumFractionDigits: 2,
  });
}

export function shortDate(value) {
  if (!value) return "-";

  const d = new Date(`${value}T00:00:00`);

  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function monthKey(date) {
  if (!date) return null;
  return String(date).slice(0, 7);
}

export function monthName(key) {
  if (!key) return "";

  const [year, month] = key.split("-");

  return new Date(
    Number(year),
    Number(month) - 1,
    1
  ).toLocaleDateString("en-GB", {
    month: "short",
  });
}

export function salesUnitQty(row) {
  const salesAmount = Number(row?.sales_amount || 0);
  const rate = Number(row?.rate || 0);

  if (!rate) return 0;

  return salesAmount / rate;
}

export function buildLast12Months(latestDate) {
  if (!latestDate) return [];

  const d = new Date(`${latestDate}T00:00:00`);

  const result = [];

  for (let i = 11; i >= 0; i--) {
    const x = new Date(
      d.getFullYear(),
      d.getMonth() - i,
      1
    );

    result.push(
      `${x.getFullYear()}-${String(
        x.getMonth() + 1
      ).padStart(2, "0")}`
    );
  }

  return result;
}

export function trendClass(
  current,
  previous,
  hasPrevious = true
) {
  if (!hasPrevious) return "";

  const c = Number(current || 0);
  const p = Number(previous || 0);

  if (c > p) return "auditTrendUp";
  if (c < p) return "auditTrendDown";

  return "auditTrendSame";
}

export function normalizeCode(code) {
  return String(code || "")
    .trim()
    .toUpperCase();
}

export function getPrice(priceList, itemCode) {
  return Number(
    priceList[
      normalizeCode(itemCode)
    ] || 0
  );
}

export function lineTotal(
  priceList,
  itemCode,
  qty
) {
  return (
    getPrice(priceList, itemCode) *
    Number(qty || 0)
  );
}

export function grandTotal(
  orderItems,
  priceList
) {
  return orderItems.reduce(
    (sum, item) =>
      sum +
      lineTotal(
        priceList,
        item.item_code,
        item.order_quantity
      ),
    0
  );
}

export function isDoNotUseItem(name) {
  return /do\s*not\s*use+/i.test(
    String(name || "")
      .trim()
      .toLowerCase()
  );
}
