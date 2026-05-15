import type { PostgrestError } from '@supabase/supabase-js'

export function errorMessageFromUnknown(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'object' && e !== null && 'message' in e) {
    const m = (e as { message: unknown }).message
    if (typeof m === 'string' && m.length) return m
  }
  return typeof e === 'string' ? e : 'Update failed'
}

/** True when PostgREST/Postgres rejects `price_calibration_by_scope` (migration not applied). */
export function isMissingPriceCalibrationByScopeColumn(error: PostgrestError): boolean {
  const msg = (error.message ?? '').toLowerCase()
  return (
    error.code === 'PGRST204' ||
    error.code === '42703' ||
    msg.includes('price_calibration_by_scope')
  )
}
