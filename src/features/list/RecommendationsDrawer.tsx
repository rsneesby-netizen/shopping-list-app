import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Suggestion } from '../../lib/recommendations'
import { fingerprintFromText } from '../../lib/normalize'
import { estimateSuggestionLineCost } from '../../lib/pricing'
import type { StorePresetRow } from '../../types'
import {
  baseCanonToQuantityInUnit,
  baseFromScaledDisplay,
  clampQuantityForUnit,
  formatQuantityForInput,
  normalizeUnit,
  parseQuantityInput,
  quantityWhenChangingUnit,
  recipeLineBaseCanonical,
  scaledDisplayFromBase,
  scaledDisplayFromBaseKeepUnit,
  unitOptionLabel,
  UNIT_OPTIONS,
  RECIPE_IMPORT_SCALE_OPTIONS,
  type RecipeImportScale,
} from '../../lib/units'
import { ItemDeleteIcon } from './listIcons'

const EACH_OPTIONS = Array.from({ length: 20 }, (_, i) => i + 1)

const qtyBoxClass =
  'box-border h-8 w-[48px] min-w-[48px] max-w-[48px] shrink-0 rounded-l-[8px] rounded-r-none border border-r-0 border-slate-200/80 bg-white pl-0 pr-2 py-1 text-right text-base font-medium tabular-nums [text-align-last:right] text-[#505258] outline-none focus:border-slate-400 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-slate-500'

const qtyTextInputClass = `${qtyBoxClass} [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`

const noChevron =
  'appearance-none bg-[length:0] [background-image:none] [&::-webkit-appearance]:none'

const unitSelectClass =
  `${noChevron} h-8 w-[48px] min-w-[48px] max-w-[48px] shrink-0 cursor-pointer rounded-l-none rounded-r-[8px] border border-slate-200/80 bg-white px-2 py-1 text-left text-base font-medium leading-5 text-[#505258] outline-none ring-0 focus:border-slate-400 focus:outline-none focus:ring-0 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-slate-500`

export type RecommendationBatchRow = {
  fingerprint: string
  displayText: string
  qty: number
  unit: string
}

type LineState = {
  selected: boolean
  displayText: string
  fingerprint: string
  baseQty: number
  baseUnit: string
  qty: number
  unit: string
  qtyText: string
}

type Props = {
  open: boolean
  onClose: () => void
  suggestions: Suggestion[]
  storePresetId: string | null
  presets: StorePresetRow[]
  /** When false, per-row estimate amounts are hidden */
  showPrices?: boolean
  onDismiss: (fingerprint: string, displayText: string) => void | Promise<void>
  onAddBatch: (rows: RecommendationBatchRow[]) => void | Promise<void>
}

function eachQty(n: number) {
  const r = Math.round(Number(n))
  return Math.min(20, Math.max(1, Number.isFinite(r) ? r : 1))
}

function initialLineState(s: Suggestion): LineState {
  const u = normalizeUnit(s.unit)
  const q = clampQuantityForUnit(u, s.suggestedQty) ?? (u === 'each' ? 1 : 0.1)
  const { baseQty, baseUnit } = recipeLineBaseCanonical(q, u)
  const disp = scaledDisplayFromBase(baseQty, baseUnit, 1)
  const displayText = s.displayText.trim()
  return {
    selected: false,
    displayText,
    fingerprint: fingerprintFromText(displayText),
    baseQty,
    baseUnit,
    qty: disp.qty,
    unit: disp.unit,
    qtyText: formatQuantityForInput(disp.unit, disp.qty),
  }
}

