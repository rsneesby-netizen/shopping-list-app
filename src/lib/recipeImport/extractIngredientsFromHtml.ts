/**
 * Pull human ingredient lines from common recipe page shapes (JSON-LD Recipe, WP Recipe Maker, microdata).
 */

function cleanIngredientLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function dedupeKeepOrder(lines: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of lines) {
    const s = cleanIngredientLine(raw)
    if (!s || s.length < 2) continue
    const k = s.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(s)
  }
  return out
}

function asStringArray(x: unknown): string[] {
  if (!Array.isArray(x)) return []
  const out: string[] = []
  for (const el of x) {
    if (typeof el === 'string') out.push(el)
    else if (el && typeof el === 'object' && typeof (el as { text?: unknown }).text === 'string') {
      out.push((el as { text: string }).text)
    }
  }
  return out
}

function collectIngredientsFromLdNode(node: unknown, sink: string[]): void {
  if (node == null) return
  if (typeof node === 'string') return
  if (Array.isArray(node)) {
    for (const x of node) collectIngredientsFromLdNode(x, sink)
    return
  }
  if (typeof node !== 'object') return
  const o = node as Record<string, unknown>

  if (o['@graph']) collectIngredientsFromLdNode(o['@graph'], sink)

  const t = o['@type']
  const types: string[] = Array.isArray(t) ? t.map(String) : t != null ? [String(t)] : []
  const isRecipe = types.some((x) => {
    const s = x.toLowerCase()
    return s === 'recipe' || s.endsWith('/recipe')
  })

  if (isRecipe) {
    const ing = o.recipeIngredient
    if (typeof ing === 'string') sink.push(ing)
    else sink.push(...asStringArray(ing))
  }

  if (o.mainEntity) collectIngredientsFromLdNode(o.mainEntity, sink)
  if (o.hasPart) collectIngredientsFromLdNode(o.hasPart, sink)
}

function extractFromJsonLdScripts(html: string): string[] {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  const sink: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim()
    if (!raw) continue
    try {
      const data = JSON.parse(raw) as unknown
      collectIngredientsFromLdNode(data, sink)
    } catch {
      /* ignore malformed blocks */
    }
  }
  return dedupeKeepOrder(sink.map(cleanIngredientLine))
}

function extractFromWprm(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const els = doc.querySelectorAll('.wprm-recipe-ingredient')
  const out: string[] = []
  els.forEach((el) => {
    const q = el.querySelector('.wprm-recipe-ingredient-quantity')?.textContent?.trim() ?? ''
    const u = el.querySelector('.wprm-recipe-ingredient-unit')?.textContent?.trim() ?? ''
    const n = el.querySelector('.wprm-recipe-ingredient-name')?.textContent?.trim() ?? ''
    const line = [q, u, n].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
    if (line) out.push(line)
  })
  return dedupeKeepOrder(out)
}

function extractFromItemprop(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const els = doc.querySelectorAll('[itemprop="recipeIngredient"]')
  const out: string[] = []
  els.forEach((el) => {
    const t = el.textContent?.replace(/\s+/g, ' ').trim()
    if (t) out.push(t)
  })
  return dedupeKeepOrder(out)
}

/** Ordered extractors: first non-empty wins as primary; others only fill gaps if primary empty. */
export function extractIngredientStringsFromHtml(html: string): string[] {
  const fromLd = extractFromJsonLdScripts(html)
  if (fromLd.length > 0) return fromLd
  const wprm = extractFromWprm(html)
  if (wprm.length > 0) return wprm
  return extractFromItemprop(html)
}
