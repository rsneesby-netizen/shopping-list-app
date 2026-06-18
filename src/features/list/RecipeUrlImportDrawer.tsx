import { useMemo, useRef, useState } from 'react'
import { fingerprintFromText, ingredientLikelyMatch } from '../../lib/normalize'
import { estimateSuggestionLineCost } from '../../lib/pricing'
import { extractIngredientStringsFromHtml } from '../../lib/recipeImport/extractIngredientsFromHtml'
import { fetchRecipeHtml } from '../../lib/recipeImport/fetchRecipeHtml'
import { parseIngredientLine } from '../../lib/recipeImport/parseIngredientLine'
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
import type { StorePresetRow } from '../../types'

const qtyBoxClass =
  'box-border h-8 w-[40px] min-w-[40px] max-w-[40px] shrink-0 rounded border border-slate-200/80 bg-white text-center text-xs tabular-nums text-slate-700 outline-none focus:border-slate-400 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-slate-500'

const qtyTextInputClass = `${qtyBoxClass} [appearance:textfield] px-0.5 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`

const noChevron =
  'appearance-none bg-[length:0] [background-image:none] [&::-webkit-appearance]:none'

const unitSelectClass =
  `${noChevron} shrink-0 cursor-pointer border-0 bg-transparent p-0 text-[10px] leading-tight text-slate-500 outline-none ring-0 focus:border-0 focus:outline-none focus:ring-0 dark:text-slate-400`

export type RecipeUrlImportBatchRow = {
  fingerprint: string
  displayText: string
  qty: number
  unit: string
}

type MatchItem = { text: string; checked: boolean; quantity: number; unit: string }

type LineRow = {
  id: string
  section: 'new' | 'onList'
  fingerprint: string
  displayText: string
  /** Canonical base at 1× (g, ml, each, tsp, tbs) — URL amounts before scale buttons */
  baseQty: number
  baseUnit: string
  qty: number
  unit: string
  qtyText: string
  selected: boolean
  existingQty?: number
  existingUnit?: string
}

type Props = {
  open: boolean
  onClose: () => void
  showPrices?: boolean
  itemsForMatch: MatchItem[]
  storePresetId: string | null
  presets: StorePresetRow[]
  onAddBatch: (rows: RecipeUrlImportBatchRow[]) => void | Promise<void>
}

const EACH_OPTIONS = Array.from({ length: 20 }, (_, i) => i + 1)

function eachQty(n: number) {
  const r = Math.round(Number(n))
  return Math.min(20, Math.max(1, Number.isFinite(r) ? r : 1))
}

function fpMapForUnchecked(unchecked: MatchItem[]) {
  const fpToExisting = new Map<string, { qty: number; unit: string }>()
  for (const i of unchecked) {
    const fp = fingerprintFromText(i.text)
    if (!fpToExisting.has(fp)) fpToExisting.set(fp, { qty: i.quantity, unit: normalizeUnit(i.unit) })
  }
  return fpToExisting
}

/** Exact fingerprint first, then fuzzy ingredient match vs list lines */
function findExistingForRecipeLine(
  displayText: string,
  itemsForMatch: MatchItem[],
): { qty: number; unit: string } | null {
  const unchecked = itemsForMatch.filter((i) => !i.checked)
  const fpToExisting = fpMapForUnchecked(unchecked)
  const fp = fingerprintFromText(displayText)
  const exact = fpToExisting.get(fp)
  if (exact) return exact
  for (const i of unchecked) {
    if (ingredientLikelyMatch(displayText, i.text)) {
      const ifp = fingerprintFromText(i.text)
      return fpToExisting.get(ifp) ?? { qty: i.quantity, unit: normalizeUnit(i.unit) }
    }
  }
  return null
}

function reorderRowsBySection(rows: LineRow[]): LineRow[] {
  const fresh = rows.filter((r) => r.section === 'new')
  const onList = rows.filter((r) => r.section === 'onList')
  return [...fresh, ...onList]
}

