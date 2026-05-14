import type { ListItemEventRow, ListItemRow } from '../types'
import { fingerprintFromText } from './normalize'

export type Suggestion = {
  fingerprint: string
  displayText: string
  suggestedQty: number
  unit: string
  confidence: 'high' | 'medium' | 'low'
  reason: string
  /** User previously thumbs-downed but bought again — sort lower than never-dismissed. */
  deprioritized?: boolean
}

function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

function median(nums: number[]): number {
  if (!nums.length) return 0
  const s = [...nums].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

function lastDismissMs(events: ListItemEventRow[], fp: string, horizonStart: number): number | null {
  let max: number | null = null
  for (const e of events) {
    if (e.event_type !== 'recommendation_dismissed' || e.fingerprint !== fp) continue
    const t = new Date(e.created_at).getTime()
    if (t < horizonStart) continue
    if (max === null || t > max) max = t
  }
  return max
}

function countChecksSince(events: ListItemEventRow[], fp: string, sinceMs: number): number {
  let n = 0
  for (const e of events) {
    if (e.event_type !== 'item_checked' || e.fingerprint !== fp) continue
    if (new Date(e.created_at).getTime() > sinceMs) n += 1
  }
  return n
}

export function buildSuggestions(
  events: ListItemEventRow[],
  currentItems: ListItemRow[],
  now = new Date(),
): Suggestion[] {
  const horizonMs = 90 * 86400000
  const cutoff = now.getTime() - horizonMs

  const checked = events.filter(
    (e) =>
      e.event_type === 'item_checked' &&
      new Date(e.created_at).getTime() >= cutoff &&
      e.fingerprint,
  )

  type Agg = {
    fingerprint: string
    displayText: string
    weeklyTotals: Map<string, number>
    purchaseQtys: number[]
    firstPurchaseAt: number
    lastPurchaseAt: number
    lastQty: number
    lastUnit: string
  }

  const byFp = new Map<string, Agg>()

  for (const e of checked) {
    const fp = e.fingerprint!
    const p = (e.payload ?? {}) as Record<string, unknown>
    const qty = Number(p.quantity ?? 1) || 1
    const unit = String(p.unit ?? 'each')
    const text = String(p.text ?? fp)
    const wk = isoWeekKey(new Date(e.created_at))
    const ts = new Date(e.created_at).getTime()

    let a = byFp.get(fp)
    if (!a) {
      a = {
        fingerprint: fp,
        displayText: text,
        weeklyTotals: new Map(),
        purchaseQtys: [],
        firstPurchaseAt: ts,
        lastPurchaseAt: 0,
        lastQty: 0,
        lastUnit: unit,
      }
      byFp.set(fp, a)
    }
    a.weeklyTotals.set(wk, (a.weeklyTotals.get(wk) ?? 0) + qty)
    a.purchaseQtys.push(qty)
    a.firstPurchaseAt = Math.min(a.firstPurchaseAt, ts)
    if (ts >= a.lastPurchaseAt) {
      a.lastPurchaseAt = ts
      a.lastQty = qty
      a.lastUnit = unit
      a.displayText = text
    }
  }

  const existing = new Set(
    currentItems.filter((i) => !i.checked).map((i) => fingerprintFromText(i.text)),
  )

  const suggestions: Suggestion[] = []

  for (const a of byFp.values()) {
    const fp = a.fingerprint
    if (existing.has(fp)) continue

    const lastDim = lastDismissMs(events, fp, cutoff)
    if (lastDim !== null && countChecksSince(events, fp, lastDim) < 3) {
      continue
    }
    const deprioritized = lastDim !== null

    const weeks = [...a.weeklyTotals.values()]
    const weeklyConsumption = median(weeks)
    if (weeklyConsumption <= 0) continue

    const purchaseCount = checked.filter((c) => c.fingerprint === fp).length
    if (purchaseCount < 2) continue

    const purchaseMed = median(a.purchaseQtys)
    const medianPurchase = purchaseMed > 0 ? purchaseMed : a.lastQty || 1

    const nowMs = now.getTime()
    const weeksSinceLast = Math.max(0.0001, (nowMs - a.lastPurchaseAt) / (7 * 86400000))
    const depletedEstimate = a.lastQty - weeklyConsumption * weeksSinceLast
    const targetBuffer = weeklyConsumption * 0.5
    if (depletedEstimate > targetBuffer) continue

    const spanMs = Math.max(nowMs - a.firstPurchaseAt, 86400000)
    const spanWeeks = spanMs / (7 * 86400000)
    const weekCoverage = Math.min(1.2, a.weeklyTotals.size / Math.max(0.75, spanWeeks))

    let suggestedQty =
      medianPurchase * (0.5 + 0.3 * weekCoverage) + weeklyConsumption * (0.12 + 0.18 * weekCoverage)
    suggestedQty = Math.min(suggestedQty, Math.max(weeklyConsumption * 0.9, medianPurchase * 1.05))
    suggestedQty = Math.max(0.25, Math.round(suggestedQty * 10) / 10)
    if (suggestedQty < 0.25) continue

    const confidence: Suggestion['confidence'] =
      purchaseCount >= 6 ? 'high' : purchaseCount >= 3 ? 'medium' : 'low'

    const reasonParts: string[] = []
    reasonParts.push(`Usual purchase ~${medianPurchase.toFixed(1)} ${a.lastUnit}`)
    reasonParts.push(`~${weeklyConsumption.toFixed(1)} ${a.lastUnit}/wk across weeks`)
    if (weekCoverage >= 0.55) reasonParts.push('often weekly')

    suggestions.push({
      fingerprint: fp,
      displayText: a.displayText,
      suggestedQty,
      unit: a.lastUnit,
      confidence,
      reason: reasonParts.join(' · '),
      deprioritized,
    })
  }

  suggestions.sort((x, y) => {
    const rank = { high: 0, medium: 1, low: 2 }
    if (rank[x.confidence] !== rank[y.confidence]) return rank[x.confidence] - rank[y.confidence]
    if (Boolean(x.deprioritized) !== Boolean(y.deprioritized)) return Number(x.deprioritized) - Number(y.deprioritized)
    return y.suggestedQty - x.suggestedQty
  })

  return suggestions
}
