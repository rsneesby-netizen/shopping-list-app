/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  /** Optional: `https://<ref>.supabase.co/functions/v1/recipe-proxy` for production recipe import (see README). */
  readonly VITE_RECIPE_FETCH_URL?: string
  /** Optional redesign flag; when true `/lists/:id` uses NewListPage. */
  readonly VITE_ENABLE_NEW_UI?: 'true' | 'false'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
