import type { SupabaseClient } from '@supabase/supabase-js'
import type { ListPriceLearningRow, PriceCalibrationV1 } from '../types'
import { normalizeUnit } from './units'
import { nextEmaUnitPrice, observedUnitPriceFromCalibration } from './priceLearnings'

export async function upsertPriceLearningFromCalibration(
  supabase: SupabaseClient,
  params: {
    listId: string
    storePresetId: string
    fingerprint: string
    cal: PriceCalibrationV1
  },
): Promise<void> {
  const obs = observedUnitPriceFromCalibration(params.cal)
  if (!Number.isFinite(obs) || obs <= 0) return
  const unit = normalizeUnit(params.cal.unit)

  const { data: existing, error: eRead } = await supabase
    .from('list_price_learnings')
    .select('*')
    .eq('list_id', params.listId)
    .eq('fingerprint', params.fingerprint)
    .eq('store_preset_id', params.storePresetId)
    .eq('unit', unit)
    .maybeSingle()

  if (eRead) throw eRead

  const now = new Date().toISOString()
  let row: ListPriceLearningRow

  if (!existing) {
    row = {
      list_id: params.listId,
      fingerprint: params.fingerprint,
      store_preset_id: params.storePresetId,
      unit,
      ema_unit_price_aud: obs,
      sample_count: 1,
      min_unit_price_aud: obs,
      max_unit_price_aud: obs,
      last_obs_unit_price_aud: obs,
      updated_at: now,
    }
  } else {
    const ex = existing as ListPriceLearningRow
    const nextEma = nextEmaUnitPrice(ex.ema_unit_price_aud, obs, ex.sample_count)
    row = {
      ...ex,
      ema_unit_price_aud: nextEma,
      sample_count: ex.sample_count + 1,
      min_unit_price_aud: Math.min(ex.min_unit_price_aud, obs),
      max_unit_price_aud: Math.max(ex.max_unit_price_aud, obs),
      last_obs_unit_price_aud: obs,
      updated_at: now,
    }
  }

  const { error: eUpsert } = await supabase.from('list_price_learnings').upsert(row, {
    onConflict: 'list_id,fingerprint,store_preset_id,unit',
  })
  if (eUpsert) throw eUpsert
}
