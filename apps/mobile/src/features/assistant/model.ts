import type { ActivityStep, Message } from '../../types'

export const PENDING_ACTIVITY: ActivityStep[] = [
  {
    id: 'compoota.server.received.pending',
    label: 'Sending message to the house-server',
    status: 'done',
  },
  {
    id: 'compoota.server.auth.pending',
    label: 'Checking this device',
    status: 'done',
  },
  {
    id: 'compoota.agent.start.pending',
    label: 'Handing it to the local agent',
    detail: 'compoota is passing the request along.',
    status: 'running',
  },
]

export function messageId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function parseMessages(value: string | null): Message[] | null {
  if (!value) {
    return null
  }

  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) {
      return null
    }
    return parsed
      .filter((message) => message && typeof message === 'object')
      .map((message) => {
        const record = message as Record<string, unknown>
        return {
          id: typeof record.id === 'string' ? record.id : messageId(),
          role: record.role === 'assistant' ? 'assistant' : 'user',
          text: typeof record.text === 'string' ? record.text : '',
          media: Array.isArray(record.media) ? (record.media as Message['media']) : undefined,
          activity: Array.isArray(record.activity) ? (record.activity as ActivityStep[]) : undefined,
          isStreaming: false,
        }
      })
  } catch {
    return null
  }
}

export function activitySummary(activity: ActivityStep[], includeRunning = true): string {
  if (activity.some((step) => step.status === 'error')) {
    return 'compoota hit a snag'
  }

  const running = includeRunning
    ? [...activity].reverse().find((step) => step.status === 'running')
    : undefined
  if (running) {
    return running.label
  }

  const latest =
    [...activity].reverse().find((step) => step.status === 'done') ?? activity[activity.length - 1]
  return latest?.label ?? `${activity.length} step${activity.length === 1 ? '' : 's'} completed`
}

export function activityDuration(activity: ActivityStep[]): string | null {
  const times = activity
    .map((step) => (step.at ? Date.parse(step.at) : Number.NaN))
    .filter((time) => Number.isFinite(time))

  if (times.length < 2) {
    return null
  }

  const seconds = Math.max(1, Math.round((Math.max(...times) - Math.min(...times)) / 1000))
  if (seconds < 60) {
    return `${seconds}s`
  }

  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`
}

export function activityStatusText(message: Message): string {
  const activity = message.activity ?? []
  if (message.isStreaming) {
    return activitySummary(activity, true)
  }

  const duration = activityDuration(activity)
  if (duration) {
    return `Worked for ${duration}`
  }

  return activity.some((step) => step.status === 'error') ? 'compoota hit a snag' : 'Worked just now'
}

export function mergeActivity(existing: ActivityStep[] = [], next: ActivityStep): ActivityStep[] {
  const withoutExisting = existing.filter((item) => item.id !== next.id)
  return [...withoutExisting, next]
}
