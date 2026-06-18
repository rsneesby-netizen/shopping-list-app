import { createPortal } from 'react-dom'
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  formatQuantityForInput,
  normalizeUnit,
  parseQuantityInput,
  unitOptionLabel,
  UNIT_OPTIONS,
} from '../../lib/units'
import type { ListItemRow } from '../../types'
import { ItemDeleteIcon } from './listIcons'
import { ToolbarIconMore } from './toolbarIcons'

const EACH_QUANTITY_OPTIONS = Array.from({ length: 20 }, (_, i) => i + 1)

/** 32×32 quantity control, subtle border at rest */
const qtyBoxClass =
  'box-border h-8 w-[40px] min-w-[40px] max-w-[40px] shrink-0 rounded border border-slate-200/80 bg-white text-center text-xs tabular-nums text-slate-700 outline-none focus:border-slate-400 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-slate-500'

const noChevron =
  'appearance-none bg-[length:0] [background-image:none] [&::-webkit-appearance]:none'

type Props = {
  item: ListItemRow
  /** Greys out the row and disables interactions (e.g. completed items). */
  disabled?: boolean
  /** Disables drag reordering only; row stays visually normal (e.g. active items in grouped view). */
  disableDrag?: boolean
  showDragHandle?: boolean
  /** When true, drag listeners attach to the row (flat list); interactive controls stop propagation so they stay usable. */
  dragFromRow?: boolean
  inGroupedBlock?: boolean
  isOnSpecial?: boolean
  /** When false, line price and special stripe are hidden */
  showPrices?: boolean
  /** Estimated line total (AUD); when set with onOpenYourPrice, shows tappable price control */
  estimatedLineCost?: number
  /** True when user saved a custom price hint for this line */
  hasYourPrice?: boolean
  /** Long-press row (outside controls) to change category — only when `itemMenuVariant` is default. */
  enableLongPressCategoryChange?: boolean
  /** Flat / grouped active: ⋯ menu instead of trash; name edit only via menu when `onTextChange` is set. */
  itemMenuVariant?: 'default' | 'overflow'
  /** Opens the change-category flow (used by overflow menu). */
  onChangeCategory?: (id: string) => void
  onToggle: (id: string, checked: boolean) => void
  onDelete: (id: string) => void
  onQuantityChange: (id: string, quantity: number) => void
  onUnitChange: (id: string, unit: string) => void
  /** Rename list item (optional — list page wires this). */
  onTextChange?: (id: string, text: string) => void
  onLongPressCategoryChange?: (id: string) => void
  onOpenYourPrice?: () => void
}

function eachQuantityValue(q: number) {
  const n = Math.round(Number(q))
  return Math.min(20, Math.max(1, Number.isFinite(n) ? n : 1))
}

