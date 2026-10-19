"use client";

import { useEffect, useRef } from "react";
import { useAppPopup } from "../components/AppPopupProvider";

export function usePopupMessages({ message = "", error = "", warnings = [] } = {}) {
  const { showPopup } = useAppPopup();
  const seenRef = useRef({
    message: "",
    error: "",
    warningsKey: "",
  });

  useEffect(() => {
    const nextError = String(error || "").trim();
    if (nextError && nextError !== seenRef.current.error) {
      seenRef.current.error = nextError;
      showPopup({ message: nextError, variant: "error" });
    }
    if (!nextError) {
      seenRef.current.error = "";
    }
  }, [error, showPopup]);

  useEffect(() => {
    const nextMessage = String(message || "").trim();
    if (nextMessage && nextMessage !== seenRef.current.message) {
      seenRef.current.message = nextMessage;
      showPopup({ message: nextMessage, variant: "success" });
    }
    if (!nextMessage) {
      seenRef.current.message = "";
    }
  }, [message, showPopup]);

  useEffect(() => {
    const normalizedWarnings = (warnings || []).map((value) => String(value || "").trim()).filter(Boolean);
    const warningsKey = normalizedWarnings.join("\u0001");
    if (!warningsKey || warningsKey === seenRef.current.warningsKey) return;

    seenRef.current.warningsKey = warningsKey;
    normalizedWarnings.forEach((warning) => {
      showPopup({ message: warning, variant: "warning" });
    });
  }, [warnings, showPopup]);
}
