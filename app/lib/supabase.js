import { createClient } from '@supabase/supabase-js';
import { assertSupabaseUrlAllowed } from './supabaseGuard.js';

let clientInstance = null;

export function getSupabaseClient() {
  if (clientInstance) {
    return clientInstance;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  assertSupabaseUrlAllowed(supabaseUrl);

  clientInstance = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });

  return clientInstance;
}
