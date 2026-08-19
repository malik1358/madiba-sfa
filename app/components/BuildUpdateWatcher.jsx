"use client";

import { useEffect, useRef } from "react";
import { getClientBuildId } from "../lib/buildInfo";

const POLL_MS = 5 * 60 * 1000;
const RETRY_MS = 30 * 1000;

function userIsBusy() {
  const active = document.activeElement;
  if (!active) return false;

  const tag = String(active.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (active.isContentEditable) return true;
  return false;
}

export default function BuildUpdateWatcher() {
  const clientBuildRef = useRef("");
  const pendingReloadRef = useRef(false);

  useEffect(() => {
    clientBuildRef.current = getClientBuildId();
    if (clientBuildRef.current === "local") return undefined;

    function scheduleReload() {
      if (pendingReloadRef.current) return;
      pendingReloadRef.current = true;

      const attempt = () => {
        if (document.hidden || userIsBusy()) {
          window.setTimeout(attempt, RETRY_MS);
          return;
        }
        window.location.reload();
      };

      attempt();
    }

    async function checkForUpdate() {
      try {
        const response = await fetch(`/api/build-info?ts=${Date.now()}`, { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        const serverBuild = String(payload.buildId || "").trim();
        if (!serverBuild || serverBuild === "local") return;
        if (serverBuild !== clientBuildRef.current) {
          scheduleReload();
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

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}
