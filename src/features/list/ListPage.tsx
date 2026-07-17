import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
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
import { categoryForNewItem } from '../../lib/categoryLearning'
import { logListItemEvent } from '../../lib/events'
import { fingerprintFromText } from '../../lib/normalize'
import {
  mergeCalibrationIntoMap,
  parsePriceCalibration,
  parsePriceCalibrationForScope,
  removeCalibrationFromMap,
} from '../../lib/priceCalibration'
import { upsertPriceLearningFromCalibration } from '../../lib/priceLearningDb'
import { estimateListPricing, fetchMergedListPricing, type ListPriceEstimate } from '../../lib/pricing'
import { keyAfterLast, keyAfterReorder, sortByPosition } from '../../lib/positions'
import { buildSuggestions } from '../../lib/recommendations'
import {
  filterStoreLayouts,
  pickDefaultStoreLayoutId,
  rememberLastStoreLayoutId,
} from '../../lib/storeLayouts'
import { priceLearningScopeFromPresetId } from '../../lib/storeChain'
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
import { readShowPricesPreference, writeShowPricesPreference } from '../../lib/showPricesPreference'
import { errorMessageFromUnknown, isMissingPriceCalibrationByScopeColumn } from '../../lib/supabaseErrorMessage'
import { applyThemePreference, readThemePreference, saveThemePreference, type ThemePreference } from '../../lib/theme'
import type {
  ListCategoryLearningRow,
  ListItemEventRow,
  ListItemRow,
  ListRow,
  ListPriceLearningRow,
  PriceCalibrationV1,
  StorePresetCategoryRow,
  StorePresetRow,
} from '../../types'
import { CategoryOrderModal } from './CategoryOrderModal'
import { PriceCalibrationModal } from './PriceCalibrationModal'
import { RecipeUrlImportDrawer, type RecipeUrlImportBatchRow } from './RecipeUrlImportDrawer'
import { RecommendationsDrawer, type RecommendationBatchRow } from './RecommendationsDrawer'
import { SortableItem } from './SortableItem'
import { StoresManageModal } from './StoresManageModal'
import { BackToListsIcon } from './listIcons'
import {
  ToolbarIconMore,
  ToolbarIconPlan,
  ToolbarIconRedo,
  ToolbarIconShop,
  ToolbarIconUndo,
  ToolbarIconViewFlat,
  ToolbarIconViewGrouped,
} from './toolbarIcons'

function clonePriceCalibrationByScope(m: ListItemRow['price_calibration_by_scope']): Record<string, unknown> {
  if (m && typeof m === 'object' && !Array.isArray(m)) {
    return JSON.parse(JSON.stringify(m)) as Record<string, unknown>
  }
  return {}
}

const ADD_EACH_QTY_OPTIONS = Array.from({ length: 20 }, (_, i) => i + 1)
type PendingAdd = { text: string; qty: number; unit: string }
type HeaderMode = 'plan' | 'shop'
type ListView = 'flat' | 'grouped'
const MODE_DEFAULT_VIEW: Record<HeaderMode, ListView> = { plan: 'flat', shop: 'grouped' }

const HEADER_MODE_KEY = 'list-header-mode-v1'
const HEADER_VIEW_KEY = 'list-header-view-v1'

