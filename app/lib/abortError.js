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

export const NETWORK_FETCH_MESSAGE =
  "Unable to reach the server. Check your connection, then refresh and try again.";

export function friendlyErrorMessage(error, fallback = "Something went wrong. Please try again.") {
  if (isAbortError(error)) {
    return REQUEST_TIMEOUT_MESSAGE;
  }
  // Callers sometimes pass the Error object (String(err) => "TypeError: Failed to fetch")
  // or only err.message ("Failed to fetch").
  const message = String(error?.message || error || "").trim();
  const lower = message.toLowerCase();
  if (
    lower.includes("failed to fetch")
    || lower.includes("networkerror")
    || lower.includes("load failed")
    || lower.includes("network request failed")
  ) {
    return NETWORK_FETCH_MESSAGE;
  }
  return message || fallback;
}
