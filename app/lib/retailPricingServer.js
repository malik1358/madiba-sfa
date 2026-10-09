import { PRICE_SOURCE_URL } from "./priceApiConfig.js";
import { parsePricePayload } from "./pricePayload.js";

export async function loadRetailPriceMaps(fetcher = fetch) {
  const response = await fetcher(PRICE_SOURCE_URL, { cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Retail price feed request failed (${response.status}).`);
  const payload = await response.json();
  if (payload.success === false) throw new Error("Retail price feed reported a failure.");
  const parsed = parsePricePayload(payload);
  if (!Object.values(parsed.retailRegionPriceMaps).some((map) => Object.keys(map).length > 0)) {
    throw new Error("Retail prices are unavailable. Redeploy the price Apps Script with retailRegionPriceMaps, then sync prices.");
  }
  return parsed.retailRegionPriceMaps;
}
