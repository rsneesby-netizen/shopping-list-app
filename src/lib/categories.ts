import raw from '../data/categories.json'

type CategoryDef = {
  key: string
  label: string
  keywords: string[]
}

const data = raw as { categories: CategoryDef[] }

const defs = data.categories
const defByKey = new Map(defs.map((c) => [c.key, c]))

export function listCategoryDefs(): CategoryDef[] {
  return defs
}

export function categoryLabel(key: string): string {
  return defByKey.get(key)?.label ?? key
}

/** Display name for a category on a store layout (override or taxonomy default). */
export function categoryDisplayLabel(key: string, labelOverride: string | null | undefined): string {
  const o = labelOverride?.trim()
  if (o) return o
  return categoryLabel(key)
}

export function resolveCategoryOrder(
  override: string[] | null | undefined,
  presetKeysOrdered: string[],
): string[] {
  if (!override?.length) return [...presetKeysOrdered]
  const base = [...presetKeysOrdered]
  const seen = new Set<string>()
  const result: string[] = []
  for (const k of override) {
    if (base.includes(k) && !seen.has(k)) {
      result.push(k)
      seen.add(k)
    }
  }
  for (const k of base) {
    if (!seen.has(k)) result.push(k)
  }
  return result
}

export function inferCategoryKey(text: string, override?: string | null): string {
  if (override) return override
  const t = text.trim().toLowerCase()
  if (!t) return 'miscellaneous'
  for (const cat of defs) {
    if (cat.key === 'miscellaneous') continue
    for (const kw of cat.keywords) {
      if (t.includes(kw)) return cat.key
    }
  }
  return 'miscellaneous'
}
