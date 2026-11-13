"use client";

import ExportableTable from "./ExportableTable";

/**
 * Thin wrapper so BI / BiExcelHead grids share ExportableTable's column filters,
 * Excel export, and per-user column visibility under a stable tableId.
 */
export default function BiExcelTableShell({
  tableId,
  filename,
  sheetName = "Sheet1",
  className = "moduleTableWrap moduleBiTableWrap",
  style,
  disabled = false,
  enableColumnFilters = true,
  enableColumnVisibility = true,
  onError,
  children,
}) {
  const resolvedId = tableId || filename;
  return (
    <ExportableTable
      tableId={resolvedId}
      filename={filename || resolvedId}
      sheetName={sheetName}
      className={className}
      style={style}
      disabled={disabled}
      enableColumnFilters={enableColumnFilters}
      enableColumnVisibility={enableColumnVisibility}
      onError={onError}
    >
      {children}
    </ExportableTable>
  );
}
