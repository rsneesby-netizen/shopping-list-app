import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useState } from 'react'
import { categoryLabel } from '../../lib/categories'

function SortableRow({ id }: { id: string }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
    >
      <button
        type="button"
        className="touch-none rounded p-2 text-slate-400"
        aria-label="Drag"
        {...attributes}
        {...listeners}
      >
        ⋮⋮
      </button>
      <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{categoryLabel(id)}</span>
    </li>
  )
}

type Props = {
  initialOrder: string[]
  onClose: () => void
  onSave: (order: string[]) => Promise<void>
}

export function CategoryOrderModal({ initialOrder, onClose, onSave }: Props) {
  const [order, setOrder] = useState(initialOrder)
  const [saving, setSaving] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = order.indexOf(String(active.id))
    const newIndex = order.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    setOrder((o) => arrayMove(o, oldIndex, newIndex))
  }

  async function save() {
    setSaving(true)
    try {
      await onSave(order)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="max-h-[85vh] w-full max-w-md overflow-hidden rounded-t-3xl bg-white shadow-xl dark:bg-slate-900 sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Aisle order</h2>
          <button type="button" className="text-sm text-slate-500" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="px-4 py-2 text-xs text-slate-500">
          Drag categories to match how you walk that store. This order is saved per store layout.
        </p>
        <div className="max-h-[50vh] overflow-y-auto px-2 pb-2">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={order} strategy={verticalListSortingStrategy}>
              <ul className="flex flex-col gap-1">
                {order.map((id) => (
                  <SortableRow key={id} id={id} />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </div>
        <div className="flex gap-2 border-t border-slate-200 p-4 dark:border-slate-700">
          <button
            type="button"
            className="flex-1 rounded-xl border border-slate-200 py-3 text-sm font-semibold dark:border-slate-600"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            className="flex-1 rounded-xl bg-teal-700 py-3 text-sm font-semibold text-white disabled:opacity-60"
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save order'}
          </button>
        </div>
      </div>
    </div>
  )
}
