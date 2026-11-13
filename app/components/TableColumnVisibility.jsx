"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

const DROPDOWN_MIN_WIDTH = 220;
const DROPDOWN_MAX_HEIGHT = 280;
const DROPDOWN_GAP = 4;
const VIEWPORT_PAD = 8;

function dropdownStyleFromButton(button) {
  if (!button || typeof button.getBoundingClientRect !== "function") {
    return { top: VIEWPORT_PAD, left: VIEWPORT_PAD, minWidth: DROPDOWN_MIN_WIDTH, maxHeight: DROPDOWN_MAX_HEIGHT };
  }
  const rect = button.getBoundingClientRect();
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const width = Math.min(Math.max(DROPDOWN_MIN_WIDTH, rect.width), Math.max(DROPDOWN_MIN_WIDTH, viewportWidth - VIEWPORT_PAD * 2));
  let left = rect.left;
  if (left + width > viewportWidth - VIEWPORT_PAD) {
    left = Math.max(VIEWPORT_PAD, rect.right - width);
  }
  left = Math.max(VIEWPORT_PAD, left);

  const spaceBelow = viewportHeight - rect.bottom - VIEWPORT_PAD;
  const spaceAbove = rect.top - VIEWPORT_PAD;
  const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;
  const maxHeight = Math.max(120, Math.min(DROPDOWN_MAX_HEIGHT, openUp ? spaceAbove - DROPDOWN_GAP : spaceBelow - DROPDOWN_GAP));
  const top = openUp
    ? Math.max(VIEWPORT_PAD, rect.top - DROPDOWN_GAP - maxHeight)
    : rect.bottom + DROPDOWN_GAP;

  return {
    position: "fixed",
    top,
    left,
    minWidth: width,
    maxHeight,
    zIndex: 10050,
  };
}

export default function TableColumnVisibility({
  tableHostRef,
  tableId,
  enabled = true,
  syncKey = null,
}) {
  const { language } = useAppLanguage();
  const t = translate(language, TEXT);
  const { hiddenLabels, toggle, show, reset, ready } = useTableColumnPrefs(enabled ? tableId : "");
  const [labels, setLabels] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState(null);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const dropdownRef = useRef(null);

  useLayoutEffect(() => {
    if (!enabled) return undefined;

    let observer = null;
    let frame = 0;
    let cancelled = false;

    const syncLabels = (host) => {
      const table = host.querySelector("table");
      const next = discoverTableColumnLabels(table);
      setLabels((current) => {
        if (current.length === next.length && current.every((label, index) => label === next[index])) {
          return current;
        }
        return next;
      });
    };

    const attach = () => {
      if (cancelled) return;
      const host = tableHostRef?.current;
      if (!host) {
        frame = requestAnimationFrame(attach);
        return;
      }
      syncLabels(host);
      observer = new MutationObserver(() => syncLabels(host));
      observer.observe(host, { childList: true, subtree: true });
    };

    attach();

    return () => {
      cancelled = true;
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [enabled, tableHostRef, syncKey]);

  useLayoutEffect(() => {
    if (!enabled || !ready) return;
    const table = tableHostRef?.current?.querySelector("table");
    if (!table) return;
    applyColumnVisibilityToTable(table, hiddenLabels);
  }, [enabled, ready, hiddenLabels, labels, tableHostRef, syncKey]);

  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuStyle(null);
      return undefined;
    }
    const syncPosition = () => {
      setMenuStyle(dropdownStyleFromButton(buttonRef.current));
    };
    syncPosition();
    window.addEventListener("resize", syncPosition);
    window.addEventListener("scroll", syncPosition, true);
    return () => {
      window.removeEventListener("resize", syncPosition);
      window.removeEventListener("scroll", syncPosition, true);
    };
  }, [menuOpen, labels.length]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointerDown = (event) => {
      const target = event.target;
      if (rootRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setMenuOpen(false);
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

  if (!enabled || !tableId) return null;
  if (labels.length === 0) return null;

  const hiddenSet = new Set(hiddenLabels);
  const menu = menuOpen && menuStyle && typeof document !== "undefined"
    ? createPortal(
      (
        <div
          ref={dropdownRef}
          className="moduleTableColumnVisibilityDropdown"
          role="menu"
          style={menuStyle}
        >
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
      ),
      document.body,
    )
    : null;

  return (
    <div className="moduleTableColumnVisibility" ref={rootRef}>
      <div className="moduleTableColumnVisibilityControls">
        <div className="moduleTableColumnVisibilityMenu">
          <button
            ref={buttonRef}
            type="button"
            className="moduleButton moduleButtonSecondary moduleTableColumnVisibilityButton"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {t("columns")}
          </button>
          {menu}
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
