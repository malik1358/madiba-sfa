import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOrderPdfFileName,
  isMissingNativePluginError,
  isShareCancelledError,
} from "../app/lib/orderPdfExport.js";

describe("orderPdfExport native plugin helpers", () => {
  it("detects Capacitor Filesystem/Share not-implemented errors", () => {
    assert.equal(
      isMissingNativePluginError(new Error("\"Filesystem\" plugin is not implemented on android")),
      true,
    );
    assert.equal(
      isMissingNativePluginError({ message: "Share plugin is not implemented on android" }),
      true,
    );
    assert.equal(isMissingNativePluginError(new Error("Network offline")), false);
    assert.equal(isMissingNativePluginError(null), false);
  });

  it("detects share cancellation without treating plugin errors as cancel", () => {
    assert.equal(isShareCancelledError({ name: "AbortError", message: "Share canceled" }), true);
    assert.equal(isShareCancelledError(new Error("User cancelled")), true);
    assert.equal(
      isShareCancelledError(new Error("\"Filesystem\" plugin is not implemented on android")),
      false,
    );
  });

  it("builds order PDF filenames with optional pending-sync marker", () => {
    assert.equal(
      buildOrderPdfFileName({
        orderId: 503,
        customerCode: "1281",
        savedAtIso: "2026-10-14T11:45:00.000Z",
      }),
      "order-503-1281-2026-10-14-11-45-00.pdf",
    );
    assert.equal(
      buildOrderPdfFileName({
        orderId: "pending:abc",
        customerCode: "ABA81",
        savedAtIso: "2026-10-14T11:45:00.000Z",
        pendingSync: true,
      }),
      "order-pending:abc-pending-sync-ABA81-2026-10-14-11-45-00.pdf",
    );
  });
});
