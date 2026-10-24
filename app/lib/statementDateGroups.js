function sumStatementField(rows, key) {
  return rows.reduce((total, row) => total + Number(row[key] || 0), 0);
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
    difference: sumStatementField(group.rows, "difference"),
    issueCount: group.rows.filter((row) => row.status !== "matched").length,
    leadsGap: group.rows.some((row) => row.leadsGap),
  }));
}
