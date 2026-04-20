import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ListItemRow } from '../../types'
import { ItemDeleteIcon } from './listIcons'

const EACH_QUANTITY_OPTIONS = Array.from({ length: 20 }, (_, i) => i + 1)

const controlFieldClass =
  'min-h-8 rounded-[6px] border border-slate-200 bg-white px-1 text-right text-xs sm:text-sm dark:border-slate-600 dark:bg-slate-950'

type Props = {
  item: ListItemRow
  disabled?: boolean
  showDragHandle?: boolean
  /** Rows inside a grouped category card (shared white background on parent) */
  inGroupedBlock?: boolean
  onToggle: (id: string, checked: boolean) => void
  onDelete: (id: string) => void
  onQuantityChange: (id: string, quantity: number) => void
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
  onToggle,
  onDelete,
  onQuantityChange,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
  }

  const isEach = item.unit === 'each'

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={
        inGroupedBlock
          ? 'flex items-center gap-1.5 rounded-none bg-transparent px-2 py-1.5 sm:gap-2 sm:px-3 sm:py-2 dark:bg-transparent'
          : 'flex items-center gap-1.5 rounded-[6px] bg-white px-2 py-1.5 sm:gap-2 sm:px-3 sm:py-2 dark:bg-slate-900'
      }
    >
      {showDragHandle ? (
        <button
          type="button"
          className="grid min-h-8 min-w-8 touch-none place-items-center rounded-[6px] p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"
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
            className={`${controlFieldClass} w-14 sm:w-16`}
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
            type="number"
            min={0.1}
            step={0.1}
            value={item.quantity}
            onChange={(e) => onQuantityChange(item.id, Number(e.target.value))}
            className={`${controlFieldClass} w-14 sm:w-16`}
          />
        )}
        <span className="w-8 text-[10px] text-slate-500 sm:w-10 sm:text-xs">{item.unit}</span>
      </div>
      <button
        type="button"
        className="grid min-h-8 min-w-8 place-items-center rounded-[6px] text-[#505258] hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        onClick={() => onDelete(item.id)}
        aria-label={`Delete ${item.text}`}
        title="Delete item"
      >
        <ItemDeleteIcon className="h-5 w-5 sm:h-6 sm:w-6" />
      </button>
    </li>
  )
}
