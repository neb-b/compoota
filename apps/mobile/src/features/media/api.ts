import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { request, requestJson } from '../../lib/api/client'
import type { Connection, Message, MessageMedia } from '../../types'
import { parseMediaItems } from './model'

export const mediaQueryKey = (connection: Connection | null) => ['media', connection?.deviceId] as const

export function useMediaQuery(connection: Connection | null) {
  return useQuery({
    queryKey: mediaQueryKey(connection),
    enabled: Boolean(connection),
    queryFn: async () =>
      parseMediaItems(
        (
          await requestJson<{ media?: unknown }>('/media', {
            connection,
          })
        ).media,
      ),
  })
}

export function useDeleteMediaMutation(connection: Connection | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (media: MessageMedia) => {
      await request(`/media/${media.id}`, {
        connection,
        method: 'DELETE',
      })
      return media.id
    },
    onSuccess: (deletedId) => {
      queryClient.setQueryData(mediaQueryKey(connection), (current?: MessageMedia[]) =>
        current?.filter((item) => item.id !== deletedId) ?? current,
      )
    },
  })
}

export function removeMediaFromMessages(messages: Message[], deletedId: string): Message[] {
  return messages.map((message) => ({
    ...message,
    media: message.media?.filter((item) => item.id !== deletedId),
  }))
}
