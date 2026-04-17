import type { StorePresetRow } from '../types'

export const STORE_LAYOUT_SPECS = [
  { slug: 'woolworths-kotara', name: 'Woolworths Kotara' },
  { slug: 'coles-kotara', name: 'Coles Kotara' },
  { slug: 'coles-waratah', name: 'Coles Waratah' },
  { slug: 'aldi-kotara', name: 'Aldi Kotara' },
  { slug: 'aldi-newcastle-west', name: 'Aldi Newcastle West' },
] as const

const ALLOWED = new Set<string>(STORE_LAYOUT_SPECS.map((s) => s.slug))
const LAST_LAYOUT_KEY = 'grocery:lastStoreLayoutId'

export function filterStoreLayouts(rows: StorePresetRow[]): StorePresetRow[] {
  const filtered = rows.filter((r) => ALLOWED.has(r.slug))
  const orderedSlugs = STORE_LAYOUT_SPECS.map((s) => s.slug) as string[]
  return filtered.sort((a, b) => {
    const ai = orderedSlugs.indexOf(a.slug)
    const bi = orderedSlugs.indexOf(b.slug)
    return (ai >= 0 ? ai : 999) - (bi >= 0 ? bi : 999)
  })
}

export function rememberLastStoreLayoutId(presetId: string) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(LAST_LAYOUT_KEY, presetId)
}

export function getRememberedStoreLayoutId(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(LAST_LAYOUT_KEY)
}

export function pickDefaultStoreLayoutId(presets: StorePresetRow[]): string | null {
  if (!presets.length) return null
  const remembered = getRememberedStoreLayoutId()
  if (remembered && presets.some((p) => p.id === remembered)) return remembered
  const wooliesKotara = presets.find((p) => p.slug === 'woolworths-kotara')
  return wooliesKotara?.id ?? presets[0]?.id ?? null
}
