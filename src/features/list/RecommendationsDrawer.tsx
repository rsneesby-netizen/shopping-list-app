import { useEffect, useMemo, useState } from 'react'
import type { Suggestion } from '../../lib/recommendations'
import { estimateSuggestionLineCost } from '../../lib/pricing'
import type { StorePresetRow } from '../../types'
import {
  clampQuantityForUnit,
  formatQuantityForInput,
  normalizeUnit,
  parseQuantityInput,
  quantityWhenChangingUnit,
  unitOptionLabel,
  UNIT_OPTIONS,
} from '../../lib/units'
import { RecommendationThumbDownIcon } from './listIcons'

const EACH_OPTIONS = Array.from({ length: 20 }, (_, i) => i + 1)

const qtyBoxClass =
  'box-border h-8 w-8 shrink-0 rounded border border-slate-200/80 bg-white text-center text-xs tabular-nums text-slate-700 outline-none focus:border-slate-400 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-slate-500'

const noChevron =
  'appearance-none bg-[length:0] [background-image:none] [&::-webkit-appearance]:none'

const unitSelectClass =
  `${noChevron} shrink-0 cursor-pointer border-0 bg-transparent p-0 text-[10px] leading-tight text-slate-500 outline-none ring-0 focus:border-0 focus:outline-none focus:ring-0 dark:text-slate-400`

export type RecommendationBatchRow = {
  fingerprint: string
  displayText: string
  qty: number
  unit: string
}

type LineState = { selected: boolean; qty: number; qtyText: string; unit: string }

type Props = {
  open: boolean
  onClose: () => void
  suggestions: Suggestion[]
  storePresetId: string | null
  presets: StorePresetRow[]
  onDismiss: (fingerprint: string, displayText: string) => void | Promise<void>
  onAddBatch: (rows: RecommendationBatchRow[]) => void | Promise<void>
}

function eachQty(n: number) {
  const r = Math.round(Number(n))
  return Math.min(20, Math.max(1, Number.isFinite(r) ? r : 1))
}

