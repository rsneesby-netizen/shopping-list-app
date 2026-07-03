import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
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
const SWIPE_DELETE_THRESHOLD_PX = 72
const SWIPE_DELETE_MAX_PX = 78

/** 32×32 quantity control, subtle border at rest */
const qtyBoxClass =
  'box-border h-8 w-[48px] min-w-[48px] max-w-[48px] shrink-0 rounded-l-[8px] rounded-r-none border border-r-0 border-slate-200/80 bg-white pl-0 pr-2 py-1 text-right text-base font-medium tabular-nums [text-align-last:right] text-[#505258] outline-none focus:border-slate-400 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-slate-500'

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
  const [swipeOffset, setSwipeOffset] = useState(0)
  const [isSwiping, setIsSwiping] = useState(false)
  const sortableLocked = !!(disabled || disableDrag || isSwiping)
  const rowDrag = dragFromRow && !sortableLocked
  const blockDragFromControl = rowDrag
    ? (e: ReactPointerEvent<HTMLElement>) => {
        e.stopPropagation()
      }
    : undefined

  const [qtyText, setQtyText] = useState(() => formatQuantityForInput(unit, item.quantity))
  const [textDraft, setTextDraft] = useState(() => item.text)
  const [rowAction, setRowAction] = useState('')
  const [nameFieldActive, setNameFieldActive] = useState(false)

  const nameInputRef = useRef<HTMLInputElement>(null)
  const swipePointerIdRef = useRef<number | null>(null)
  const swipeStartXRef = useRef(0)
  const swipeStartYRef = useRef(0)

  useEffect(() => {
    setQtyText(formatQuantityForInput(unit, item.quantity))
  }, [item.id, item.quantity, item.unit, unit])

  useEffect(() => {
    setTextDraft(item.text)
  }, [item.id, item.text])


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
    setRowAction('')
    setNameFieldActive(true)
    requestAnimationFrame(() => {
      const el = nameInputRef.current
      if (!el) return
      el.focus()
      el.select()
    })
  }

  function handleRowActionChange(value: string) {
    if (!value) return
    if (value === 'delete') onDelete(item.id)
    if (value === 'category' && onChangeCategory) onChangeCategory(item.id)
    if (value === 'edit' && onTextChange) beginEditNameFromMenu()
    setRowAction('')
  }

  const unitSelectClass =
    `${noChevron} h-8 w-[48px] min-w-[48px] max-w-[48px] shrink-0 cursor-pointer rounded-l-none rounded-r-[8px] border border-slate-200/80 bg-white px-2 py-1 text-left text-base font-medium leading-5 text-[#505258] outline-none ring-0 focus:border-slate-400 focus:outline-none focus:ring-0 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-slate-500`

  const nameLocked = overflowMenu && onTextChange && !nameFieldActive
  const nameTextClass = `min-w-0 flex-1 rounded-[4px] border border-transparent bg-transparent px-1 py-0.5 text-left text-base font-medium leading-5 outline-none focus:border-[#1868DB] disabled:opacity-50 ${
    item.checked ? 'text-slate-400 line-through' : 'text-slate-600 dark:text-slate-50'
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

  function finishSwipe() {
    swipePointerIdRef.current = null
    setIsSwiping(false)
    setSwipeOffset(0)
  }

  function handleSwipePointerDown(e: ReactPointerEvent<HTMLLIElement>) {
    if (disabled || isDragging) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (e.pointerType !== 'touch' && e.pointerType !== 'mouse') return
    const target = e.target as HTMLElement
    if (target.closest('button, input, select, a')) return
    swipePointerIdRef.current = e.pointerId
    swipeStartXRef.current = e.clientX
    swipeStartYRef.current = e.clientY
    setSwipeOffset(0)
  }

  function handleSwipePointerMove(e: ReactPointerEvent<HTMLLIElement>) {
    if (swipePointerIdRef.current !== e.pointerId) return
    if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) return
    if (isDragging) {
      finishSwipe()
      return
    }
    const dx = e.clientX - swipeStartXRef.current
    const dy = Math.abs(e.clientY - swipeStartYRef.current)
    if (!isSwiping) {
      if (dy > 18 && Math.abs(dx) < dy) {
        finishSwipe()
        return
      }
      // Claim left-swipe intent early so DnD doesn't activate first.
      if (dx >= -2 || Math.abs(dx) <= dy + 1) return
      setIsSwiping(true)
    }
    if (dy > 18 && Math.abs(dx) < dy) {
      finishSwipe()
      return
    }
    const next = Math.max(-SWIPE_DELETE_MAX_PX, Math.min(0, dx))
    setSwipeOffset(next)
    if (next <= -SWIPE_DELETE_THRESHOLD_PX) {
      finishSwipe()
      onDelete(item.id)
    }
  }

  function handleTrackpadWheel(e: ReactWheelEvent<HTMLLIElement>) {
    if (disabled || isDragging) return
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
    const next = Math.max(-SWIPE_DELETE_MAX_PX, Math.min(0, swipeOffset - e.deltaX))
    setSwipeOffset(next)
    if (next <= -SWIPE_DELETE_THRESHOLD_PX) {
      setSwipeOffset(0)
      onDelete(item.id)
    }
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      {...(rowDrag ? attributes : {})}
      {...dndRowListeners}
      onPointerUp={clearLongPress}
      onPointerLeave={clearLongPress}
      onPointerCancel={clearLongPress}
      onPointerDownCapture={handleSwipePointerDown}
      onPointerMove={handleSwipePointerMove}
      onPointerUpCapture={() => finishSwipe()}
      onPointerCancelCapture={() => finishSwipe()}
      onWheel={handleTrackpadWheel}
      onContextMenu={!overflowMenu && enableLongPressCategoryChange ? (e) => e.preventDefault() : undefined}
      onClickCapture={(e) => {
        if (!longPressTriggeredRef.current) return
        e.preventDefault()
        e.stopPropagation()
        longPressTriggeredRef.current = false
      }}
      className={
        (inGroupedBlock
          ? 'relative overflow-hidden rounded-none bg-transparent dark:bg-transparent'
          : 'relative overflow-hidden rounded-[8px] bg-white dark:bg-slate-900') +
        (rowDrag ? ' touch-none cursor-grab active:cursor-grabbing' : '')
      }
    >
      {swipeOffset < 0 ? (
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center">
          <button
            type="button"
            className="pointer-events-auto h-8 rounded-[8px] bg-[#AE2E24] px-3 text-sm font-medium text-white"
            onPointerDown={blockDragFromControl}
            onClick={() => onDelete(item.id)}
            aria-label={`Remove ${item.text}`}
          >
            Remove
          </button>
        </div>
      ) : null}
      <div
        className="relative z-10 flex h-8 items-center gap-[9px] bg-white py-0.5 transition-transform duration-75 dark:bg-slate-900"
        style={{ transform: `translateX(${swipeOffset}px)` }}
      >
        {showPrices && isOnSpecial ? <span className="absolute inset-y-0 left-0 w-0.5 bg-amber-300" aria-hidden /> : null}
        {showDragHandle ? (
          <button
            type="button"
            className={`grid h-8 w-4 place-items-center rounded-[6px] p-0 text-slate-400 hover:bg-slate-100 active:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800 dark:active:bg-slate-800 ${rowDrag ? '' : 'touch-none'}`}
            aria-label="Drag to reorder"
            disabled={sortableLocked}
            {...(!rowDrag ? attributes : {})}
            {...(!rowDrag ? listeners : {})}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
              <path d="M5.25 2.0625C5.25 2.78737 4.66237 3.375 3.9375 3.375C3.21263 3.375 2.625 2.78737 2.625 2.0625C2.625 1.33763 3.21263 0.75 3.9375 0.75C4.66237 0.75 5.25 1.33763 5.25 2.0625Z" fill="#080F21" fillOpacity="0.29" />
              <path d="M9.375 2.0625C9.375 2.78737 8.78737 3.375 8.0625 3.375C7.33763 3.375 6.75 2.78737 6.75 2.0625C6.75 1.33763 7.33763 0.75 8.0625 0.75C8.78737 0.75 9.375 1.33763 9.375 2.0625Z" fill="#080F21" fillOpacity="0.29" />
              <path d="M5.25 6C5.25 6.72487 4.66237 7.3125 3.9375 7.3125C3.21263 7.3125 2.625 6.72487 2.625 6C2.625 5.27513 3.21263 4.6875 3.9375 4.6875C4.66237 4.6875 5.25 5.27513 5.25 6Z" fill="#080F21" fillOpacity="0.29" />
              <path d="M9.375 6C9.375 6.72487 8.78737 7.3125 8.0625 7.3125C7.33763 7.3125 6.75 6.72487 6.75 6C6.75 5.27513 7.33763 4.6875 8.0625 4.6875C8.78737 4.6875 9.375 5.27513 9.375 6Z" fill="#080F21" fillOpacity="0.29" />
              <path d="M5.25 9.9375C5.25 10.6624 4.66237 11.25 3.9375 11.25C3.21263 11.25 2.625 10.6624 2.625 9.9375C2.625 9.21263 3.21263 8.625 3.9375 8.625C4.66237 8.625 5.25 9.21263 5.25 9.9375Z" fill="#080F21" fillOpacity="0.29" />
              <path d="M9.375 9.9375C9.375 10.6624 8.78737 11.25 8.0625 11.25C7.33763 11.25 6.75 10.6624 6.75 9.9375C6.75 9.21263 7.33763 8.625 8.0625 8.625C8.78737 8.625 9.375 9.21263 9.375 9.9375Z" fill="#080F21" fillOpacity="0.29" />
            </svg>
          </button>
        ) : null}
        <div className="flex min-w-0 flex-1 items-center gap-[10px]">
        <input
          type="checkbox"
          disabled={disabled}
          checked={item.checked}
          onPointerDown={blockDragFromControl}
          onChange={(e) => onToggle(item.id, e.target.checked)}
          className="grocery-checkbox shrink-0"
        />
        {nameLocked ? (
          <span className={`${nameTextClass} cursor-grab select-none`}>
            {textDraft}
          </span>
        ) : (
          <input
            ref={nameInputRef}
            type="text"
            disabled={disabled}
            readOnly={false}
            tabIndex={0}
            className={nameTextClass}
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            onPointerDown={(e) => {
              blockDragFromControl?.(e)
            }}
            onFocus={(e) => {
              setNameFieldActive(true)
              e.target.select()
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
        )}
        </div>
        <div className="flex items-center gap-0">
        {isEach ? (
          <select
            disabled={disabled}
            value={eachQuantityValue(item.quantity)}
            onPointerDown={blockDragFromControl}
            onChange={(e) => onQuantityChange(item.id, Number(e.target.value))}
            className={`${qtyBoxClass} ${noChevron}`}
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
            onFocus={(e) => e.target.select()}
            onBlur={() => commitQtyText()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
            className={`${qtyBoxClass} [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
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
              {u === 'each' ? 'ea' : unitOptionLabel(u)}
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
        {overflowMenu && !item.checked ? (
        <div className="-ml-[9px] relative h-8 w-8 shrink-0">
          <select
            value={rowAction}
            onChange={(e) => handleRowActionChange(e.target.value)}
            className="absolute inset-0 z-10 h-8 w-8 cursor-pointer appearance-none rounded-[8px] bg-transparent text-transparent outline-none hover:bg-[#050C1810] active:bg-[#050C1810]"
            aria-label={`Actions for ${item.text}`}
            onPointerDown={blockDragFromControl}
          >
            <option value="delete">Delete</option>
            {onChangeCategory ? <option value="category">Change category</option> : null}
            {onTextChange ? <option value="edit">Edit name</option> : null}
          </select>
          <div className="pointer-events-none grid h-8 w-8 place-items-center rounded-[8px]">
            <ToolbarIconMore className="h-4 w-4 shrink-0" />
          </div>
        </div>
        ) : (
        <button
          type="button"
          className="-ml-[9px] grid h-8 w-8 place-items-center rounded-[8px] text-[#505258] hover:bg-[#050C1810] active:bg-[#050C1810] dark:text-slate-400 dark:hover:bg-slate-800 dark:active:bg-slate-800"
          onPointerDown={blockDragFromControl}
          onClick={() => onDelete(item.id)}
          aria-label={`Delete ${item.text}`}
          title="Delete item"
        >
          <ItemDeleteIcon className="h-4 w-4" />
        </button>
        )}
      </div>
    </li>
  )
}
