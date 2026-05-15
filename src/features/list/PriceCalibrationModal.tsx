import { useEffect, useState } from 'react'
import { parsePriceCalibrationForScope } from '../../lib/priceCalibration'
import {
  clampQuantityForUnit,
  formatQuantityForInput,
  normalizeUnit,
  parseQuantityInput,
  unitOptionLabel,
} from '../../lib/units'
import type { ListItemRow, PriceCalibrationV1 } from '../../types'

const EACH_PACK = Array.from({ length: 20 }, (_, i) => i + 1)

type Props = {
  item: ListItemRow
  /** Same scope key as list learnings (`aldi`, `woolworths`, `preset:<uuid>`, …). */
  storeScopeKey: string
  onClose: () => void
  onSave: (cal: PriceCalibrationV1) => void | Promise<void>
  onClear: () => void | Promise<void>
}

export function PriceCalibrationModal({ item, storeScopeKey, onClose, onSave, onClear }: Props) {
  const unit = normalizeUnit(item.unit)
  const isEach = unit === 'each'
  const existing = parsePriceCalibrationForScope(item, storeScopeKey)

  const [paidText, setPaidText] = useState(() => (existing ? String(existing.paidAud) : ''))
  const [packEach, setPackEach] = useState(() => (existing && isEach ? eachPackValue(existing.packQty) : 1))
  const [packText, setPackText] = useState(() =>
    existing && !isEach ? formatQuantityForInput(unit, existing.packQty) : formatQuantityForInput(unit, 1),
  )
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  function eachPackValue(n: number) {
    const r = Math.round(Number(n))
    return Math.min(20, Math.max(1, Number.isFinite(r) ? r : 1))
  }

  useEffect(() => {
    const ex = parsePriceCalibrationForScope(item, storeScopeKey)
    setPaidText(ex ? String(ex.paidAud) : '')
    if (isEach) {
      setPackEach(ex ? eachPackValue(ex.packQty) : 1)
    } else {
      setPackText(ex ? formatQuantityForInput(unit, ex.packQty) : formatQuantityForInput(unit, 1))
    }
    setFormError(null)
  }, [item.id, item.price_calibration_by_scope, item.unit, isEach, unit, storeScopeKey])

  async function handleSave() {
    setFormError(null)
    const paid = Number.parseFloat(paidText.replace(/,/g, ''))
    if (!Number.isFinite(paid) || paid <= 0) {
      setFormError('Enter a valid amount paid (greater than zero).')
      return
    }
    let packQty: number | null = null
    if (isEach) {
      packQty = clampQuantityForUnit('each', packEach)
    } else {
      packQty = clampQuantityForUnit(unit, parseQuantityInput(unit, packText) ?? NaN)
    }
    if (packQty === null) {
      setFormError('Enter a valid pack size.')
      return
    }
    const cal: PriceCalibrationV1 = { v: 1, paidAud: Math.round(paid * 100) / 100, packQty, unit }
    setBusy(true)
    try {
      await onSave(cal)
      onClose()
    } catch {
      setFormError('Could not save. Try again.')
    } finally {
      setBusy(false)
    }
  }

  async function handleClear() {
    setFormError(null)
    setBusy(true)
    try {
      await onClear()
      onClose()
    } catch {
      setFormError('Could not clear. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-t-3xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] shadow-xl dark:bg-slate-900 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="price-cal-title"
      >
        <h3 id="price-cal-title" className="mb-1 text-sm font-semibold text-slate-900 dark:text-slate-50">
          Your price for this line
        </h3>
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
          Optional. Enter what you paid for a purchase of this product (same unit as the list line). Estimates use
          that to price your current quantity. Changing the line unit clears this.
        </p>
        <p className="mb-3 truncate text-xs font-medium text-slate-700 dark:text-slate-200">{item.text}</p>

        <label className="mb-2 block text-xs font-medium text-slate-600 dark:text-slate-300">Paid (AUD)</label>
        <input
          type="text"
          inputMode="decimal"
          className="mb-3 w-full rounded-[6px] border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950"
          value={paidText}
          onChange={(e) => setPaidText(e.target.value)}
          placeholder="e.g. 4.50"
          aria-label="Amount paid in Australian dollars"
        />

        <label className="mb-2 block text-xs font-medium text-slate-600 dark:text-slate-300">
          For this much ({unitOptionLabel(unit)})
        </label>
        {isEach ? (
          <select
            className="mb-3 w-full rounded-[6px] border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950"
            value={packEach}
            onChange={(e) => setPackEach(Number(e.target.value))}
            aria-label="Pack size in each"
          >
            {EACH_PACK.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            inputMode="decimal"
            className="mb-3 w-full rounded-[6px] border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950"
            value={packText}
            onChange={(e) => setPackText(e.target.value)}
            onBlur={() => {
              const p = parseQuantityInput(unit, packText)
              if (p !== null) setPackText(formatQuantityForInput(unit, p))
              else setPackText(formatQuantityForInput(unit, 1))
            }}
            aria-label="Pack size"
          />
        )}

        <p className="mb-3 text-[11px] text-slate-500 dark:text-slate-400">
          List quantity ({formatQuantityForInput(unit, item.quantity)} {unitOptionLabel(unit)}) is unchanged — only
          the cost estimate uses this.
        </p>

        {formError ? (
          <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            {formError}
          </p>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            className="flex-1 rounded-[6px] border border-slate-200 py-2 text-sm font-medium dark:border-slate-600"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          {existing ? (
            <button
              type="button"
              className="flex-1 rounded-[6px] border border-slate-200 py-2 text-sm font-medium text-slate-700 dark:border-slate-600 dark:text-slate-200"
              onClick={() => void handleClear()}
              disabled={busy}
            >
              Clear
            </button>
          ) : null}
          <button
            type="button"
            className="flex-1 rounded-[6px] bg-teal-700 py-2 text-sm font-semibold text-white disabled:opacity-50"
            onClick={() => void handleSave()}
            disabled={busy}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