export function RecommendationsDrawer({
  open,
  onClose,
  suggestions,
  storePresetId,
  presets,
  onDismiss,
  onAddBatch,
}: Props) {
  const [lineState, setLineState] = useState<Record<string, LineState>>({})
  const [busy, setBusy] = useState(false)

  const suggKey = useMemo(
    () => suggestions.map((s) => `${s.fingerprint}:${s.suggestedQty}:${s.unit}`).join('|'),
    [suggestions],
  )

  useEffect(() => {
    if (!open) return
    const next: Record<string, LineState> = {}
    for (const s of suggestions) {
      const u = normalizeUnit(s.unit)
      next[s.fingerprint] = {
        selected: false,
        qty: s.suggestedQty,
        qtyText: formatQuantityForInput(u, s.suggestedQty),
        unit: u,
      }
    }
    setLineState(next)
  }, [open, suggKey, suggestions])

  if (!open) return null

  function setLine(fp: string, patch: Partial<LineState>) {
    setLineState((prev) => {
      const cur = prev[fp]
      if (!cur) return prev
      return { ...prev, [fp]: { ...cur, ...patch } }
    })
  }

  function lineCost(s: Suggestion): number {
    const st = lineState[s.fingerprint]
    const u = normalizeUnit(st?.unit ?? s.unit)
    let q = st?.qty ?? s.suggestedQty
    if (u !== 'each' && st) {
      const p = parseQuantityInput(u, st.qtyText)
      if (p !== null) q = p
    }
    return estimateSuggestionLineCost(s.displayText, q, u, storePresetId, presets)
  }

  function buildBatch(): RecommendationBatchRow[] {
    const out: RecommendationBatchRow[] = []
    const seen = new Set<string>()
    for (const s of suggestions) {
      if (seen.has(s.fingerprint)) continue
      const st = lineState[s.fingerprint]
      if (!st?.selected) continue
      const u = normalizeUnit(st.unit ?? s.unit)
      let qty: number | null = null
      if (u === 'each') {
        qty = clampQuantityForUnit('each', st.qty)
      } else {
        qty = clampQuantityForUnit(u, parseQuantityInput(u, st.qtyText) ?? NaN)
      }
      if (qty === null) continue
      seen.add(s.fingerprint)
      out.push({ fingerprint: s.fingerprint, displayText: s.displayText, qty, unit: u })
    }
    return out
  }

  const batch = buildBatch()
  const selectedCount = suggestions.filter((s) => lineState[s.fingerprint]?.selected).length

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/30" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl dark:bg-slate-900 sm:rounded-l-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shrink-0 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Recommended</h2>
              <p className="text-xs text-slate-500">From your check-off history on this list.</p>
            </div>
            <button type="button" className="text-sm text-slate-500" onClick={onClose}>
              Done
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-28">
          {suggestions.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-500 dark:border-slate-700">
              Check off items a few times to build history. Suggestions avoid items already on your list.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5 sm:gap-2">
              {suggestions.map((s) => {
                const st = lineState[s.fingerprint]
                const u = normalizeUnit(st?.unit ?? s.unit)
                const isEach = u === 'each'
                return (
                  <li
                    key={s.fingerprint}
                    className="flex flex-wrap items-center gap-1.5 rounded-[6px] border border-slate-200 bg-white px-2 py-1.5 sm:gap-2 sm:px-3 sm:py-2 dark:border-slate-700 dark:bg-slate-900"
                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 sm:gap-3">
                      <input
                        type="checkbox"
                        checked={st?.selected ?? false}
                        onChange={(e) => setLine(s.fingerprint, { selected: e.target.checked })}
                        className="h-4 w-4 shrink-0 rounded border-slate-300 text-teal-700 sm:h-5 sm:w-5"
                        aria-label={`Include ${s.displayText}`}
                      />
                      <span className="min-w-0 flex-1 text-left text-sm text-slate-900 dark:text-slate-50">
                        {s.displayText}
                      </span>
                    </label>
                    <div className="flex shrink-0 items-center gap-1">
                      {isEach ? (
                        <select
                          className={`${qtyBoxClass} ${noChevron} px-0.5`}
                          value={eachQty(st?.qty ?? s.suggestedQty)}
                          onChange={(e) => {
                            const v = Number(e.target.value)
                            setLine(s.fingerprint, { qty: v, qtyText: String(v) })
                          }}
                          aria-label={`Quantity for ${s.displayText}`}
                        >
                          {EACH_OPTIONS.map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          inputMode="decimal"
                          className={`${qtyBoxClass} px-0.5`}
                          value={st?.qtyText ?? formatQuantityForInput(u, s.suggestedQty)}
                          onChange={(e) => setLine(s.fingerprint, { qtyText: e.target.value })}
                          onBlur={() => {
                            const p = parseQuantityInput(u, st?.qtyText ?? '')
                            if (p !== null) {
                              setLine(s.fingerprint, {
                                qty: p,
                                qtyText: formatQuantityForInput(u, p),
                              })
                            } else {
                              setLine(s.fingerprint, {
                                qtyText: formatQuantityForInput(u, st?.qty ?? s.suggestedQty),
                              })
                            }
                          }}
                          aria-label={`Quantity for ${s.displayText}`}
                        />
                      )}
                      <select
                        value={u}
                        onChange={(e) => {
                          const prevU = normalizeUnit(st?.unit ?? s.unit)
                          const nu = normalizeUnit(e.target.value)
                          if (prevU === nu) return
                          let pq = st?.qty ?? s.suggestedQty
                          if (prevU !== 'each') {
                            const parsed = parseQuantityInput(prevU, st?.qtyText ?? '')
                            if (parsed !== null) pq = parsed
                          }
                          const nextQty = quantityWhenChangingUnit(prevU, nu, pq)
                          setLine(s.fingerprint, {
                            unit: nu,
                            qty: nextQty,
                            qtyText: formatQuantityForInput(nu, nextQty),
                          })
                        }}
                        className={unitSelectClass}
                        aria-label={`Unit for ${s.displayText}`}
                      >
                        {UNIT_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {unitOptionLabel(opt)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="min-w-[4.5rem] shrink-0 text-right text-xs tabular-nums text-slate-600 dark:text-slate-300">
                      ${lineCost(s).toFixed(2)}
                    </div>
                    <button
                      type="button"
                      className="grid min-h-8 min-w-8 shrink-0 place-items-center rounded-[6px] text-[#505258] hover:bg-slate-100 active:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 dark:active:bg-slate-800"
                      aria-label={`Not interested in ${s.displayText}`}
                      title="Hide from recommendations"
                      onClick={() => void onDismiss(s.fingerprint, s.displayText)}
                    >
                      <RecommendationThumbDownIcon className="h-5 w-5 sm:h-6 sm:w-6" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="shrink-0 border-t border-slate-200 bg-white/95 px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
          <button
            type="button"
            disabled={busy || batch.length === 0}
            className="min-h-10 w-full rounded-xl bg-teal-700 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
            onClick={async () => {
              setBusy(true)
              try {
                await onAddBatch(batch)
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Adding…' : `Add items to list${batch.length ? ` (${batch.length})` : ''}`}
          </button>
          {selectedCount > 0 && batch.length === 0 ? (
            <p className="mt-2 text-center text-xs text-amber-800 dark:text-amber-200">
              Fix invalid quantities for selected rows, or deselect them.
            </p>
          ) : null}
        </div>
      </aside>
    </div>
  )
}
