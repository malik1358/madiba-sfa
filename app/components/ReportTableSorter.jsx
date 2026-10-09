"use client";

import { useEffect } from "react";
import {
  getFilterableHeaderCells,
  groupTableBodyRows,
  isSortableReportTable,
  sortTableRowGroups,
} from "../lib/tableColumnFilter";

function installSortButton(header) {
  if (header.querySelector(":scope > .moduleReportSortButton")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "moduleReportSortButton";
  button.dataset.direction = "↕";
  button.title = "Sort column";
  button.setAttribute("aria-label", `Sort by ${header.innerText || header.textContent || "column"}`);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const table = header.closest("table");
    const body = table?.querySelector(":scope > tbody");
    const headers = getFilterableHeaderCells(table);
    const columnIndex = headers.indexOf(header);
    if (!body || columnIndex < 0) return;
    const direction = header.getAttribute("aria-sort") === "ascending" ? "desc" : "asc";
    sortTableRowGroups(groupTableBodyRows(table), columnIndex, direction).forEach((group) => {
      group.rows.forEach((row) => body.appendChild(row));
    });
    headers.forEach((cell) => {
      cell.removeAttribute("aria-sort");
      const currentButton = cell.querySelector(":scope > .moduleReportSortButton");
      if (currentButton) currentButton.dataset.direction = "↕";
    });
    header.setAttribute("aria-sort", direction === "asc" ? "ascending" : "descending");
    button.dataset.direction = direction === "asc" ? "↑" : "↓";
  });
  header.appendChild(button);
}

export default function ReportTableSorter() {
  useEffect(() => {
    const sync = () => document.querySelectorAll("table.moduleTable, table.auditMatrix, table.auditCategoryMatrixV3, table.auditItemMatrix, table.auditPerformanceMatrix, table.auditQuickOrderTable, table.auditTransactionTable").forEach((table) => {
      if (!isSortableReportTable(table)) return;
      getFilterableHeaderCells(table).forEach(installSortButton);
    });
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return null;
}