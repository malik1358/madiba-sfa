import { redirect } from "next/navigation";

/** Legacy salesman URL — Payment Collections is the shared entry for all roles. */
export default async function MyCollectionsPage({ searchParams }) {
  const params = await searchParams;
  const query = new URLSearchParams(
    Object.entries(params || {}).flatMap(([key, value]) => {
      if (Array.isArray(value)) return value.map((entry) => [key, String(entry)]);
      if (value == null) return [];
      return [[key, String(value)]];
    }),
  ).toString();

  redirect(`/management/payment-collections${query ? `?${query}` : ""}`);
}