export function RecommendationsDrawer({
  open,
  onClose,
  suggestions,
  storePresetId,
  presets,
  showPrices = true,
  onDismiss,
  onAddBatch,
}: Props) {
  const [lineState, setLineState] = useState<Record<string, LineState>>({})
  const [busy, setBusy] = useState(false)
  const [recipeScale, setRecipeScale] = useState<RecipeImportScale>(1)
  const nameSnapRef = useRef<Record<string, string>>({})

  const suggKey = useMemo(
    () => suggestions.map((s) => `${s.fingerprint}:${s.suggestedQty}:${s.unit}`).join('|'),
    [suggestions],
  )

  useLayoutEffect(() => {
    if (!open) return
    const next: Record<string, LineState> = {}
    for (const s of suggestions) {
      next[s.fingerprint] = initialLineState(s)
    }
    setLineState(next)
    setRecipeScale(1)
  }, [open, suggKey, suggestions])

  if (!open) return null

  function setLine(fp: string, patch: Partial<LineState>) {
    setLineState((prev) => {
      const sug = suggestions.find((x) => x.fingerprint === fp)
      const cur = prev[fp] ?? (sug ? initialLineState(sug) : null)
      if (!cur) return prev
      return { ...prev, [fp]: { ...cur, ...patch } }
    })
  }

  function applyScaleToAll(scale: RecipeImportScale) {
    setRecipeScale(scale)
    setLineState((prev) => {
      const out = { ...prev }
      for (const k of Object.keys(out)) {
        const cur = out[k]!
        const d = scaledDisplayFromBase(cur.baseQty, cur.baseUnit, scale)
        out[k] = {
          ...cur,
          qty: d.qty,
          unit: d.unit,
          qtyText: formatQuantityForInput(d.unit, d.qty),
        }
      }
      return out
    })
  }

  function commitDisplayQuantity(fp: string, u: string, qtyText: string, qtyFallback: number) {
    const nu = normalizeUnit(u)
    if (nu === 'each') {
      const v = eachQty(qtyFallback)
      const b = baseFromScaledDisplay(v, 'each', recipeScale)
      const d = scaledDisplayFromBase(b.baseQty, b.baseUnit, recipeScale)
      setLine(fp, {
        baseQty: b.baseQty,
        baseUnit: b.baseUnit,
        qty: d.qty,
        unit: d.unit,
        qtyText: formatQuantityForInput(d.unit, d.qty),
      })
      return
    }
    const p = parseQuantityInput(nu, qtyText)
    if (p === null) {
      setLine(fp, { qtyText: formatQuantityForInput(nu, qtyFallback) })
      return
    }
    const b = baseFromScaledDisplay(p, nu, recipeScale)
    const d = scaledDisplayFromBaseKeepUnit(b.baseQty, b.baseUnit, recipeScale, nu)
    setLine(fp, {
      baseQty: b.baseQty,
      baseUnit: b.baseUnit,
      qty: d.qty,
      unit: d.unit,
      qtyText: formatQuantityForInput(d.unit, d.qty),
    })
  }

  function commitName(fp: string, raw: string) {
    const snap = nameSnapRef.current[fp] ?? ''
    const t = raw.trim()
    if (!t) {
      setLine(fp, { displayText: snap || 'Item' })
      return
    }
    setLine(fp, { displayText: t, fingerprint: fingerprintFromText(t) })
  }

  function lineCost(s: Suggestion): number {
    const st = lineState[s.fingerprint]
    const u = normalizeUnit(st?.unit ?? s.unit)
    let q = st?.qty ?? s.suggestedQty
    if (u !== 'each' && st) {
      const p = parseQuantityInput(u, st.qtyText)
      if (p !== null) q = p
    }
    return estimateSuggestionLineCost(st?.displayText ?? s.displayText, q, u, storePresetId, presets)
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
      out.push({
        fingerprint: st.fingerprint,
        displayText: st.displayText.trim(),
        qty,
        unit: u,
      })
    }
    return out
  }

  const batch = buildBatch()
  const selectedCount = suggestions.filter((s) => lineState[s.fingerprint]?.selected).length

  function resetDrawer() {
    const next: Record<string, LineState> = {}
    for (const s of suggestions) {
      next[s.fingerprint] = initialLineState(s)
    }
    setLineState(next)
    setRecipeScale(1)
    nameSnapRef.current = {}
  }

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-black/30" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl dark:bg-slate-900 sm:rounded-l-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shrink-0 border-b border-slate-200 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top,0px))] dark:border-slate-700">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 pr-2">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Recommended</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">From your check-off history on this list.</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                className="min-h-8 rounded-[6px] border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 active:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 dark:active:bg-slate-800"
                onClick={resetDrawer}
              >
                Reset
              </button>
              <button
                type="button"
                className="min-h-8 rounded-[6px] border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 active:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 dark:active:bg-slate-800"
                onClick={onClose}
              >
                Done
              </button>
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-28">
          {suggestions.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-500 dark:border-slate-700">
              Check off items a few times to build history. Suggestions avoid items already on your list.
            </p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2 pb-3">
                <span className="text-sm font-medium text-slate-600 dark:text-slate-400">Scale amounts</span>
                <div className="flex flex-wrap gap-1" role="group" aria-label="Scale suggestion quantities">
                  {RECIPE_IMPORT_SCALE_OPTIONS.map((sc) => (
                    <button
                      key={sc}
                      type="button"
                      onClick={() => applyScaleToAll(sc)}
                      className={`min-h-8 min-w-10 rounded-full border px-2.5 text-sm font-semibold tabular-nums transition-colors sm:px-3 ${
                        recipeScale === sc
                          ? 'border-transparent bg-[linear-gradient(147deg,#00B66F_0%,#005371_100%)] text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                      }`}
                    >
                      {sc}x
                    </button>
                  ))}
                </div>
              </div>
              <ul className="flex flex-col gap-1.5 sm:gap-2">
                {suggestions.map((s) => {
                  const st = lineState[s.fingerprint]
                  if (!st) return null
                  const u = normalizeUnit(st.unit)
                  const isEach = u === 'each'
                  return (
                    <li
                      key={s.fingerprint}
                      className="flex flex-wrap items-center gap-1.5 rounded-[8px] bg-white px-2 py-1.5 sm:gap-2 sm:px-3 sm:py-2 dark:bg-slate-900"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
                        <input
                          type="checkbox"
                          checked={st.selected}
                          onChange={(e) => setLine(s.fingerprint, { selected: e.target.checked })}
                          className="grocery-checkbox shrink-0"
                          aria-label={`Include ${st.displayText}`}
                        />
                        <input
                          type="text"
                          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-left text-sm text-slate-900 outline-none ring-0 focus:ring-0 dark:text-slate-50"
                          value={st.displayText}
                          onChange={(e) => setLine(s.fingerprint, { displayText: e.target.value })}
                          onFocus={(e) => {
                            nameSnapRef.current[s.fingerprint] = st.displayText
                            e.target.select()
                          }}
                          onBlur={(e) => commitName(s.fingerprint, e.target.value)}
                          aria-label="Item name"
                        />
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {isEach ? (
                          <select
                            className={`${qtyBoxClass} ${noChevron}`}
                            value={eachQty(st.qty)}
                            onChange={(e) => {
                              const v = Number(e.target.value)
                              commitDisplayQuantity(s.fingerprint, 'each', String(v), v)
                            }}
                            aria-label={`Quantity for ${st.displayText}`}
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
                            className={qtyTextInputClass}
                            value={st.qtyText}
                            onChange={(e) => setLine(s.fingerprint, { qtyText: e.target.value })}
                            onBlur={() => commitDisplayQuantity(s.fingerprint, u, st.qtyText, st.qty)}
                            aria-label={`Quantity for ${st.displayText}`}
                          />
                        )}
                        <select
                          value={u}
                          onChange={(e) => {
                            const prevU = normalizeUnit(st.unit)
                            const nu = normalizeUnit(e.target.value)
                            if (prevU === nu) return
                            let pqDisplay: number
                            if (prevU === 'each') {
                              pqDisplay = eachQty(st.qty)
                            } else {
                              const parsed = parseQuantityInput(prevU, st.qtyText)
                              pqDisplay = parsed !== null ? parsed : st.qty
                            }
                            const baseSnap = baseFromScaledDisplay(pqDisplay, prevU, recipeScale)
                            const pq1x = baseCanonToQuantityInUnit(baseSnap.baseQty, baseSnap.baseUnit, prevU)
                            const next1x = quantityWhenChangingUnit(prevU, nu, pq1x)
                            const canon = recipeLineBaseCanonical(next1x, nu)
                            const d = scaledDisplayFromBaseKeepUnit(canon.baseQty, canon.baseUnit, recipeScale, nu)
                            setLine(s.fingerprint, {
                              baseQty: canon.baseQty,
                              baseUnit: canon.baseUnit,
                              qty: d.qty,
                              unit: d.unit,
                              qtyText: formatQuantityForInput(d.unit, d.qty),
                            })
                          }}
                          className={unitSelectClass}
                          aria-label={`Unit for ${st.displayText}`}
                        >
                          {UNIT_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt === 'each' ? 'ea' : unitOptionLabel(opt)}
                            </option>
                          ))}
                        </select>
                      </div>
                      {showPrices ? (
                        <div className="min-w-[4.5rem] shrink-0 text-right text-xs tabular-nums text-slate-600 dark:text-slate-300">
                          ${lineCost(s).toFixed(2)}
                        </div>
                      ) : null}
                      <button
                        type="button"
                        className="grid min-h-8 min-w-8 shrink-0 place-items-center rounded-[6px] text-[#505258] hover:bg-slate-100 active:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 dark:active:bg-slate-800"
                        aria-label={`Not interested in ${st.displayText}`}
                        title="Hide from recommendations"
                        onClick={() => void onDismiss(s.fingerprint, s.displayText)}
                      >
                        <ItemDeleteIcon className="h-4 w-4" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>

        <div className="shrink-0 border-t border-slate-200 bg-white/95 px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
          <button
            type="button"
            disabled={busy || batch.length === 0}
            className={`min-h-12 w-full rounded-full py-3 text-base font-semibold text-white ${
              busy || batch.length === 0
                ? 'bg-slate-300'
                : 'bg-[linear-gradient(147deg,#00B66F_0%,#005371_100%)]'
            } disabled:opacity-50`}
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
