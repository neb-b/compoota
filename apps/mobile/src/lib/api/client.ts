import type { ActivityStep, Connection, MessageMedia, PendingMedia } from '../../types'
import { parseMediaItems } from '../../features/media/model'

export type RequestOptions = RequestInit & {
  connection?: Connection | null
  timeoutMs?: number
}

export class ApiError extends Error {
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function normalizeServerUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) {
    throw new Error('Enter the house-server URL.')
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('Enter a valid http:// or https:// server URL.')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Use an http:// or https:// server URL.')
  }

  return url.toString().replace(/\/+$/, '')
}

export async function readError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string }
    return data.error || `Request failed with status ${response.status}.`
  } catch {
    return `Request failed with status ${response.status}.`
  }
}

export async function request(pathOrUrl: string, options: RequestOptions = {}): Promise<Response> {
  const { connection, timeoutMs = 12000, headers, ...init } = options
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const url = pathOrUrl.startsWith('http')
    ? pathOrUrl
    : `${connection?.serverUrl ?? ''}${pathOrUrl}`

  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        ...(connection ? { Authorization: `Bearer ${connection.deviceToken}` } : null),
        ...headers,
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new ApiError(await readError(response), response.status)
    }

    return response
  } finally {
    clearTimeout(timeout)
  }
}

export async function requestJson<T>(pathOrUrl: string, options: RequestOptions = {}): Promise<T> {
  const response = await request(pathOrUrl, options)
  return (await response.json()) as T
}

function parseSseBlock(block: string): { event: string; data: unknown } | null {
  const lines = block.split(/\r?\n/)
  let event = 'message'
  const dataLines: string[] = []

  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart())
    }
  }

  if (dataLines.length === 0) {
    return null
  }

  try {
    return { event, data: JSON.parse(dataLines.join('\n')) as unknown }
  } catch {
    return null
  }
}

export function streamCommandRequest({
  connection,
  text,
  media,
  onMediaStored,
  onActivity,
  onReply,
}: {
  connection: Connection
  text: string
  media?: PendingMedia[]
  onMediaStored?: (media: MessageMedia[]) => void
  onActivity: (step: ActivityStep) => void
  onReply: (reply: string, activity?: ActivityStep[], media?: MessageMedia[]) => void
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let cursor = 0
    let settled = false
    let streamBuffer = ''

    function fail(error: Error) {
      if (settled) {
        return
      }
      settled = true
      reject(error)
    }

    function consume(final = false) {
      const chunk = xhr.responseText.slice(cursor)
      cursor = xhr.responseText.length
      streamBuffer += chunk
      if (final && streamBuffer.trim()) {
        streamBuffer += '\n\n'
      }
      const blocks = streamBuffer.split(/\n\n/)
      streamBuffer = final ? '' : (blocks.pop() ?? '')

      for (const block of blocks) {
        const parsed = parseSseBlock(block)
        if (!parsed) {
          continue
        }

        if (parsed.event === 'activity') {
          onActivity(parsed.data as ActivityStep)
        } else if (parsed.event === 'media') {
          const data = parsed.data as { media?: unknown }
          const storedMedia = parseMediaItems(data.media)
          if (storedMedia.length > 0) {
            onMediaStored?.(storedMedia)
          }
        } else if (parsed.event === 'reply') {
          const data = parsed.data as { reply?: string; activity?: ActivityStep[]; media?: unknown }
          const replyMedia = parseMediaItems(data.media)
          onReply(data.reply || '', Array.isArray(data.activity) ? data.activity : undefined, replyMedia)
        } else if (parsed.event === 'error') {
          fail(new Error('Command failed.'))
        }
      }
    }

    xhr.open('POST', `${connection.serverUrl}/command/stream`)
    xhr.timeout = 180000
    xhr.setRequestHeader('Authorization', `Bearer ${connection.deviceToken}`)
    xhr.setRequestHeader('Content-Type', 'application/json')
    xhr.onreadystatechange = () => {
      if (xhr.readyState === 3) {
        consume()
      }
    }
    xhr.onload = () => {
      consume(true)

      if (settled) {
        return
      }

      if (xhr.status === 401) {
        fail(new Error('This device is unauthorized or revoked. Reset and pair again.'))
        return
      }

      if (xhr.status < 200 || xhr.status >= 300) {
        fail(new Error(`Command failed with status ${xhr.status}.`))
        return
      }

      settled = true
      resolve()
    }
    xhr.onerror = () => fail(new Error('Server unreachable. Check the URL and LAN connection.'))
    xhr.ontimeout = () => fail(new Error('compoota is taking too long to respond. Try again in a moment.'))
    xhr.send(
      JSON.stringify({
        text,
        media: media?.map((item) => ({
          base64: item.base64,
          mimeType: item.mimeType,
          fileName: item.fileName,
        })),
      }),
    )
  })
}

export function userFacingError(err: unknown, fallback: string): string {
  if (err instanceof TypeError) {
    return 'Server unreachable. Check the URL and network connection.'
  }
  if (err instanceof Error && err.name === 'AbortError') {
    return 'Server did not respond. Check that this device can reach the house-server.'
  }
  return err instanceof Error ? err.message : fallback
}
