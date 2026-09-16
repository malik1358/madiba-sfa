"use client";

import { useEffect, useId, useRef, useState } from "react";
import { fetchJsonWithTimeout, resolveAuthSession } from "../../lib/authSession";
import { getSupabaseClient } from "../../lib/supabase";

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

export default function ItemCodeSearchField({
  value = "",
  itemName = "",
  onSelect,
  placeholder = "Search item code or name",
  searchingLabel = "Searching...",
  noMatchesLabel = "No matching items",
}) {
  const listId = useId();
  const rootRef = useRef(null);
  const [query, setQuery] = useState(() => {
    const code = normalizeCode(value);
    if (!code) return "";
    if (itemName && itemName !== code) return `${code} — ${itemName}`;
    return code;
  });
  const [matches, setMatches] = useState([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const selectedCode = normalizeCode(value);

  useEffect(() => {
    const code = normalizeCode(value);
    if (!code) {
      if (!open) setQuery("");
      return;
    }
    if (open) return;
    const next = itemName && itemName !== code ? `${code} — ${itemName}` : code;
    setQuery(next);
  }, [value, itemName, open]);

  useEffect(() => {
    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
        setMatches([]);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return undefined;

    const needle = String(query || "").trim();
    if (!open || needle.length < 2) {
      setMatches([]);
      setSearching(false);
      return undefined;
    }

    const selectedDisplay = selectedCode
      ? (itemName && itemName !== selectedCode ? `${selectedCode} — ${itemName}` : selectedCode)
      : "";
    if (selectedDisplay && needle === selectedDisplay) {
      setMatches([]);
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const session = await resolveAuthSession(supabase);
        if (!session?.access_token || cancelled) return;
        const params = new URLSearchParams({ q: needle });
        const { response, payload } = await fetchJsonWithTimeout(
          `/api/admin/item-price-history?${params}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } },
          20000,
        );
        if (cancelled) return;
        if (!response.ok || !payload?.success) {
          setMatches([]);
          return;
        }
        setMatches(Array.isArray(payload.matches) ? payload.matches : []);
      } catch {
        if (!cancelled) setMatches([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 280);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open, selectedCode, itemName]);

  function pickItem(row) {
    const code = normalizeCode(row.itemCode || row.item_code);
    const name = String(row.itemName || row.item_name || code).trim() || code;
    onSelect?.({ itemCode: code, itemName: name, category: row.category || "" });
    setQuery(name !== code ? `${code} — ${name}` : code);
    setMatches([]);
    setOpen(false);
  }

  return (
    <div className="moduleCustomerSearch moduleQtyItemSearch" ref={rootRef}>
      <input
        className="moduleInput"
        type="text"
        role="combobox"
        aria-expanded={open && (matches.length > 0 || searching)}
        aria-controls={listId}
        aria-autocomplete="list"
        value={query}
        placeholder={placeholder}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          if (!event.target.value.trim()) {
            onSelect?.({ itemCode: "", itemName: "", category: "" });
          }
        }}
        onBlur={() => {
          // Keep typed code if user typed a bare code without picking.
          const typed = normalizeCode(query.split("—")[0] || query);
          if (typed && typed !== selectedCode && matches.length === 0) {
            onSelect?.({ itemCode: typed, itemName: itemName || "", category: "" });
          }
        }}
      />
      {open && (searching || matches.length > 0 || String(query || "").trim().length >= 2) ? (
        <div className="moduleCustomerSuggestions" id={listId} role="listbox">
          {searching ? (
            <button type="button" disabled>{searchingLabel}</button>
          ) : matches.length === 0 ? (
            <button type="button" disabled>{noMatchesLabel}</button>
          ) : (
            matches.map((row) => (
              <button
                type="button"
                key={row.itemCode}
                role="option"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pickItem(row)}
              >
                <strong>
                  {row.itemName && row.itemName !== row.itemCode ? row.itemName : row.itemCode}
                  {row.category ? <small className="moduleQtyItemCategory"> · {row.category}</small> : null}
                </strong>
                <span>{row.itemCode}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
