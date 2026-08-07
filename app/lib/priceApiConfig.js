const FALLBACK_PRICE_SOURCE_URL =
  "https://script.google.com/macros/s/AKfycbwmgoTXNLgIVM_HyVl3iwnfmhqmqjvJcIriCDtZAc0FDgvBbslYmmmC8-h2P2I0RH6f/exec";

export const PRICE_SOURCE_URL =
  process.env.PRICE_SOURCE_URL || FALLBACK_PRICE_SOURCE_URL;

export const PRICE_CACHE_KEY = "madiba.pricePayload.v2";
