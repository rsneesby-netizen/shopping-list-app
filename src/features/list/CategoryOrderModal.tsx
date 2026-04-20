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
import { useCallback, useEffect, useState } from 'react'
import { categoryLabel } from '../../lib/categories'
import type { StorePresetCategoryRow, StorePresetRow } from '../../types'

function SortableRow({
  id,
  nameValue,
  onNameChange,
}: {
  id: string
  nameValue: string
  onNameChange: (categoryKey: string, value: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-2 dark:border-slate-600 dark:bg-slate-900"
    >
      <button
        type="button"
        className="touch-none shrink-0 rounded p-2 text-slate-400"
        aria-label="Drag"
        {...attributes}
        {...listeners}
      >
        ⋮⋮
      </button>
      <input
        type="text"
        className="min-w-0 flex-1 rounded-[6px] border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none focus:border-slate-400 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-50"
        value={nameValue}
        onChange={(e) => onNameChange(id, e.target.value)}
        aria-label={`Name for ${id}`}
      />
    </li>
  )
}

function buildOrderAndLabelsFromCats(
  presetId: string | null,
  allCats: StorePresetCategoryRow[],
): { order: string[]; labels: Record<string, string> } {
  if (!presetId) return { order: [], labels: {} }
  const rows = allCats
    .filter((c) => c.preset_id === presetId)
    .sort((a, b) => a.sort_index - b.sort_index)
  const order = rows.map((r) => r.category_key)
  const labels: Record<string, string> = {}
  for (const r of rows) {
    labels[r.category_key] = r.label_override?.trim()
      ? r.label_override
      : categoryLabel(r.category_key)
  }
  return { order, labels }
}

export type CategoryOrderSavePayload = {
  targetPresetId: string
  order: string[]
  /** Raw display strings keyed by category_key */
  labels: Record<string, string>
}

type Props = {
  presets: StorePresetRow[]
  presetCats: StorePresetCategoryRow[]
  /** List's current layout — initial "editing" preset when modal opens */
  defaultEditingPresetId: string | null
  onClose: () => void
  onSave: (payload: CategoryOrderSavePayload) => Promise<void>
}

export function CategoryOrderModal({
  presets,
  presetCats,
  defaultEditingPresetId,
  onClose,
  onSave,
}: Props) {
  const [editingPresetId, setEditingPresetId] = useState<string | null>(
    () => defaultEditingPresetId ?? presets[0]?.id ?? null,
  )
  const [order, setOrder] = useState<string[]>([])
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const syncFromPreset = useCallback(
    (presetId: string | null) => {
      const { order: o, labels: lb } = buildOrderAndLabelsFromCats(presetId, presetCats)
      setOrder(o)
      setLabels(lb)
    },
    [presetCats],
  )

  useEffect(() => {
    setEditingPresetId((prev) => prev ?? defaultEditingPresetId ?? presets[0]?.id ?? null)
  }, [defaultEditingPresetId, presets])

  useEffect(() => {
    syncFromPreset(editingPresetId)
  }, [editingPresetId, syncFromPreset])

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

  function onNameChange(categoryKey: string, value: string) {
    setLabels((prev) => ({ ...prev, [categoryKey]: value }))
  }

  async function save() {
    if (!editingPresetId || !order.length) {
      onClose()
      return
    }
    setSaving(true)
    try {
      await onSave({
        targetPresetId: editingPresetId,
        order,
        labels,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="max-h-[85vh] w-full max-w-md overflow-hidden rounded-t-3xl bg-white shadow-xl dark:bg-slate-900 sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Manage store aisle ordering</h2>
          <button type="button" className="text-sm text-slate-500" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="px-4 py-2 text-xs text-slate-500">
          Choose a store layout to edit its aisle order and category names. This does not change which layout is
          active for your list — use the store layout control above the list for that.
        </p>
        <div className="border-b border-slate-200 px-4 pb-3 dark:border-slate-700">
          <label className="sr-only">Store layout to edit</label>
          {presets.length ? (
            <select
              className="min-h-8 w-full rounded-[6px] border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-50"
              value={editingPresetId ?? ''}
              onChange={(e) => setEditingPresetId(e.target.value || null)}
              aria-label="Store layout to edit"
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-sm text-slate-500">No store layouts available.</p>
          )}
        </div>
        <div className="max-h-[50vh] overflow-y-auto px-2 pb-2 pt-2">
          {editingPresetId && order.length ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={order} strategy={verticalListSortingStrategy}>
                <ul className="flex flex-col gap-1">
                  {order.map((id) => (
                    <SortableRow
                      key={id}
                      id={id}
                      nameValue={labels[id] ?? categoryLabel(id)}
                      onNameChange={onNameChange}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          ) : (
            <p className="px-2 py-4 text-center text-sm text-slate-500">No categories for this layout.</p>
          )}
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
            disabled={saving || !editingPresetId}
            className="flex-1 rounded-xl bg-teal-700 py-3 text-sm font-semibold text-white disabled:opacity-60"
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
