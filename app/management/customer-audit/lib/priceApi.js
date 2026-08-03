const PRICE_API =
  "https://script.google.com/macros/s/AKfycbzXPREoz0tUgern-5LhpEPBMY_ed2hO1fgYpIVfzG2-BU9HbjOklKCBFVMtsw64Uff5/exec";

let cachedPrices = null;
let lastFetch = 0;
const CACHE_TTL = 1000 * 60 * 5; // 5 minutes

export async function loadPrices() {
  if (cachedPrices && Date.now() - lastFetch < CACHE_TTL) {
    return cachedPrices;
  }

  try {
    const res = await fetch(PRICE_API);
    const json = await res.json();
    cachedPrices = json || {};
    lastFetch = Date.now();
    return cachedPrices;
  } catch (e) {
    console.error("Failed to load prices", e);
    return {};
  }
}
