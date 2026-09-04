"use client";

import { useRef } from "react";
import ExportExcelButton from "./ExportExcelButton";
import TableColumnFilters from "./TableColumnFilters";
import { rowsFromHtmlTable } from "../lib/excelExport";

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