export function SortableItem({
  item,
  disabled,
  disableDrag = false,
  showDragHandle = true,
  dragFromRow = false,
  inGroupedBlock = false,
  isOnSpecial = false,
  showPrices = true,
  estimatedLineCost,
  hasYourPrice = false,
  enableLongPressCategoryChange = false,
  itemMenuVariant = 'default',
  onChangeCategory,
  onToggle,
  onDelete,
  onQuantityChange,
  onUnitChange,
  onTextChange,
  onLongPressCategoryChange,
  onOpenYourPrice,
}: Props) {
  const unit = normalizeUnit(item.unit)
  const isEach = unit === 'each'
  const overflowMenu = itemMenuVariant === 'overflow'
  const sortableLocked = !!(disabled || disableDrag)
  const rowDrag = dragFromRow && !sortableLocked
  const blockDragFromControl = rowDrag
    ? (e: ReactPointerEvent<HTMLElement>) => {
        e.stopPropagation()
      }
    : undefined

  const [qtyText, setQtyText] = useState(() => formatQuantityForInput(unit, item.quantity))
  const [textDraft, setTextDraft] = useState(() => item.text)
  const [rowMenuOpen, setRowMenuOpen] = useState(false)
  const [rowMenuPlacement, setRowMenuPlacement] = useState<{ top: number; right: number } | null>(null)
  const [nameFieldActive, setNameFieldActive] = useState(false)

  const nameInputRef = useRef<HTMLInputElement>(null)
  const rowMenuRef = useRef<HTMLDivElement>(null)
  const rowMenuButtonRef = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    if (!rowMenuOpen || !overflowMenu) {
      setRowMenuPlacement(null)
      return
    }
    function updatePlacement() {
      const btn = rowMenuButtonRef.current
      if (!btn) return
      const r = btn.getBoundingClientRect()
      setRowMenuPlacement({ top: r.bottom + 4, right: window.innerWidth - r.right })
    }
    updatePlacement()
    window.addEventListener('scroll', updatePlacement, true)
    window.addEventListener('resize', updatePlacement)
    return () => {
      window.removeEventListener('scroll', updatePlacement, true)
      window.removeEventListener('resize', updatePlacement)
    }
  }, [rowMenuOpen, overflowMenu])

  useEffect(() => {
    setQtyText(formatQuantityForInput(unit, item.quantity))
  }, [item.id, item.quantity, item.unit, unit])

  useEffect(() => {
    setTextDraft(item.text)
  }, [item.id, item.text])

  useEffect(() => {
    if (!rowMenuOpen) return
    function onDocPointerDown(e: PointerEvent) {
      const t = e.target as Node
      if (rowMenuRef.current?.contains(t)) return
      if (rowMenuButtonRef.current?.contains(t)) return
      setRowMenuOpen(false)
    }
    document.addEventListener('pointerdown', onDocPointerDown, true)
    return () => document.removeEventListener('pointerdown', onDocPointerDown, true)
  }, [rowMenuOpen])

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: sortableLocked,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
  }
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressTriggeredRef = useRef(false)

  function clearLongPress() {
    if (!longPressRef.current) return
    clearTimeout(longPressRef.current)
    longPressRef.current = null
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLLIElement>) {
    if (overflowMenu) return
    if (!enableLongPressCategoryChange || !onLongPressCategoryChange) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('button, input, select, a')) return
    longPressTriggeredRef.current = false
    clearLongPress()
    longPressRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true
      onLongPressCategoryChange(item.id)
      longPressRef.current = null
    }, 500)
  }

  function commitQtyText() {
    const parsed = parseQuantityInput(unit, qtyText)
    if (parsed !== null) {
      onQuantityChange(item.id, parsed)
    } else {
      setQtyText(formatQuantityForInput(unit, item.quantity))
    }
  }

  function beginEditNameFromMenu() {
    setRowMenuOpen(false)
    setNameFieldActive(true)
    requestAnimationFrame(() => {
      const el = nameInputRef.current
      if (!el) return
      el.focus()
      el.select()
    })
  }

  const unitSelectClass =
    `${noChevron} shrink-0 cursor-pointer border-0 bg-transparent p-0 text-[10px] leading-tight text-slate-500 outline-none ring-0 focus:border-0 focus:outline-none focus:ring-0 dark:text-slate-400`

  const nameLocked = overflowMenu && onTextChange && !nameFieldActive
  const nameTextClass = `min-w-0 flex-1 border-0 bg-transparent p-0 text-left text-sm outline-none ring-0 focus:ring-0 disabled:opacity-50 ${
    item.checked ? 'text-slate-400 line-through' : 'text-slate-900 dark:text-slate-50'
  }`

  const dndRowListeners = rowDrag
    ? {
        ...(listeners ?? {}),
        onPointerDown: (e: ReactPointerEvent<HTMLLIElement>) => {
          handlePointerDown(e)
          const down = listeners?.onPointerDown as ((ev: ReactPointerEvent<HTMLLIElement>) => void) | undefined
          down?.(e)
        },
      }
    : { onPointerDown: handlePointerDown }

  return (
    <li
      ref={setNodeRef}
      style={style}
      {...(rowDrag ? attributes : {})}
      {...dndRowListeners}
      onPointerUp={clearLongPress}
      onPointerLeave={clearLongPress}
      onPointerCancel={clearLongPress}
      onContextMenu={!overflowMenu && enableLongPressCategoryChange ? (e) => e.preventDefault() : undefined}
      onClickCapture={(e) => {
        if (!longPressTriggeredRef.current) return
        e.preventDefault()
        e.stopPropagation()
        longPressTriggeredRef.current = false
      }}
      className={
        (inGroupedBlock
          ? 'relative flex items-center gap-1.5 rounded-none bg-transparent px-2 py-1.5 sm:gap-2 sm:px-3 sm:py-2 dark:bg-transparent'
          : 'relative flex items-center gap-1.5 rounded-[6px] bg-white px-2 py-1.5 sm:gap-2 sm:px-3 sm:py-2 dark:bg-slate-900') +
        (rowDrag ? ' touch-none cursor-grab active:cursor-grabbing' : '')
      }
    >
      {showPrices && isOnSpecial ? <span className="absolute inset-y-0 left-0 w-0.5 bg-amber-300" aria-hidden /> : null}
      {showDragHandle ? (
        <button
          type="button"
          className={`grid min-h-8 min-w-8 place-items-center rounded-[6px] p-1 text-slate-400 hover:bg-slate-100 active:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800 dark:active:bg-slate-800 ${rowDrag ? '' : 'touch-none'}`}
          aria-label="Drag to reorder"
          disabled={sortableLocked}
          {...(!rowDrag ? attributes : {})}
          {...(!rowDrag ? listeners : {})}
        >
          <span className="text-lg leading-none">⋮⋮</span>
        </button>
      ) : null}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <input
          type="checkbox"
          disabled={disabled}
          checked={item.checked}
          onPointerDown={blockDragFromControl}
          onChange={(e) => onToggle(item.id, e.target.checked)}
          className="h-4 w-4 shrink-0 rounded border-slate-300 text-teal-700 sm:h-5 sm:w-5"
        />
        <input
          ref={nameInputRef}
          type="text"
          disabled={disabled}
          readOnly={!!nameLocked}
          tabIndex={nameLocked ? -1 : 0}
          className={nameTextClass}
          value={textDraft}
          onChange={(e) => setTextDraft(e.target.value)}
          onPointerDown={(e) => {
            blockDragFromControl?.(e)
            if (nameLocked) e.preventDefault()
          }}
          onFocus={(e) => {
            if (!nameLocked) e.target.select()
          }}
          onBlur={() => {
            const t = textDraft.trim()
            if (!t) {
              setTextDraft(item.text)
              setNameFieldActive(false)
              return
            }
            if (t !== item.text && onTextChange) void onTextChange(item.id, t)
            else setTextDraft(item.text)
            setNameFieldActive(false)
          }}
          onClick={(e) => e.stopPropagation()}
          aria-label="Item name"
        />
      </div>
      <div className="flex items-center gap-1">
        {isEach ? (
          <select
            disabled={disabled}
            value={eachQuantityValue(item.quantity)}
            onPointerDown={blockDragFromControl}
            onChange={(e) => onQuantityChange(item.id, Number(e.target.value))}
            className={`${qtyBoxClass} ${noChevron} px-0.5`}
            aria-label="Quantity"
          >
            {EACH_QUANTITY_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            inputMode="decimal"
            disabled={disabled}
            value={qtyText}
            onPointerDown={blockDragFromControl}
            onChange={(e) => setQtyText(e.target.value)}
            onBlur={() => commitQtyText()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
            className={`${qtyBoxClass} [appearance:textfield] px-0.5 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
            aria-label="Quantity"
          />
        )}
        <select
          disabled={disabled}
          value={unit}
          onPointerDown={blockDragFromControl}
          onChange={(e) => onUnitChange(item.id, normalizeUnit(e.target.value))}
          className={unitSelectClass}
          aria-label="Quantity type"
        >
          {UNIT_OPTIONS.map((u) => (
            <option key={u} value={u}>
              {unitOptionLabel(u)}
            </option>
          ))}
        </select>
      </div>
      {showPrices && onOpenYourPrice != null && estimatedLineCost != null ? (
        <button
          type="button"
          className={`min-w-[3.25rem] shrink-0 rounded-[6px] px-1 py-1 text-right text-[11px] tabular-nums outline-none ring-teal-600 hover:bg-slate-100 focus-visible:ring-2 active:bg-slate-100 dark:hover:bg-slate-800 dark:active:bg-slate-800 ${
            hasYourPrice ? 'font-semibold text-teal-800 dark:text-teal-200' : 'text-slate-500 dark:text-slate-400'
          }`}
          onPointerDown={blockDragFromControl}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onOpenYourPrice()
          }}
          title={hasYourPrice ? 'Your price — tap to edit' : 'Tap to set your price for better estimates'}
          aria-label={`Estimated cost ${estimatedLineCost.toFixed(2)} dollars, adjust your price`}
        >
          ${estimatedLineCost.toFixed(2)}
        </button>
      ) : null}
      {overflowMenu ? (
        <div className="relative shrink-0">
          <button
            ref={rowMenuButtonRef}
            type="button"
            className="grid min-h-8 min-w-8 place-items-center text-[#505258] hover:bg-slate-100 active:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 dark:active:bg-slate-800"
            aria-haspopup="menu"
            aria-expanded={rowMenuOpen}
            aria-label={`Actions for ${item.text}`}
            onPointerDown={blockDragFromControl}
            onClick={() => setRowMenuOpen((o) => !o)}
          >
            <ToolbarIconMore className="h-5 w-5 shrink-0 sm:h-6 sm:w-6" />
          </button>
          {rowMenuOpen && rowMenuPlacement && typeof document !== 'undefined'
            ? createPortal(
                <div
                  ref={rowMenuRef}
                  role="menu"
                  style={{
                    position: 'fixed',
                    top: rowMenuPlacement.top,
                    right: rowMenuPlacement.right,
                    zIndex: 9999,
                  }}
                  className="w-48 rounded-[6px] border border-slate-200 bg-white py-1 text-xs shadow-lg ring-1 ring-black/5 dark:border-slate-700 dark:bg-slate-900 dark:ring-white/10"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="block min-h-8 w-full px-3 py-1.5 text-left text-slate-800 hover:bg-slate-100 active:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800 dark:active:bg-slate-800"
                    onClick={() => {
                      setRowMenuOpen(false)
                      onDelete(item.id)
                    }}
                  >
                    Delete
                  </button>
                  {onChangeCategory ? (
                    <button
                      type="button"
                      role="menuitem"
                      className="block min-h-8 w-full px-3 py-1.5 text-left text-slate-800 hover:bg-slate-100 active:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800 dark:active:bg-slate-800"
                      onClick={() => {
                        setRowMenuOpen(false)
                        onChangeCategory(item.id)
                      }}
                    >
                      Change category
                    </button>
                  ) : null}
                  {onTextChange ? (
                    <button
                      type="button"
                      role="menuitem"
                      className="block min-h-8 w-full px-3 py-1.5 text-left text-slate-800 hover:bg-slate-100 active:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800 dark:active:bg-slate-800"
                      onClick={() => beginEditNameFromMenu()}
                    >
                      Edit name
                    </button>
                  ) : null}
                </div>,
                document.body,
              )
            : null}
        </div>
      ) : (
        <button
          type="button"
          className="grid min-h-8 min-w-8 place-items-center rounded-[6px] text-[#505258] hover:bg-slate-100 active:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 dark:active:bg-slate-800"
          onPointerDown={blockDragFromControl}
          onClick={() => onDelete(item.id)}
          aria-label={`Delete ${item.text}`}
          title="Delete item"
        >
          <ItemDeleteIcon className="h-5 w-5 sm:h-6 sm:w-6" />
        </button>
      )}
    </li>
  )
}
