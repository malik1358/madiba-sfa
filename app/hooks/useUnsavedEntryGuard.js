"use client";

import { useEffect } from "react";
import { claimUnsavedEntry } from "../lib/unsavedEntryGuard";

export function useUnsavedEntryGuard(active) {
  useEffect(() => {
    if (!active) return undefined;
    return claimUnsavedEntry();
  }, [active]);
}
