export function excelFileStamp(date = new Date()) {
  return date.toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

export function normalizeExcelFilename(filename, stamp = excelFileStamp()) {
  const raw = String(filename || "export").trim() || "export";
  const base = raw.replace(/\.xlsx$/i, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "export";
  return `${base}-${stamp}.xlsx`;
}

export function uniqueExcelHeader(header, used) {
  const base = String(header || "").trim() || "Column";
  let next = base;
  let suffix = 2;
  while (used.has(next)) {
    next = `${base} ${suffix}`;
    suffix += 1;
  }
  used.add(next);
  return next;
}

export function rowsFromTableMatrix(headers, bodyRows) {
  const used = new Set();
  const columns = (headers || []).map((header) => uniqueExcelHeader(header, used));

  return (bodyRows || [])
    .filter((cells) => Array.isArray(cells) && cells.length > 0)
    .filter((cells) => !(cells.length === 1 && String(cells[0] || "").trim() === ""))
    .map((cells) => {
      const row = {};
      columns.forEach((column, index) => {
        row[column] = cells[index] ?? "";
      });
      return row;
    });
}

export function cellTextFromNode(node) {
  return String(node?.innerText || node?.textContent || "").replace(/\s+/g, " ").trim();
}

export function rowsFromHtmlTable(table) {
  if (!table) return [];

  const headerRows = [...table.querySelectorAll(":scope > thead > tr")];
  const lastHeaderRow = headerRows[headerRows.length - 1];
  const lastHeaderCells = [...(lastHeaderRow?.querySelectorAll(":scope > th, :scope > td") || [])];
  const leadingHeaders = headerRows.length > 1
    ? [...headerRows[0].querySelectorAll(":scope > th, :scope > td")]
      .filter((cell) => Number(cell.rowSpan || 1) > 1)
      .map((cell) => cell.dataset?.columnFilterLabel || cellTextFromNode(cell))
    : [];
  const headers = [
    ...leadingHeaders,
    ...lastHeaderCells.map((cell, index) => cell.dataset?.columnFilterLabel || cellTextFromNode(cell) || `Column ${index + 1}`),
  ];
  const bodyRows = [...table.querySelectorAll(":scope > tbody > tr")].map((row) => {
    if (row.hidden || row.classList?.contains?.("moduleTableRowFilteredOut")) return null;
    const cells = [...row.querySelectorAll(":scope > th, :scope > td")];
    if (cells.length === 1 && Number(cells[0].colSpan || 1) > 1) return null;
    return cells.map((cell) => cellTextFromNode(cell));
  }).filter(Boolean);

  return rowsFromTableMatrix(headers, bodyRows);
}

export async function downloadExcelWorkbook(sheets, filename) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  const entries = Array.isArray(sheets) ? sheets : [{ name: "Sheet1", rows: sheets }];
  let added = 0;

  entries.forEach((sheet, index) => {
    const rows = Array.isArray(sheet?.rows) ? sheet.rows : [];
    if (rows.length === 0) return;
    const name = String(sheet?.name || `Sheet${index + 1}`).slice(0, 31) || `Sheet${index + 1}`;
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), name);
    added += 1;
  });

  if (added === 0) {
    throw new Error("No table rows to export.");
  }

  XLSX.writeFile(workbook, normalizeExcelFilename(filename));
}

export async function downloadExcelFromHtmlTable(table, filename, sheetName = "Sheet1") {
  return downloadExcelWorkbook([{ name: sheetName, rows: rowsFromHtmlTable(table) }], filename);
}
