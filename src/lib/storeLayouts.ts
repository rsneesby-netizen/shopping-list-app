import type { StorePresetRow } from '../types'

const LAST_LAYOUT_KEY = 'grocery:lastStoreLayoutId'

/** Sort presets for dropdowns; all presets from the database are shown. */
export function filterStoreLayouts(rows: StorePresetRow[]): StorePresetRow[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
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
