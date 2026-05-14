import type { ListPriceLearningRow, PriceCalibrationV1, StorePresetRow } from '../types'
import { chainIndexColesBaseline } from './storeChain'
import { normalizeUnit } from './units'

export function priceLearningMapKey(fingerprint: string, storePresetId: string, unit: string) {
  return `${fingerprint}\0${storePresetId}\0${normalizeUnit(unit)}`
}

export function observedUnitPriceFromCalibration(cal: PriceCalibrationV1): number {
  if (cal.packQty <= 0 || cal.paidAud <= 0) return NaN
  return cal.paidAud / cal.packQty
}

/** Next EMA after a new observation (higher weight on history as sample_count grows). */
export function nextEmaUnitPrice(prevEma: number, obs: number, sampleCountBefore: number): number {
  const alpha = sampleCountBefore <= 0 ? 1 : Math.min(0.4, 2 / Math.sqrt(sampleCountBefore + 2))
  const next = alpha * obs + (1 - alpha) * prevEma
  return Math.round(next * 10000) / 10000
}

export type CrossStoreHint = { lineCost: number; confidence: 'medium' | 'low'; onSpecial: boolean }

/**
 * When this store has no learning yet, optionally blend in a translation from another store's EMA
 * if the seed/catalog line total is very far off (guards bad defaults without overwriting store-specific rows).
 */
export function crossStoreLineHint(
  fingerprint: string,
  unit: string,
  lineQty: number,
  currentStorePresetId: string,
  catalogLineCost: number,
  learnings: ListPriceLearningRow[],
  presets: StorePresetRow[],
): CrossStoreHint | null {
  if (lineQty <= 0 || !Number.isFinite(catalogLineCost) || catalogLineCost <= 0) return null
  const u = normalizeUnit(unit)
  const candidates = learnings.filter(
    (r) =>
      r.fingerprint === fingerprint &&
      normalizeUnit(r.unit) === u &&
      r.store_preset_id !== currentStorePresetId &&
      r.sample_count >= 2,
  )
  if (!candidates.length) return null
  candidates.sort((a, b) => b.sample_count - a.sample_count)
  const best = candidates[0]!
  const curSlug = presets.find((p) => p.id === currentStorePresetId)?.slug ?? null
  const othSlug = presets.find((p) => p.id === best.store_preset_id)?.slug ?? null
  const idxCur = chainIndexColesBaseline(curSlug)
  const idxOth = chainIndexColesBaseline(othSlug)
  if (idxOth <= 0) return null
  const translatedUnit = best.ema_unit_price_aud * (idxCur / idxOth)
  const translatedLine = Math.round(translatedUnit * lineQty * 100) / 100
  const rel = Math.abs(catalogLineCost - translatedLine) / Math.max(catalogLineCost, 0.01)
  if (rel < 0.42) return null
  const blended = Math.round((0.58 * translatedLine + 0.42 * catalogLineCost) * 100) / 100
  return { lineCost: blended, confidence: 'medium', onSpecial: false }
}

export function learningDealStripe(learning: ListPriceLearningRow): boolean {
  return learning.last_obs_unit_price_aud < learning.ema_unit_price_aud * 0.88
}
