import type { ImageSourcePropType } from 'react-native'

import type { MessageMedia } from '../../types'

export function mediaImageSource(media: MessageMedia): ImageSourcePropType {
  return { uri: media.remoteUrl }
}

export function parseMediaItems(value: unknown): MessageMedia[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const media = item as Record<string, unknown>
      return {
        id: typeof media.id === 'string' ? media.id : '',
        remoteUrl: typeof media.remoteUrl === 'string' ? media.remoteUrl : '',
        mimeType: typeof media.mimeType === 'string' ? media.mimeType : 'application/octet-stream',
        fileName: typeof media.fileName === 'string' ? media.fileName : undefined,
        byteSize: typeof media.byteSize === 'number' ? media.byteSize : undefined,
        createdAt: typeof media.createdAt === 'string' ? media.createdAt : undefined,
        width: typeof media.width === 'number' ? media.width : undefined,
        height: typeof media.height === 'number' ? media.height : undefined,
      }
    })
    .filter((item) => item.id && item.remoteUrl)
}

export function mergeMediaItems(existing: MessageMedia[], next: MessageMedia[]): MessageMedia[] {
  const byId = new Map(existing.map((item) => [item.id, item]))
  for (const item of next) {
    byId.set(item.id, item)
  }
  return [...byId.values()].sort((left, right) => {
    const leftTime = left.createdAt ? Date.parse(left.createdAt) : 0
    const rightTime = right.createdAt ? Date.parse(right.createdAt) : 0
    return rightTime - leftTime
  })
}
