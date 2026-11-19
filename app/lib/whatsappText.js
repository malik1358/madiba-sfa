/**
 * WhatsApp click-to-chat URLs only treat %0A as a line break. Android often
 * turns summary text into CRLF (%0D%0A); WhatsApp then drops the breaks, the
 * message becomes one line, and a Google Maps GPS link swallows the rest
 * (shown as Distance%20from%20customer… in the chat).
 */
export function normalizeWhatsappSummaryText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}
