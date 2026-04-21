import pricingSeed from '../data/pricingSeed.json'
import type { PricingEstimateRequest, PricingEstimateResponse } from './pricingContract'
import { fetchRemotePricingEstimate } from './pricingRemote'
import { normalizeUnit } from './units'
import type { ListItemRow, StorePresetRow } from '../types'

type CatalogRow = {
  keywords: string[]
  unit: string
  unitPrice: number
  regularUnitPrice?: number
}

type SeedShape = {
  stores: Record<string, CatalogRow[]>
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

function fallbackUnitPrice(unit: string) {
  const u = normalizeUnit(unit)
  if (u === 'each') return 1.8
  if (u === 'L') return 2.2
  if (u === 'kg') return 6.5
  return 2
}

function resolveStoreSlug(storePresetId: string | null, presets: StorePresetRow[]) {
  if (!storePresetId) return null
  return presets.find((p) => p.id === storePresetId)?.slug ?? null
}

function estimateItemCostFromCatalog(item: ListItemRow, rows: CatalogRow[] | undefined): ItemPriceEstimate {
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
    const fallback = fallbackUnitPrice(unit) * Math.max(0, Number(item.quantity) || 0)
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

function mergeRemoteWithLocal(remote: PricingEstimateResponse | null, local: ListPriceEstimate): ListPriceEstimate {
  if (!remote?.items?.length) return local

  const byId = new Map(remote.items.map((r) => [r.itemId, r]))
  let remoteUsed = 0
  const items: Record<string, ItemPriceEstimate> = {}
  let total = 0

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
): ListPriceEstimate {
  const seed = pricingSeed as SeedShape
  const slug = resolveStoreSlug(storePresetId, presets)
  const rows = slug ? seed.stores[slug] : undefined
  const map: Record<string, ItemPriceEstimate> = {}
  let total = 0

  for (const item of items) {
    const est = estimateItemCostFromCatalog(item, rows)
    map[item.id] = est
    total += est.estimatedCost
  }

  return {
    totalEstimatedCost: total,
    items: map,
    sourceLabel: rows?.length ? 'Seeded store pricing estimate' : 'Fallback estimate',
  }
}

/**
 * Tries `/api/pricing/estimate` first, then fills gaps from {@link estimateListPricing}.
 */
export async function fetchMergedListPricing(
  items: ListItemRow[],
  storePresetId: string | null,
  presets: StorePresetRow[],
): Promise<ListPriceEstimate> {
  const local = estimateListPricing(items, storePresetId, presets)
  const req = buildPricingRequest(items, storePresetId, presets)
  const remote = await fetchRemotePricingEstimate(req)
  return mergeRemoteWithLocal(remote, local)
}
