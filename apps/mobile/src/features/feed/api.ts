import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { request, requestJson } from '../../lib/api/client'
import type { Connection, FeedFeedback, FeedItem, FeedPreferences, FeedRun } from '../../types'
import { parseFeedItems, parseFeedPreferences, parseFeedRun, sortFeedItems } from './model'

export type FeedPayload = {
  items: FeedItem[]
  preferences: FeedPreferences | null
  run: FeedRun | null
}

export const feedQueryKey = (connection: Connection | null) => ['feed', connection?.deviceId] as const

function parseFeedPayload(data: { items?: unknown; preferences?: unknown; run?: unknown }): FeedPayload {
  return {
    items: parseFeedItems(data.items),
    preferences: parseFeedPreferences(data.preferences),
    run: parseFeedRun(data.run),
  }
}

export function useFeedQuery(connection: Connection | null) {
  return useQuery({
    queryKey: feedQueryKey(connection),
    enabled: Boolean(connection),
    queryFn: async () =>
      parseFeedPayload(
        await requestJson<{ items?: unknown; preferences?: unknown; run?: unknown }>('/feed', {
          connection,
        }),
      ),
  })
}

export function useRefreshFeedMutation(connection: Connection | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () =>
      parseFeedPayload(
        await requestJson<{ items?: unknown; run?: unknown }>('/feed/refresh', {
          connection,
          method: 'POST',
          timeoutMs: 180000,
        }),
      ),
    onSuccess: (payload) => {
      queryClient.setQueryData(feedQueryKey(connection), (current?: FeedPayload) => ({
        ...payload,
        preferences: payload.preferences ?? current?.preferences ?? null,
      }))
    },
  })
}

export function useFeedFeedbackMutation(connection: Connection | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      item,
      value,
    }: {
      item: FeedItem
      value: Exclude<FeedFeedback, null> | 'clear'
    }) => {
      const data = await requestJson<{ item?: unknown }>(`/feed/items/${item.id}/feedback`, {
        connection,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      })
      const [updated] = parseFeedItems(data.item ? [data.item] : [])
      return updated ?? null
    },
    onSuccess: (updated) => {
      if (!updated) {
        return
      }
      queryClient.setQueryData(feedQueryKey(connection), (current?: FeedPayload) =>
        current
          ? {
              ...current,
              items: current.items.map((item) => (item.id === updated.id ? updated : item)),
            }
          : current,
      )
    },
  })
}

export function useCreateFeedEventMutation(connection: Connection | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: {
      startsAt: string
      endsAt?: string | null
      allDay: boolean
      text: string
      remindOneWeekBefore: boolean
    }) => {
      const data = await requestJson<{ items?: unknown; item?: unknown }>('/feed/items', {
        connection,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const items = parseFeedItems(data.items)
      if (items.length) {
        return items
      }
      return parseFeedItems(data.item ? [data.item] : [])
    },
    onSuccess: (items) => {
      if (!items.length) {
        return
      }
      queryClient.setQueryData(feedQueryKey(connection), (current?: FeedPayload) =>
        current
          ? {
              ...current,
              items: items.length > 1 ? items : sortFeedItems([...current.items, items[0]]),
            }
          : { items, preferences: null, run: null },
      )
    },
  })
}

export async function clearFeed(connection: Connection) {
  await request('/feed/clear', {
    connection,
    method: 'POST',
  })
}

export async function saveFeedPreferences(
  connection: Connection,
  preferences: { homeLocation: string; radiusMiles: number },
) {
  return parseFeedPreferences(
    await requestJson('/feed/preferences', {
      connection,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(preferences),
    }),
  )
}

export async function loadFeedPreferences(connection: Connection) {
  return parseFeedPreferences(await requestJson('/feed/preferences', { connection }))
}
