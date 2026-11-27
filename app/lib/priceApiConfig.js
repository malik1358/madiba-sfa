const FALLBACK_PRICE_SOURCE_URL =
  "https://script.google.com/macros/s/AKfycbwmgoTXNLgIVM_HyVl3iwnfmhqmqjvJcIriCDtZAc0FDgvBbslYmmmC8-h2P2I0RH6f/exec";

export const PRICE_SOURCE_URL =
  process.env.PRICE_SOURCE_URL || FALLBACK_PRICE_SOURCE_URL;

// Bump when published price rules change so phones drop stale localStorage
// (e.g. v4 hid all LP* codes; v5 keeps non-building-material LP items when priced).
export const PRICE_CACHE_KEY = "madiba.pricePayload.v5";

export const PRICE_SHEET_ID =
  process.env.PRICE_SHEET_ID || "15DFVFiwKkv3rNdHZkxYzOpGdfFgpc7AkyQGUq6QIzJc";

export const PRICE_SHEET_GID =
  process.env.PRICE_SHEET_GID || "2077649997";
