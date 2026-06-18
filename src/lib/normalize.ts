export function fingerprintFromText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
}

const STOPWORDS = new Set(['the', 'and', 'or', 'a', 'an', 'to', 'of', 'for'])

/**
 * True when a recipe ingredient line and a list line are plausibly the same product
 * (e.g. "garlic" vs "garlic cloves") — used for "already on the list" in recipe import.
 */
export function ingredientLikelyMatch(recipeLine: string, listLine: string): boolean {
  const a = fingerprintFromText(recipeLine)
  const b = fingerprintFromText(listLine)
  if (a === b) return true
  const ca = a.replace(/\s+/g, '')
  const cb = b.replace(/\s+/g, '')
  if (ca.length >= 3 && cb.length >= 3 && (ca.includes(cb) || cb.includes(ca))) return true

  const wa = new Set(
    a
      .split(' ')
      .map((w) => w.trim())
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  )
  const wb = new Set(
    b
      .split(' ')
      .map((w) => w.trim())
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  )
  if (wa.size === 0 || wb.size === 0) return false
  let inter = 0
  for (const w of wa) {
    if (wb.has(w)) inter++
  }
  const union = wa.size + wb.size - inter
  return union > 0 && inter / union >= 0.45
}
