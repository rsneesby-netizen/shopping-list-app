import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
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

const EACH_QUANTITY_OPTIONS = Array.from({ length: 20 }, (_, i) => i + 1)

/** 32×32 quantity control, subtle border at rest */
const qtyBoxClass =
  'box-border h-8 w-8 shrink-0 rounded border border-slate-200/80 bg-white text-center text-xs tabular-nums text-slate-700 outline-none focus:border-slate-400 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-slate-500'

const noChevron =
  'appearance-none bg-[length:0] [background-image:none] [&::-webkit-appearance]:none'

type Props = {
  item: ListItemRow
  disabled?: boolean
  showDragHandle?: boolean
  inGroupedBlock?: boolean
  enableLongPressCategoryChange?: boolean
  onToggle: (id: string, checked: boolean) => void
  onDelete: (id: string) => void
  onQuantityChange: (id: string, quantity: number) => void
  onUnitChange: (id: string, unit: string) => void
  onLongPressCategoryChange?: (id: string) => void
}

function eachQuantityValue(q: number) {
  const n = Math.round(Number(q))
  return Math.min(20, Math.max(1, Number.isFinite(n) ? n : 1))
}

export function SortableItem({
  item,
  disabled,
  showDragHandle = true,
  inGroupedBlock = false,
  enableLongPressCategoryChange = false,
  onToggle,
  onDelete,
  onQuantityChange,
  onUnitChange,
  onLongPressCategoryChange,
}: Props) {
  const unit = normalizeUnit(item.unit)
  const isEach = unit === 'each'

  const [qtyText, setQtyText] = useState(() => formatQuantityForInput(unit, item.quantity))

  useEffect(() => {
    setQtyText(formatQuantityForInput(unit, item.quantity))
  }, [item.id, item.quantity, item.unit, unit])

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled,
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
    if (!enableLongPressCategoryChange || !onLongPressCategoryChange) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const target = e.target as HTMLElement
    // Allow long-press on most of the row (including text area), but never on active controls.
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

  const unitSelectClass =
    `${noChevron} shrink-0 cursor-pointer border-0 bg-transparent p-0 text-[10px] leading-tight text-slate-500 outline-none ring-0 focus:border-0 focus:outline-none focus:ring-0 dark:text-slate-400`

  return (
    <li
      ref={setNodeRef}
      style={style}
      onPointerDown={handlePointerDown}
      onPointerUp={clearLongPress}
      onPointerLeave={clearLongPress}
      onPointerCancel={clearLongPress}
      onContextMenu={enableLongPressCategoryChange ? (e) => e.preventDefault() : undefined}
      onClickCapture={(e) => {
        if (!longPressTriggeredRef.current) return
        // Prevent the delayed click from toggling checkbox/other default row actions.
        e.preventDefault()
        e.stopPropagation()
        longPressTriggeredRef.current = false
      }}
      className={
        inGroupedBlock
          ? 'flex items-center gap-1.5 rounded-none bg-transparent px-2 py-1.5 sm:gap-2 sm:px-3 sm:py-2 dark:bg-transparent'
          : 'flex items-center gap-1.5 rounded-[6px] bg-white px-2 py-1.5 sm:gap-2 sm:px-3 sm:py-2 dark:bg-slate-900'
      }
    >
      {showDragHandle ? (
        <button
          type="button"
          className="grid min-h-8 min-w-8 touch-none place-items-center rounded-[6px] p-1 text-slate-400 hover:bg-slate-100 active:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800 dark:active:bg-slate-800"
          aria-label="Drag to reorder"
          disabled={disabled}
          {...attributes}
          {...listeners}
        >
          <span className="text-lg leading-none">⋮⋮</span>
        </button>
      ) : null}
      <label className="flex flex-1 cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={item.checked}
          onChange={(e) => onToggle(item.id, e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-teal-700 sm:h-5 sm:w-5"
        />
        <span className={`flex-1 text-left ${item.checked ? 'text-slate-400 line-through' : 'text-slate-900 dark:text-slate-50'}`}>
          {item.text}
        </span>
      </label>
      <div className="flex items-center gap-1">
        {isEach ? (
          <select
            value={eachQuantityValue(item.quantity)}
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
            value={qtyText}
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
          value={unit}
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
      <button
        type="button"
        className="grid min-h-8 min-w-8 place-items-center rounded-[6px] text-[#505258] hover:bg-slate-100 active:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 dark:active:bg-slate-800"
        onClick={() => onDelete(item.id)}
        aria-label={`Delete ${item.text}`}
        title="Delete item"
      >
        <ItemDeleteIcon className="h-5 w-5 sm:h-6 sm:w-6" />
      </button>
    </li>
  )
}
