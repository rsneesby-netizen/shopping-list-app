import { useState } from 'react'
import { DEFAULT_STORE_CATEGORY_ROWS } from '../../lib/defaultStoreCategories'
import { getSupabase } from '../../lib/supabase'
import type { StorePresetRow } from '../../types'

function slugFromStoreName(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return (s || 'store').slice(0, 96)
}

function uniqueSlug(base: string, taken: Set<string>): string {
  let s = base
  let n = 2
  while (taken.has(s)) {
    s = `${base}-${n}`
    n += 1
  }
  return s.slice(0, 96)
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'object' && e !== null && 'message' in e) return String((e as { message: unknown }).message)
  return 'Request failed'
}

type Props = {
  presets: StorePresetRow[]
  onClose: () => void
  onCatalogUpdated: () => Promise<void>
  setError: (msg: string | null) => void
}

export function StoresManageModal({ presets, onClose, onCatalogUpdated, setError }: Props) {
  const supabase = getSupabase()
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  async function addStore() {
    const name = newName.trim()
    if (!name) return
    setError(null)
    setBusy(true)
    try {
      const base = slugFromStoreName(name)
      const slug = uniqueSlug(base, new Set(presets.map((p) => p.slug)))
      const { data: created, error: insErr } = await supabase
        .from('store_presets')
        .insert({ slug, name })
        .select('id')
        .single()
      if (insErr) throw insErr
      if (!created?.id) throw new Error('Store was not created.')

      const catRows = DEFAULT_STORE_CATEGORY_ROWS.map((r) => ({
        preset_id: created.id,
        category_key: r.category_key,
        sort_index: r.sort_index,
      }))
      const { error: catErr } = await supabase.from('store_preset_categories').insert(catRows)
      if (catErr) throw catErr

      setNewName('')
      await onCatalogUpdated()
    } catch (e: unknown) {
      setError(errMsg(e) || 'Could not add store')
    } finally {
      setBusy(false)
    }
  }

  async function renameStore(id: string, nextName: string, prevName: string, input: HTMLInputElement) {
    const t = nextName.trim()
    if (t === prevName.trim()) return
    if (!t) {
      setError('Store name cannot be empty.')
      input.value = prevName
      return
    }
    setError(null)
    setBusy(true)
    try {
      const { error } = await supabase.from('store_presets').update({ name: t }).eq('id', id)
      if (error) throw error
      await onCatalogUpdated()
    } catch (e: unknown) {
      setError(errMsg(e) || 'Could not update store')
      input.value = prevName
    } finally {
      setBusy(false)
    }
  }

  async function deleteStore(row: StorePresetRow) {
    if (presets.length <= 1) {
      setError('Add another store before deleting the last one.')
      return
    }
    if (!window.confirm(`Delete store “${row.name}”? Lists using it will have no store until you pick one.`)) return
    setError(null)
    setBusy(true)
    try {
      const { error } = await supabase.rpc('delete_store_preset', { target_id: row.id })
      if (error) throw error
      await onCatalogUpdated()
    } catch (e: unknown) {
      setError(errMsg(e) || 'Could not delete store')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="max-h-[85vh] w-full max-w-md overflow-hidden rounded-t-3xl bg-white shadow-xl dark:bg-slate-900 sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Manage stores</h2>
          <button type="button" className="text-sm text-slate-500" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="px-4 py-2 text-xs text-slate-500">
          Add stores, rename them, or remove ones you do not need. New stores get the default aisle list; customize
          order under “Manage store aisle ordering”.
        </p>

        <div className="max-h-[50vh] overflow-y-auto px-3 pb-2 pt-1">
          <ul className="flex flex-col gap-2">
            {presets.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-2 dark:border-slate-600 dark:bg-slate-900"
              >
                <input
                  key={`${p.id}:${p.name}`}
                  type="text"
                  defaultValue={p.name}
                  disabled={busy}
                  className="min-h-8 min-w-0 flex-1 rounded-[6px] border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none focus:border-slate-400 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-50"
                  aria-label={`Name for ${p.name}`}
                  onBlur={(e) => void renameStore(p.id, e.target.value, p.name, e.target)}
                />
                <button
                  type="button"
                  disabled={busy || presets.length <= 1}
                  className="min-h-8 rounded-[6px] border border-slate-200 px-2 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                  onClick={() => void deleteStore(p)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="border-t border-slate-200 px-3 py-3 dark:border-slate-700">
          <p className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-400">Add store</p>
          <div className="flex gap-2">
            <input
              type="text"
              className="min-h-8 min-w-0 flex-1 rounded-[6px] border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-50"
              placeholder="Store name"
              value={newName}
              disabled={busy}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void addStore()
                }
              }}
            />
            <button
              type="button"
              disabled={busy || !newName.trim()}
              className="min-h-8 shrink-0 rounded-[6px] bg-teal-700 px-3 text-sm font-semibold text-white disabled:opacity-50"
              onClick={() => void addStore()}
            >
              Add
            </button>
          </div>
        </div>

        <div className="border-t border-slate-200 p-4 dark:border-slate-700">
          <button
            type="button"
            className="w-full rounded-xl border border-slate-200 py-3 text-sm font-semibold dark:border-slate-600"
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
