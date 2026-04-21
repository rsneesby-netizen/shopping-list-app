import type { PricingEstimateRequest, PricingEstimateResponse } from './pricingContract'

/**
 * Optional server-side pricing adapter:
 * - calls our backend endpoint (where scraping/provider logic belongs)
 * - returns null on network/server failure so UI can fall back to local estimates
 */
export async function fetchRemotePricingEstimate(
  request: PricingEstimateRequest,
  opts?: { timeoutMs?: number },
): Promise<PricingEstimateResponse | null> {
  const timeoutMs = opts?.timeoutMs ?? 2500
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch('/api/pricing/estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal,
    })
    if (!res.ok) return null
    return (await res.json()) as PricingEstimateResponse
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}
