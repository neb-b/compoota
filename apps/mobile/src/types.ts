export type Connection = {
  serverUrl: string
  deviceId: string
  deviceToken: string
}

export type ConnectionPreferences = {
  serverUrl: string
  deviceName: string
  homeLocation?: string
}

export type ActivityStep = {
  id: string
  label: string
  detail?: string
  status: 'pending' | 'running' | 'done' | 'error'
  at?: string
}

export type MessageMedia = {
  id: string
  remoteUrl: string
  mimeType: string
  fileName?: string
  byteSize?: number
  createdAt?: string
  width?: number
  height?: number
}

export type ActiveScreen = 'home' | 'assistant' | 'maintenance' | 'media' | 'settings'

export type Message = {
  id: string
  role: 'user' | 'assistant'
  text: string
  media?: MessageMedia[]
  activity?: ActivityStep[]
  isStreaming?: boolean
}

export type FeedFeedback = 'like' | 'dislike' | 'hide' | 'save' | null

export type FeedPreferences = {
  homeLocation: string
  radiusMiles: number
  likedSignals: string[]
  dislikedSignals: string[]
  hiddenCategories: string[]
}

export type FeedRun = {
  id: string
  status: string
  startedAt: string
  finishedAt: string | null
  itemCount: number
  errorMessage: string | null
}

export type FeedItem = {
  id: string
  title: string
  summary: string
  category: string
  startsAt: string
  endsAt: string | null
  allDay: boolean
  venue: string
  area: string
  sourceUrl: string
  imageUrl: string | null
  priceText: string | null
  reason: string
  score: number
  distanceMiles: number | null
  feedback: FeedFeedback
  createdAt: string
  updatedAt: string
}

export type FeedView = 'list' | 'calendar'
export type AppearanceMode = 'system' | 'dark' | 'light'

export type FeedUndoState = {
  item: FeedItem
  previousFeedback: FeedFeedback
}

export type MaintenanceTask = {
  id: string
  title: string
  cadenceDays: number | null
  nextDueAt: string | null
  lastCompletedAt: string | null
  notes: string
  status: string
}

export type PendingMedia = Omit<MessageMedia, 'remoteUrl'> & {
  uri: string
  base64: string
}
