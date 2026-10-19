export function numberFormat(value) {
  return Number(value || 0).toLocaleString('en-SA', {
    maximumFractionDigits: 0,
  });
}

export function qtyFormat(value) {
  return Number(value || 0).toLocaleString('en-SA', {
    maximumFractionDigits: 0,
  });
}

export function shortDate(value) {
  if (!value) return '-';

  const d = new Date(`${value}T00:00:00`);

  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function parseDateValue(value) {
  if (!value) return null;

  const text = String(value).trim();
  if (!text) return null;

  // Fast path for ISO-like YYYY-MM-DD values.
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const isoDate = new Date(`${text.slice(0, 10)}T00:00:00Z`);
    return Number.isNaN(isoDate.getTime()) ? null : isoDate;
  }

  // Handles formats like 30/04/2025 or 30-04-2025.
  const dmyMatch = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (dmyMatch) {
    const day = Number(dmyMatch[1]);
    const month = Number(dmyMatch[2]);
    const year = Number(dmyMatch[3]);
    const utc = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isNaN(utc.getTime())) return utc;
  }

  // Handles formats like "Wednesday, April 30, 2025".
  const longMonthMatch = text.match(/(?:^|,\s*)([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (longMonthMatch) {
    const candidate = new Date(`${longMonthMatch[1]} ${longMonthMatch[2]}, ${longMonthMatch[3]} UTC`);
    if (!Number.isNaN(candidate.getTime())) return candidate;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function monthKey(date) {
  const parsed = parseDateValue(date);
  if (!parsed) return null;

  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function monthName(key) {
  if (!key) return '';

  const [year, month] = key.split('-');

  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('en-GB', {
    month: 'short',
  });
}

export function salesUnitQty(row) {
  const quantity = Number(row?.quantity);
  if (Number.isFinite(quantity) && quantity !== 0) return quantity;

  const salesAmount = Number(row?.sales_amount || 0);
  const rate = Number(row?.rate || 0);

  if (!rate) return 0;

  return salesAmount / rate;
}

export function buildLast12Months(latestDate) {
  const d = parseDateValue(latestDate);
  if (!d) return [];
  const result = [];

  for (let i = 11; i >= 0; i -= 1) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    result.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`);
  }

  return result;
}

export function trendClass(current, previous, hasPrevious = true) {
  if (!hasPrevious) return '';

  const currentValue = Number(current || 0);
  const previousValue = Number(previous || 0);

  if (currentValue > previousValue) return 'auditTrendUp';
  if (currentValue < previousValue) return 'auditTrendDown';

  return 'auditTrendSame';
}
