"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "../lib/supabase";
import {
  canHideLabel,
  hiddenLabelsForTable,
  mergeTableHidden,
  normalizeColumnLabel,
  normalizeHiddenLabels,
  normalizeTableId,
  parseColumnPrefs,
  sanitizeHiddenLabels,
} from "../lib/tableColumnVisibility";

const SAVE_DEBOUNCE_MS = 400;

let prefsCache = null;
let prefsPromise = null;
let prefsUserId = "";

function resetPrefsCache() {
  prefsCache = null;
  prefsPromise = null;
  prefsUserId = "";
}

async function authHeaders() {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token || !session?.user?.id) {
    throw new Error("Please login again.");
  }
  return {
    userId: session.user.id,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
  };
}

async function fetchPrefs() {
  const { headers, userId } = await authHeaders();
  if (prefsCache && prefsUserId === userId) return prefsCache;
  if (prefsPromise && prefsUserId === userId) return prefsPromise;

  prefsUserId = userId;
  prefsPromise = (async () => {
    const response = await fetch("/api/user/table-column-prefs", { headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.success) {
      throw new Error(payload?.error || "Unable to load column preferences.");
    }
    prefsCache = parseColumnPrefs(payload);
    return prefsCache;
  })().catch((error) => {
    prefsPromise = null;
    throw error;
  });

  return prefsPromise;
}

async function putHidden(tableId, hidden) {
  const { headers, userId } = await authHeaders();
  const response = await fetch("/api/user/table-column-prefs", {
    method: "PUT",
    headers,
    body: JSON.stringify({ tableId, hidden }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error || "Unable to save column preferences.");
  }
  const next = parseColumnPrefs(payload);
  prefsCache = next;
  prefsUserId = userId;
  prefsPromise = Promise.resolve(next);
  return next;
}

export default function useTableColumnPrefs(tableId) {
  const id = normalizeTableId(tableId);
  const [hiddenLabels, setHiddenLabels] = useState([]);
  const [ready, setReady] = useState(false);
  const saveTimerRef = useRef(null);
  const pendingHiddenRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    if (!id) {
      setHiddenLabels([]);
      setReady(true);
      return undefined;
    }

    setReady(false);
    fetchPrefs()
      .then((prefs) => {
        if (cancelled) return;
        setHiddenLabels(hiddenLabelsForTable(prefs, id));
        setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setHiddenLabels([]);
        setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  const scheduleSave = useCallback((nextHidden) => {
    if (!id) return;
    const sanitized = normalizeHiddenLabels(nextHidden);
    prefsCache = mergeTableHidden(prefsCache || emptyLocalPrefs(), id, sanitized);
    pendingHiddenRef.current = sanitized;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const toSave = pendingHiddenRef.current;
      pendingHiddenRef.current = null;
      putHidden(id, toSave).catch(() => {
        // Keep local state; next interaction retries.
      });
    }, SAVE_DEBOUNCE_MS);
  }, [id]);

  const setHidden = useCallback((nextHidden, allLabels = null) => {
    const sanitized = allLabels
      ? sanitizeHiddenLabels(allLabels, nextHidden)
      : normalizeHiddenLabels(nextHidden);
    setHiddenLabels(sanitized);
    scheduleSave(sanitized);
  }, [scheduleSave]);

  const hide = useCallback((label, allLabels) => {
    const nextLabel = normalizeColumnLabel(label);
    if (!nextLabel) return;
    if (allLabels && !canHideLabel(allLabels, hiddenLabels, nextLabel)) return;
    setHidden([...hiddenLabels, nextLabel], allLabels);
  }, [hiddenLabels, setHidden]);

  const show = useCallback((label) => {
    const nextLabel = normalizeColumnLabel(label);
    if (!nextLabel) return;
    setHidden(hiddenLabels.filter((item) => item !== nextLabel));
  }, [hiddenLabels, setHidden]);

  const toggle = useCallback((label, allLabels) => {
    const nextLabel = normalizeColumnLabel(label);
    if (!nextLabel) return;
    if (hiddenLabels.includes(nextLabel)) {
      show(nextLabel);
      return;
    }
    hide(nextLabel, allLabels);
  }, [hiddenLabels, hide, show]);

  const reset = useCallback(() => {
    setHidden([]);
  }, [setHidden]);

  return {
    tableId: id,
    ready,
    hiddenLabels,
    hide,
    show,
    toggle,
    reset,
    setHidden,
    refreshCache: resetPrefsCache,
  };
}

function emptyLocalPrefs() {
  return parseColumnPrefs(null);
}
