import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getSupabase } from '../../lib/supabase'

function InviteAcceptContent({ token }: { token: string }) {
  const navigate = useNavigate()
  const [status, setStatus] = useState<'working' | 'done' | 'error'>('working')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function accept() {
      try {
        const supabase = getSupabase()
        const {
          data: { session },
        } = await supabase.auth.getSession()
        if (!session) {
          navigate(`/login?next=${encodeURIComponent(`/invite/${token}`)}`, { replace: true })
          return
        }
        const { data, error } = await supabase.rpc('accept_list_invite', { invite_token: token })
        if (error) throw error
        if (!cancelled) {
          setStatus('done')
          navigate(`/lists/${data as string}`, { replace: true })
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setStatus('error')
          setMessage(e instanceof Error ? e.message : 'Invite could not be accepted')
        }
      }
    }
    void accept()
    return () => {
      cancelled = true
    }
  }, [navigate, token])

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col justify-center px-4 py-10 text-center">
      {status === 'working' && <p className="text-slate-600 dark:text-slate-300">Joining list…</p>}
      {status === 'error' && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-6 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
          <p className="font-semibold">Invite failed</p>
          <p className="mt-2 text-sm">{message}</p>
          <div className="mt-4 flex flex-col gap-2 text-sm">
            <Link className="underline" to="/login">
              Sign in
            </Link>
            <button type="button" className="underline" onClick={() => navigate('/', { replace: true })}>
              Back to lists
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function InvitePage() {
  const { token } = useParams()

  if (!token) {
    return (
      <div className="mx-auto flex min-h-full max-w-md flex-col justify-center px-4 py-10 text-center">
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-6 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
          <p className="font-semibold">Invite failed</p>
          <p className="mt-2 text-sm">Missing invite token</p>
        </div>
      </div>
    )
  }

  return <InviteAcceptContent token={token} />
}
