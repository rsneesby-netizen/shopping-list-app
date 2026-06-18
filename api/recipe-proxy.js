/**
 * Vercel serverless: fetch recipe HTML server-side (same contract as Vite dev middleware
 * and `supabase/functions/recipe-proxy`). Lets production use same-origin `/api/recipe-proxy?url=`.
 */

export async function GET(request) {
  const target = new URL(request.url).searchParams.get('url')
  if (!target || !/^https?:\/\//i.test(target)) {
    return new Response(JSON.stringify({ error: 'Missing or invalid url query parameter.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  try {
    const r = await fetch(target, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; GroceryListRecipeImport/1.0; +https://github.com/)',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    })
    const html = await r.text()
    return new Response(JSON.stringify({ ok: true, status: r.status, html }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
