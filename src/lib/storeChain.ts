import type { StorePresetRow } from '../types'

/** Infer retail chain from a store preset slug (used for heuristics and cross-store translation). */
export function storeChainFromSlug(slug: string | null): 'aldi' | 'coles' | 'woolworths' | 'iga' | 'neutral' {
  if (!slug) return 'neutral'
  const s = slug.toLowerCase()
  if (s.includes('aldi')) return 'aldi'
  if (s.includes('woolworths') || s.includes('woolies')) return 'woolworths'
  if (s.includes('coles')) return 'coles'
  if (s.includes('iga')) return 'iga'
  return 'neutral'
}

/**
 * Scope key for shared price learnings: one row per major chain for all locations,
 * or `preset:<uuid>` for other stores so they stay isolated.
 */
export function priceLearningScopeFromPresetId(
  presets: StorePresetRow[],
  presetId: string | null,
): string | null {
  if (!presetId) return null
  const slug = presets.find((p) => p.id === presetId)?.slug ?? ''
  const ch = storeChainFromSlug(slug === '' ? null : slug)
  if (ch !== 'neutral') return ch
  return `preset:${presetId}`
}

/** Any preset slug whose chain scope matches `scope` (for chain index in hints). */
export function exampleSlugForPriceLearningScope(
  presets: StorePresetRow[],
  scope: string,
): string | null {
  if (scope.startsWith('preset:')) {
    const id = scope.slice('preset:'.length)
    return presets.find((p) => p.id === id)?.slug ?? null
  }
  const hit = presets.find((p) => priceLearningScopeFromPresetId(presets, p.id) === scope)
  return hit?.slug ?? null
}

/** Multipliers for generic fallback unit prices (Aldi < Coles < Woolworths). */
export function chainFallbackMultiplier(slug: string | null): number {
  const chain = storeChainFromSlug(slug)
  if (chain === 'aldi') return 0.84
  if (chain === 'coles') return 0.95
  if (chain === 'woolworths') return 1.04
  if (chain === 'iga') return 0.93
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
