"use client";

import { useEffect, useRef } from "react";
import { buildCacheBustingReloadUrl, getClientBuildId } from "../lib/buildInfo";
import { hasOpenUnsavedEntry, UNSAVED_ENTRY_EVENT } from "../lib/unsavedEntryGuard";

const POLL_MS = 60 * 1000;
const RETRY_MS = 15 * 1000;

function reloadForBuild(serverBuild) {
  const nextUrl = buildCacheBustingReloadUrl(serverBuild, window.location.href);
  window.location.replace(nextUrl);
}

export default function BuildUpdateWatcher() {
  const clientBuildRef = useRef("");
  const pendingReloadRef = useRef(false);
  const targetBuildRef = useRef("");
  const retryTimerRef = useRef(0);

  useEffect(() => {
    clientBuildRef.current = getClientBuildId();
    if (clientBuildRef.current === "local") return undefined;

    function clearRetry() {
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = 0;
      }
    }

    function attemptReload() {
      if (!pendingReloadRef.current) return;
      if (hasOpenUnsavedEntry(document)) {
        clearRetry();
        retryTimerRef.current = window.setTimeout(attemptReload, RETRY_MS);
        return;
      }
      clearRetry();
      reloadForBuild(targetBuildRef.current);
    }

    function scheduleReload(serverBuild) {
      targetBuildRef.current = serverBuild;
      if (!pendingReloadRef.current) {
        pendingReloadRef.current = true;
      }
      attemptReload();
    }

    async function checkForUpdate() {
      try {
        const response = await fetch(`/api/build-info?ts=${Date.now()}`, {
          cache: "no-store",
          headers: {
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          },
        });
        const payload = await response.json().catch(() => ({}));
        const serverBuild = String(payload.buildId || "").trim();
        if (!serverBuild || serverBuild === "local") return;
        if (serverBuild !== clientBuildRef.current) {
          if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
            navigator.serviceWorker.getRegistrations()
              .then((registrations) => Promise.all(registrations.map((registration) => registration.update())))
              .catch(() => undefined);
          }
          scheduleReload(serverBuild);
        }
      } catch {
        // Ignore polling errors.
      }
    }

    checkForUpdate();

    const timer = window.setInterval(checkForUpdate, POLL_MS);
    const onFocus = () => checkForUpdate();
    const onVisibility = () => {
      if (!document.hidden) checkForUpdate();
    };
    const onControllerChange = () => {
      if (pendingReloadRef.current) {
        attemptReload();
        return;
      }
      checkForUpdate();
    };
    const onEntryStateChange = () => attemptReload();

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("focusin", onEntryStateChange);
    document.addEventListener("focusout", onEntryStateChange);
    document.addEventListener("input", onEntryStateChange);
    document.addEventListener("change", onEntryStateChange);
    window.addEventListener(UNSAVED_ENTRY_EVENT, onEntryStateChange);
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    }

    return () => {
      window.clearInterval(timer);
      clearRetry();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("focusin", onEntryStateChange);
      document.removeEventListener("focusout", onEntryStateChange);
      document.removeEventListener("input", onEntryStateChange);
      document.removeEventListener("change", onEntryStateChange);
      window.removeEventListener(UNSAVED_ENTRY_EVENT, onEntryStateChange);
      if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      }
    };
  }, []);

  return null;
}
