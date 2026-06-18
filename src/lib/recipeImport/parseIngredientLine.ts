import { cleanRecipeIngredientNarrative } from './cleanRecipeIngredientText'
import { clampQuantityForUnit, normalizeUnit } from '../units'

export type ParsedIngredient = {
  displayText: string
  qty: number
  unit: string
  /**
   * When true, qty/unit were parsed from the start of the line and removed from displayText.
   * When false, qty is 1 each and any numbers stay in displayText (user can edit or split manually).
   */
  structuredQuantity: boolean
}

const CUP_TO_ML = 236.588
const US_PINT_ML = 473.176
const US_QUART_ML = 946.353
const OZ_TO_KG = 0.028349523125
const LB_TO_KG = 0.45359237

const UNICODE_FRAC: Record<string, string> = {
  '\u00BC': '1/4',
  '\u00BD': '1/2',
  '\u00BE': '3/4',
  '\u2150': '1/7',
  '\u2151': '1/9',
  '\u2152': '1/10',
  '\u2153': '1/3',
  '\u2154': '2/3',
  '\u2155': '1/5',
  '\u2156': '2/5',
  '\u2157': '3/5',
  '\u2158': '4/5',
  '\u2159': '1/6',
  '\u215A': '5/6',
  '\u215B': '1/8',
  '\u215C': '3/8',
  '\u215D': '5/8',
  '\u215E': '7/8',
}

function stripListLead(s: string): string {
  return s.replace(/^[\s*•\u2022\u2013\u2014-]+/, '').trim()
}

