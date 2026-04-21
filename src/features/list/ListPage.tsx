import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useUndoRedo } from '../../hooks/useUndoRedo'
import { categoryDisplayLabel, categoryLabel, inferCategoryKey, listCategoryDefs } from '../../lib/categories'
import { logListItemEvent } from '../../lib/events'
import { fingerprintFromText } from '../../lib/normalize'
import { estimateListPricing, fetchMergedListPricing, type ListPriceEstimate } from '../../lib/pricing'
import { keyAfterLast, keyAfterReorder, sortByPosition } from '../../lib/positions'
import { buildSuggestions } from '../../lib/recommendations'
import {
  filterStoreLayouts,
  pickDefaultStoreLayoutId,
  rememberLastStoreLayoutId,
} from '../../lib/storeLayouts'
import {
  clampQuantityForUnit,
  formatQuantityForInput,
  normalizeUnit,
  parseQuantityInput,
  quantityWhenChangingUnit,
  unitOptionLabel,
  UNIT_OPTIONS,
} from '../../lib/units'
import { getSupabase } from '../../lib/supabase'
import type { ListItemEventRow, ListItemRow, ListRow, StorePresetCategoryRow, StorePresetRow } from '../../types'
import { CategoryOrderModal } from './CategoryOrderModal'
import { RecommendationsDrawer } from './RecommendationsDrawer'
import { SortableItem } from './SortableItem'
import { BackToListsIcon, GroupCollapseChevronIcon, GroupExpandChevronIcon } from './listIcons'
import { ToolbarIconMore, ToolbarIconRecommended, ToolbarIconRedo, ToolbarIconUndo } from './toolbarIcons'

const ADD_EACH_QTY_OPTIONS = Array.from({ length: 20 }, (_, i) => i + 1)
type PendingAdd = { text: string; qty: number; unit: string }

