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

  const d = new Date(Number(year), Number(month) - 1, 1);

  return d.toLocaleDateString("en-GB", {
    month: "short",
  });
}