function normalizeSpaces(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function expandUnicodeFractions(s: string): string {
  let t = s
  for (const [u, f] of Object.entries(UNICODE_FRAC)) {
    t = t.replaceAll(u, ` ${f} `)
  }
  return normalizeSpaces(t)
}

/** Parse leading number: decimals, fractions, mixed "1 1/2" */
export function parseLeadingNumber(raw: string): number | null {
  const t = expandUnicodeFractions(raw.trim())
  if (!t) return null
  const parts = t.split(' ')
  let total = 0
  for (const part of parts) {
    if (!part) continue
    if (part.includes('/')) {
      const [a, b] = part.split('/').map((x) => Number(x.trim()))
      if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null
      total += a / b
    } else {
      const n = Number(part)
      if (!Number.isFinite(n)) return null
      total += n
    }
  }
  return total === 0 ? null : total
}

function trimLeadComma(s: string): string {
  return s.trim().replace(/^[,;]\s*/, '').trim()
}

function leadRestConfident(n: number, rest: string): boolean {
  const r = rest.trim()
  if (r.length < 2) return false
  if (/^\d/.test(r)) return false
  if (/^[\d./\s]+(g|kg|ml|mL|oz|lb|cup|tsp|tbsp|tbs)\b/i.test(r)) return false
  if (!Number.isFinite(n) || n <= 0) return false
  if (n > 250) return false
  return true
}

function clampParsed(p: ParsedIngredient): ParsedIngredient {
  if (!p.structuredQuantity) {
    const text = normalizeSpaces(p.displayText)
    return { displayText: text || 'Item', qty: 1, unit: 'each', structuredQuantity: false }
  }
  const u = normalizeUnit(p.unit)
  const q = clampQuantityForUnit(u, p.qty)
  const qty = q ?? (u === 'each' ? 1 : 0.01)
  const text = normalizeSpaces(p.displayText)
  return { displayText: text || 'Item', qty, unit: u, structuredQuantity: true }
}

/**
 * Parse a single ingredient line: strip site fluff, then split measurable qty/unit when confident.
 */
export function parseIngredientLine(raw: string): ParsedIngredient {
  const cleaned = cleanRecipeIngredientNarrative(stripListLead(raw))
  const s0 = expandUnicodeFractions(cleaned)
  if (!s0) return clampParsed({ displayText: 'Item', qty: 1, unit: 'each', structuredQuantity: false })

  const tryMassGlued = s0.match(/^([\d.]+)(g|kg)\b/i)
  if (tryMassGlued) {
    const n = Number(tryMassGlued[1])
    if (Number.isFinite(n)) {
      const suf = tryMassGlued[2].toLowerCase()
      const rest = trimLeadComma(s0.slice(tryMassGlued[0].length))
      if (suf === 'kg') {
        return clampParsed({ displayText: rest || s0, qty: n, unit: 'kg', structuredQuantity: true })
      }
      return clampParsed({ displayText: rest || s0, qty: n, unit: 'g', structuredQuantity: true })
    }
  }

  const tryMassSpaced = s0.match(/^([\d\s./]+)\s+(g|kg)\b/i)
  if (tryMassSpaced) {
    const n = parseLeadingNumber(tryMassSpaced[1])
    if (n != null) {
      const suf = tryMassSpaced[2].toLowerCase()
      const rest = trimLeadComma(s0.slice(tryMassSpaced[0].length))
      if (suf === 'kg') {
        return clampParsed({ displayText: rest || s0, qty: n, unit: 'kg', structuredQuantity: true })
      }
      return clampParsed({ displayText: rest || s0, qty: n, unit: 'g', structuredQuantity: true })
    }
  }

  const tryLb = s0.match(/^([\d\s./]+)\s*(lb|lbs|pounds?)\b/i)
  if (tryLb) {
    const n = parseLeadingNumber(tryLb[1])
    if (n != null) {
      const kg = n * LB_TO_KG
      const rest = trimLeadComma(s0.slice(tryLb[0].length))
      return clampParsed({ displayText: rest || s0, qty: kg, unit: 'kg', structuredQuantity: true })
    }
  }

  const tryOz = s0.match(/^([\d\s./]+)\s*(oz|ounces?)\b/i)
  if (tryOz) {
    const n = parseLeadingNumber(tryOz[1])
    if (n != null) {
      const kg = n * OZ_TO_KG
      const rest = trimLeadComma(s0.slice(tryOz[0].length))
      return clampParsed({
        displayText: rest || s0,
        qty: Math.max(0.0001, kg),
        unit: 'kg',
        structuredQuantity: true,
      })
    }
  }

  const tryVolGlued = s0.match(/^([\d.]+)(ml|mL)\b/i)
  if (tryVolGlued) {
    const n = Number(tryVolGlued[1])
    if (Number.isFinite(n)) {
      const rest = trimLeadComma(s0.slice(tryVolGlued[0].length))
      return clampParsed({ displayText: rest || s0, qty: n, unit: 'ml', structuredQuantity: true })
    }
  }

  const tryVolSpaced = s0.match(/^([\d\s./]+)\s+(ml|mL|millilitres?|milliliters?)\b/i)
  if (tryVolSpaced) {
    const n = parseLeadingNumber(tryVolSpaced[1])
    if (n != null) {
      const rest = trimLeadComma(s0.slice(tryVolSpaced[0].length))
      return clampParsed({ displayText: rest || s0, qty: n, unit: 'ml', structuredQuantity: true })
    }
  }

  const tryL = s0.match(/^([\d\s./]+)\s*(L|l|litres?|liters?)\b/i)
  if (tryL) {
    const n = parseLeadingNumber(tryL[1])
    if (n != null) {
      const rest = trimLeadComma(s0.slice(tryL[0].length))
      return clampParsed({ displayText: rest || s0, qty: n, unit: 'L', structuredQuantity: true })
    }
  }

  const quart = s0.match(/^([\d\s./]+)\s*(qt|quarts?)\b/i)
  if (quart) {
    const n = parseLeadingNumber(quart[1]) ?? 1
    const ml = n * US_QUART_ML
    const rest = trimLeadComma(s0.slice(quart[0].length))
    return clampParsed({ displayText: rest || s0, qty: ml, unit: 'ml', structuredQuantity: true })
  }

  const pint = s0.match(/^([\d\s./]+)\s*(pts?|pints?)\b/i)
  if (pint) {
    const n = parseLeadingNumber(pint[1]) ?? 1
    const ml = n * US_PINT_ML
    const rest = trimLeadComma(s0.slice(pint[0].length))
    return clampParsed({ displayText: rest || s0, qty: ml, unit: 'ml', structuredQuantity: true })
  }

  const cup = s0.match(/^([\d\s./]+)\s*(cup|cups)\b/i)
  if (cup) {
    const n = parseLeadingNumber(cup[1]) ?? 1
    const ml = n * CUP_TO_ML
    const rest = trimLeadComma(s0.slice(cup[0].length))
    return clampParsed({ displayText: rest || s0, qty: ml, unit: 'ml', structuredQuantity: true })
  }

  const tbsp = s0.match(/^([\d\s./]+)\s*(tbsp|tablespoons?|T\.)\b/i)
  if (tbsp) {
    const n = parseLeadingNumber(tbsp[1]) ?? 1
    const rest = trimLeadComma(s0.slice(tbsp[0].length))
    return clampParsed({
      displayText: rest || s0,
      qty: n,
      unit: 'tbs',
      structuredQuantity: true,
    })
  }

  const tsp = s0.match(/^([\d\s./]+)\s*(tsp|teaspoons?|t\.)\b/i)
  if (tsp) {
    const n = parseLeadingNumber(tsp[1]) ?? 1
    const rest = trimLeadComma(s0.slice(tsp[0].length))
    return clampParsed({
      displayText: rest || s0,
      qty: n,
      unit: 'tsp',
      structuredQuantity: true,
    })
  }

  const leadRest = s0.match(/^([\d\s./]+)\s+(.+)/)
  if (leadRest) {
    const n = parseLeadingNumber(leadRest[1])
    const rest = leadRest[2].trim()
    if (n != null && leadRestConfident(n, rest)) {
      return clampParsed({ displayText: rest, qty: n, unit: 'each', structuredQuantity: true })
    }
  }

  return clampParsed({ displayText: s0, qty: 1, unit: 'each', structuredQuantity: false })
}
