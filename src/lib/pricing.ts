import pricingSeed from '../data/pricingSeed.json'
import type { ListItemRow, ListPriceLearningRow, StorePresetRow } from '../types'
import { calibratedLineCostAud, parsePriceCalibrationForScope } from './priceCalibration'
import { crossStoreLineHint, learningDealStripe, priceLearningMapKey } from './priceLearnings'
import { fingerprintFromText } from './normalize'
import type { PricingEstimateRequest, PricingEstimateResponse } from './pricingContract'
import { fetchRemotePricingEstimate } from './pricingRemote'
import { chainFallbackMultiplier, priceLearningScopeFromPresetId, storeChainFromSlug } from './storeChain'
import { normalizeUnit } from './units'

type CatalogRow = {
  keywords: string[]
  unit: string
  unitPrice: number
  regularUnitPrice?: number
}

type SeedShape = {
  stores: Record<string, CatalogRow[]>
  /** Map preset slug → catalog slug when the short slug has no rows (e.g. legacy "woolworths"). */
  catalogSlugAliases?: Record<string, string>
}

export type ItemPriceEstimate = {
  itemId: string
  estimatedCost: number
  onSpecial: boolean
  confidence: 'high' | 'medium' | 'low'
}

export type ListPriceEstimate = {
  totalEstimatedCost: number
  items: Record<string, ItemPriceEstimate>
  sourceLabel: string
}

function normalizeText(s: string) {
  return s.trim().toLowerCase()
}

/**
 * Heuristic unit price when nothing in the seed catalog matches. Scales by chain so Aldi is lower than Coles,
 * and Woolworths is a touch higher (typical AU positioning).
 */
function fallbackUnitPrice(unit: string, slug: string | null) {
  const u = normalizeUnit(unit)
  let base: number
  if (u === 'each') base = 1.8
  else if (u === 'L') base = 2.2
  else if (u === 'ml') base = 2.2 / 1000
  else if (u === 'kg') base = 6.5
  else if (u === 'g') base = 6.5 / 1000
  else if (u === 'tsp') base = 0.08
  else if (u === 'tbs') base = 0.2
  else base = 2
  return base * chainFallbackMultiplier(slug)
}

function resolveStoreSlug(storePresetId: string | null, presets: StorePresetRow[]) {
  if (!storePresetId) return null
  return presets.find((p) => p.id === storePresetId)?.slug ?? null
}

/** Pick keyword catalog rows for this preset: exact slug, configured alias, then same-chain default layout. */
function resolveCatalogRows(seed: SeedShape, slug: string | null): CatalogRow[] | undefined {
  if (!slug) return undefined
  const direct = seed.stores[slug]
  if (direct?.length) return direct
  const alias = seed.catalogSlugAliases?.[slug]
  if (alias && seed.stores[alias]?.length) return seed.stores[alias]
  const chain = storeChainFromSlug(slug)
  if (chain === 'aldi' && seed.stores['aldi-kotara']?.length) return seed.stores['aldi-kotara']
  if (chain === 'woolworths' && seed.stores['woolworths-kotara']?.length) return seed.stores['woolworths-kotara']
  if (chain === 'coles' && seed.stores['coles-kotara']?.length) return seed.stores['coles-kotara']
  return undefined
}

function estimateItemCostFromCatalog(item: ListItemRow, rows: CatalogRow[] | undefined, slug: string | null): ItemPriceEstimate {
  const text = normalizeText(item.text)
  const unit = normalizeUnit(item.unit)
  let matched: CatalogRow | null = null
  if (rows?.length) {
    matched =
      rows.find((r) => r.keywords.some((kw) => text.includes(normalizeText(kw))) && normalizeUnit(r.unit) === unit) ??
      rows.find((r) => r.keywords.some((kw) => text.includes(normalizeText(kw)))) ??
      null
  }

  if (!matched) {
    const fallback = fallbackUnitPrice(unit, slug) * Math.max(0, Number(item.quantity) || 0)
    return {
      itemId: item.id,
      estimatedCost: fallback,
      onSpecial: false,
      confidence: 'low',
    }
  }

  const qty = Math.max(0, Number(item.quantity) || 0)
  const est = matched.unitPrice * qty
  const regular = matched.regularUnitPrice ?? matched.unitPrice
  return {
    itemId: item.id,
    estimatedCost: est,
    onSpecial: matched.unitPrice < regular,
    confidence: normalizeUnit(matched.unit) === unit ? 'high' : 'medium',
  }
}

