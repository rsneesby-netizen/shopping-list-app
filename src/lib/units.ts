/** Stored unit keys for list items */
export const UNIT_OPTIONS = ['each', 'tsp', 'tbs', 'g', 'kg', 'ml', 'L'] as const
export type CanonicalUnit = (typeof UNIT_OPTIONS)[number]

const DECIMAL_MASS = new Set(['L', 'kg', 'g'])
const ML_UNIT = 'ml'

/** Synonyms → canonical keys */
export function normalizeUnit(u: string): string {
  const x = String(u).trim().toLowerCase()
  if (x === 'gram' || x === 'grams') return 'g'
  if (x === 'millilitre' || x === 'millilitres' || x === 'milliliter' || x === 'milliliters') return 'ml'
  if (x === 'l' || x === 'litre' || x === 'litres' || x === 'liter' || x === 'liters') return 'L'
  if (x === 'tbsp' || x === 'tablespoon' || x === 'tablespoons' || x === 'tbs') return 'tbs'
  if (x === 'teaspoon' || x === 'teaspoons' || x === 'tsp') return 'tsp'
  if (x === 'g' || x === 'kg' || x === 'ml' || x === 'L' || x === 'each' || x === 'tsp' || x === 'tbs') return x
  return x
}

export function unitOptionLabel(u: string): string {
  const n = normalizeUnit(u)
  if (n === 'each') return 'each'
  if (n === 'tsp') return 'tsp'
  if (n === 'tbs') return 'tbs'
  if (n === 'g') return 'g'
  if (n === 'kg') return 'kg'
  if (n === 'ml') return 'ml'
  if (n === 'L') return 'L'
  return n
}

/** L and kg: round down to 2 decimal places. g: half-up to 2 decimals. ml/tsp/tbs: handled in format/clamp. */
export function quantizeQuantityForUnit(unit: string, quantity: number): number {
  const u = normalizeUnit(unit)
  const n = Number(quantity)
  if (!Number.isFinite(n)) return quantity
  if (u === 'kg' || u === 'L') return Math.floor(n * 100 + 1e-9) / 100
  if (u === 'g') return Math.round(n * 100) / 100
  if (u === ML_UNIT) return Math.max(1, Math.ceil(n - 1e-9))
  if (u === 'tsp' || u === 'tbs') return Math.max(0.25, Math.round(n * 100) / 100)
  return n
}

/** Store recipe import amounts in grams (mass) or millilitres (volume) for scaling. */
export function recipeLineBaseCanonical(qty: number, unit: string): { baseQty: number; baseUnit: string } {
  const u = normalizeUnit(unit)
  if (u === 'kg') return { baseQty: qty * 1000, baseUnit: 'g' }
  if (u === 'g') return { baseQty: qty, baseUnit: 'g' }
  if (u === 'L') return { baseQty: qty * 1000, baseUnit: 'ml' }
  if (u === ML_UNIT) return { baseQty: qty, baseUnit: 'ml' }
  return { baseQty: qty, baseUnit: u }
}

/** Allowed multipliers for recipe URL import (drawer buttons). */
export const RECIPE_IMPORT_SCALE_OPTIONS = [1, 1.5, 2, 3] as const
export type RecipeImportScale = (typeof RECIPE_IMPORT_SCALE_OPTIONS)[number]

/** Snap any numeric scale to the nearest allowed recipe import multiplier. */
export function normalizeRecipeImportScale(scale: number): RecipeImportScale {
  const n = Number(scale)
  if (!Number.isFinite(n)) return 1
  if (n <= 1) return 1
  if (n >= 3) return 3
  let best: RecipeImportScale = 1
  let bestD = Infinity
  for (const v of RECIPE_IMPORT_SCALE_OPTIONS) {
    const d = Math.abs(n - v)
    if (d < bestD) {
      bestD = d
      best = v
    }
  }
  return best
}

