import { generateKeyBetween } from 'fractional-indexing'
import type { ListItemRow } from '../types'

export function comparePosition(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function sortByPosition(items: ListItemRow[]): ListItemRow[] {
  return [...items].sort((x, y) => comparePosition(x.position, y.position))
}

export function keyAfterLast(positions: string[]): string {
  const last = positions.length ? positions[positions.length - 1] : null
  return generateKeyBetween(last, null)
}

/** Compute a new fractional key for the item moved from `fromIndex` to `toIndex` within a sorted list. */
export function keyAfterReorder(
  sortedAsc: ListItemRow[],
  fromIndex: number,
  toIndex: number,
): string {
  const arr = [...sortedAsc]
  const [removed] = arr.splice(fromIndex, 1)
  arr.splice(toIndex, 0, removed)
  const prev = arr[toIndex - 1]?.position ?? null
  const next = arr[toIndex + 1]?.position ?? null
  return generateKeyBetween(prev, next)
}
