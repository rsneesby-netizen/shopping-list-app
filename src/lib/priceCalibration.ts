import type { ListItemRow, PriceCalibrationV1 } from '../types'
import { clampQuantityForUnit, normalizeUnit } from './units'

/** Scope key when the list has no store preset selected (matches DB migration default bucket). */
export const PRICE_CALIBRATION_FALLBACK_SCOPE = '_'

export function parsePriceCalibration(raw: unknown): PriceCalibrationV1 | null {
  if (raw == null || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.v !== 1) return null
  const paidAud = Number(o.paidAud)
  const packQty = Number(o.packQty)
  const unit = typeof o.unit === 'string' ? normalizeUnit(o.unit) : ''
  if (!Number.isFinite(paidAud) || paidAud <= 0) return null
  if (unit !== 'each' && unit !== 'L' && unit !== 'kg' && unit !== 'g' && unit !== 'ml' && unit !== 'tsp' && unit !== 'tbs')
    return null
  const q = clampQuantityForUnit(unit, packQty)
  if (q === null || q <= 0) return null
  return { v: 1, paidAud, packQty: q, unit }
}

export function parsePriceCalibrationForScope(
  item: Pick<ListItemRow, 'price_calibration_by_scope' | 'price_calibration'>,
  scopeKey: string | null,
): PriceCalibrationV1 | null {
  const key = scopeKey ?? PRICE_CALIBRATION_FALLBACK_SCOPE
  const map = item.price_calibration_by_scope
  const raw = map && typeof map === 'object' && !Array.isArray(map) ? (map as Record<string, unknown>)[key] : undefined
  const fromKey = parsePriceCalibration(raw)
  if (fromKey) return fromKey

  const hasAnyScopedCalibration =
    map &&
    typeof map === 'object' &&
    !Array.isArray(map) &&
    Object.keys(map as Record<string, unknown>).some((k) =>
      parsePriceCalibration((map as Record<string, unknown>)[k]),
    )
  if (hasAnyScopedCalibration) return null

  return parsePriceCalibration(item.price_calibration)
}

export function mergeCalibrationIntoMap(
  prev: Record<string, unknown> | null | undefined,
  scopeKey: string,
  cal: PriceCalibrationV1,
): Record<string, unknown> {
  const base =
    prev && typeof prev === 'object' && !Array.isArray(prev) ? { ...prev } : ({} as Record<string, unknown>)
  base[scopeKey] = cal
  return base
}

export function removeCalibrationFromMap(
  prev: Record<string, unknown> | null | undefined,
  scopeKey: string,
): Record<string, unknown> {
  const base =
    prev && typeof prev === 'object' && !Array.isArray(prev) ? { ...prev } : ({} as Record<string, unknown>)
  delete base[scopeKey]
  return base
}

/** Line total in AUD from calibration, or null if incompatible with the line. */
export function calibratedLineCostAud(item: Pick<ListItemRow, 'quantity' | 'unit'>, cal: PriceCalibrationV1 | null): number | null {
  if (!cal) return null
  const iu = normalizeUnit(item.unit)
  const cu = normalizeUnit(cal.unit)
  if (iu !== cu) return null
  const iq = Math.max(0, Number(item.quantity) || 0)
  if (iq <= 0) return null
  const unitPrice = cal.paidAud / cal.packQty
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return null
  const raw = unitPrice * iq
  return Math.round(raw * 100) / 100
}
