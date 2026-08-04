import { getSupabaseClient } from "./supabase";

export async function fetchSalesScope() {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error("Please login again.");
  }

  const response = await fetch("/api/user/sales-scope", {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.error || "Unable to load access scope.");
  }

  return data;
}