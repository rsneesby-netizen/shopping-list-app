import { useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getSupabase } from '../../lib/supabase'

export function AuthPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setMessage(null)
    setBusy(true)
    try {
      const supabase = getSupabase()
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setMessage('Check your email to confirm the account if required by your Supabase project settings.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        const next = params.get('next')
        navigate(next && next.startsWith('/') ? next : '/', { replace: true })
      }
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col justify-center px-4 py-10">
      <h1 className="mb-1 text-2xl font-semibold text-slate-900 dark:text-slate-50">Grocery list</h1>
      <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">
        Sign in to sync lists in real time with Supabase.
      </p>
      <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <label className="flex flex-col gap-1 text-left text-sm font-medium text-slate-800 dark:text-slate-100">
          Email
          <input
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-base outline-none ring-teal-600 focus:ring-2 dark:border-slate-600 dark:bg-slate-950"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-left text-sm font-medium text-slate-800 dark:text-slate-100">
          Password
          <input
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-base outline-none ring-teal-600 focus:ring-2 dark:border-slate-600 dark:bg-slate-950"
            type="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
        </label>
        {message && (
          <p className="rounded-lg bg-teal-50 px-3 py-2 text-left text-sm text-teal-900 dark:bg-teal-950 dark:text-teal-100">
            {message}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="mt-1 rounded-xl bg-teal-700 px-4 py-3 text-base font-semibold text-white shadow-sm disabled:opacity-60"
        >
          {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
        </button>
        <button
          type="button"
          className="text-sm text-teal-800 underline dark:text-teal-300"
          onClick={() => setMode((m) => (m === 'signup' ? 'signin' : 'signup'))}
        >
          {mode === 'signup' ? 'Already have an account? Sign in' : 'Need an account? Sign up'}
        </button>
      </form>
    </div>
  )
}
