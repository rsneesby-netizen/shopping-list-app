/**
 * Vercel serverless pricing adapter scaffold.
 *
 * Replace the `getProviderQuote` implementation with:
 * - a scraper/provider client
 * - normalized result mapping to this endpoint contract
 *
 * Request body:
 * {
 *   storeSlug: string | null,
 *   items: [{ id, text, quantity, unit }],
 *   currency?: 'AUD'
 * }
 *
 * Response body:
 * {
 *   currency: 'AUD',
 *   items: [{ itemId, estimatedCost, regularEstimatedCost?, onSpecial, confidence, source }],
 *   totalEstimatedCost: number,
 *   generatedAt: ISOString,
 *   sourceLabel: string
 * }
 */

function badRequest(message) {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Provider hook point (stub):
 * return null when no provider available so caller can use local fallback.
 */
async function getProviderQuote(_storeSlug, _item) {
  return null
}

export async function POST(req) {
  let body
  try {
    body = await req.json()
  } catch {
    return badRequest('invalid_json')
  }

  const storeSlug = body?.storeSlug ?? null
  const items = Array.isArray(body?.items) ? body.items : null
  if (!items) return badRequest('items_required')

  const estimates = []
  for (const item of items) {
    if (!item?.id || !item?.text) continue
    const provider = await getProviderQuote(storeSlug, item)
    if (!provider) continue
    estimates.push({
      itemId: item.id,
      estimatedCost: provider.estimatedCost,
      regularEstimatedCost: provider.regularEstimatedCost,
      onSpecial: !!provider.onSpecial,
      confidence: provider.confidence ?? 'medium',
      source: provider.source ?? 'provider',
    })
  }

  const totalEstimatedCost = estimates.reduce((sum, i) => sum + Number(i.estimatedCost || 0), 0)
  return new Response(
    JSON.stringify({
      currency: 'AUD',
      items: estimates,
      totalEstimatedCost,
      generatedAt: new Date().toISOString(),
      sourceLabel: 'Server provider estimate (scaffold)',
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}
