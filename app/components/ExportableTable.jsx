"use client";

import { useLayoutEffect, useRef } from "react";
import ExportExcelButton from "./ExportExcelButton";
import TableColumnFilters from "./TableColumnFilters";
import TableColumnVisibility from "./TableColumnVisibility";
import { rowsFromHtmlTable } from "../lib/excelExport";
import { syncStackedHeaderSticky } from "../lib/tableColumnFilter";
import { normalizeTableId } from "../lib/tableColumnVisibility";

export default function ExportableTable({
  filename,
  tableId,
  sheetName = "Sheet1",
  className = "",
  style,
  disabled = false,
  enableColumnFilters = true,
  enableColumnVisibility = true,
  onError,
  children,
}) {
  const tableHostRef = useRef(null);
  const resolvedTableId = normalizeTableId(tableId || filename);

  useLayoutEffect(() => {
    const host = tableHostRef.current;
    if (!host) return undefined;

    const sync = () => {
      syncStackedHeaderSticky(host.querySelector("table"));
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(host, { childList: true, subtree: true });
    const header = host.querySelector("table thead");
    const firstRow = host.querySelector("table thead tr");
    const resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(sync)
      : null;
    if (header) resizeObserver?.observe(header);
    if (firstRow) resizeObserver?.observe(firstRow);

    return () => {
      observer.disconnect();
      resizeObserver?.disconnect();
    };
  }, [children]);

  return (
    <div className="moduleExportableTable">
      <div className="moduleExportableTableBar">
        <TableColumnFilters tableHostRef={tableHostRef} enabled={enableColumnFilters} />
        <TableColumnVisibility
          tableHostRef={tableHostRef}
          tableId={resolvedTableId}
          enabled={enableColumnVisibility && Boolean(resolvedTableId)}
        />
        <ExportExcelButton
          filename={filename}
          sheetName={sheetName}
          disabled={disabled}
          onError={onError}
          getRows={() => {
            const table = tableHostRef.current?.querySelector("table");
            return [{ name: sheetName, rows: rowsFromHtmlTable(table) }];
          }}
        />
      </div>
      <div ref={tableHostRef} className={className} style={style}>
        {children}
      </div>
    </div>
  );
}