function buildRowsFromHtml(html: string, itemsForMatch: MatchItem[]): LineRow[] {
  const strings = extractIngredientStringsFromHtml(html)
  const parsed = strings.map(parseIngredientLine).filter((p) => p.displayText.trim().length > 0)

  let n = 0
  const mkId = () => `ru-${++n}-${Math.random().toString(36).slice(2, 9)}`

  const newRows: LineRow[] = []
  const onListRows: LineRow[] = []

  for (const p of parsed) {
    const structured = p.structuredQuantity
    const u = structured ? normalizeUnit(p.unit) : 'each'
    const q = structured
      ? clampQuantityForUnit(u, p.qty) ?? (u === 'each' ? 1 : 0.1)
      : 1
    const displayText = p.displayText.trim()
    const fp = fingerprintFromText(displayText)
    const ex = findExistingForRecipeLine(displayText, itemsForMatch)
    const { baseQty, baseUnit } = recipeLineBaseCanonical(q, u)
    const disp = scaledDisplayFromBase(baseQty, baseUnit, 1)
    const base = {
      id: mkId(),
      fingerprint: fp,
      displayText,
      baseQty,
      baseUnit,
      qty: disp.qty,
      unit: disp.unit,
      qtyText: formatQuantityForInput(disp.unit, disp.qty),
    }
    if (ex) {
      onListRows.push({
        ...base,
        section: 'onList',
        selected: false,
        existingQty: ex.qty,
        existingUnit: ex.unit,
      })
    } else {
      newRows.push({ ...base, section: 'new', selected: true })
    }
  }

  return [...newRows, ...onListRows]
}

