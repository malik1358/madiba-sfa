"use client";

import { useEffect } from "react";
import { installNativeFieldTrackingListeners } from "../lib/nativeFieldTracking";

export default function NativeFieldTracking() {
  useEffect(() => installNativeFieldTrackingListeners(), []);
  return null;
}
