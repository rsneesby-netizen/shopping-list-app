/** Stored unit keys for list items */
export const UNIT_OPTIONS = ['each', 'L', 'kg'] as const
export type CanonicalUnit = (typeof UNIT_OPTIONS)[number]

/** Normalize (e.g. legacy `g` from an older build → `kg`) */
export function normalizeUnit(u: string): string {
  if (u === 'g') return 'kg'
  return u
}

export function unitOptionLabel(u: string): string {
  const n = normalizeUnit(u)
  if (n === 'each') return 'each'
  if (n === 'L') return 'L'
  if (n === 'kg') return 'kg'
  return n
}

function formatDecimalQty(quantity: number, min: number): string {
  const n = Number(quantity)
  if (!Number.isFinite(n)) return String(min)
  const r = Math.round(n * 10) / 10
  return String(Math.max(min, r))
}

export function formatQuantityForInput(unit: string, quantity: number): string {
  const u = normalizeUnit(unit)
  if (u === 'each') return String(Math.round(quantity))
  if (u === 'L' || u === 'kg') return formatDecimalQty(quantity, 0.1)
  return String(quantity)
}

/** Parse typed quantity on blur; returns null if invalid / empty */
export function parseQuantityInput(unit: string, raw: string): number | null {
  const u = normalizeUnit(unit)
  const t = raw.trim()
  if (t === '') return null
  if (u === 'each') {
    const n = parseInt(t, 10)
    if (!Number.isFinite(n)) return null
    return Math.min(20, Math.max(1, n))
  }
  if (u === 'L' || u === 'kg') {
    const n = parseFloat(t.replace(',', '.'))
    if (!Number.isFinite(n)) return null
    const r = Math.round(n * 10) / 10
    return Math.max(0.1, r)
  }
  return null
}

/** Clamp a numeric quantity for persistence given unit */
export function clampQuantityForUnit(unit: string, quantity: number): number | null {
  const u = normalizeUnit(unit)
  if (!Number.isFinite(quantity)) return null
  if (u === 'each') return Math.min(20, Math.max(1, Math.round(quantity)))
  if (u === 'L' || u === 'kg') return Math.max(0.1, Math.round(quantity * 10) / 10)
  return null
}

/** When changing unit, derive a sensible starting quantity */
export function quantityWhenChangingUnit(_prevUnit: string, nextUnit: string, prevQty: number): number {
  const to = normalizeUnit(nextUnit)
  const q = Number(prevQty)
  if (!Number.isFinite(q)) return to === 'each' ? 1 : 0.1

  if (to === 'each') return Math.min(20, Math.max(1, Math.round(q) || 1))
  if (to === 'L' || to === 'kg') return Math.max(0.1, Math.round(q * 10) / 10)
  return q
}