export function RecipeUrlImportDrawer({
  open,
  onClose,
  showPrices = true,
  itemsForMatch,
  storePresetId,
  presets,
  onAddBatch,
}: Props) {
  const [urlInput, setUrlInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [rows, setRows] = useState<LineRow[]>([])
  const [busy, setBusy] = useState(false)
  const [recipeScale, setRecipeScale] = useState<RecipeImportScale>(1)
  const nameSnapRef = useRef<Record<string, string>>({})

  const selectedCount = useMemo(() => rows.filter((r) => r.selected).length, [rows])

  if (!open) return null

  function applyScaleToAllRows(scale: RecipeImportScale) {
    setRecipeScale(scale)
    setRows((prev) =>
      prev.map((r) => {
        const d = scaledDisplayFromBase(r.baseQty, r.baseUnit, scale)
        return {
          ...r,
          qty: d.qty,
          unit: d.unit,
          qtyText: formatQuantityForInput(d.unit, d.qty),
        }
      }),
    )
  }

  function setLine(id: string, patch: Partial<LineRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  function commitDisplayQuantity(id: string, u: string, qtyText: string, qtyFallback: number) {
    const nu = normalizeUnit(u)
    if (nu === 'each') {
      const v = eachQty(qtyFallback)
      const b = baseFromScaledDisplay(v, 'each', recipeScale)
      const d = scaledDisplayFromBase(b.baseQty, b.baseUnit, recipeScale)
      setLine(id, {
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
      setLine(id, { qtyText: formatQuantityForInput(nu, qtyFallback) })
      return
    }
    const b = baseFromScaledDisplay(p, nu, recipeScale)
    const d = scaledDisplayFromBaseKeepUnit(b.baseQty, b.baseUnit, recipeScale, nu)
    setLine(id, {
      baseQty: b.baseQty,
      baseUnit: b.baseUnit,
      qty: d.qty,
      unit: d.unit,
      qtyText: formatQuantityForInput(d.unit, d.qty),
    })
  }

  function commitNameAndReclassify(id: string, raw: string) {
    const snap = nameSnapRef.current[id] ?? ''
    const t = raw.trim()
    if (!t) {
      setLine(id, { displayText: snap || 'Ingredient' })
      return
    }
    const ex = findExistingForRecipeLine(t, itemsForMatch)
    const fp = fingerprintFromText(t)
    const patch: Partial<LineRow> = {
      displayText: t,
      fingerprint: fp,
    }
    if (ex) {
      patch.section = 'onList'
      patch.selected = false
      patch.existingQty = ex.qty
      patch.existingUnit = ex.unit
    } else {
      patch.section = 'new'
      patch.selected = true
      patch.existingQty = undefined
      patch.existingUnit = undefined
    }
    setRows((prev) => reorderRowsBySection(prev.map((r) => (r.id === id ? { ...r, ...patch } : r))))
  }

  function lineCost(r: LineRow): number {
    const u = normalizeUnit(r.unit)
    let q = r.qty
    if (u !== 'each') {
      const p = parseQuantityInput(u, r.qtyText)
      if (p !== null) q = p
    }
    return estimateSuggestionLineCost(r.displayText, q, u, storePresetId, presets)
  }

  function buildBatch(): RecipeUrlImportBatchRow[] {
    const out: RecipeUrlImportBatchRow[] = []
    const seen = new Set<string>()
    for (const r of rows) {
      if (!r.selected) continue
      const u = normalizeUnit(r.unit)
      let qty: number | null = null
      if (u === 'each') {
        qty = clampQuantityForUnit('each', r.qty)
      } else {
        qty = clampQuantityForUnit(u, parseQuantityInput(u, r.qtyText) ?? NaN)
      }
      if (qty === null) continue
      if (seen.has(r.fingerprint)) continue
      seen.add(r.fingerprint)
      out.push({ fingerprint: r.fingerprint, displayText: r.displayText, qty, unit: u })
    }
    return out
  }

  const batch = buildBatch()

  async function onGo() {
    setFetchError(null)
    setLoading(true)
    setRows([])
    try {
      const html = await fetchRecipeHtml(urlInput)
      const next = buildRowsFromHtml(html, itemsForMatch)
      if (next.length === 0) {
        setFetchError(
          'No ingredients found on that page. Try another recipe URL, or use a site that publishes JSON-LD or standard recipe markup.',
        )
      } else {
        setRecipeScale(1)
        setRows(next)
      }
    } catch (e: unknown) {
      setFetchError(e instanceof Error ? e.message : 'Could not load recipe.')
    } finally {
      setLoading(false)
    }
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
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Add items from URL</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">Paste recipe URL below</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                className="min-h-8 rounded-[6px] border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 active:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 dark:active:bg-slate-800"
                onClick={() => {
                  setUrlInput('')
                  setFetchError(null)
                  setRows([])
                  setRecipeScale(1)
                  setLoading(false)
                  setBusy(false)
                  nameSnapRef.current = {}
                }}
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

        <div className="shrink-0 border-b border-slate-200 px-3 py-3 dark:border-slate-700">
          <div className="flex gap-2">
            <input
              type="url"
              inputMode="url"
              autoComplete="url"
              placeholder="https://…"
              className="min-h-10 min-w-0 flex-1 rounded-[6px] border border-slate-200 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-950"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void onGo()
              }}
              aria-label="Recipe URL"
            />
            <button
              type="button"
              disabled={loading || !urlInput.trim()}
              className="shrink-0 rounded-[6px] bg-slate-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-slate-200 dark:text-slate-900"
              onClick={() => void onGo()}
            >
              {loading ? '…' : 'Go'}
            </button>
          </div>
          {fetchError ? (
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
              {fetchError}
            </p>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-28">
          {loading ? <p className="py-8 text-center text-sm text-slate-500">Loading recipe…</p> : null}

          {rows.length > 0 && !loading ? (
            <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400">scale amounts</span>
              <div className="flex flex-wrap gap-1" role="group" aria-label="Scale recipe quantities">
                {RECIPE_IMPORT_SCALE_OPTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => applyScaleToAllRows(s)}
                    className={`min-h-8 min-w-10 rounded-lg border px-2.5 text-sm font-semibold tabular-nums transition-colors sm:px-3 ${
                      recipeScale === s
                        ? 'border-teal-700 bg-teal-700 text-white dark:border-teal-500 dark:bg-teal-600'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                    }`}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {rows.some((r) => r.section === 'new') ? (
            <section className="mb-4">
              <h3 className="mb-2 text-xs font-semibold text-slate-500 dark:text-slate-400">from recipe</h3>
              <ul className="flex flex-col gap-1.5 sm:gap-2">
                {rows
                  .filter((r) => r.section === 'new')
                  .map((r) => {
                    const u = normalizeUnit(r.unit)
                    const isEach = u === 'each'
                    return (
                      <li
                        key={r.id}
                        className="flex flex-wrap items-center gap-1.5 rounded-[6px] border border-slate-200 bg-white px-2 py-1.5 sm:gap-2 sm:px-3 sm:py-2 dark:border-slate-700 dark:bg-slate-900"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
                          <input
                            type="checkbox"
                            checked={r.selected}
                            onChange={(e) => setLine(r.id, { selected: e.target.checked })}
                            className="grocery-checkbox shrink-0"
                            aria-label={`Include ${r.displayText}`}
                          />
                          <input
                            type="text"
                            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-left text-sm text-slate-900 outline-none ring-0 focus:ring-0 dark:text-slate-50"
                            value={r.displayText}
                            onChange={(e) => setLine(r.id, { displayText: e.target.value })}
                            onFocus={(e) => {
                              nameSnapRef.current[r.id] = r.displayText
                              e.target.select()
                            }}
                            onBlur={(e) => commitNameAndReclassify(r.id, e.target.value)}
                            aria-label="Ingredient name"
                          />
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {isEach ? (
                            <select
                              className={`${qtyBoxClass} ${noChevron} px-0.5`}
                              value={eachQty(r.qty)}
                              onChange={(e) => {
                                const v = Number(e.target.value)
                                commitDisplayQuantity(r.id, 'each', String(v), v)
                              }}
                              aria-label={`Quantity for ${r.displayText}`}
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
                              value={r.qtyText}
                              onChange={(e) => setLine(r.id, { qtyText: e.target.value })}
                              onBlur={() => commitDisplayQuantity(r.id, u, r.qtyText, r.qty)}
                              aria-label={`Quantity for ${r.displayText}`}
                            />
                          )}
                          <select
                            value={u}
                            onChange={(e) => {
                              const prevU = normalizeUnit(r.unit)
                              const nu = normalizeUnit(e.target.value)
                              if (prevU === nu) return
                              let pqDisplay: number
                              if (prevU === 'each') {
                                pqDisplay = eachQty(r.qty)
                              } else {
                                const parsed = parseQuantityInput(prevU, r.qtyText)
                                pqDisplay = parsed !== null ? parsed : r.qty
                              }
                              const baseSnap = baseFromScaledDisplay(pqDisplay, prevU, recipeScale)
                              const pq1x = baseCanonToQuantityInUnit(baseSnap.baseQty, baseSnap.baseUnit, prevU)
                              const next1x = quantityWhenChangingUnit(prevU, nu, pq1x)
                              const canon = recipeLineBaseCanonical(next1x, nu)
                              const d = scaledDisplayFromBaseKeepUnit(canon.baseQty, canon.baseUnit, recipeScale, nu)
                              setLine(r.id, {
                                baseQty: canon.baseQty,
                                baseUnit: canon.baseUnit,
                                qty: d.qty,
                                unit: d.unit,
                                qtyText: formatQuantityForInput(d.unit, d.qty),
                              })
                            }}
                            className={unitSelectClass}
                            aria-label={`Unit for ${r.displayText}`}
                          >
                            {UNIT_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>
                                {unitOptionLabel(opt)}
                              </option>
                            ))}
                          </select>
                        </div>
                        {showPrices ? (
                          <div className="min-w-[4.5rem] shrink-0 text-right text-xs tabular-nums text-slate-600 dark:text-slate-300">
                            ${lineCost(r).toFixed(2)}
                          </div>
                        ) : null}
                      </li>
                    )
                  })}
              </ul>
            </section>
          ) : null}

          {rows.some((r) => r.section === 'onList') ? (
            <section>
              <h3 className="mb-2 text-xs font-semibold text-slate-500 dark:text-slate-400">already on the list</h3>
              <ul className="flex flex-col gap-1.5 sm:gap-2">
                {rows
                  .filter((r) => r.section === 'onList')
                  .map((r) => {
                    const u = normalizeUnit(r.unit)
                    const isEach = u === 'each'
                    const exQ = r.existingQty ?? 1
                    const exU = r.existingUnit ? unitOptionLabel(r.existingUnit) : ''
                    return (
                      <li
                        key={r.id}
                        className="flex flex-wrap items-center gap-1.5 rounded-[6px] border border-slate-200 bg-slate-50 px-2 py-1.5 sm:gap-2 sm:px-3 sm:py-2 dark:border-slate-700 dark:bg-slate-950"
                      >
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <div className="flex items-center gap-2 sm:gap-3">
                            <input
                              type="checkbox"
                              checked={r.selected}
                              onChange={(e) => setLine(r.id, { selected: e.target.checked })}
                              className="grocery-checkbox shrink-0"
                              aria-label={`Also add ${r.displayText} from recipe`}
                            />
                            <input
                              type="text"
                              className="min-w-0 flex-1 border-0 bg-transparent p-0 text-left text-sm text-slate-900 outline-none ring-0 focus:ring-0 dark:text-slate-50"
                              value={r.displayText}
                              onChange={(e) => setLine(r.id, { displayText: e.target.value })}
                              onFocus={(e) => {
                                nameSnapRef.current[r.id] = r.displayText
                                e.target.select()
                              }}
                              onBlur={(e) => commitNameAndReclassify(r.id, e.target.value)}
                              aria-label="Ingredient name"
                            />
                          </div>
                          <span className="pl-7 text-xs text-slate-500 dark:text-slate-400 sm:pl-9">
                            On list: {exQ} {exU}
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {isEach ? (
                            <select
                              className={`${qtyBoxClass} ${noChevron} px-0.5`}
                              value={eachQty(r.qty)}
                              onChange={(e) => {
                                const v = Number(e.target.value)
                                commitDisplayQuantity(r.id, 'each', String(v), v)
                              }}
                              aria-label={`Recipe quantity for ${r.displayText}`}
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
                              value={r.qtyText}
                              onChange={(e) => setLine(r.id, { qtyText: e.target.value })}
                              onBlur={() => commitDisplayQuantity(r.id, u, r.qtyText, r.qty)}
                              aria-label={`Recipe quantity for ${r.displayText}`}
                            />
                          )}
                          <select
                            value={u}
                            onChange={(e) => {
                              const prevU = normalizeUnit(r.unit)
                              const nu = normalizeUnit(e.target.value)
                              if (prevU === nu) return
                              let pqDisplay: number
                              if (prevU === 'each') {
                                pqDisplay = eachQty(r.qty)
                              } else {
                                const parsed = parseQuantityInput(prevU, r.qtyText)
                                pqDisplay = parsed !== null ? parsed : r.qty
                              }
                              const baseSnap = baseFromScaledDisplay(pqDisplay, prevU, recipeScale)
                              const pq1x = baseCanonToQuantityInUnit(baseSnap.baseQty, baseSnap.baseUnit, prevU)
                              const next1x = quantityWhenChangingUnit(prevU, nu, pq1x)
                              const canon = recipeLineBaseCanonical(next1x, nu)
                              const d = scaledDisplayFromBaseKeepUnit(canon.baseQty, canon.baseUnit, recipeScale, nu)
                              setLine(r.id, {
                                baseQty: canon.baseQty,
                                baseUnit: canon.baseUnit,
                                qty: d.qty,
                                unit: d.unit,
                                qtyText: formatQuantityForInput(d.unit, d.qty),
                              })
                            }}
                            className={unitSelectClass}
                            aria-label={`Unit for ${r.displayText}`}
                          >
                            {UNIT_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>
                                {unitOptionLabel(opt)}
                              </option>
                            ))}
                          </select>
                        </div>
                        {showPrices ? (
                          <div className="min-w-[4.5rem] shrink-0 text-right text-xs tabular-nums text-slate-600 dark:text-slate-300">
                            ${lineCost(r).toFixed(2)}
                          </div>
                        ) : null}
                      </li>
                    )
                  })}
              </ul>
            </section>
          ) : null}
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
            {busy ? 'Adding…' : `Add to list${batch.length ? ` (${batch.length})` : ''}`}
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
