import type { Suggestion } from '../../lib/recommendations'

type Props = {
  open: boolean
  onClose: () => void
  suggestions: Suggestion[]
  onAdd: (s: Suggestion) => void
}

export function RecommendationsDrawer({ open, onClose, suggestions, onAdd }: Props) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/30" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl dark:bg-slate-900 sm:rounded-l-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Recommended</h2>
            <p className="text-xs text-slate-500">Based on what you check off while shopping.</p>
          </div>
          <button type="button" className="text-sm text-slate-500" onClick={onClose}>
            Done
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {suggestions.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-500 dark:border-slate-700">
              Check off items with quantities a few times to build history. We will suggest top-ups here.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {suggestions.map((s) => (
                <li
                  key={s.fingerprint}
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/60"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-slate-900 dark:text-slate-50">{s.displayText}</p>
                      <p className="mt-1 text-xs text-slate-500">{s.reason}</p>
                      <p className="mt-1 text-xs uppercase tracking-wide text-teal-800 dark:text-teal-300">
                        {s.confidence} confidence
                      </p>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 rounded-xl bg-teal-700 px-3 py-2 text-xs font-semibold text-white"
                      onClick={() => onAdd(s)}
                    >
                      Add {s.suggestedQty} {s.unit}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  )
}
