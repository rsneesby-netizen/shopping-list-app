/** localStorage key for "Show prices" on list UI (default: off until user opts in). */
export const SHOW_PRICES_STORAGE_KEY = 'grocery_list_show_prices'

export function readShowPricesPreference(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const v = window.localStorage.getItem(SHOW_PRICES_STORAGE_KEY)
    if (v === null) return false
    return v === '1' || v === 'true'
  } catch {
    return false
  }
}

export function writeShowPricesPreference(value: boolean): void {
  try {
    window.localStorage.setItem(SHOW_PRICES_STORAGE_KEY, value ? '1' : '0')
  } catch {
    /* private mode / quota */
  }
}