/** Display qty/unit after applying recipe scale (g→kg if >999g, ml→L if >999 ml, ml always whole ceil). */
export function scaledDisplayFromBase(baseQty: number, baseUnit: string, scale: number): { qty: number; unit: string } {
  const bu = normalizeUnit(baseUnit)
  const s = normalizeRecipeImportScale(scale)

  if (bu === 'g') {
    const q = baseQty * s
    if (q > 999) {
      const kg = q / 1000
      return { qty: quantizeQuantityForUnit('kg', kg), unit: 'kg' }
    }
    return { qty: quantizeQuantityForUnit('g', q), unit: 'g' }
  }
  if (bu === 'ml') {
    const q = Math.ceil(baseQty * s - 1e-9)
    const whole = Math.max(1, q)
    if (whole > 999) {
      const L = whole / 1000
      return { qty: quantizeQuantityForUnit('L', L), unit: 'L' }
    }
    return { qty: whole, unit: 'ml' }
  }
  if (bu === 'tsp' || bu === 'tbs') {
    const q = Math.max(0.25, quantizeQuantityForUnit(bu, baseQty * s))
    return { qty: q, unit: bu }
  }
  if (bu === 'each') {
    return { qty: Math.min(20, Math.max(1, Math.round(baseQty * s))), unit: 'each' }
  }
  return { qty: baseQty * s, unit: bu }
}

/** Reverse scaled display back to canonical base (g / ml / …) for the current scale. */
export function baseFromScaledDisplay(displayQty: number, displayUnit: string, scale: number): { baseQty: number; baseUnit: string } {
  const u = normalizeUnit(displayUnit)
  const s = normalizeRecipeImportScale(scale)
  const bq = displayQty / s
  if (u === 'kg') return { baseQty: bq * 1000, baseUnit: 'g' }
  if (u === 'g') return { baseQty: bq, baseUnit: 'g' }
  if (u === 'L') return { baseQty: bq * 1000, baseUnit: 'ml' }
  if (u === ML_UNIT) return { baseQty: bq, baseUnit: 'ml' }
  return { baseQty: bq, baseUnit: u }
}

/** Express canonical base (g / ml / each / …) as a 1× amount in `inUnit` (g vs kg, ml vs L). */
export function baseCanonToQuantityInUnit(baseQty: number, baseCanon: string, inUnit: string): number {
  const bu = normalizeUnit(baseCanon)
  const u = normalizeUnit(inUnit)
  if (bu === 'g' && u === 'g') return baseQty
  if (bu === 'g' && u === 'kg') return baseQty / 1000
  if (bu === 'ml' && u === 'ml') return baseQty
  if (bu === 'ml' && u === 'L') return baseQty / 1000
  if (bu === u) return baseQty
  return baseQty
}

/**
 * Like scaledDisplayFromBase but keeps g vs kg / ml vs L as `preferUnit` (no auto-switch by amount).
 * Used after manual quantity or unit edits in recipe import.
 */
export function scaledDisplayFromBaseKeepUnit(
  baseQty: number,
  baseUnit: string,
  scale: number,
  preferUnit: string,
): { qty: number; unit: string } {
  const pu = normalizeUnit(preferUnit)
  const s = normalizeRecipeImportScale(scale)
  const bu = normalizeUnit(baseUnit)

  if (bu === 'g') {
    const grams = baseQty * s
    if (pu === 'kg') return { qty: quantizeQuantityForUnit('kg', grams / 1000), unit: 'kg' }
    if (pu === 'g') return { qty: quantizeQuantityForUnit('g', grams), unit: 'g' }
    return scaledDisplayFromBase(baseQty, baseUnit, scale)
  }
  if (bu === 'ml') {
    const wholeMl = Math.max(1, Math.ceil(baseQty * s - 1e-9))
    if (pu === 'L') return { qty: quantizeQuantityForUnit('L', wholeMl / 1000), unit: 'L' }
    if (pu === ML_UNIT) return { qty: wholeMl, unit: 'ml' }
    return scaledDisplayFromBase(baseQty, baseUnit, scale)
  }
  if (bu === 'tsp' || bu === 'tbs') {
    if (pu === bu) {
      const q = Math.max(0.25, quantizeQuantityForUnit(bu, baseQty * s))
      return { qty: q, unit: bu }
    }
    return scaledDisplayFromBase(baseQty, baseUnit, scale)
  }
  if (bu === 'each') {
    return { qty: Math.min(20, Math.max(1, Math.round(baseQty * s))), unit: 'each' }
  }
  return scaledDisplayFromBase(baseQty, baseUnit, scale)
}

