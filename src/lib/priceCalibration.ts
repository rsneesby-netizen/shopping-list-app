import type { ListItemRow, PriceCalibrationV1 } from '../types'
import { clampQuantityForUnit, normalizeUnit } from './units'

export function parsePriceCalibration(raw: unknown): PriceCalibrationV1 | null {
  if (raw == null || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.v !== 1) return null
  const paidAud = Number(o.paidAud)
  const packQty = Number(o.packQty)
  const unit = typeof o.unit === 'string' ? normalizeUnit(o.unit) : ''
  if (!Number.isFinite(paidAud) || paidAud <= 0) return null
  if (unit !== 'each' && unit !== 'L' && unit !== 'kg') return null
  const q = clampQuantityForUnit(unit, packQty)
  if (q === null || q <= 0) return null
  return { v: 1, paidAud, packQty: q, unit }
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
