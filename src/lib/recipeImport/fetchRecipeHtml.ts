/**
 * Fetches remote recipe HTML without browser CORS.
 *
 * Resolution order:
 * 1. `VITE_RECIPE_FETCH_URL` — e.g. deployed Supabase Edge Function `https://<ref>.supabase.co/functions/v1/recipe-proxy`
 *    (append `?url=`). If the URL host is `supabase.co`, anon key headers are added automatically.
 * 2. Same-origin `/api/recipe-proxy?url=` — Vite dev middleware (see vite.config.ts) or Vercel `api/recipe-proxy.js`.
 * 3. Direct `fetch(url)` — only works if the recipe site sends permissive CORS (rare).
 */

function isSupabaseFunctionUrl(u: string): boolean {
  try {
    return new URL(u).hostname.endsWith('supabase.co')
  } catch {
    return false
  }
}

/** Built-in proxy path (dev middleware or Vercel serverless). Returns `undefined` if not available. */
async function fetchViaSameOriginProxy(trimmed: string): Promise<string | undefined> {
  const local = `/api/recipe-proxy?url=${encodeURIComponent(trimmed)}`
  let res: Response
  try {
    res = await fetch(local)
  } catch {
    return undefined
  }
  const ct = res.headers.get('content-type') ?? ''
  if (ct.includes('text/html')) {
    return undefined
  }
  const text = await res.text()
  let body: unknown
  try {
    body = JSON.parse(text) as { html?: string; error?: string }
  } catch {
    return undefined
  }
  if (!res.ok) {
    if (res.status === 404) return undefined
    const err =
      typeof body === 'object' && body && 'error' in body ? String((body as { error: unknown }).error) : text
    throw new Error(err || `Proxy HTTP ${res.status}`)
  }
  if (typeof body === 'object' && body && typeof (body as { html?: unknown }).html === 'string') {
    return (body as { html: string }).html
  }
  return undefined
}

export async function fetchRecipeHtml(url: string): Promise<string> {
  const trimmed = url.trim()
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) {
    throw new Error('Enter a full recipe URL (https://…).')
  }

  const remoteBase = import.meta.env.VITE_RECIPE_FETCH_URL as string | undefined
  if (remoteBase) {
    const base = remoteBase.replace(/\?$/, '')
    const sep = base.includes('?') ? '&' : '?'
    const target = `${base}${sep}url=${encodeURIComponent(trimmed)}`
    const headers: Record<string, string> = { Accept: 'application/json' }
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
    if (anon && isSupabaseFunctionUrl(base)) {
      headers.apikey = anon
      headers.Authorization = `Bearer ${anon}`
    }
    const res = await fetch(target, { headers })
    const text = await res.text()
    let body: unknown
    try {
      body = JSON.parse(text) as { html?: string; error?: string; ok?: boolean }
    } catch {
      throw new Error('Recipe proxy returned non-JSON. Check VITE_RECIPE_FETCH_URL.')
    }
    if (!res.ok) {
      const err = typeof body === 'object' && body && 'error' in body ? String((body as { error: unknown }).error) : text
      throw new Error(err || `Proxy HTTP ${res.status}`)
    }
    if (typeof body === 'object' && body && typeof (body as { html?: unknown }).html === 'string') {
      return (body as { html: string }).html
    }
    throw new Error('Recipe proxy response missing html field.')
  }

  const viaProxy = await fetchViaSameOriginProxy(trimmed)
  if (viaProxy !== undefined) {
    return viaProxy
  }

  try {
    const res = await fetch(trimmed, { mode: 'cors', credentials: 'omit' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } catch {
    throw new Error(
      'Could not load that recipe page (blocked by the site’s CORS policy in the browser). On Vercel, deploy with the included `api/recipe-proxy` route, run `npm run dev` locally, or set `VITE_RECIPE_FETCH_URL` to a deployed Supabase `recipe-proxy` function (see README).',
    )
  }
}
