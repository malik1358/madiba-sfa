"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import useTableColumnPrefs from "../hooks/useTableColumnPrefs";
import { translate, useAppLanguage } from "../lib/appLanguage";
import {
  applyColumnVisibilityToTable,
  canHideLabel,
  discoverTableColumnLabels,
} from "../lib/tableColumnVisibility";

const TEXT = {
  columns: { en: "Columns", ar: "الأعمدة" },
  hidden: { en: "Hidden", ar: "مخفي" },
  showAll: { en: "Show all", ar: "إظهار الكل" },
  keepOne: { en: "Keep at least one column visible.", ar: "أبقِ عموداً واحداً ظاهراً على الأقل." },
};

export default function TableColumnVisibility({
  tableHostRef,
  tableId,
  enabled = true,
}) {
  const { language } = useAppLanguage();
  const t = translate(language, TEXT);
  const { hiddenLabels, toggle, show, reset, ready } = useTableColumnPrefs(enabled ? tableId : "");
  const [labels, setLabels] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef(null);

  useLayoutEffect(() => {
    if (!enabled) return undefined;
    const host = tableHostRef?.current;
    if (!host) return undefined;

    const syncLabels = () => {
      const table = host.querySelector("table");
      const next = discoverTableColumnLabels(table);
      setLabels((current) => {
        if (current.length === next.length && current.every((label, index) => label === next[index])) {
          return current;
        }
        return next;
      });
    };

    syncLabels();
    const observer = new MutationObserver(syncLabels);
    observer.observe(host, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [enabled, tableHostRef]);

  useLayoutEffect(() => {
    if (!enabled || !ready) return;
    const table = tableHostRef?.current?.querySelector("table");
    if (!table) return;
    applyColumnVisibilityToTable(table, hiddenLabels);
  }, [enabled, ready, hiddenLabels, labels, tableHostRef]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  if (!enabled || !tableId || labels.length === 0) return null;

  const hiddenSet = new Set(hiddenLabels);

  return (
    <div className="moduleTableColumnVisibility" ref={rootRef}>
      <div className="moduleTableColumnVisibilityControls">
        <div className="moduleTableColumnVisibilityMenu">
          <button
            type="button"
            className="moduleButton moduleButtonSecondary moduleTableColumnVisibilityButton"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {t("columns")}
          </button>
          {menuOpen ? (
            <div className="moduleTableColumnVisibilityDropdown" role="menu">
              {labels.map((label) => {
                const checked = !hiddenSet.has(label);
                const disableHide = checked && !canHideLabel(labels, hiddenLabels, label);
                return (
                  <label key={label} className="moduleTableColumnVisibilityOption">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disableHide}
                      title={disableHide ? t("keepOne") : undefined}
                      onChange={() => toggle(label, labels)}
                    />
                    <span>{label}</span>
                  </label>
                );
              })}
            </div>
          ) : null}
        </div>
        {hiddenLabels.length > 0 ? (
          <button
            type="button"
            className="moduleButton moduleButtonSecondary moduleTableColumnVisibilityShowAll"
            onClick={reset}
          >
            {t("showAll")}
          </button>
        ) : null}
      </div>
      {hiddenLabels.length > 0 ? (
        <div className="moduleTableColumnVisibilityChips" aria-label={t("hidden")}>
          <span className="moduleTableColumnVisibilityChipsLabel">{t("hidden")}:</span>
          {hiddenLabels.map((label) => (
            <button
              key={label}
              type="button"
              className="moduleTableColumnVisibilityChip"
              title={`${t("showAll")} — ${label}`}
              onClick={() => show(label)}
            >
              {label}
              <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
