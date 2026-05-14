/** Infer retail chain from a store preset slug (used for heuristics and cross-store translation). */
export function storeChainFromSlug(slug: string | null): 'aldi' | 'coles' | 'woolworths' | 'neutral' {
  if (!slug) return 'neutral'
  const s = slug.toLowerCase()
  if (s.includes('aldi')) return 'aldi'
  if (s.includes('woolworths') || s.includes('woolies')) return 'woolworths'
  if (s.includes('coles')) return 'coles'
  return 'neutral'
}

/** Multipliers for generic fallback unit prices (Aldi < Coles < Woolworths). */
export function chainFallbackMultiplier(slug: string | null): number {
  const chain = storeChainFromSlug(slug)
  if (chain === 'aldi') return 0.84
  if (chain === 'coles') return 0.95
  if (chain === 'woolworths') return 1.04
  return 0.98
}

/**
 * Relative price level with Coles as 1.0 — used to translate learned unit prices between chains
 * when the current store has no samples yet but another store does.
 */
export function chainIndexColesBaseline(slug: string | null): number {
  const m = chainFallbackMultiplier(slug)
  const coles = 0.95
  return coles > 0 ? m / coles : 1
}
