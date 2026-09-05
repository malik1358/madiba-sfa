"use client";

import { useLayoutEffect, useRef } from "react";
import ExportExcelButton from "./ExportExcelButton";
import TableColumnFilters from "./TableColumnFilters";
import { rowsFromHtmlTable } from "../lib/excelExport";
import { syncStackedHeaderSticky } from "../lib/tableColumnFilter";

export default function ExportableTable({
  filename,
  sheetName = "Sheet1",
  className = "",
  style,
  disabled = false,
  enableColumnFilters = true,
  onError,
  children,
}) {
  const tableHostRef = useRef(null);

  useLayoutEffect(() => {
    const host = tableHostRef.current;
    if (!host) return undefined;

    const sync = () => {
      syncStackedHeaderSticky(host.querySelector("table"));
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(host, { childList: true, subtree: true });
    const firstRow = host.querySelector("table thead tr");
    const resizeObserver = firstRow && typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(sync)
      : null;
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