export function ListPage() {
  const { listId } = useParams()
  const supabase = getSupabase()
  const { push, undo, redo, canUndo, canRedo } = useUndoRedo()

  const [list, setList] = useState<ListRow | null>(null)
  const [items, setItems] = useState<ListItemRow[]>([])
  const itemsRef = useRef(items)
  const [presets, setPresets] = useState<StorePresetRow[]>([])
  const [presetCats, setPresetCats] = useState<StorePresetCategoryRow[]>([])
  /** fingerprint → category_key for this list (from DB + local updates) */
  const [categoryLearnings, setCategoryLearnings] = useState<Record<string, string>>({})
  const [priceLearnings, setPriceLearnings] = useState<ListPriceLearningRow[]>([])
  const [events, setEvents] = useState<ListItemEventRow[]>([])
  const [title, setTitle] = useState('')
  const [newText, setNewText] = useState('')
  const [newQty, setNewQty] = useState(1)
  /** Text field for L / g quantity in add bar (validates on blur / add) */
  const [newQtyText, setNewQtyText] = useState('1')
  const [newUnit, setNewUnit] = useState('each')
  const [footerExpanded, setFooterExpanded] = useState(false)
  const [footerClosing, setFooterClosing] = useState(false)
  const [qtyTouched, setQtyTouched] = useState(false)
  const [unitTouched, setUnitTouched] = useState(false)
  const [mode, setMode] = useState<HeaderMode>(() => {
    if (typeof window === 'undefined') return 'plan'
    return window.localStorage.getItem(HEADER_MODE_KEY) === 'shop' ? 'shop' : 'plan'
  })
  const [view, setView] = useState<ListView>(() => {
    if (typeof window === 'undefined') return MODE_DEFAULT_VIEW.plan
    const raw = window.localStorage.getItem(HEADER_VIEW_KEY)
    if (raw === 'flat' || raw === 'grouped') return raw
    const savedMode = window.localStorage.getItem(HEADER_MODE_KEY) === 'shop' ? 'shop' : 'plan'
    return MODE_DEFAULT_VIEW[savedMode]
  })
  const [recOpen, setRecOpen] = useState(false)
  const [recipeUrlOpen, setRecipeUrlOpen] = useState(false)
  /** Remount recipe URL drawer so internal state resets each time it opens */
  const [recipeUrlImportKey, setRecipeUrlImportKey] = useState(0)
  const [catOpen, setCatOpen] = useState(false)
  const [storesOpen, setStoresOpen] = useState(false)
  const [headerAction, setHeaderAction] = useState('')
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => readThemePreference())
  const [error, setError] = useState<string | null>(null)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [pendingDuplicateAdd, setPendingDuplicateAdd] = useState<PendingAdd | null>(null)
  const [categoryPickerItemId, setCategoryPickerItemId] = useState<string | null>(null)
  const [categoryTargetKey, setCategoryTargetKey] = useState<string>('miscellaneous')
  /** When true, category group body is hidden */
  const [collapsedCategoryKeys, setCollapsedCategoryKeys] = useState<Record<string, boolean>>({})
  /** Item id when "your price" sheet is open */
  const [priceCalItemId, setPriceCalItemId] = useState<string | null>(null)
  /** Off by default; remembered in localStorage */
  const [showPrices] = useState(() => readShowPricesPreference())
  const [headerElevated, setHeaderElevated] = useState(false)
  const [shopSelectorVisible, setShopSelectorVisible] = useState(true)
  const [footerKeyboardInset, setFooterKeyboardInset] = useState(0)
  const addItemInputRef = useRef<HTMLInputElement>(null)
  const themeSelectRef = useRef<HTMLSelectElement>(null)
  const footerSwipeStartYRef = useRef<number | null>(null)
  const footerSwipePointerIdRef = useRef<number | null>(null)
  const footerCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastScrollYRef = useRef(0)

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 10 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const refreshAll = useCallback(async () => {
    if (!listId) return
    const [
      { data: l, error: e1 },
      { data: its, error: e2 },
      { data: evs, error: e3 },
      { data: learnRows, error: e4 },
      { data: priceRows, error: e5 },
    ] = await Promise.all([
      supabase.from('lists').select('*').eq('id', listId).maybeSingle(),
      supabase.from('list_items').select('*').eq('list_id', listId),
      supabase.from('list_item_events').select('*').eq('list_id', listId).order('created_at', { ascending: false }).limit(800),
      supabase.from('list_category_learnings').select('fingerprint, category_key').eq('list_id', listId),
      supabase.from('list_price_learnings').select('*').eq('list_id', listId),
    ])
    if (e1) throw e1
    if (e2) throw e2
    if (e3) throw e3
    if (e4) {
      console.warn('list_category_learnings unavailable (run migrations if missing):', e4.message)
    }
    if (e5) {
      console.warn('list_price_learnings unavailable (run migrations if missing):', e5.message)
    }
    setList(l as ListRow)
    setTitle((l as ListRow | null)?.title ?? '')
    setItems(sortByPosition((its ?? []) as ListItemRow[]))
    const evRows = (evs ?? []) as ListItemEventRow[]
    setEvents(evRows)
    const nextLearn: Record<string, string> = {}
    if (!e4) {
      for (const row of (learnRows ?? []) as Pick<ListCategoryLearningRow, 'fingerprint' | 'category_key'>[]) {
        nextLearn[row.fingerprint] = row.category_key
      }
    }
    setCategoryLearnings(nextLearn)
    setPriceLearnings(e5 ? [] : ((priceRows ?? []) as ListPriceLearningRow[]))
  }, [listId, supabase])

  const refreshEvents = useCallback(async () => {
    if (!listId) return
    const { data: evs, error: err } = await supabase
      .from('list_item_events')
      .select('*')
      .eq('list_id', listId)
      .order('created_at', { ascending: false })
      .limit(800)
    if (err) {
      setError(err.message)
      return
    }
    setEvents((evs ?? []) as ListItemEventRow[])
  }, [listId, supabase])

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  useEffect(() => {
    writeShowPricesPreference(showPrices)
  }, [showPrices])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(HEADER_MODE_KEY, mode)
  }, [mode])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(HEADER_VIEW_KEY, view)
  }, [view])

  useEffect(() => {
    setFooterExpanded(false)
    setFooterClosing(false)
    setQtyTouched(false)
    setUnitTouched(false)
  }, [mode])

  useEffect(() => {
    return () => {
      if (footerCloseTimerRef.current) clearTimeout(footerCloseTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const vv = window.visualViewport
    if (!vv) {
      setFooterKeyboardInset(0)
      return
    }
    let rafId: number | null = null
    const updateInset = () => {
      if (rafId != null) window.cancelAnimationFrame(rafId)
      rafId = window.requestAnimationFrame(() => {
        rafId = null
        if (!footerExpanded) {
          setFooterKeyboardInset(0)
          return
        }
        const viewportBottom = vv.height + vv.offsetTop
        const overlap = Math.max(0, window.innerHeight - viewportBottom)
        setFooterKeyboardInset(Math.round(overlap))
      })
    }
    updateInset()
    vv.addEventListener('resize', updateInset)
    vv.addEventListener('scroll', updateInset)
    window.addEventListener('orientationchange', updateInset)
    return () => {
      if (rafId != null) window.cancelAnimationFrame(rafId)
      vv.removeEventListener('resize', updateInset)
      vv.removeEventListener('scroll', updateInset)
      window.removeEventListener('orientationchange', updateInset)
      setFooterKeyboardInset(0)
    }
  }, [footerExpanded])

  useEffect(() => {
    function onScroll() {
      const y = window.scrollY
      setHeaderElevated(y > 4)
      if (y <= 2) {
        setShopSelectorVisible(true)
      } else if (y > lastScrollYRef.current + 1) {
        // Scrolling down content upward: hide selector.
        setShopSelectorVisible(false)
      } else if (y < lastScrollYRef.current - 1) {
        // Scrolling back toward top: show selector.
        setShopSelectorVisible(true)
      }
      lastScrollYRef.current = y
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const refreshStoreCatalog = useCallback(async () => {
    const [{ data: presetRows, error: e1 }, { data: pcRows, error: e2 }] = await Promise.all([
      supabase.from('store_presets').select('*').order('name'),
      supabase.from('store_preset_categories').select('*').order('sort_index'),
    ])
    if (e1) throw e1
    if (e2) throw e2
    setPresets(filterStoreLayouts((presetRows ?? []) as StorePresetRow[]))
    setPresetCats((pcRows ?? []) as StorePresetCategoryRow[])
  }, [supabase])

  useEffect(() => {
    if (!listId) return
    let cancelled = false
    ;(async () => {
      try {
        await refreshStoreCatalog()
        if (cancelled) return
        await refreshAll()
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [listId, refreshAll, refreshStoreCatalog, supabase])

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
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'list_price_learnings', filter: `list_id=eq.${listId}` },
        () => {
          void supabase
            .from('list_price_learnings')
            .select('*')
            .eq('list_id', listId)
            .then(({ data, error }) => {
              if (!error && data) setPriceLearnings(data as ListPriceLearningRow[])
            })
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

  /** Scope key for line-level "your price" calibrations (matches list_price_learnings.store_scope). */
  const priceCalibrationScopeKey = useMemo(
    () => priceLearningScopeFromPresetId(presets, list?.store_preset_id ?? null) ?? '_',
    [presets, list?.store_preset_id],
  )

  const suggestions = useMemo(
    () => buildSuggestions(events, items),
    [events, items],
  )
  const smartGuessByFingerprint = useMemo(() => {
    const map = new Map<string, { qty: number; unit: string }>()
    for (const s of suggestions) {
      map.set(s.fingerprint, { qty: s.suggestedQty, unit: normalizeUnit(s.unit) })
    }
    for (const e of events) {
      if (e.event_type !== 'item_checked' || !e.fingerprint) continue
      const p = (e.payload ?? {}) as Record<string, unknown>
      const q = Number(p.quantity)
      const u = normalizeUnit(String(p.unit ?? 'each'))
      if (Number.isFinite(q) && q > 0 && !map.has(e.fingerprint)) {
        map.set(e.fingerprint, { qty: q, unit: u })
      }
    }
    return map
  }, [events, suggestions])

  function inferUnitFromText(text: string): string {
    const t = text.toLowerCase()
    if (/\b(ml|millilit|milk|juice|oil|broth|stock|vinegar|soy|water)\b/.test(t)) return 'ml'
    if (/\b(l|litre|liter|soda|soft drink)\b/.test(t)) return 'L'
    if (/\b(kg|kilogram)\b/.test(t)) return 'kg'
    if (/\b(g|gram|flour|sugar|rice|pasta|salt|pepper|mince|beef|chicken)\b/.test(t)) return 'g'
    if (/\b(tsp|teaspoon)\b/.test(t)) return 'tsp'
    if (/\b(tbsp|tablespoon)\b/.test(t)) return 'tbs'
    return 'each'
  }

  useEffect(() => {
    const text = newText.trim()
    if (!text) {
      if (!qtyTouched) {
        setNewQty(1)
        setNewQtyText('1')
      }
      if (!unitTouched) setNewUnit('each')
      return
    }
    const fp = fingerprintFromText(text)
    const guess = smartGuessByFingerprint.get(fp)
    const guessedUnit = normalizeUnit(guess?.unit ?? inferUnitFromText(text))
    const guessedQty = clampQuantityForUnit(guessedUnit, guess?.qty ?? 1)
    if (guessedQty == null) return
    if (!unitTouched) setNewUnit(guessedUnit)
    if (!qtyTouched) {
      setNewQty(guessedQty)
      setNewQtyText(formatQuantityForInput(guessedUnit, guessedQty))
    }
  }, [newText, qtyTouched, unitTouched, smartGuessByFingerprint])

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

  function toggleMode() {
    setMode((prev) => {
      const next = prev === 'plan' ? 'shop' : 'plan'
      setView(MODE_DEFAULT_VIEW[next])
      return next
    })
  }

  function toggleView() {
    setView(view === 'flat' ? 'grouped' : 'flat')
  }

  function handleHeaderActionChange(value: string) {
    if (!value) return
    if (value === 'aisles') setCatOpen(true)
    if (value === 'stores') setStoresOpen(true)
    if (value === 'invite') void createInvite()
    if (value === 'theme') {
      requestAnimationFrame(() => {
        const el = themeSelectRef.current
        if (!el) return
        if (typeof el.showPicker === 'function') el.showPicker()
        else {
          el.focus()
          el.click()
        }
      })
      return
    }
    setHeaderAction('')
  }

  function selectTheme(nextTheme: ThemePreference) {
    setThemePreference(nextTheme)
    saveThemePreference(nextTheme)
    applyThemePreference(nextTheme)
    setHeaderAction('')
  }

  async function insertItem(text: string, qty: number, unit: string) {
    if (!listId) return
    const trimmed = text.trim()
    if (!trimmed) return
    const u = normalizeUnit(unit)
    const q = clampQuantityForUnit(u, qty)
    if (q === null) return
    const fp = fingerprintFromText(trimmed)
    const cat = categoryForNewItem(trimmed, fp, categoryLearnings, presetKeysOrdered)
    const activePositions = sortByPosition(itemsRef.current.filter((i) => !i.checked)).map((i) => i.position)
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
            const merged = sortByPosition([...prev, data as ListItemRow])
            itemsRef.current = merged
            return merged
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
      throw e
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
    const alreadyExists = items.some((i) => !i.checked && fingerprintFromText(i.text) === fp)
    if (alreadyExists) {
      setPendingDuplicateAdd({ text: newText, qty, unit: u })
      return
    }
    try {
      await insertItem(newText, qty, u)
    } catch {
      return
    }
    setNewText('')
    setNewQty(1)
    setNewQtyText('1')
    setNewUnit('each')
    setQtyTouched(false)
    setUnitTouched(false)
    setError(null)
    requestAnimationFrame(() => {
      const isFinePointer =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(hover: hover) and (pointer: fine)').matches
      if (isFinePointer) {
        addItemInputRef.current?.focus()
      } else {
        addItemInputRef.current?.blur()
      }
    })
  }

  async function deleteItem(id: string) {
    if (!listId) return
    const snap = items.find((i) => i.id === id)
    if (!snap) return
    triggerDeleteHaptic()
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
            price_calibration_by_scope: snap.price_calibration_by_scope ?? {},
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
              price_calibration_by_scope: snap.price_calibration_by_scope ?? {},
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
    setItems((p) => {
      const next = p.map((i) => (i.id === id ? { ...i, quantity: q } : i))
      itemsRef.current = next
      return next
    })
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

  async function changeItemText(id: string, newText: string) {
    if (!listId) return
    const trimmed = newText.trim()
    if (!trimmed) return
    const current = items.find((i) => i.id === id)
    if (!current) return
    if (trimmed === current.text) return
    const prevText = current.text
    const prevCat = current.category_key
    const fp = fingerprintFromText(trimmed)
    const cat = categoryForNewItem(trimmed, fp, categoryLearnings, presetKeysOrdered)
    setItems((p) => {
      const next = p.map((i) => (i.id === id ? { ...i, text: trimmed, category_key: cat } : i))
      itemsRef.current = next
      return next
    })
    try {
      await push({
        apply: async () => {
          const { error: err } = await supabase
            .from('list_items')
            .update({ text: trimmed, category_key: cat })
            .eq('id', id)
          if (err) throw err
          void logListItemEvent(supabase, {
            listId,
            itemId: id,
            eventType: 'text_changed',
            fingerprint: fp,
            payload: { from: prevText, to: trimmed },
          })
        },
        revert: async () => {
          const { error: err } = await supabase
            .from('list_items')
            .update({ text: prevText, category_key: prevCat })
            .eq('id', id)
          if (err) throw err
        },
      })
    } catch (e: unknown) {
      setItems((p) => {
        const next = p.map((i) => (i.id === id ? { ...i, text: prevText, category_key: prevCat } : i))
        itemsRef.current = next
        return next
      })
      setError(e instanceof Error ? e.message : 'Update failed')
    }
  }

  async function savePriceCalibration(id: string, cal: PriceCalibrationV1) {
    if (!listId) return
    const current = items.find((i) => i.id === id)
    if (!current) return
    const prevMap = clonePriceCalibrationByScope(current.price_calibration_by_scope)
    const prevLegacy = parsePriceCalibration(current.price_calibration)
    const nextMap = mergeCalibrationIntoMap(current.price_calibration_by_scope, priceCalibrationScopeKey, cal)
    const fp = fingerprintFromText(current.text)
    setItems((p) => {
      const next = p.map((i) => (i.id === id ? { ...i, price_calibration_by_scope: nextMap } : i))
      itemsRef.current = next
      return next
    })
    let calibrationWriteMode: 'scoped' | 'legacy' = 'scoped'
    try {
      await push({
        apply: async () => {
          const modern = await supabase
            .from('list_items')
            .update({ price_calibration_by_scope: nextMap })
            .eq('id', id)
          if (!modern.error) {
            calibrationWriteMode = 'scoped'
            void logListItemEvent(supabase, {
              listId,
              itemId: id,
              eventType: 'price_calibration_set',
              fingerprint: fp,
              payload: { text: current.text, cal, store_scope: priceCalibrationScopeKey },
            })
          } else if (isMissingPriceCalibrationByScopeColumn(modern.error)) {
            const leg = await supabase.from('list_items').update({ price_calibration: cal }).eq('id', id)
            if (leg.error) throw modern.error
            calibrationWriteMode = 'legacy'
            setItems((p) => {
              const next = p.map((i) =>
                i.id === id ? { ...i, price_calibration_by_scope: {}, price_calibration: cal } : i,
              )
              itemsRef.current = next
              return next
            })
            void logListItemEvent(supabase, {
              listId,
              itemId: id,
              eventType: 'price_calibration_set',
              fingerprint: fp,
              payload: { text: current.text, cal, store_scope: priceCalibrationScopeKey, legacy_column: true },
            })
            console.warn(
              '[list_items] price_calibration_by_scope missing — run Supabase migration 20260516100000_list_items_price_calibration_by_scope.sql (e.g. supabase db push) for per-store prices.',
            )
          } else {
            throw modern.error
          }
          const sid = list?.store_preset_id
          if (sid && listId) {
            try {
              await upsertPriceLearningFromCalibration(supabase, {
                listId,
                storePresetId: sid,
                presets,
                fingerprint: fp,
                cal,
              })
            } catch (learnErr) {
              console.warn('list_price_learnings upsert', learnErr)
            }
          }
        },
        revert: async () => {
          if (calibrationWriteMode === 'scoped') {
            const { error: err } = await supabase
              .from('list_items')
              .update({ price_calibration_by_scope: prevMap })
              .eq('id', id)
            if (err) throw err
          } else {
            const { error: err } = await supabase
              .from('list_items')
              .update({ price_calibration: prevLegacy })
              .eq('id', id)
            if (err) throw err
          }
        },
      })
      const { data: plRows } = await supabase.from('list_price_learnings').select('*').eq('list_id', listId)
      if (plRows) setPriceLearnings(plRows as ListPriceLearningRow[])
    } catch (e: unknown) {
      setItems((p) => {
        const next = p.map((i) =>
          i.id === id
            ? { ...i, price_calibration_by_scope: prevMap, price_calibration: prevLegacy }
            : i,
        )
        itemsRef.current = next
        return next
      })
      setError(errorMessageFromUnknown(e))
    }
  }

  async function clearPriceCalibration(id: string) {
    if (!listId) return
    const current = items.find((i) => i.id === id)
    if (!current) return
    if (parsePriceCalibrationForScope(current, priceCalibrationScopeKey) === null) return
    const prevMap = clonePriceCalibrationByScope(current.price_calibration_by_scope)
    const prevLegacy = parsePriceCalibration(current.price_calibration)
    const nextMap = removeCalibrationFromMap(current.price_calibration_by_scope, priceCalibrationScopeKey)
    const fp = fingerprintFromText(current.text)
    setItems((p) => {
      const next = p.map((i) => (i.id === id ? { ...i, price_calibration_by_scope: nextMap } : i))
      itemsRef.current = next
      return next
    })
    let calibrationWriteMode: 'scoped' | 'legacy' = 'scoped'
    try {
      await push({
        apply: async () => {
          const modern = await supabase
            .from('list_items')
            .update({ price_calibration_by_scope: nextMap })
            .eq('id', id)
          if (!modern.error) {
            calibrationWriteMode = 'scoped'
          } else if (isMissingPriceCalibrationByScopeColumn(modern.error)) {
            const leg = await supabase.from('list_items').update({ price_calibration: null }).eq('id', id)
            if (leg.error) throw modern.error
            calibrationWriteMode = 'legacy'
            setItems((p) => {
              const next = p.map((i) =>
                i.id === id ? { ...i, price_calibration_by_scope: nextMap, price_calibration: null } : i,
              )
              itemsRef.current = next
              return next
            })
          } else {
            throw modern.error
          }
          void logListItemEvent(supabase, {
            listId,
            itemId: id,
            eventType: 'price_calibration_cleared',
            fingerprint: fp,
            payload: { text: current.text, store_scope: priceCalibrationScopeKey },
          })
        },
        revert: async () => {
          if (calibrationWriteMode === 'scoped') {
            const { error: err } = await supabase
              .from('list_items')
              .update({ price_calibration_by_scope: prevMap })
              .eq('id', id)
            if (err) throw err
          } else {
            const { error: err } = await supabase
              .from('list_items')
              .update({ price_calibration: prevLegacy })
              .eq('id', id)
            if (err) throw err
          }
        },
      })
    } catch (e: unknown) {
      setItems((p) => {
        const next = p.map((i) =>
          i.id === id
            ? { ...i, price_calibration_by_scope: prevMap, price_calibration: prevLegacy }
            : i,
        )
        itemsRef.current = next
        return next
      })
      setError(errorMessageFromUnknown(e))
    }
  }

  async function changeUnit(id: string, nextUnit: string) {
    const allowed = new Set(['each', 'tsp', 'tbs', 'g', 'kg', 'ml', 'L'])
    const nu = normalizeUnit(nextUnit)
    if (!listId || !allowed.has(nu)) return
    const current = items.find((i) => i.id === id)
    if (!current) return
    if (current.unit === nu) return
    const fp = fingerprintFromText(current.text)
    const prevUnit = current.unit
    const prevQty = current.quantity
    const prevCalMap = clonePriceCalibrationByScope(current.price_calibration_by_scope)
    const prevLegacy = parsePriceCalibration(current.price_calibration)
    const nextQty = quantityWhenChangingUnit(prevUnit, nu, current.quantity)
    const emptyCalMap: Record<string, unknown> = {}
    setItems((p) => {
      const next = p.map((i) =>
        i.id === id
          ? {
              ...i,
              unit: nu,
              quantity: nextQty,
              price_calibration_by_scope: emptyCalMap,
              price_calibration: null,
            }
          : i,
      )
      itemsRef.current = next
      return next
    })
    let unitCalWriteMode: 'scoped' | 'legacy' = 'scoped'
    try {
      await push({
        apply: async () => {
          const modern = await supabase
            .from('list_items')
            .update({ unit: nu, quantity: nextQty, price_calibration_by_scope: emptyCalMap })
            .eq('id', id)
          if (!modern.error) {
            unitCalWriteMode = 'scoped'
          } else if (isMissingPriceCalibrationByScopeColumn(modern.error)) {
            const leg = await supabase
              .from('list_items')
              .update({ unit: nu, quantity: nextQty, price_calibration: null })
              .eq('id', id)
            if (leg.error) throw modern.error
            unitCalWriteMode = 'legacy'
          } else {
            throw modern.error
          }
          void logListItemEvent(supabase, {
            listId,
            itemId: id,
            eventType: 'unit_changed',
            fingerprint: fp,
            payload: { from: prevUnit, to: nu, quantity: nextQty, prevQuantity: prevQty, text: current.text },
          })
        },
        revert: async () => {
          if (unitCalWriteMode === 'scoped') {
            const { error: err } = await supabase
              .from('list_items')
              .update({ unit: prevUnit, quantity: prevQty, price_calibration_by_scope: prevCalMap })
              .eq('id', id)
            if (err) throw err
          } else {
            const { error: err } = await supabase
              .from('list_items')
              .update({ unit: prevUnit, quantity: prevQty, price_calibration: prevLegacy })
              .eq('id', id)
            if (err) throw err
          }
        },
      })
    } catch (e: unknown) {
      setItems((p) => {
        const next = p.map((i) =>
          i.id === id
            ? {
                ...i,
                unit: prevUnit,
                quantity: prevQty,
                price_calibration_by_scope: prevCalMap,
                price_calibration: prevLegacy,
              }
            : i,
        )
        itemsRef.current = next
        return next
      })
      setError(errorMessageFromUnknown(e))
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
          const { error: err } = await supabase
            .from('list_items')
            .update({ category_key: current.category_key })
            .eq('id', id)
          if (err) throw err
        },
      })
      const { error: learnErr } = await supabase.from('list_category_learnings').upsert(
        {
          list_id: listId,
          fingerprint: fp,
          category_key: categoryKey,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'list_id,fingerprint' },
      )
      if (learnErr) {
        setError(learnErr.message)
        return
      }
      setCategoryLearnings((prev) => ({ ...prev, [fp]: categoryKey }))
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

  async function dismissRecommendation(fingerprint: string, displayText: string) {
    if (!listId) return
    setError(null)
    try {
      await logListItemEvent(supabase, {
        listId,
        itemId: null,
        eventType: 'recommendation_dismissed',
        fingerprint,
        payload: { text: displayText },
      })
      await refreshEvents()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not update recommendations')
    }
  }

  async function addRecommendationsBatch(rows: RecommendationBatchRow[]) {
    if (!listId || rows.length === 0) return
    setError(null)
    try {
      for (const r of rows) {
        const match = itemsRef.current.find(
          (i) => !i.checked && fingerprintFromText(i.text) === r.fingerprint,
        )
        if (match) {
          const nextQty = Math.round((match.quantity + r.qty) * 10) / 10
          await changeQuantity(match.id, nextQty)
        } else {
          await insertItem(r.displayText, r.qty, r.unit)
        }
      }
      await refreshEvents()
      setRecOpen(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not add items')
    }
  }

  async function addRecipeUrlImportBatch(rows: RecipeUrlImportBatchRow[]) {
    if (!listId || rows.length === 0) return
    setError(null)
    try {
      for (const r of rows) {
        const match = itemsRef.current.find(
          (i) => !i.checked && fingerprintFromText(i.text) === r.fingerprint,
        )
        if (match) {
          const nextQty = Math.round((match.quantity + r.qty) * 10) / 10
          await changeQuantity(match.id, nextQty)
        } else {
          await insertItem(r.displayText, r.qty, r.unit)
        }
      }
      await refreshEvents()
      setRecipeUrlImportKey((k) => k + 1)
      setRecipeUrlOpen(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not add items')
    }
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
    () => estimateListPricing(items, list?.store_preset_id ?? null, presets, priceLearnings),
    [items, list?.store_preset_id, presets, priceLearnings],
  )

  const pricingFetchKey = useMemo(
    () =>
      `${list?.store_preset_id ?? ''}:${presets.map((p) => `${p.id}:${p.slug}`).join(',')}:${items
        .map(
          (i) =>
            `${i.id}:${i.quantity}:${normalizeUnit(i.unit)}:${i.text}:${i.checked ? '1' : '0'}:${JSON.stringify(i.price_calibration_by_scope ?? {})}`,
        )
        .join('|')}|PL:${priceLearnings
        .map(
          (r) =>
            `${r.fingerprint}:${r.store_scope}:${normalizeUnit(r.unit)}:${r.ema_unit_price_aud}:${r.sample_count}:${r.last_obs_unit_price_aud}`,
        )
        .sort()
        .join(';')}`,
    [items, list?.store_preset_id, presets, priceLearnings],
  )

  const [mergedPricing, setMergedPricing] = useState<{ key: string; estimate: ListPriceEstimate } | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchMergedListPricing(items, list?.store_preset_id ?? null, presets, priceLearnings).then((estimate) => {
      if (cancelled) return
      setMergedPricing({ key: pricingFetchKey, estimate })
    })
    return () => {
      cancelled = true
    }
  }, [pricingFetchKey, items, list?.store_preset_id, presets, priceLearnings])

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

  const priceCalItem = useMemo(
    () => (priceCalItemId ? items.find((i) => i.id === priceCalItemId) ?? null : null),
    [priceCalItemId, items],
  )
  const selectedStoreName = useMemo(() => {
    const id = list?.store_preset_id ?? ''
    const match = presets.find((p) => p.id === id)
    return match?.name ?? 'Store layout'
  }, [list?.store_preset_id, presets])
  const storeSelectorWidthCh = useMemo(
    () => Math.max(12, selectedStoreName.length + 4),
    [selectedStoreName],
  )

  function openCategoryPicker(itemId: string) {
    const item = items.find((i) => i.id === itemId)
    if (!item) return
    setCategoryPickerItemId(itemId)
    setCategoryTargetKey(inferCategoryKey(item.text, item.category_key))
  }

  function openFooterAddMode() {
    if (footerCloseTimerRef.current) {
      clearTimeout(footerCloseTimerRef.current)
      footerCloseTimerRef.current = null
    }
    setFooterClosing(false)
    setFooterExpanded(true)
    requestAnimationFrame(() => {
      addItemInputRef.current?.focus()
    })
  }

  function dismissFooterAddMode() {
    if (!footerExpanded) return
    if (footerCloseTimerRef.current) clearTimeout(footerCloseTimerRef.current)
    setFooterClosing(true)
    footerCloseTimerRef.current = setTimeout(() => {
      setFooterExpanded(false)
      setFooterClosing(false)
      footerCloseTimerRef.current = null
    }, 180)
  }

  function handleFooterSheetPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'touch' && e.pointerType !== 'mouse') return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    footerSwipeStartYRef.current = e.clientY
    footerSwipePointerIdRef.current = e.pointerId
  }

  function handleFooterSheetPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (footerSwipePointerIdRef.current !== e.pointerId) return
    const startY = footerSwipeStartYRef.current
    if (startY == null) return
    const dy = e.clientY - startY
    if (dy > 44) {
      dismissFooterAddMode()
      footerSwipeStartYRef.current = null
      footerSwipePointerIdRef.current = null
    }
  }

  function clearFooterSheetSwipe() {
    footerSwipeStartYRef.current = null
    footerSwipePointerIdRef.current = null
  }

  function triggerDeleteHaptic() {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
    navigator.vibrate(14)
  }

  if (!listId) {
    return <p className="p-4 text-sm text-slate-600">Missing list id.</p>
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col scroll-pb-[calc(15rem+env(safe-area-inset-bottom,0px))] bg-slate-50 px-2 pb-[calc(15rem+env(safe-area-inset-bottom,0px))] pt-0 text-slate-900 dark:bg-slate-950 dark:text-slate-100 sm:px-3 sm:pb-[calc(15rem+env(safe-area-inset-bottom,0px))]">
      <div className="sticky top-0 z-40 h-0">
        <div
          className="pointer-events-none -mx-2 h-[130px] bg-[linear-gradient(to_bottom,rgba(255,255,255,0.72)_0%,rgba(255,255,255,0.48)_42%,rgba(255,255,255,0)_100%)] backdrop-blur-[24px] [mask-image:linear-gradient(to_bottom,black_0%,black_55%,transparent_100%)] dark:bg-[linear-gradient(to_bottom,rgba(15,23,42,0.9)_0%,rgba(15,23,42,0.7)_42%,rgba(15,23,42,0)_100%)] sm:-mx-3"
          aria-hidden
        />
      </div>
      <header className="sticky top-0 z-50 -mx-2 mb-2 flex flex-col gap-1.5 bg-transparent px-2 pt-2 sm:-mx-3 sm:mb-3 sm:gap-2 sm:px-3 sm:pt-3">
        <div className="flex min-h-16 items-center justify-between px-2 py-2">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              to="/"
              className="grid h-10 min-h-10 w-10 min-w-10 shrink-0 place-items-center rounded-full bg-white text-slate-700 shadow-[0_4px_20px_rgba(30,31,33,0.12),0_0_8px_rgba(0,0,0,0.04)] hover:bg-black/15 active:bg-black/15 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:active:bg-slate-800"
              aria-label="All lists"
              title="All lists"
            >
              <BackToListsIcon className="h-4 w-4 shrink-0" />
            </Link>
            <input
              className="min-w-0 rounded-[4px] border border-transparent bg-transparent px-1 py-1 text-base font-medium leading-5 text-slate-600 outline-none focus:border-[#1868DB] dark:text-slate-200"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => void persistTitle(title)}
              placeholder="Shopping list"
              aria-label="List name"
            />
          </div>
          <div className="flex items-center rounded-full bg-white p-1 shadow-[0_4px_20px_rgba(30,31,33,0.12),0_0_8px_rgba(0,0,0,0.04)] dark:bg-slate-900">
            <button
              type="button"
              onClick={toggleMode}
              className={`flex h-10 items-center gap-2 rounded-full px-3 pr-4 text-base font-medium text-white shadow-[0_4px_20px_rgba(30,31,33,0.12),0_0_8px_rgba(0,0,0,0.04)] hover:brightness-95 active:brightness-95 ${
                mode === 'plan'
                  ? 'bg-[linear-gradient(147deg,#00B66F_0%,#005371_100%)]'
                  : 'bg-[linear-gradient(147deg,#D500F1_0%,#00338C_100%)]'
              }`}
              aria-label={mode === 'plan' ? 'Switch to Shop mode' : 'Switch to Plan mode'}
              title={mode === 'plan' ? 'Switch to Shop mode' : 'Switch to Plan mode'}
            >
              {mode === 'plan' ? <ToolbarIconPlan className="h-4 w-4" /> : <ToolbarIconShop className="h-4 w-4" />}
              {mode === 'plan' ? 'Plan' : 'Shop'}
            </button>
            <div className="relative ml-1 h-10 w-10">
              <label htmlFor="list-settings-action" className="sr-only">
                List settings
              </label>
              <select
                id="list-settings-action"
                value={headerAction}
                onChange={(e) => handleHeaderActionChange(e.target.value)}
                className="absolute inset-0 z-10 h-10 w-10 cursor-pointer appearance-none rounded-full bg-transparent text-transparent outline-none hover:bg-black/15 active:bg-black/15 dark:hover:bg-slate-800 dark:active:bg-slate-800"
                aria-label="List settings actions"
              >
                <option value="" hidden />
                <option value="aisles">Manage store aisle ordering</option>
                <option value="stores">Manage stores</option>
                <option value="invite">Invite collaborator</option>
                <option value="theme">Theme</option>
              </select>
              <div className="pointer-events-none grid h-10 w-10 place-items-center rounded-full">
                <ToolbarIconMore className="h-4 w-4 text-slate-600 dark:text-slate-200" />
              </div>
            </div>
            <select
              ref={themeSelectRef}
              value={themePreference}
              onChange={(e) => selectTheme(e.target.value as ThemePreference)}
              className="sr-only"
              aria-label="Theme"
              tabIndex={-1}
            >
              <option value="system">{themePreference === 'system' ? '✓ System' : 'System'}</option>
              <option value="light">{themePreference === 'light' ? '✓ Light' : 'Light'}</option>
              <option value="dark">{themePreference === 'dark' ? '✓ Dark' : 'Dark'}</option>
            </select>
          </div>
        </div>
        <div className="flex min-h-10 items-center justify-between px-2 pr-1">
          {mode === 'shop' ? (
            <div
              className={`relative h-10 min-w-0 max-w-full flex-1 transition-opacity duration-200 ${
                shopSelectorVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
              }`}
              style={{ width: `${storeSelectorWidthCh}ch`, maxWidth: `${storeSelectorWidthCh}ch` }}
            >
              <label htmlFor="list-store-layout" className="sr-only">
                Store layout
              </label>
              <select
                id="list-store-layout"
                className="h-10 w-full appearance-none rounded-full border border-slate-900/15 bg-white py-2 pl-3 pr-9 text-base font-medium text-slate-600 outline-none hover:bg-[#F0F1F2] active:bg-[#F0F1F2] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:active:bg-slate-800"
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
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 dark:text-slate-200" aria-hidden>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path
                    fillRule="evenodd"
                    d="M5.23 7.21a.75.75 0 011.06.02L10 11.084l3.71-3.852a.75.75 0 111.08 1.04l-4.24 4.4a.75.75 0 01-1.08 0l-4.24-4.4a.75.75 0 01.02-1.06z"
                    clipRule="evenodd"
                  />
                </svg>
              </span>
            </div>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={!canUndo}
              onClick={() => void undo().then(() => refreshAll())}
              className={`grid h-10 w-10 place-items-center rounded-full bg-white text-slate-600 transition-shadow duration-200 hover:bg-[#F0F1F2] active:bg-[#F0F1F2] ${
                headerElevated ? 'shadow-[0_4px_12px_rgba(30,31,33,0.18)]' : 'shadow-none'
              } dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:active:bg-slate-800`}
              aria-label="Undo"
              title="Undo"
            >
              <ToolbarIconUndo className={`h-4 w-4 shrink-0 ${canUndo ? '' : 'opacity-40'}`} />
            </button>
            <button
              type="button"
              disabled={!canRedo}
              onClick={() => void redo().then(() => refreshAll())}
              className={`grid h-10 w-10 place-items-center rounded-full bg-white text-slate-600 transition-shadow duration-200 hover:bg-[#F0F1F2] active:bg-[#F0F1F2] ${
                headerElevated ? 'shadow-[0_4px_12px_rgba(30,31,33,0.18)]' : 'shadow-none'
              } dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:active:bg-slate-800`}
              aria-label="Redo"
              title="Redo"
            >
              <ToolbarIconRedo className={`h-4 w-4 shrink-0 ${canRedo ? '' : 'opacity-40'}`} />
            </button>
            <button
              type="button"
              onClick={toggleView}
              className={`grid h-10 w-10 place-items-center rounded-full bg-white text-slate-600 transition-shadow duration-200 hover:bg-[#F0F1F2] active:bg-[#F0F1F2] ${
                headerElevated ? 'shadow-[0_4px_12px_rgba(30,31,33,0.18)]' : 'shadow-none'
              } dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:active:bg-slate-800`}
              aria-label={view === 'flat' ? 'Switch to grouped view' : 'Switch to flat view'}
              title={view === 'flat' ? 'Switch to grouped view' : 'Switch to flat view'}
            >
              {view === 'flat' ? (
                <ToolbarIconViewFlat className="h-4 w-4 shrink-0" />
              ) : (
                <ToolbarIconViewGrouped className="h-4 w-4 shrink-0" />
              )}
            </button>
          </div>
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
          <div className={mode === 'shop' ? 'p-1 pt-2' : 'p-1'}>
            <section>
              <SortableContext items={activeSorted.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                <ul className="flex flex-col gap-2 sm:gap-2">
                  {activeSorted.map((item) => (
                    <SortableItem
                      key={item.id}
                      item={item}
                      showDragHandle={mode === 'plan'}
                      showPrices={showPrices}
                      isOnSpecial={pricing.items[item.id]?.onSpecial ?? false}
                      estimatedLineCost={pricing.items[item.id]?.estimatedCost ?? 0}
                      hasYourPrice={parsePriceCalibrationForScope(item, priceCalibrationScopeKey) !== null}
                      onOpenYourPrice={showPrices ? () => setPriceCalItemId(item.id) : undefined}
                      dragFromRow
                      itemMenuVariant="overflow"
                      onChangeCategory={openCategoryPicker}
                      onToggle={(id, c) => void toggleItem(id, c)}
                      onDelete={(id) => void deleteItem(id)}
                      onQuantityChange={(id, q) => void changeQuantity(id, q)}
                      onUnitChange={(id, u) => void changeUnit(id, u)}
                      onTextChange={(id, t) => void changeItemText(id, t)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </section>
            <section className="mt-8 border-t border-slate-200 pt-4 dark:border-slate-800">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-slate-500">Completed</h2>
                <button
                  type="button"
                  className="min-h-8 rounded-[99px] border border-slate-200 px-3 py-1 text-sm text-slate-600 hover:bg-slate-100 active:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:active:bg-slate-800 disabled:opacity-40"
                  onClick={() => void deleteCompletedItems()}
                  disabled={!completedSorted.length}
                >
                  Delete items
                </button>
              </div>
              <SortableContext items={completedSorted.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                <ul className="flex flex-col gap-2 sm:gap-2">
                  {completedSorted.map((item) => (
                    <SortableItem
                      key={item.id}
                      item={item}
                      showDragHandle={mode === 'plan'}
                      showPrices={showPrices}
                      isOnSpecial={pricing.items[item.id]?.onSpecial ?? false}
                      estimatedLineCost={pricing.items[item.id]?.estimatedCost ?? 0}
                      hasYourPrice={parsePriceCalibrationForScope(item, priceCalibrationScopeKey) !== null}
                      onOpenYourPrice={showPrices ? () => setPriceCalItemId(item.id) : undefined}
                      dragFromRow
                      onToggle={(id, c) => void toggleItem(id, c)}
                      onDelete={(id) => void deleteItem(id)}
                      onQuantityChange={(id, q) => void changeQuantity(id, q)}
                      onUnitChange={(id, u) => void changeUnit(id, u)}
                      onTextChange={(id, t) => void changeItemText(id, t)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </section>
          </div>
        </DndContext>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void onDragEnd(e)}>
          <div className={`flex flex-col gap-3 p-1 sm:gap-4 ${mode === 'shop' ? 'pt-2' : ''}`}>
            <SortableContext items={activeSorted.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              {categoryWalkOrder.map((key) => {
                const rows = groupedBuckets.buckets[key] ?? []
                if (!rows.length) return null
                const collapsed = !!collapsedCategoryKeys[key]
                return (
                  <section key={key} className="space-y-1 py-0.5">
                    <div className="flex items-center justify-between gap-2 py-0.5">
                      <button
                        type="button"
                        className={`-ml-[7px] flex h-6 items-center gap-[14px] rounded-full pl-1.5 pr-4 text-[14px] font-medium leading-4 text-[#505258] ${
                          collapsed
                            ? 'bg-[rgba(5,12,24,0.06)] hover:bg-[rgba(11,18,14,0.14)] active:bg-[rgba(11,18,14,0.14)]'
                            : 'bg-transparent hover:bg-[rgba(5,12,24,0.06)] active:bg-[rgba(5,12,24,0.06)]'
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
                        <span className="grid h-5 w-5 shrink-0 place-items-center" aria-hidden>
                          {collapsed ? (
                            <svg width="7" height="10" viewBox="0 0 7 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M-4.29498e-07 1.00193L-9.50382e-08 8.65349C-5.76932e-08 9.50785 1.00212 9.96875 1.65079 9.41275L6.1142 5.58697C6.57981 5.18787 6.57981 4.46755 6.1142 4.06846L1.65079 0.242677C1.00212 -0.313329 -4.66843e-07 0.14758 -4.29498e-07 1.00193Z" fill="#505258" />
                            </svg>
                          ) : (
                            <svg width="10" height="7" viewBox="0 0 10 7" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M8.65354 0H1.00198C0.147626 0 -0.313283 1.00212 0.242723 1.65079L4.0685 6.1142C4.4676 6.57981 5.18792 6.57981 5.58702 6.1142L9.4128 1.65079C9.9688 1.00212 9.50789 0 8.65354 0Z" fill="#505258" />
                            </svg>
                          )}
                        </span>
                        <span>{headingForCategoryKey(key)}</span>
                      </button>
                      <span className="min-w-8" aria-hidden />
                    </div>
                    <div
                      className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-200 ease-out ${
                        collapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'
                      }`}
                    >
                      <ul className="min-h-0 flex flex-col gap-2 overflow-hidden rounded-[6px] bg-transparent dark:bg-transparent sm:gap-2">
                        {rows.map((item) => (
                          <SortableItem
                            key={item.id}
                            item={item}
                            showPrices={showPrices}
                            isOnSpecial={pricing.items[item.id]?.onSpecial ?? false}
                            estimatedLineCost={pricing.items[item.id]?.estimatedCost ?? 0}
                            hasYourPrice={parsePriceCalibrationForScope(item, priceCalibrationScopeKey) !== null}
                            onOpenYourPrice={showPrices ? () => setPriceCalItemId(item.id) : undefined}
                            disableDrag
                            inGroupedBlock
                            itemMenuVariant="overflow"
                            onChangeCategory={openCategoryPicker}
                            showDragHandle={false}
                            onToggle={(id, c) => void toggleItem(id, c)}
                            onDelete={(id) => void deleteItem(id)}
                            onQuantityChange={(id, q) => void changeQuantity(id, q)}
                            onUnitChange={(id, u) => void changeUnit(id, u)}
                            onTextChange={(id, t) => void changeItemText(id, t)}
                          />
                        ))}
                      </ul>
                    </div>
                  </section>
                )
              })}
            </SortableContext>
            <section className="mt-8 border-t border-slate-200 pt-4 dark:border-slate-800">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-slate-500">Completed</h2>
                <button
                  type="button"
                  className="min-h-8 rounded-[99px] border border-slate-200 px-3 py-1 text-sm text-slate-600 hover:bg-slate-100 active:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:active:bg-slate-800 disabled:opacity-40"
                  onClick={() => void deleteCompletedItems()}
                  disabled={!completedSorted.length}
                >
                  Delete items
                </button>
              </div>
              {completedSorted.length ? (
                <SortableContext items={completedSorted.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                  <ul className="flex flex-col gap-2 overflow-hidden rounded-[6px] bg-transparent dark:bg-transparent sm:gap-2">
                    {completedSorted.map((item) => (
                      <SortableItem
                        key={item.id}
                        item={item}
                        showPrices={showPrices}
                        isOnSpecial={pricing.items[item.id]?.onSpecial ?? false}
                        estimatedLineCost={pricing.items[item.id]?.estimatedCost ?? 0}
                        hasYourPrice={parsePriceCalibrationForScope(item, priceCalibrationScopeKey) !== null}
                        onOpenYourPrice={showPrices ? () => setPriceCalItemId(item.id) : undefined}
                        inGroupedBlock
                        enableLongPressCategoryChange
                        showDragHandle={false}
                        onToggle={(id, c) => void toggleItem(id, c)}
                        onDelete={(id) => void deleteItem(id)}
                        onQuantityChange={(id, q) => void changeQuantity(id, q)}
                        onUnitChange={(id, u) => void changeUnit(id, u)}
                        onTextChange={(id, t) => void changeItemText(id, t)}
                        onLongPressCategoryChange={openCategoryPicker}
                      />
                    ))}
                  </ul>
                </SortableContext>
              ) : null}
            </section>
          </div>
        </DndContext>
      )}

      <div
        className="pointer-events-none fixed bottom-0 left-0 right-0 z-20 overflow-visible bg-transparent px-2 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] pt-2 sm:px-3 sm:pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] sm:pt-3"
        style={{ transform: footerExpanded && footerKeyboardInset > 0 ? `translateY(-${footerKeyboardInset}px)` : 'translateY(0)' }}
      >
        <div className="pointer-events-none mx-auto w-full max-w-lg">
          {!footerExpanded ? (
            mode === 'plan' ? (
              <div className="pointer-events-auto grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 p-1">
                <button
                  type="button"
                  className="flex h-12 min-w-0 items-center rounded-full bg-white px-3 text-left text-base font-normal text-slate-500 shadow-[0_4px_20px_rgba(30,31,33,0.12),0_0_8px_rgba(0,0,0,0.04)] hover:bg-[#F0F1F2] active:bg-[#F0F1F2] dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:active:bg-slate-800"
                  onClick={openFooterAddMode}
                  onPointerDown={(e) => {
                    e.preventDefault()
                    openFooterAddMode()
                  }}
                >
                  Add item
                </button>
                <button
                  type="button"
                  className="flex h-12 min-w-0 items-center gap-2 rounded-full bg-white px-3 text-base font-medium text-slate-700 shadow-[0_4px_20px_rgba(30,31,33,0.12),0_0_8px_rgba(0,0,0,0.04)] hover:bg-[#F0F1F2] active:bg-[#F0F1F2] dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:active:bg-slate-800"
                  onClick={() => setRecipeUrlOpen(true)}
                >
                  <span aria-hidden>🔗</span>
                  <span className="truncate">From URL</span>
                </button>
                <button
                  type="button"
                  className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white text-[18px] text-slate-700 shadow-[0_4px_20px_rgba(30,31,33,0.12),0_0_8px_rgba(0,0,0,0.04)] hover:bg-[#F0F1F2] active:bg-[#F0F1F2] dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:active:bg-slate-800"
                  onClick={() => setRecOpen(true)}
                  aria-label="Recommendations"
                >
                  ★
                </button>
              </div>
            ) : (
              <div className="pointer-events-auto flex items-center justify-end p-1">
                <button
                  type="button"
                  className="grid h-12 w-12 place-items-center rounded-full bg-white text-[22px] text-slate-700 shadow-[0_4px_20px_rgba(30,31,33,0.12),0_0_8px_rgba(0,0,0,0.04)] hover:bg-[#F0F1F2] active:bg-[#F0F1F2] dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:active:bg-slate-800"
                  onClick={openFooterAddMode}
                  onPointerDown={(e) => {
                    e.preventDefault()
                    openFooterAddMode()
                  }}
                  aria-label="Add item"
                >
                  +
                </button>
              </div>
            )
          ) : (
            <div
              className={`pointer-events-auto relative overflow-visible rounded-t-xl bg-white px-3 py-3 shadow-[0_4px_20px_rgba(30,31,33,0.12),0_0_8px_rgba(0,0,0,0.04)] transition-all duration-200 ease-out dark:bg-slate-950 ${
                footerClosing ? 'translate-y-8 opacity-0' : 'translate-y-0 opacity-100'
              }`}
              onPointerDown={handleFooterSheetPointerDown}
              onPointerMove={handleFooterSheetPointerMove}
              onPointerUp={clearFooterSheetSwipe}
              onPointerCancel={clearFooterSheetSwipe}
            >
              <button
                type="button"
                className="absolute -top-[40px] right-3 z-20 grid h-8 w-8 place-items-center rounded-full bg-white text-[#292A2E] shadow-[0_4px_20px_rgba(30,31,33,0.12),0_0_8px_rgba(0,0,0,0.04)] hover:bg-[#F0F1F2] active:bg-[#F0F1F2] dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 dark:active:bg-slate-800"
                onClick={dismissFooterAddMode}
                aria-label="Close add item panel"
                title="Close"
              >
                <svg width="12" height="5" viewBox="0 0 12 5" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                  <path
                    d="M3.27729e-07 1.25195L5.5 4.87695C5.75041 5.04199 6.07576 5.04199 6.32617 4.87695L11.8262 1.25195L11 -1.97957e-06L5.91309 3.35254L0.826172 -2.869e-06L3.27729e-07 1.25195Z"
                    fill="currentColor"
                  />
                </svg>
              </button>
              <div className="flex items-center gap-2">
                <input
                  ref={addItemInputRef}
                  className="h-12 min-w-0 flex-1 rounded-full border-2 border-[#1868DB] bg-white px-3 text-[18px] text-slate-700 outline-none dark:bg-slate-900 dark:text-slate-100"
                  autoFocus
                  autoCapitalize="words"
                  enterKeyHint="done"
                  placeholder="Add item"
                  value={newText}
                  onChange={(e) => setNewText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    void addItem()
                  }}
                />
                <div className="flex h-12 items-center rounded-full bg-white p-1 shadow-[0_4px_20px_rgba(30,31,33,0.12),0_0_8px_rgba(0,0,0,0.04)] dark:bg-slate-900">
                  {newUnit === 'each' ? (
                    <select
                      className="h-10 min-w-[40px] appearance-none rounded-full border-0 bg-white px-1 text-right text-[16px] font-medium [text-align-last:right] text-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      value={Math.min(20, Math.max(1, Math.round(Number(newQty)) || 1))}
                      onChange={(e) => {
                        const v = Number(e.target.value)
                        setQtyTouched(true)
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
                      className="h-10 w-[56px] rounded-full border-0 bg-white px-1 text-right text-[16px] font-medium text-slate-700 outline-none dark:bg-slate-900 dark:text-slate-100"
                      value={newQtyText}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        setQtyTouched(true)
                        setNewQtyText(e.target.value)
                      }}
                      onBlur={() => {
                        const p = parseQuantityInput(newUnit, newQtyText)
                        if (p !== null) {
                          setNewQty(p)
                          setNewQtyText(formatQuantityForInput(newUnit, p))
                        } else {
                          setNewQtyText(formatQuantityForInput(newUnit, newQty))
                        }
                      }}
                      aria-label="Quantity"
                    />
                  )}
                  <select
                    className="h-10 min-w-[44px] appearance-none rounded-full border-0 bg-white px-1 text-center text-[16px] font-medium text-slate-700 [text-align-last:center] dark:bg-slate-900 dark:text-slate-100"
                    value={normalizeUnit(newUnit)}
                    onChange={(e) => {
                      const u = normalizeUnit(e.target.value)
                      const bridged = quantityWhenChangingUnit(newUnit, u, newQty)
                      setUnitTouched(true)
                      setNewUnit(u)
                      setNewQty(bridged)
                      setNewQtyText(formatQuantityForInput(u, bridged))
                    }}
                    aria-label="Quantity type"
                  >
                    {UNIT_OPTIONS.map((u) => (
                      <option key={u} value={u}>
                        {u === 'each' ? 'ea' : unitOptionLabel(u)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                type="button"
                className={`mt-2 h-12 w-full rounded-full text-base font-semibold text-white ${
                  newText.trim()
                    ? 'bg-[linear-gradient(147deg,#00B66F_0%,#005371_100%)]'
                    : 'bg-slate-300'
                }`}
                onClick={() => void addItem()}
                disabled={!newText.trim()}
              >
                Add item
              </button>
            </div>
          )}
          {showPrices ? (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Total estimated cost: ${pricing.totalEstimatedCost.toFixed(2)}
              <span aria-hidden="true"> | </span>
              Remaining cost: ${remainingEstimatedCost.toFixed(2)}
            </p>
          ) : null}
        </div>
      </div>

      <RecommendationsDrawer
        open={recOpen}
        onClose={() => setRecOpen(false)}
        suggestions={suggestions}
        storePresetId={list?.store_preset_id ?? null}
        presets={presets}
        showPrices={showPrices}
        onDismiss={(fp, text) => void dismissRecommendation(fp, text)}
        onAddBatch={(rows) => addRecommendationsBatch(rows)}
      />

      <RecipeUrlImportDrawer
        key={recipeUrlImportKey}
        open={recipeUrlOpen}
        onClose={() => setRecipeUrlOpen(false)}
        showPrices={showPrices}
        itemsForMatch={items.map((i) => ({
          text: i.text,
          checked: i.checked,
          quantity: i.quantity,
          unit: i.unit,
        }))}
        storePresetId={list?.store_preset_id ?? null}
        presets={presets}
        onAddBatch={(rows) => addRecipeUrlImportBatch(rows)}
      />

      {priceCalItem ? (
        <PriceCalibrationModal
          item={priceCalItem}
          storeScopeKey={priceCalibrationScopeKey}
          onClose={() => setPriceCalItemId(null)}
          onSave={(cal) => void savePriceCalibration(priceCalItem.id, cal)}
          onClear={() => void clearPriceCalibration(priceCalItem.id)}
        />
      ) : null}

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
                  void insertItem(payload.text, payload.qty, payload.unit).catch(() => {
                    /* insertItem sets error */
                  })
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

      {storesOpen ? (
        <StoresManageModal
          presets={presets}
          onClose={() => setStoresOpen(false)}
          onCatalogUpdated={async () => {
            setError(null)
            await refreshStoreCatalog()
            await refreshAll()
          }}
          setError={setError}
        />
      ) : null}
    </div>
  )
}
