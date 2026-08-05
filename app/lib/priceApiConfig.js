const FALLBACK_PRICE_SOURCE_URL =
  "https://script.google.com/macros/s/AKfycbypi2PkOaBIWdcQnxrBJAT6xGmqsuyx2mekiIkkOjE/exec";

export const PRICE_SOURCE_URL =
  process.env.PRICE_SOURCE_URL || FALLBACK_PRICE_SOURCE_URL;

export const PRICE_CACHE_KEY = "madiba.pricePayload";
