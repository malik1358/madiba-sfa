export function buildLast12Months(latestDate) {
  if (!latestDate) return [];

  const d = new Date(`${latestDate}T00:00:00`);
  const result = [];

  for (let i = 11; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);

    result.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`);
  }

  return result;
}
