export const REQUEST_TIMEOUT_MESSAGE =
  "Request timed out. Please check your connection and try again.";

export function isAbortError(error) {
  if (!error) return false;
  if (error.name === "AbortError") return true;
  if (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  const message = String(error?.message || "").toLowerCase();
  return message.includes("aborted") || message.includes("abort");
}

export function toFriendlyAbortError(error, fallback = REQUEST_TIMEOUT_MESSAGE) {
  if (isAbortError(error)) {
    return new Error(fallback);
  }
  return error instanceof Error ? error : new Error(fallback);
}

export function friendlyErrorMessage(error, fallback = "Something went wrong. Please try again.") {
  if (isAbortError(error)) {
    return REQUEST_TIMEOUT_MESSAGE;
  }
  const message = String(error?.message || "").trim();
  return message || fallback;
}
