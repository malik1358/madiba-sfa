import { fetchSalesScopeCached } from "./mobileDataCache";

export async function fetchSalesScope(options = {}) {
  const { scope } = await fetchSalesScopeCached(options);
  return scope;
}