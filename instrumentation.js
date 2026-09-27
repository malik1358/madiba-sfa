export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertConfiguredSupabaseUrlAllowed } = await import("./app/lib/supabaseGuard.js");
    assertConfiguredSupabaseUrlAllowed();
  }
}