/** Local seed-based line total for a hypothetical item (recommendations drawer). */
export function estimateSuggestionLineCost(
  displayText: string,
  quantity: number,
  unit: string,
  storePresetId: string | null,
  presets: StorePresetRow[],
): number {
  const seed = pricingSeed as SeedShape
  const slug = resolveStoreSlug(storePresetId, presets)
  const rows = resolveCatalogRows(seed, slug)
  const fake: ListItemRow = {
    id: '__suggestion__',
    list_id: '',
    text: displayText,
    quantity: Math.max(0, Number(quantity) || 0),
    unit: normalizeUnit(unit),
    checked: false,
    position: 'a',
    category_key: null,
    created_by: null,
    updated_at: new Date().toISOString(),
  }
  return estimateItemCostFromCatalog(fake, rows, slug).estimatedCost
}

function buildPricingRequest(
  items: ListItemRow[],
  storePresetId: string | null,
  presets: StorePresetRow[],
): PricingEstimateRequest {
  const slug = resolveStoreSlug(storePresetId, presets)
  return {
    storeSlug: slug,
    currency: 'AUD',
    items: items.map((i) => ({
      id: i.id,
      text: i.text,
      quantity: Math.max(0, Number(i.quantity) || 0),
      unit: normalizeUnit(i.unit),
    })),
  }
}

function mergeRemoteWithLocal(
  remote: PricingEstimateResponse | null,
  local: ListPriceEstimate,
  listItems: ListItemRow[],
  storePresetId: string | null,
  presets: StorePresetRow[],
  priceLearnings: ListPriceLearningRow[],
): ListPriceEstimate {
  if (!remote?.items?.length) return local

  const byId = new Map(remote.items.map((r) => [r.itemId, r]))
  const itemById = new Map(listItems.map((i) => [i.id, i]))
  const learningByKey = new Map<string, ListPriceLearningRow>()
  for (const row of priceLearnings) {
    learningByKey.set(priceLearningMapKey(row.fingerprint, row.store_scope, row.unit), row)
  }

  let remoteUsed = 0
  const items: Record<string, ItemPriceEstimate> = {}
  let total = 0
  const calibrationScopeKey = storePresetId ? priceLearningScopeFromPresetId(presets, storePresetId) ?? '_' : '_'

  for (const [id, loc] of Object.entries(local.items)) {
    const r = byId.get(id)
    if (r && Number.isFinite(r.estimatedCost)) {
      remoteUsed++
      items[id] = {
        itemId: id,
        estimatedCost: r.estimatedCost,
        onSpecial: r.onSpecial,
        confidence: r.confidence,
      }
    } else {
      items[id] = loc
    }
    const row = itemById.get(id)
    const calCost = row ? calibratedLineCostAud(row, parsePriceCalibrationForScope(row, calibrationScopeKey)) : null
    if (calCost !== null) {
      items[id] = { ...items[id], estimatedCost: calCost, confidence: 'high', onSpecial: false }
    } else if (row && storePresetId) {
      const scope = priceLearningScopeFromPresetId(presets, storePresetId)
      if (scope) {
        const fp = fingerprintFromText(row.text)
        const unit = normalizeUnit(row.unit)
        const qty = Math.max(0, Number(row.quantity) || 0)
        const own = learningByKey.get(priceLearningMapKey(fp, scope, unit))
        if (own && own.sample_count >= 1 && qty > 0) {
          const lineCost = Math.round(own.ema_unit_price_aud * qty * 100) / 100
          items[id] = {
            itemId: id,
            estimatedCost: lineCost,
            onSpecial: learningDealStripe(own),
            confidence: 'high',
          }
        }
      }
    }
    total += items[id].estimatedCost
  }

  const n = Object.keys(local.items).length
  let sourceLabel = local.sourceLabel
  if (remoteUsed > 0) {
    sourceLabel = remoteUsed === n ? remote.sourceLabel : `${remote.sourceLabel} · local for unmatched`
  }

  return {
    totalEstimatedCost: total,
    items,
    sourceLabel,
  }
}