export function ListPage() {
  const { listId } = useParams()
  const supabase = getSupabase()
  const { push, undo, redo, canUndo, canRedo } = useUndoRedo()

  const [list, setList] = useState<ListRow | null>(null)
  const [items, setItems] = useState<ListItemRow[]>([])
  const [presets, setPresets] = useState<StorePresetRow[]>([])
  const [presetCats, setPresetCats] = useState<StorePresetCategoryRow[]>([])
  const [events, setEvents] = useState<ListItemEventRow[]>([])
  const [title, setTitle] = useState('')
  const [newText, setNewText] = useState('')
  const [newQty, setNewQty] = useState(1)
  /** Text field for L / g quantity in add bar (validates on blur / add) */
  const [newQtyText, setNewQtyText] = useState('1')
  const [newUnit, setNewUnit] = useState('each')
  const [view, setView] = useState<'flat' | 'grouped'>('flat')
  const [recOpen, setRecOpen] = useState(false)
  const [catOpen, setCatOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [pendingDuplicateAdd, setPendingDuplicateAdd] = useState<PendingAdd | null>(null)
  const [categoryPickerItemId, setCategoryPickerItemId] = useState<string | null>(null)
  const [categoryTargetKey, setCategoryTargetKey] = useState<string>('miscellaneous')
  /** When true, category group body is hidden */
  const [collapsedCategoryKeys, setCollapsedCategoryKeys] = useState<Record<string, boolean>>({})
  const actionsMenuRef = useRef<HTMLDivElement | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const refreshAll = useCallback(async () => {
    if (!listId) return
    const [{ data: l, error: e1 }, { data: its, error: e2 }, { data: evs, error: e3 }] = await Promise.all([
      supabase.from('lists').select('*').eq('id', listId).maybeSingle(),
      supabase.from('list_items').select('*').eq('list_id', listId),
      supabase.from('list_item_events').select('*').eq('list_id', listId).order('created_at', { ascending: false }).limit(800),
    ])
    if (e1) throw e1
    if (e2) throw e2
    if (e3) throw e3
    setList(l as ListRow)
    setTitle((l as ListRow | null)?.title ?? '')
    setItems(sortByPosition((its ?? []) as ListItemRow[]))
    setEvents((evs ?? []) as ListItemEventRow[])
  }, [listId, supabase])

  useEffect(() => {
    if (!listId) return
    let cancelled = false
    ;(async () => {
      try {
        const [{ data: presetRows }, { data: pcRows }] = await Promise.all([
          supabase.from('store_presets').select('*').order('name'),
          supabase.from('store_preset_categories').select('*').order('sort_index'),
        ])
        if (!cancelled) {
          setPresets(filterStoreLayouts((presetRows ?? []) as StorePresetRow[]))
          setPresetCats((pcRows ?? []) as StorePresetCategoryRow[])
        }
        await refreshAll()
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [listId, refreshAll, supabase])

  useEffect(() => {
    if (!listId) return
    const channel = supabase
      .channel(`list-items-${listId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'list_items', filter: `list_id=eq.${listId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const row = payload.new as ListItemRow
            setItems((prev) => {
              if (prev.some((i) => i.id === row.id)) return prev
              return sortByPosition([...prev, row])
            })
          } else if (payload.eventType === 'UPDATE') {
            const row = payload.new as ListItemRow
            setItems((prev) => sortByPosition(prev.map((i) => (i.id === row.id ? row : i))))
          } else if (payload.eventType === 'DELETE') {
            const id = (payload.old as { id: string }).id
            setItems((prev) => prev.filter((i) => i.id !== id))
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'list_item_events', filter: `list_id=eq.${listId}` },
        (payload) => {
          const row = payload.new as ListItemEventRow
          setEvents((prev) => [row, ...prev])
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'lists', filter: `id=eq.${listId}` },
        (payload) => {
          setList(payload.new as ListRow)
          setTitle((payload.new as ListRow).title)
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [listId, supabase])

  const activeSorted = useMemo(
    () => sortByPosition(items.filter((i) => !i.checked)),
    [items],
  )
  const completedSorted = useMemo(
    () => sortByPosition(items.filter((i) => i.checked)),
    [items],
  )

  const presetKeysOrdered = useMemo(() => {
    if (!list?.store_preset_id) {
      return listCategoryDefs().map((c) => c.key)
    }
    const keys = presetCats
      .filter((c) => c.preset_id === list.store_preset_id)
      .sort((a, b) => a.sort_index - b.sort_index)
      .map((c) => c.category_key)
    return keys.length ? keys : listCategoryDefs().map((c) => c.key)
  }, [list, presetCats])

  const categoryWalkOrder = useMemo(() => {
    const out = [...presetKeysOrdered]
    if (!out.includes('miscellaneous')) out.push('miscellaneous')
    return out
  }, [presetKeysOrdered])

  const headingForCategoryKey = useCallback(
    (key: string) => {
      if (!list?.store_preset_id) return categoryLabel(key)
      const row = presetCats.find((c) => c.preset_id === list.store_preset_id && c.category_key === key)
      return categoryDisplayLabel(key, row?.label_override)
    },
    [list?.store_preset_id, presetCats],
  )

  const suggestions = useMemo(
    () => buildSuggestions(events, items),
    [events, items],
  )

  async function persistTitle(next: string) {
    if (!listId) return
    const { error: e } = await supabase.from('lists').update({ title: next }).eq('id', listId)
    if (e) setError(e.message)
  }

  async function persistPreset(presetId: string | null) {
    if (!listId) return
    const { error: e } = await supabase.from('lists').update({ store_preset_id: presetId }).eq('id', listId)
    if (e) setError(e.message)
    else {
      if (presetId) rememberLastStoreLayoutId(presetId)
      setList((prev) => (prev ? { ...prev, store_preset_id: presetId } : prev))
    }
  }

  useEffect(() => {
    if (!listId || !list || list.store_preset_id || !presets.length) return
    const fallbackPresetId = pickDefaultStoreLayoutId(presets)
    if (!fallbackPresetId) return
    void persistPreset(fallbackPresetId)
  }, [listId, list, presets])

  useEffect(() => {
    if (!actionsOpen) return
    function onDocMouseDown(event: MouseEvent) {
      const target = event.target
      if (!(target instanceof Node)) return
      if (actionsMenuRef.current?.contains(target)) return
      setActionsOpen(false)
    }
    function onDocKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setActionsOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onDocKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onDocKeyDown)
    }
  }, [actionsOpen])

  async function insertItem(text: string, qty: number, unit: string) {
    if (!listId) return
    const trimmed = text.trim()
    if (!trimmed) return
    const u = normalizeUnit(unit)
    const q = clampQuantityForUnit(u, qty)
    if (q === null) return
    const fp = fingerprintFromText(trimmed)
    const cat = inferCategoryKey(trimmed, null)
    const activePositions = sortByPosition(items.filter((i) => !i.checked)).map((i) => i.position)
    const position = keyAfterLast(activePositions)
    let createdId: string | null = null
    setError(null)
    try {
      await push({
        apply: async () => {
          const { data, error: err } = await supabase
            .from('list_items')
            .insert({
              list_id: listId,
              text: trimmed,
              quantity: q,
              unit: u,
              checked: false,
              position,
              category_key: cat,
            })
            .select('*')
            .single()
          if (err) throw err
          createdId = data.id
          setItems((prev) => {
            if (prev.some((i) => i.id === data.id)) return prev
            return sortByPosition([...prev, data as ListItemRow])
          })
          void logListItemEvent(supabase, {
            listId,
            itemId: data.id,
            eventType: 'item_added',
            fingerprint: fp,
            payload: { text: trimmed, quantity: q, unit: u },
          })
        },
        revert: async () => {
          if (!createdId) return
          const { error: err } = await supabase.from('list_items').delete().eq('id', createdId)
          if (err) throw err
        },
      })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not add item')
    }
  }

  async function onDragEnd(e: DragEndEvent) {
    if (!listId) return
    const { active, over } = e
    if (!over) return
    const activeItem = items.find((i) => i.id === active.id)
    const overItem = items.find((i) => i.id === over.id)
    if (!activeItem || !overItem || activeItem.checked !== overItem.checked) return
    const bucket = activeItem.checked ? completedSorted : activeSorted
    const oldIndex = bucket.findIndex((i) => i.id === active.id)
    const newIndex = bucket.findIndex((i) => i.id === over.id)
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return
    const newPos = keyAfterReorder(bucket, oldIndex, newIndex)
    const prevPos = activeItem.position
    setItems((prev) =>
      sortByPosition(prev.map((i) => (i.id === activeItem.id ? { ...i, position: newPos } : i))),
    )
    try {
      await push({
        apply: async () => {
          const { error: err } = await supabase.from('list_items').update({ position: newPos }).eq('id', activeItem.id)
          if (err) throw err
          void logListItemEvent(supabase, {
            listId,
            itemId: activeItem.id,
            eventType: 'reorder',
            fingerprint: fingerprintFromText(activeItem.text),
            payload: { from: prevPos, to: newPos },
          })
        },
        revert: async () => {
          const { error: err } = await supabase.from('list_items').update({ position: prevPos }).eq('id', activeItem.id)
          if (err) throw err
        },
      })
    } catch (e: unknown) {
      setItems((prev) =>
        sortByPosition(prev.map((i) => (i.id === activeItem.id ? { ...i, position: prevPos } : i))),
      )
      setError(e instanceof Error ? e.message : 'Reorder failed')
    }
  }

  async function addItem() {
    const u = normalizeUnit(newUnit)
    let qty: number
    if (u === 'each') {
      qty = clampQuantityForUnit('each', newQty) ?? 1
    } else {
      const p = parseQuantityInput(u, newQtyText)
      if (p === null) {
        setError('Enter a valid quantity.')
        setNewQtyText(formatQuantityForInput(u, newQty))
        return
      }
      qty = p
    }
    const fp = fingerprintFromText(newText)
    const alreadyExists = items.some((i) => fingerprintFromText(i.text) === fp)
    if (alreadyExists) {
      setPendingDuplicateAdd({ text: newText, qty, unit: u })
      return
    }
    await insertItem(newText, qty, u)
    setNewText('')
    setNewQty(1)
    setNewQtyText('1')
    setNewUnit('each')
    setError(null)
  }

  async function deleteItem(id: string) {
    if (!listId) return
    const snap = items.find((i) => i.id === id)
    if (!snap) return
    const fp = fingerprintFromText(snap.text)
    setItems((prev) => prev.filter((i) => i.id !== id))
    try {
      await push({
        apply: async () => {
          const { error: err } = await supabase.from('list_items').delete().eq('id', id)
          if (err) throw err
          void logListItemEvent(supabase, {
            listId,
            itemId: id,
            eventType: 'item_deleted',
            fingerprint: fp,
            payload: { snapshot: snap },
          })
        },
        revert: async () => {
          const { error: err } = await supabase.from('list_items').insert({
            id: snap.id,
            list_id: snap.list_id,
            text: snap.text,
            quantity: snap.quantity,
            unit: snap.unit,
            checked: snap.checked,
            position: snap.position,
            category_key: snap.category_key,
            created_by: snap.created_by,
          })
          if (err) throw err
        },
      })
    } catch (e: unknown) {
      setItems((prev) => sortByPosition([...prev, snap]))
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  async function deleteCompletedItems() {
    if (!listId) return
    const snaps = completedSorted
    if (!snaps.length) return
    const ids = snaps.map((s) => s.id)
    const idSet = new Set(ids)
    setItems((prev) => prev.filter((i) => !idSet.has(i.id)))
    try {
      await push({
        apply: async () => {
          const { error: err } = await supabase.from('list_items').delete().in('id', ids)
          if (err) throw err
        },
        revert: async () => {
          const { error: err } = await supabase.from('list_items').insert(
            snaps.map((snap) => ({
              id: snap.id,
              list_id: snap.list_id,
              text: snap.text,
              quantity: snap.quantity,
              unit: snap.unit,
              checked: snap.checked,
              position: snap.position,
              category_key: snap.category_key,
              created_by: snap.created_by,
            })),
          )
          if (err) throw err
        },
      })
    } catch (e: unknown) {
      setItems((prev) => sortByPosition([...prev, ...snaps]))
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  async function toggleItem(id: string, checked: boolean) {
    if (!listId) return
    const current = items.find((i) => i.id === id)
    if (!current) return
    const fp = fingerprintFromText(current.text)
    const completedPositions = completedSorted.filter((i) => i.id !== id).map((i) => i.position)
    const activePositions = activeSorted.filter((i) => i.id !== id).map((i) => i.position)
    const position = checked ? keyAfterLast(completedPositions) : keyAfterLast(activePositions)
    const prev = { checked: current.checked, position: current.position }
    const nextRow: ListItemRow = { ...current, checked, position }
    setItems((p) => sortByPosition(p.map((i) => (i.id === id ? nextRow : i))))
    try {
      await push({
        apply: async () => {
          const { error: err } = await supabase
            .from('list_items')
            .update({ checked, position })
            .eq('id', id)
          if (err) throw err
          if (checked) {
            void logListItemEvent(supabase, {
              listId,
              itemId: id,
              eventType: 'item_checked',
              fingerprint: fp,
              payload: {
                text: current.text,
                quantity: current.quantity,
                unit: current.unit,
                checked: true,
              },
            })
          } else {
            void logListItemEvent(supabase, {
              listId,
              itemId: id,
              eventType: 'item_unchecked',
              fingerprint: fp,
              payload: { text: current.text },
            })
          }
        },
        revert: async () => {
          const { error: err } = await supabase
            .from('list_items')
            .update({ checked: prev.checked, position: prev.position })
            .eq('id', id)
          if (err) throw err
        },
      })
    } catch (e: unknown) {
      setItems((p) => sortByPosition(p.map((i) => (i.id === id ? current : i))))
      setError(e instanceof Error ? e.message : 'Update failed')
    }
  }

  async function changeQuantity(id: string, quantity: number) {
    if (!listId) return
    const current = items.find((i) => i.id === id)
    if (!current) return
    const fp = fingerprintFromText(current.text)
    const prevQty = current.quantity

    const u = normalizeUnit(current.unit)
    const q = clampQuantityForUnit(u, quantity)
    if (q === null) return
    setItems((p) => p.map((i) => (i.id === id ? { ...i, quantity: q } : i)))
    try {
      await push({
        apply: async () => {
          const { error: err } = await supabase.from('list_items').update({ quantity: q }).eq('id', id)
          if (err) throw err
          void logListItemEvent(supabase, {
            listId,
            itemId: id,
            eventType: 'quantity_changed',
            fingerprint: fp,
            payload: { from: prevQty, to: q, unit: current.unit, text: current.text },
          })
        },
        revert: async () => {
          const { error: err } = await supabase.from('list_items').update({ quantity: prevQty }).eq('id', id)
          if (err) throw err
        },
      })
    } catch (e: unknown) {
      setItems((p) => p.map((i) => (i.id === id ? { ...i, quantity: prevQty } : i)))
      setError(e instanceof Error ? e.message : 'Update failed')
    }
  }

  async function changeUnit(id: string, nextUnit: string) {
    const allowed = new Set(['each', 'L', 'kg'])
    const nu = normalizeUnit(nextUnit)
    if (!listId || !allowed.has(nu)) return
    const current = items.find((i) => i.id === id)
    if (!current) return
    if (current.unit === nu) return
    const fp = fingerprintFromText(current.text)
    const prevUnit = current.unit
    const nextQty = quantityWhenChangingUnit(prevUnit, nu, current.quantity)
    const prevQty = current.quantity
    setItems((p) => p.map((i) => (i.id === id ? { ...i, unit: nu, quantity: nextQty } : i)))
    try {
      await push({
        apply: async () => {
          const { error: err } = await supabase
            .from('list_items')
            .update({ unit: nu, quantity: nextQty })
            .eq('id', id)
          if (err) throw err
          void logListItemEvent(supabase, {
            listId,
            itemId: id,
            eventType: 'unit_changed',
            fingerprint: fp,
            payload: { from: prevUnit, to: nu, quantity: nextQty, prevQuantity: prevQty, text: current.text },
          })
        },
        revert: async () => {
          const { error: err } = await supabase
            .from('list_items')
            .update({ unit: prevUnit, quantity: prevQty })
            .eq('id', id)
          if (err) throw err
        },
      })
    } catch (e: unknown) {
      setItems((p) => p.map((i) => (i.id === id ? { ...i, unit: prevUnit, quantity: prevQty } : i)))
      setError(e instanceof Error ? e.message : 'Update failed')
    }
  }

  async function changeItemCategory(id: string, categoryKey: string) {
    if (!listId) return
    const current = items.find((i) => i.id === id)
    if (!current) return
    const prevKey = inferCategoryKey(current.text, current.category_key)
    if (prevKey === categoryKey) return
    const fp = fingerprintFromText(current.text)
    setItems((p) => p.map((i) => (i.id === id ? { ...i, category_key: categoryKey } : i)))
    try {
      await push({
        apply: async () => {
          const { error: err } = await supabase.from('list_items').update({ category_key: categoryKey }).eq('id', id)
          if (err) throw err
          void logListItemEvent(supabase, {
            listId,
            itemId: id,
            eventType: 'category_changed',
            fingerprint: fp,
            payload: { from: prevKey, to: categoryKey, text: current.text },
          })
        },
        revert: async () => {
          const { error: err } = await supabase.from('list_items').update({ category_key: prevKey }).eq('id', id)
          if (err) throw err
        },
      })
    } catch (e: unknown) {
      setItems((p) => p.map((i) => (i.id === id ? { ...i, category_key: current.category_key } : i)))
      setError(e instanceof Error ? e.message : 'Update failed')
    }
  }

  async function createInvite() {
    if (!listId) return
    setError(null)
    const { data, error: err } = await supabase.from('list_invites').insert({ list_id: listId }).select('token').single()
    if (err) {
      setError(err.message)
      return
    }
    const url = `${window.location.origin}/invite/${data.token}`
    setInviteUrl(url)
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      /* ignore */
    }
  }

  async function addSuggestion(s: (typeof suggestions)[number]) {
    const match = items.find((i) => !i.checked && fingerprintFromText(i.text) === s.fingerprint)
    if (match) {
      const nextQty = Math.round((match.quantity + s.suggestedQty) * 10) / 10
      await changeQuantity(match.id, nextQty)
      return
    }
    await insertItem(s.displayText, s.suggestedQty, s.unit)
  }

  const groupedBuckets = useMemo(() => {
    const buckets: Record<string, ListItemRow[]> = {}
    for (const k of categoryWalkOrder) buckets[k] = []
    const misc = 'miscellaneous'
    if (!buckets[misc]) buckets[misc] = []
    for (const item of activeSorted) {
      const k = inferCategoryKey(item.text, item.category_key)
      const target = buckets[k] ? k : misc
      buckets[target]!.push(item)
    }
    return { buckets }
  }, [activeSorted, categoryWalkOrder])

  const localPricing = useMemo(
    () => estimateListPricing(items, list?.store_preset_id ?? null, presets),
    [items, list?.store_preset_id, presets],
  )

  const pricingFetchKey = useMemo(
    () =>
      `${list?.store_preset_id ?? ''}:${presets.map((p) => `${p.id}:${p.slug}`).join(',')}:${items
        .map((i) => `${i.id}:${i.quantity}:${normalizeUnit(i.unit)}:${i.text}:${i.checked ? '1' : '0'}`)
        .join('|')}`,
    [items, list?.store_preset_id, presets],
  )

  const [mergedPricing, setMergedPricing] = useState<{ key: string; estimate: ListPriceEstimate } | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchMergedListPricing(items, list?.store_preset_id ?? null, presets).then((estimate) => {
      if (cancelled) return
      setMergedPricing({ key: pricingFetchKey, estimate })
    })
    return () => {
      cancelled = true
    }
  }, [pricingFetchKey, items, list?.store_preset_id, presets])

  const pricing = mergedPricing?.key === pricingFetchKey ? mergedPricing.estimate : localPricing

  const remainingEstimatedCost = useMemo(() => {
    let sum = 0
    for (const item of items) {
      if (item.checked) continue
      sum += pricing.items[item.id]?.estimatedCost ?? 0
    }
    return sum
  }, [items, pricing])

  const categoryPickerItem = useMemo(
    () => (categoryPickerItemId ? items.find((i) => i.id === categoryPickerItemId) ?? null : null),
    [categoryPickerItemId, items],
  )

  function openCategoryPicker(itemId: string) {
    const item = items.find((i) => i.id === itemId)
    if (!item) return
    setCategoryPickerItemId(itemId)
    setCategoryTargetKey(inferCategoryKey(item.text, item.category_key))
  }

  if (!listId) {
    return <p className="p-4 text-sm text-slate-600">Missing list id.</p>
  }

  return (
    <div className="mx-auto flex min-h-full max-w-lg flex-col scroll-pb-[calc(15rem+env(safe-area-inset-bottom,0px))] px-2 pb-[calc(15rem+env(safe-area-inset-bottom,0px))] pt-2 sm:px-3 sm:pb-[calc(15rem+env(safe-area-inset-bottom,0px))] sm:pt-3">
      <header className="mb-2 flex flex-col gap-1.5 sm:mb-3 sm:gap-2">
        <div className="flex min-h-8 items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Link
              to="/"
              className="grid h-8 min-h-8 w-8 min-w-8 shrink-0 place-items-center rounded-[6px] border border-slate-200 text-slate-700 dark:border-slate-600 dark:text-slate-200"
              aria-label="All lists"
              title="All lists"
            >
              <BackToListsIcon className="h-6 w-6 shrink-0" />
            </Link>
            <input
              className="min-w-0 flex-1 rounded-[6px] border border-transparent bg-transparent py-1 text-lg font-semibold leading-tight text-slate-900 outline-none focus:border-slate-300 focus:bg-white dark:text-slate-50 dark:focus:border-slate-600 dark:focus:bg-slate-900"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => void persistTitle(title)}
              placeholder="List name"
              aria-label="List name"
            />
          </div>
          <div ref={actionsMenuRef} className="relative flex shrink-0 items-center gap-1">
            <button
              type="button"
              disabled={!canUndo}
              onClick={() => void undo().then(() => refreshAll())}
              className="grid h-8 min-h-8 w-8 min-w-8 place-items-center rounded-[6px] border border-slate-200 text-slate-700 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200"
              aria-label="Undo"
              title="Undo"
            >
              <ToolbarIconUndo className="h-6 w-6 shrink-0" />
            </button>
            <button
              type="button"
              disabled={!canRedo}
              onClick={() => void redo().then(() => refreshAll())}
              className="grid h-8 min-h-8 w-8 min-w-8 place-items-center rounded-[6px] border border-slate-200 text-slate-700 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200"
              aria-label="Redo"
              title="Redo"
            >
              <ToolbarIconRedo className="h-6 w-6 shrink-0" />
            </button>
            <button
              type="button"
              className="grid h-8 min-h-8 w-8 min-w-8 place-items-center rounded-[6px] border border-slate-200 text-slate-700 dark:border-slate-600 dark:text-slate-200"
              onClick={() => setActionsOpen((v) => !v)}
              aria-label="More actions"
              title="More actions"
            >
              <ToolbarIconMore className="h-6 w-6 shrink-0" />
            </button>
            {actionsOpen ? (
              <div className="absolute right-0 top-9 z-20 w-56 rounded-[6px] border border-slate-200 bg-white p-2 text-xs shadow-md dark:border-slate-700 dark:bg-slate-900">
                <button
                  type="button"
                  className="mb-1 block min-h-8 w-full rounded-[6px] px-2 py-1 text-left hover:bg-slate-100 active:bg-slate-100 dark:hover:bg-slate-800 dark:active:bg-slate-800"
                  onClick={() => {
                    setActionsOpen(false)
                    setCatOpen(true)
                  }}
                >
                  Manage store aisle ordering
                </button>
                <button
                  type="button"
                  className="block min-h-8 w-full rounded-[6px] px-2 py-1 text-left hover:bg-slate-100 active:bg-slate-100 dark:hover:bg-slate-800 dark:active:bg-slate-800"
                  onClick={() => {
                    setActionsOpen(false)
                    void createInvite()
                  }}
                >
                  Invite collaborator
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-h-8 min-w-[11rem] max-w-full flex-1 sm:max-w-[13.5rem] sm:flex-initial">
            <label htmlFor="list-store-layout" className="sr-only">
              Store layout
            </label>
            <select
              id="list-store-layout"
              className="min-h-8 w-full appearance-none rounded-[6px] border border-slate-200 bg-white py-1.5 pl-3 pr-9 text-sm font-medium text-slate-900 outline-none focus:border-slate-400 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-slate-500"
              value={list?.store_preset_id ?? ''}
              onChange={(e) => void persistPreset(e.target.value || null)}
              aria-label="Store layout"
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <span
              className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400"
              aria-hidden
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path
                  fillRule="evenodd"
                  d="M5.23 7.21a.75.75 0 011.06.02L10 11.084l3.71-3.852a.75.75 0 111.08 1.04l-4.24 4.4a.75.75 0 01-1.08 0l-4.24-4.4a.75.75 0 01.02-1.06z"
                  clipRule="evenodd"
                />
              </svg>
            </span>
          </div>
          <div className="flex rounded-[6px] border border-slate-200 p-0.5 text-xs dark:border-slate-600">
            <button
              type="button"
              className={`flex min-h-8 items-center rounded-[6px] px-3 ${view === 'flat' ? 'bg-teal-700 text-white' : ''}`}
              onClick={() => setView('flat')}
            >
              Flat
            </button>
            <button
              type="button"
              className={`flex min-h-8 items-center rounded-[6px] px-3 ${view === 'grouped' ? 'bg-teal-700 text-white' : ''}`}
              onClick={() => setView('grouped')}
            >
              Grouped
            </button>
          </div>
          <button
            type="button"
            className="grid h-8 min-h-8 w-8 min-w-8 place-items-center rounded-[6px] border border-slate-200 text-slate-700 dark:border-slate-600 dark:text-slate-200"
            onClick={() => setRecOpen(true)}
            aria-label="Recommended"
            title="Recommended"
          >
            <ToolbarIconRecommended className="h-6 w-6 shrink-0" />
          </button>
        </div>
        {inviteUrl && (
          <p className="rounded-lg bg-teal-50 px-2 py-1 text-xs text-teal-900 dark:bg-teal-950 dark:text-teal-100">
            Invite link copied (if permitted): {inviteUrl}
          </p>
        )}
        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
            {error}
          </p>
        )}
      </header>

      {view === 'flat' ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void onDragEnd(e)}>
          <section>
            <SortableContext items={activeSorted.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <ul className="flex flex-col gap-1.5 sm:gap-2">
                {activeSorted.map((item) => (
                  <SortableItem
                    key={item.id}
                    item={item}
                    isOnSpecial={pricing.items[item.id]?.onSpecial ?? false}
                    onToggle={(id, c) => void toggleItem(id, c)}
                    onDelete={(id) => void deleteItem(id)}
                    onQuantityChange={(id, q) => void changeQuantity(id, q)}
                    onUnitChange={(id, u) => void changeUnit(id, u)}
                  />
                ))}
              </ul>
            </SortableContext>
          </section>
          <section className="mt-6">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-500">Completed</h2>
              <button
                type="button"
                className="min-h-8 rounded-[6px] border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 active:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:active:bg-slate-800 disabled:opacity-40"
                onClick={() => void deleteCompletedItems()}
                disabled={!completedSorted.length}
              >
                Delete completed items
              </button>
            </div>
            <SortableContext items={completedSorted.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <ul className="flex flex-col gap-1.5 sm:gap-2">
                {completedSorted.map((item) => (
                  <SortableItem
                    key={item.id}
                    item={item}
                    isOnSpecial={pricing.items[item.id]?.onSpecial ?? false}
                    onToggle={(id, c) => void toggleItem(id, c)}
                    onDelete={(id) => void deleteItem(id)}
                    onQuantityChange={(id, q) => void changeQuantity(id, q)}
                    onUnitChange={(id, u) => void changeUnit(id, u)}
                  />
                ))}
              </ul>
            </SortableContext>
          </section>
        </DndContext>
      ) : (
        <div className="flex flex-col gap-3 sm:gap-4">
          {categoryWalkOrder.map((key) => {
            const rows = groupedBuckets.buckets[key] ?? []
            if (!rows.length) return null
            const collapsed = !!collapsedCategoryKeys[key]
            return (
              <section key={key} className="space-y-1">
                <div className="flex items-center justify-between gap-2 py-0.5">
                  <button
                    type="button"
                    className={`flex min-h-8 items-center gap-1 rounded-[6px] pl-2 pr-2 text-slate-600 dark:text-slate-400 ${
                      collapsed
                        ? 'bg-slate-100 hover:bg-slate-200 active:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 dark:active:bg-slate-700'
                        : 'hover:bg-slate-100 active:bg-slate-100 dark:hover:bg-slate-800 dark:active:bg-slate-800'
                    }`}
                    aria-expanded={!collapsed}
                    aria-label={
                      collapsed ? `Expand ${headingForCategoryKey(key)}` : `Collapse ${headingForCategoryKey(key)}`
                    }
                    onClick={() =>
                      setCollapsedCategoryKeys((prev) => ({
                        ...prev,
                        [key]: !prev[key],
                      }))
                    }
                  >
                    {collapsed ? (
                      <GroupCollapseChevronIcon className="h-6 w-6 shrink-0" />
                    ) : (
                      <GroupExpandChevronIcon className="h-6 w-6 shrink-0" />
                    )}
                    <span className="text-xs font-semibold">{headingForCategoryKey(key)}</span>
                  </button>
                  <span className="min-w-8" aria-hidden />
                </div>
                <div
                  className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-200 ease-out ${
                    collapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'
                  }`}
                >
                  <ul className="min-h-0 flex flex-col gap-0 divide-y divide-slate-100 overflow-hidden rounded-[6px] bg-white dark:divide-slate-800 dark:bg-slate-900">
                    {rows.map((item) => (
                      <SortableItem
                        key={item.id}
                        item={item}
                        isOnSpecial={pricing.items[item.id]?.onSpecial ?? false}
                        disabled
                        inGroupedBlock
                        enableLongPressCategoryChange
                        showDragHandle={false}
                        onToggle={(id, c) => void toggleItem(id, c)}
                        onDelete={(id) => void deleteItem(id)}
                        onQuantityChange={(id, q) => void changeQuantity(id, q)}
                        onUnitChange={(id, u) => void changeUnit(id, u)}
                        onLongPressCategoryChange={openCategoryPicker}
                      />
                    ))}
                  </ul>
                </div>
              </section>
            )
          })}
          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-500">Completed</h2>
              <button
                type="button"
                className="min-h-8 rounded-[6px] border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 active:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:active:bg-slate-800 disabled:opacity-40"
                onClick={() => void deleteCompletedItems()}
                disabled={!completedSorted.length}
              >
                Delete completed items
              </button>
            </div>
            {completedSorted.length ? (
              <ul className="flex flex-col gap-0 divide-y divide-slate-100 overflow-hidden rounded-[6px] bg-white dark:divide-slate-800 dark:bg-slate-900">
                {completedSorted.map((item) => (
                  <SortableItem
                    key={item.id}
                    item={item}
                    isOnSpecial={pricing.items[item.id]?.onSpecial ?? false}
                    disabled
                    inGroupedBlock
                    enableLongPressCategoryChange
                    showDragHandle={false}
                    onToggle={(id, c) => void toggleItem(id, c)}
                    onDelete={(id) => void deleteItem(id)}
                    onQuantityChange={(id, q) => void changeQuantity(id, q)}
                    onUnitChange={(id, u) => void changeUnit(id, u)}
                    onLongPressCategoryChange={openCategoryPicker}
                  />
                ))}
              </ul>
            ) : null}
          </section>
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-slate-200 bg-white/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] pt-2 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 sm:px-3 sm:pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] sm:pt-3">
        <div className="mx-auto flex max-w-lg flex-col gap-1.5 sm:gap-2">
          <div className="flex gap-1.5 sm:gap-2">
            <input
              className="min-h-8 flex-1 rounded-[6px] border border-slate-200 bg-white px-3 py-2 text-base dark:border-slate-600 dark:bg-slate-950"
              placeholder="Add item"
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
            />
            {newUnit === 'each' ? (
              <select
                className="min-h-8 w-20 appearance-none rounded-[6px] border border-slate-200 bg-white bg-[length:0] px-2 text-right text-sm [background-image:none] dark:border-slate-600 dark:bg-slate-950 [&::-webkit-appearance]:none"
                value={Math.min(20, Math.max(1, Math.round(Number(newQty)) || 1))}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setNewQty(v)
                  setNewQtyText(String(v))
                }}
                aria-label="Quantity"
              >
                {ADD_EACH_QTY_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                inputMode="decimal"
                className="min-h-8 w-20 rounded-[6px] border border-slate-200 bg-white px-2 py-2 text-right text-sm dark:border-slate-600 dark:bg-slate-950"
                value={newQtyText}
                onChange={(e) => setNewQtyText(e.target.value)}
                onBlur={() => {
                  const p = parseQuantityInput(newUnit, newQtyText)
                  if (p !== null) {
                    setNewQty(p)
                    setNewQtyText(formatQuantityForInput(newUnit, p))
                  } else {
                    setNewQtyText(formatQuantityForInput(newUnit, newQty))
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                }}
                aria-label="Quantity"
              />
            )}
            <select
              className="min-h-8 w-28 appearance-none rounded-[6px] border border-slate-200 bg-white bg-[length:0] px-1 text-sm [background-image:none] dark:border-slate-600 dark:bg-slate-950 [&::-webkit-appearance]:none"
              value={normalizeUnit(newUnit)}
              onChange={(e) => {
                const u = normalizeUnit(e.target.value)
                const bridged = quantityWhenChangingUnit(newUnit, u, newQty)
                setNewUnit(u)
                setNewQty(bridged)
                setNewQtyText(formatQuantityForInput(u, bridged))
              }}
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
            className="min-h-8 w-full rounded-[6px] bg-teal-700 py-3 text-sm font-semibold text-white"
            onClick={() => void addItem()}
          >
            Add to list
          </button>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Total estimated cost: ${pricing.totalEstimatedCost.toFixed(2)}
            <span aria-hidden="true"> | </span>
            Remaining cost: ${remainingEstimatedCost.toFixed(2)}
          </p>
        </div>
      </div>

      <RecommendationsDrawer
        open={recOpen}
        onClose={() => setRecOpen(false)}
        suggestions={suggestions}
        onAdd={(s) => void addSuggestion(s)}
      />

      {pendingDuplicateAdd ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
          <div className="w-full max-w-sm rounded-t-3xl bg-white p-4 shadow-xl dark:bg-slate-900 sm:rounded-2xl">
            <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-50">Duplicate item</h3>
            <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
              item already exists, do you wish to continue adding it.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-[6px] border border-slate-200 py-2 text-sm font-medium dark:border-slate-600"
                onClick={() => setPendingDuplicateAdd(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="flex-1 rounded-[6px] bg-teal-700 py-2 text-sm font-semibold text-white"
                onClick={() => {
                  const payload = pendingDuplicateAdd
                  setPendingDuplicateAdd(null)
                  if (!payload) return
                  void insertItem(payload.text, payload.qty, payload.unit)
                  setNewText('')
                  setNewQty(1)
                  setNewQtyText('1')
                  setNewUnit('each')
                  setError(null)
                }}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {categoryPickerItem ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
          <div className="w-full max-w-sm rounded-t-3xl bg-white p-4 shadow-xl dark:bg-slate-900 sm:rounded-2xl">
            <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-50">Move item to category</h3>
            <p className="mb-3 text-xs text-slate-500">{categoryPickerItem.text}</p>
            <select
              className="mb-3 min-h-8 w-full rounded-[6px] border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950"
              value={categoryTargetKey}
              onChange={(e) => setCategoryTargetKey(e.target.value)}
              aria-label="Select category"
            >
              {categoryWalkOrder.map((key) => (
                <option key={key} value={key}>
                  {headingForCategoryKey(key)}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-[6px] border border-slate-200 py-2 text-sm font-medium dark:border-slate-600"
                onClick={() => setCategoryPickerItemId(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="flex-1 rounded-[6px] bg-teal-700 py-2 text-sm font-semibold text-white"
                onClick={() => {
                  void changeItemCategory(categoryPickerItem.id, categoryTargetKey)
                  setCategoryPickerItemId(null)
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {catOpen && (
        <CategoryOrderModal
          presets={presets}
          presetCats={presetCats}
          defaultEditingPresetId={list?.store_preset_id ?? null}
          onClose={() => setCatOpen(false)}
          onSave={async (payload) => {
            setError(null)
            const { error: err } = await supabase.rpc('save_store_preset_order', {
              target_preset_id: payload.targetPresetId,
              ordered_categories: payload.order,
            })
            if (err) {
              setError(err.message)
              return
            }
            const labelRows = payload.order.map((key, idx) => {
              const raw = payload.labels[key] ?? ''
              const t = raw.trim()
              const def = categoryLabel(key)
              const labelOverride = !t || t === def ? null : t
              return {
                preset_id: payload.targetPresetId,
                category_key: key,
                sort_index: idx,
                label_override: labelOverride,
              }
            })
            if (labelRows.length) {
              const { error: uerr } = await supabase
                .from('store_preset_categories')
                .upsert(labelRows, { onConflict: 'preset_id,category_key' })
              if (uerr) {
                setError(uerr.message)
                return
              }
            }
            const { data: pcRows, error: fetchErr } = await supabase
              .from('store_preset_categories')
              .select('*')
              .order('sort_index')
            if (fetchErr) {
              setError(fetchErr.message)
              return
            }
            setPresetCats((pcRows ?? []) as StorePresetCategoryRow[])
          }}
        />
      )}
    </div>
  )
}
