/** Optional user price hint: paidAud for packQty in `unit` (same as list line unit). See `priceCalibration.ts`. */
export type PriceCalibrationV1 = {
  v: 1
  paidAud: number
  packQty: number
  unit: string
}

export type ListItemRow = {
  id: string
  list_id: string
  text: string
  quantity: number
  unit: string
  checked: boolean
  position: string
  category_key: string | null
  created_by: string | null
  updated_at: string
  price_calibration?: PriceCalibrationV1 | null
}

export type ListRow = {
  id: string
  owner_id: string
  title: string
  store_preset_id: string | null
  category_order_override: string[] | null
  created_at: string
}

export type StorePresetRow = {
  id: string
  slug: string
  name: string
}

export type StorePresetCategoryRow = {
  id: string
  preset_id: string
  category_key: string
  sort_index: number
  /** Custom label for this store; null uses default taxonomy label */
  label_override?: string | null
}

export type ListItemEventRow = {
  id: number
  list_id: string
  item_id: string | null
  user_id: string | null
  event_type: string
  fingerprint: string | null
  payload: Record<string, unknown>
  created_at: string
}

/** Learned typical unit price per list + item fingerprint + store layout + unit (from calibrations over time). */
export type ListPriceLearningRow = {
  list_id: string
  fingerprint: string
  store_preset_id: string
  unit: string
  ema_unit_price_aud: number
  sample_count: number
  min_unit_price_aud: number
  max_unit_price_aud: number
  last_obs_unit_price_aud: number
  updated_at: string
}

/** Per-list remembered category for an item fingerprint (normalized text). */
export type ListCategoryLearningRow = {
  list_id: string
  fingerprint: string
  category_key: string
  updated_at: string
}
