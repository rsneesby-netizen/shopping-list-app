import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { errorMessage } from '../../lib/errors'
import {
  filterStoreLayouts,
  pickDefaultStoreLayoutId,
  rememberLastStoreLayoutId,
} from '../../lib/storeLayouts'
import { getSupabase } from '../../lib/supabase'
import type { ListRow, StorePresetRow } from '../../types'

export function ListsHomePage() {
  const navigate = useNavigate()
  const [lists, setLists] = useState<ListRow[]>([])
  const [presets, setPresets] = useState<StorePresetRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const supabase = getSupabase()
        const [{ data: listRows, error: listErr }, { data: presetRows, error: presetErr }] =
          await Promise.all([
            supabase.from('lists').select('*').order('created_at', { ascending: false }),
            supabase.from('store_presets').select('*').order('name'),
          ])
        if (listErr) throw listErr
        if (presetErr) throw presetErr
        if (!cancelled) {
          setLists((listRows ?? []) as ListRow[])
          setPresets(filterStoreLayouts((presetRows ?? []) as StorePresetRow[]))
        }
      } catch (e: unknown) {
        if (!cancelled) setError(errorMessage(e, 'Failed to load lists'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  async function createList() {
    setError(null)
    try {
      const supabase = getSupabase()
      const defaultPresetId = pickDefaultStoreLayoutId(presets)
      const { data, error: insErr } = await supabase.rpc('create_list', {
        list_title: 'Shopping list',
        preset_id: defaultPresetId,
      })
      if (insErr) throw insErr
      if (!data?.id) throw new Error('List created but no id returned')
      if (data.store_preset_id) rememberLastStoreLayoutId(data.store_preset_id)
      navigate(`/lists/${data.id}`)
    } catch (e: unknown) {
      setError(errorMessage(e, 'Could not create list'))
    }
  }

  return (
    <div className="mx-auto flex min-h-full max-w-lg flex-col px-4 py-6">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">Your lists</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Open a list or create a new one.</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <button
            type="button"
            className="text-xs text-slate-500 underline"
            onClick={() => void getSupabase().auth.signOut()}
          >
            Sign out
          </button>
          <button
            type="button"
            onClick={() => void createList()}
            className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white shadow-sm"
          >
            New list
          </button>
        </div>
      </header>
      {error && (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
          {error}
        </p>
      )}
      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : lists.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">No lists yet. Tap “New list”.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {lists.map((l) => (
            <li key={l.id}>
              <Link
                to={`/lists/${l.id}`}
                className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-teal-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-teal-700"
              >
                <span className="font-medium text-slate-900 dark:text-slate-50">{l.title}</span>
                <span className="text-xs text-slate-400">Open</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
