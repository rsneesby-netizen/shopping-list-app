import type { SupabaseClient } from '@supabase/supabase-js'

export async function logListItemEvent(
  supabase: SupabaseClient,
  params: {
    listId: string
    itemId: string | null
    eventType: string
    fingerprint: string | null
    payload?: Record<string, unknown>
  },
) {
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id ?? null
  const { error } = await supabase.from('list_item_events').insert({
    list_id: params.listId,
    item_id: params.itemId,
    user_id: userId,
    event_type: params.eventType,
    fingerprint: params.fingerprint,
    payload: params.payload ?? {},
  })
  if (error) console.warn('list_item_events insert failed', error)
}