/**
 * Local estimate (seed + heuristics). Used immediately in the UI and as fallback when the server has no match.
 */
export function estimateListPricing(
  items: ListItemRow[],
  storePresetId: string | null,
  presets: StorePresetRow[],
  priceLearnings: ListPriceLearningRow[] = [],
): ListPriceEstimate {
  const seed = pricingSeed as SeedShape
  const slug = resolveStoreSlug(storePresetId, presets)
  const rows = resolveCatalogRows(seed, slug)
  const learningByKey = new Map<string, ListPriceLearningRow>()
  for (const row of priceLearnings) {
    learningByKey.set(priceLearningMapKey(row.fingerprint, row.store_scope, row.unit), row)
  }

  const map: Record<string, ItemPriceEstimate> = {}
  let total = 0
  let usedOwnLearning = false
  let usedCrossHint = false

  const currentScope = storePresetId ? priceLearningScopeFromPresetId(presets, storePresetId) : null
  const calibrationScopeKey = storePresetId ? priceLearningScopeFromPresetId(presets, storePresetId) ?? '_' : '_'

  for (const item of items) {
    const base = estimateItemCostFromCatalog(item, rows, slug)
    const calCost = calibratedLineCostAud(item, parsePriceCalibrationForScope(item, calibrationScopeKey))
    if (calCost !== null) {
      map[item.id] = { ...base, estimatedCost: calCost, confidence: 'high', onSpecial: false }
      total += map[item.id].estimatedCost
      continue
    }

    const fp = fingerprintFromText(item.text)
    const unit = normalizeUnit(item.unit)
    const qty = Math.max(0, Number(item.quantity) || 0)
    let est: ItemPriceEstimate = { ...base }

    if (storePresetId && qty > 0 && currentScope) {
      const key = priceLearningMapKey(fp, currentScope, unit)
      const own = learningByKey.get(key)
      if (own && own.sample_count >= 1) {
        const lineCost = Math.round(own.ema_unit_price_aud * qty * 100) / 100
        est = {
          itemId: item.id,
          estimatedCost: lineCost,
          onSpecial: learningDealStripe(own),
          confidence: 'high',
        }
        usedOwnLearning = true
      } else {
        const hint = crossStoreLineHint(
          fp,
          unit,
          qty,
          storePresetId,
          base.estimatedCost,
          priceLearnings,
          presets,
        )
        if (hint) {
          est = {
            itemId: item.id,
            estimatedCost: hint.lineCost,
            onSpecial: hint.onSpecial,
            confidence: hint.confidence,
          }
          usedCrossHint = true
        }
      }
    }

    map[item.id] = est
    total += est.estimatedCost
  }

  let baseLabel = rows?.length ? 'Seeded store pricing estimate' : 'Fallback estimate'
  if (usedOwnLearning) baseLabel = `${baseLabel} · learned typical`
  else if (usedCrossHint) baseLabel = `${baseLabel} · other-store hint`
  const anyCal = items.some((i) => parsePriceCalibrationForScope(i, calibrationScopeKey))
  return {
    totalEstimatedCost: total,
    items: map,
    sourceLabel: anyCal ? `${baseLabel} · line prices` : baseLabel,
  }
}

/**
 * Tries `/api/pricing/estimate` first, then fills gaps from {@link estimateListPricing}.
 */
export async function fetchMergedListPricing(
  items: ListItemRow[],
  storePresetId: string | null,
  presets: StorePresetRow[],
  priceLearnings: ListPriceLearningRow[] = [],
): Promise<ListPriceEstimate> {
  const local = estimateListPricing(items, storePresetId, presets, priceLearnings)
  const req = buildPricingRequest(items, storePresetId, presets)
  const remote = await fetchRemotePricingEstimate(req)
  return mergeRemoteWithLocal(remote, local, items, storePresetId, presets, priceLearnings)
}
