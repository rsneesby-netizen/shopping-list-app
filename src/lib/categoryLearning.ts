import { inferCategoryKey } from './categories'

/**
 * Pick category for a newly added line item: use a prior manual choice for this
 * list + fingerprint when it still exists on the current store layout; otherwise keyword inference.
 */
export function categoryForNewItem(
  trimmed: string,
  fingerprint: string,
  learnings: Record<string, string>,
  allowedCategoryKeys: string[],
): string {
  const allowed = new Set(allowedCategoryKeys)
  const learned = learnings[fingerprint]
  if (learned && allowed.has(learned)) return learned
  return inferCategoryKey(trimmed, null)
}
