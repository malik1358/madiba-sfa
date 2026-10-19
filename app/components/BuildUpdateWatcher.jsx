"use client";

import { useEffect, useRef } from "react";
import { buildCacheBustingReloadUrl, getClientBuildId } from "../lib/buildInfo";

const POLL_MS = 60 * 1000;
const RETRY_MS = 15 * 1000;
const BUSY_MAX_WAIT_MS = 2 * 60 * 1000;

function userIsBusy() {
  const active = document.activeElement;
  if (!active) return false;

  const tag = String(active.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (active.isContentEditable) return true;
  return false;
}

function reloadForBuild(serverBuild) {
  const nextUrl = buildCacheBustingReloadUrl(serverBuild, window.location.href);
  window.location.replace(nextUrl);
}

export default function BuildUpdateWatcher() {
  const clientBuildRef = useRef("");
  const pendingReloadRef = useRef(false);
  const reloadRequestedAtRef = useRef(0);
  const targetBuildRef = useRef("");

  useEffect(() => {
    clientBuildRef.current = getClientBuildId();
    if (clientBuildRef.current === "local") return undefined;

    function scheduleReload(serverBuild) {
      if (pendingReloadRef.current) return;
      pendingReloadRef.current = true;
      reloadRequestedAtRef.current = Date.now();
      targetBuildRef.current = serverBuild;

      const attempt = () => {
        const waitedMs = Date.now() - reloadRequestedAtRef.current;
        const shouldWaitForUser = (document.hidden || userIsBusy()) && waitedMs < BUSY_MAX_WAIT_MS;
        if (shouldWaitForUser) {
          window.setTimeout(attempt, RETRY_MS);
          return;
        }
        reloadForBuild(targetBuildRef.current);
      };

      attempt();
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
      if (pendingReloadRef.current) return;
      checkForUpdate();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    }

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      }
    };
  }, []);

  return null;
}
