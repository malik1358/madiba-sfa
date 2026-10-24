function sumStatementField(rows, key) {
  return rows.reduce((total, row) => total + Number(row[key] || 0), 0);
}

function roundHalalas(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  const rounded = Math.round(number * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

/** Day difference to show. A total that rounds to zero, including −0, is omitted. */
export function statementDayDifference(value) {
  const rounded = roundHalalas(value);
  return rounded === 0 ? null : rounded;
}

/** Date rows whose differences add up to zero are left out of the statement table. */
export function statementDatesWithDifference(groups) {
  return (Array.isArray(groups) ? groups : []).filter((group) => statementDayDifference(group.difference) != null);
}

export function groupStatementRowsByDate(rows) {
  const groups = [];
  const byDate = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const date = row?.date || "";
    let group = byDate.get(date);
    if (!group) {
      group = { date, rows: [] };
      byDate.set(date, group);
      groups.push(group);
    }
    group.rows.push(row);
  });
  return groups.map((group) => ({
    date: group.date,
    rows: group.rows,
    tallyDebit: sumStatementField(group.rows, "tallyDebit"),
    tallyCredit: sumStatementField(group.rows, "tallyCredit"),
    sfaDebit: sumStatementField(group.rows, "sfaDebit"),
    sfaCredit: sumStatementField(group.rows, "sfaCredit"),
    difference: roundHalalas(sumStatementField(group.rows, "difference")),
    issueCount: group.rows.filter((row) => row.status !== "matched").length,
    leadsGap: group.rows.some((row) => row.leadsGap),
  }));
}
