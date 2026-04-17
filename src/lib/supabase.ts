import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

let cached: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!url || !anon) {
    throw new Error(
      'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and add your Supabase project keys.',
    )
  }
  if (!cached) {
    cached = createClient(url, anon, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  }
  return cached
}
