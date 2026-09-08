const KSA_TIMEZONE = "Asia/Riyadh";

export const HISTORIC_PERFORMANCE_MONTHS = 6;

export function ksaMonthKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: KSA_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now).slice(0, 7);
}

export function nextMonthStart(monthKey) {
  const match = String(monthKey || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const next = month === 12
    ? { year: year + 1, month: 1 }
    : { year, month: month + 1 };
  return `${String(next.year).padStart(4, "0")}-${String(next.month).padStart(2, "0")}-01`;
}

export function selectMonthlyPerformanceMonths(allMonths, currentKey = ksaMonthKey()) {
  const current = String(currentKey || "").slice(0, 7);
  const unique = [];
  const seen = new Set();

  (Array.isArray(allMonths) ? allMonths : []).forEach((month) => {
    const key = String(month || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(key) || seen.has(key)) return;
    seen.add(key);
    unique.push(key);
  });

  unique.sort();
  const historic = unique.filter((month) => month < current);
  const currentMonths = current && unique.includes(current) ? [current] : [];
  return [...historic.slice(-HISTORIC_PERFORMANCE_MONTHS), ...currentMonths];
}
