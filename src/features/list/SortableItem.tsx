import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ListItemRow } from '../../types'
import { ItemDeleteIcon } from './listIcons'

type Props = {
  item: ListItemRow
  disabled?: boolean
  showDragHandle?: boolean
  onToggle: (id: string, checked: boolean) => void
  onDelete: (id: string) => void
  onQuantityChange: (id: string, quantity: number) => void
}

export function SortableItem({
  item,
  disabled,
  showDragHandle = true,
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

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-1.5 rounded-[6px] bg-white px-2 py-1.5 sm:gap-2 sm:px-3 sm:py-2 dark:bg-slate-900"
    >
      {showDragHandle ? (
        <button
          type="button"
          className="touch-none rounded-[6px] p-1.5 text-slate-400 hover:bg-slate-100 disabled:opacity-30 sm:p-2 dark:hover:bg-slate-800"
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
        <input
          type="number"
          min={0.1}
          step={0.1}
          value={item.quantity}
          onChange={(e) => onQuantityChange(item.id, Number(e.target.value))}
          className="w-14 rounded-[6px] border border-slate-200 bg-white px-1 py-1 text-right text-xs sm:w-16 sm:text-sm dark:border-slate-600 dark:bg-slate-950"
        />
        <span className="w-8 text-[10px] text-slate-500 sm:w-10 sm:text-xs">{item.unit}</span>
      </div>
      <button
        type="button"
        className="grid h-7 w-7 place-items-center rounded-[6px] text-red-600 hover:bg-red-50 sm:h-8 sm:w-8 dark:hover:bg-red-950"
        onClick={() => onDelete(item.id)}
        aria-label={`Delete ${item.text}`}
        title="Delete item"
      >
        <ItemDeleteIcon className="h-5 w-5 sm:h-6 sm:w-6" />
      </button>
    </li>
  )
}
