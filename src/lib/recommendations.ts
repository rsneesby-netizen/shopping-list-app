import type { ListItemEventRow, ListItemRow } from '../types'
import { fingerprintFromText } from './normalize'

export type Suggestion = {
  fingerprint: string
  displayText: string
  suggestedQty: number
  unit: string
  confidence: 'high' | 'medium' | 'low'
  reason: string
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
    let a = byFp.get(fp)
    if (!a) {
      a = {
        fingerprint: fp,
        displayText: text,
        weeklyTotals: new Map(),
        lastPurchaseAt: 0,
        lastQty: 0,
        lastUnit: unit,
      }
      byFp.set(fp, a)
    }
    a.weeklyTotals.set(wk, (a.weeklyTotals.get(wk) ?? 0) + qty)
    const t = new Date(e.created_at).getTime()
    if (t >= a.lastPurchaseAt) {
      a.lastPurchaseAt = t
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
    const weeks = [...a.weeklyTotals.values()]
    const weeklyConsumption = median(weeks)
    if (weeklyConsumption <= 0) continue

    const purchaseCount = checked.filter((c) => c.fingerprint === a.fingerprint).length
    if (purchaseCount < 2) continue

    const weeksSinceLast = Math.max(
      0.0001,
      (now.getTime() - a.lastPurchaseAt) / (7 * 86400000),
    )
    let projected = a.lastQty - weeklyConsumption * weeksSinceLast
    projected = Math.max(0, projected)

    const targetBuffer = weeklyConsumption * 0.35
    if (projected > targetBuffer) continue

    let suggestedQty = Math.max(weeklyConsumption - projected, weeklyConsumption * 0.25)
    suggestedQty = Math.round(suggestedQty * 10) / 10
    if (suggestedQty < 0.25) continue

    if (existing.has(a.fingerprint)) continue

    const confidence: Suggestion['confidence'] =
      purchaseCount >= 6 ? 'high' : purchaseCount >= 3 ? 'medium' : 'low'

    suggestions.push({
      fingerprint: a.fingerprint,
      displayText: a.displayText,
      suggestedQty,
      unit: a.lastUnit,
      confidence,
      reason: `Typical ~${weeklyConsumption.toFixed(1)} ${a.lastUnit}/wk; stock estimate low`,
    })
  }

  suggestions.sort((x, y) => {
    const rank = { high: 0, medium: 1, low: 2 }
    if (rank[x.confidence] !== rank[y.confidence]) return rank[x.confidence] - rank[y.confidence]
    return y.suggestedQty - x.suggestedQty
  })

  return suggestions
}
