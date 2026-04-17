type MaybeSupabaseError = {
  message?: string
  details?: string
  hint?: string
  code?: string
}

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const e = error as MaybeSupabaseError
    const parts = [e.message, e.details, e.hint, e.code].filter(Boolean)
    if (parts.length > 0) return parts.join(' | ')
  }
  return fallback
}