function formatDecimalQtyForDisplay(unit: string, quantity: number): string {
  const u = normalizeUnit(unit)
  const n = Number(quantity)
  if (!Number.isFinite(n)) return u === ML_UNIT ? '1' : '0.01'
  const v = Math.max(minQtyForUnit(u), quantizeQuantityForUnit(u, n))
  if (u === 'each') return String(Math.round(v))
  if (u === ML_UNIT) return String(Math.max(1, Math.ceil(n - 1e-9)))
  if (DECIMAL_MASS.has(u)) {
    if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v))
    const s = v.toFixed(2)
    return s.replace(/\.?0+$/, '')
  }
  if (u === 'tsp' || u === 'tbs') {
    if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v))
    const s = v.toFixed(2)
    return s.replace(/\.?0+$/, '')
  }
  return String(v)
}

function minQtyForUnit(u: string): number {
  if (u === ML_UNIT) return 1
  if (u === 'tsp' || u === 'tbs') return 0.25
  return 0.01
}

export function formatQuantityForInput(unit: string, quantity: number): string {
  const u = normalizeUnit(unit)
  if (u === 'each') return String(Math.round(quantity))
  if (u === ML_UNIT || u === 'g' || u === 'kg' || u === 'L' || u === 'tsp' || u === 'tbs') {
    return formatDecimalQtyForDisplay(u, quantity)
  }
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
  if (u === ML_UNIT) {
    const n = parseFloat(t.replace(',', '.'))
    if (!Number.isFinite(n)) return null
    return Math.max(1, Math.ceil(n - 1e-9))
  }
  if (u === 'g' || u === 'kg' || u === 'L' || u === 'tsp' || u === 'tbs') {
    const n = parseFloat(t.replace(',', '.'))
    if (!Number.isFinite(n)) return null
    return Math.max(minQtyForUnit(u), quantizeQuantityForUnit(u, n))
  }
  return null
}

/** Clamp a numeric quantity for persistence given unit */
export function clampQuantityForUnit(unit: string, quantity: number): number | null {
  const u = normalizeUnit(unit)
  if (!Number.isFinite(quantity)) return null
  if (u === 'each') return Math.min(20, Math.max(1, Math.round(quantity)))
  if (u === ML_UNIT) return Math.max(1, Math.ceil(quantity - 1e-9))
  if (u === 'g' || u === 'kg' || u === 'L' || u === 'tsp' || u === 'tbs') {
    return Math.max(minQtyForUnit(u), quantizeQuantityForUnit(u, quantity))
  }
  return null
}

/** When changing unit, derive a sensible starting quantity */
export function quantityWhenChangingUnit(prevUnit: string, nextUnit: string, prevQty: number): number {
  const from = normalizeUnit(prevUnit)
  const to = normalizeUnit(nextUnit)
  const q = Number(prevQty)
  if (!Number.isFinite(q)) return to === 'each' ? 1 : to === ML_UNIT ? 1 : 0.01

  if (from === to) return quantizeQuantityForUnit(to, q)

  if (to === 'each') return Math.min(20, Math.max(1, Math.round(q) || 1))

  if (from === 'tsp' && to === 'tbs') return quantizeQuantityForUnit('tbs', q / 3)
  if (from === 'tbs' && to === 'tsp') return quantizeQuantityForUnit('tsp', q * 3)

  let next = q
  if (from === 'g' && to === 'kg') next = q / 1000
  else if (from === 'kg' && to === 'g') next = q * 1000
  else if (from === 'ml' && to === 'L') next = q / 1000
  else if (from === 'L' && to === 'ml') next = q * 1000
  else if (from === 'each') {
    // Count → mass/volume has no fixed conversion; use 1 in the new unit.
    if (to === 'g' || to === 'kg' || to === ML_UNIT || to === 'L' || to === 'tsp' || to === 'tbs') {
      next = 1
    } else {
      next = Math.max(0.01, q)
    }
  } else {
    next = Math.max(0.01, q)
  }

  return quantizeQuantityForUnit(to, next)
}
