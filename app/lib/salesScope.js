import { fetchSalesScopeCached } from "./mobileDataCache";

export async function fetchSalesScope() {
  const { scope } = await fetchSalesScopeCached();
  return scope;
}