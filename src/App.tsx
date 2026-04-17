import type { Session } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthPage } from './features/auth/AuthPage'
import { InvitePage } from './features/invite/InvitePage'
import { ListPage } from './features/list/ListPage'
import { ListsHomePage } from './features/lists/ListsHomePage'
import { getSupabase } from './lib/supabase'

function useSession() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    const supabase = getSupabase()
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
    })
    return () => {
      sub.subscription.unsubscribe()
    }
  }, [])

  return session
}

function ConfigMissing() {
  return (
    <div className="mx-auto max-w-md px-4 py-12 text-center">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">Configure Supabase</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        Copy <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">.env.example</code> to{' '}
        <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">.env</code> and set{' '}
        <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">VITE_SUPABASE_URL</code> and{' '}
        <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">VITE_SUPABASE_ANON_KEY</code>.
      </p>
    </div>
  )
}

function AuthedApp() {
  const session = useSession()

  if (session === undefined) {
    return (
      <div className="flex min-h-full items-center justify-center p-6 text-sm text-slate-600 dark:text-slate-300">
        Loading…
      </div>
    )
  }

  if (!session) {
    return (
      <Routes>
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="/login" element={<AuthPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route path="/" element={<ListsHomePage />} />
      <Route path="/lists/:listId" element={<ListPage />} />
      <Route path="/invite/:token" element={<InvitePage />} />
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  const configured = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)

  return (
    <BrowserRouter>
      <div className="min-h-full bg-slate-50 dark:bg-slate-950">
        {configured ? <AuthedApp /> : <ConfigMissing />}
      </div>
    </BrowserRouter>
  )
}
