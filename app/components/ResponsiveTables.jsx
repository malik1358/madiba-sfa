"use client";

import { useEffect } from "react";

// Tables render as stacked cards on phones, which needs each cell to carry its column name.
const CARD_COLUMN_THRESHOLD = 4;

function headerLabels(table) {
  const headRow = table.tHead?.rows?.[0];
  if (!headRow) return [];
  return Array.from(headRow.cells).map((cell) => cell.textContent.trim());
}

function labelTable(table) {
  const labels = headerLabels(table);
  if (labels.length === 0) return;

  table.classList.toggle("moduleCardTable", labels.length > CARD_COLUMN_THRESHOLD);

  Array.from(table.tBodies).forEach((body) => {
    if (body.parentElement !== table) return;

    Array.from(body.rows).forEach((row) => {
      if (row.parentElement !== body) return;

      const cells = Array.from(row.cells).filter((cell) => cell.parentElement === row);
      // Expanded detail rows span the whole table and have no matching column.
      if (cells.length === 1 && cells[0].colSpan > 1) {
        cells[0].classList.add("moduleCardTableDetailCell");
        return;
      }

      cells.forEach((cell, index) => {
        const label = labels[index];
        if (label && cell.getAttribute("data-label") !== label) {
          cell.setAttribute("data-label", label);
        }
      });
    });
  });
}

function labelAll() {
  document.querySelectorAll("table.moduleTable").forEach(labelTable);
}

export default function ResponsiveTables() {
  useEffect(() => {
    labelAll();

    let frame = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(labelAll);
    });

    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return null;
}
