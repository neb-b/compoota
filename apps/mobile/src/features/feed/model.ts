import type { FeedFeedback, FeedItem, FeedPreferences, FeedRun } from '../../types'

export function parseFeedItems(value: unknown): FeedItem[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const feedItem = item as Record<string, unknown>
      const feedback: FeedFeedback =
        feedItem.feedback === 'like' ||
        feedItem.feedback === 'dislike' ||
        feedItem.feedback === 'hide' ||
        feedItem.feedback === 'save'
          ? feedItem.feedback
          : null

      return {
        id: typeof feedItem.id === 'string' ? feedItem.id : '',
        title: typeof feedItem.title === 'string' ? feedItem.title : '',
        summary: typeof feedItem.summary === 'string' ? feedItem.summary : '',
        category: typeof feedItem.category === 'string' ? feedItem.category : '',
        startsAt: typeof feedItem.startsAt === 'string' ? feedItem.startsAt : '',
        endsAt: typeof feedItem.endsAt === 'string' ? feedItem.endsAt : null,
        allDay: typeof feedItem.allDay === 'boolean' ? feedItem.allDay : false,
        venue: typeof feedItem.venue === 'string' ? feedItem.venue : '',
        area: typeof feedItem.area === 'string' ? feedItem.area : '',
        sourceUrl: typeof feedItem.sourceUrl === 'string' ? feedItem.sourceUrl : '',
        imageUrl: typeof feedItem.imageUrl === 'string' ? feedItem.imageUrl : null,
        priceText: typeof feedItem.priceText === 'string' ? feedItem.priceText : null,
        reason: typeof feedItem.reason === 'string' ? feedItem.reason : '',
        score: typeof feedItem.score === 'number' ? feedItem.score : 0,
        distanceMiles: typeof feedItem.distanceMiles === 'number' ? feedItem.distanceMiles : null,
        feedback,
        createdAt: typeof feedItem.createdAt === 'string' ? feedItem.createdAt : '',
        updatedAt: typeof feedItem.updatedAt === 'string' ? feedItem.updatedAt : '',
      }
    })
    .filter((item) => item.id && item.title && item.startsAt)
}

export function parseFeedPreferences(value: unknown): FeedPreferences | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  if (typeof record.homeLocation !== 'string' || typeof record.radiusMiles !== 'number') {
    return null
  }

  return {
    homeLocation: record.homeLocation,
    radiusMiles: record.radiusMiles,
    likedSignals: Array.isArray(record.likedSignals)
      ? record.likedSignals.filter((item): item is string => typeof item === 'string')
      : [],
    dislikedSignals: Array.isArray(record.dislikedSignals)
      ? record.dislikedSignals.filter((item): item is string => typeof item === 'string')
      : [],
    hiddenCategories: Array.isArray(record.hiddenCategories)
      ? record.hiddenCategories.filter((item): item is string => typeof item === 'string')
      : [],
  }
}

export function parseFeedRun(value: unknown): FeedRun | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || typeof record.status !== 'string') {
    return null
  }

  return {
    id: record.id,
    status: record.status,
    startedAt: typeof record.startedAt === 'string' ? record.startedAt : '',
    finishedAt: typeof record.finishedAt === 'string' ? record.finishedAt : null,
    itemCount: typeof record.itemCount === 'number' ? record.itemCount : 0,
    errorMessage: typeof record.errorMessage === 'string' ? record.errorMessage : null,
  }
}

export function formatFeedDate(item: FeedItem): string {
  const start = new Date(item.startsAt)
  if (Number.isNaN(start.getTime())) {
    return item.startsAt
  }

  const dateFormat = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  const timeFormat = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })

  if (item.allDay) {
    return dateFormat.format(start)
  }

  if (item.endsAt) {
    const end = new Date(item.endsAt)
    if (!Number.isNaN(end.getTime())) {
      const startDate = dateFormat.format(start)
      const endDate = dateFormat.format(end)
      const startTime = timeFormat.format(start)
      const endTime = timeFormat.format(end)
      return startDate === endDate
        ? `${startDate}, ${startTime} - ${endTime}`
        : `${startDate}, ${startTime} - ${endDate}, ${endTime}`
    }
  }

  return `${dateFormat.format(start)} at ${timeFormat.format(start)}`
}

export function formatFeedMeta(item: FeedItem): string {
  return [item.venue, item.area].filter(Boolean).join(' · ')
}

export function canOpenFeedItem(item: FeedItem): boolean {
  return item.sourceUrl.startsWith('http://') || item.sourceUrl.startsWith('https://')
}

export function isPersonalFeedItem(item: FeedItem): boolean {
  return item.category === 'personal' || item.sourceUrl.startsWith('compoota://personal-event/')
}

export function isSavedFeedItem(item: FeedItem): boolean {
  return item.feedback === 'save' || isPersonalFeedItem(item)
}

export function combineEventDateTime(dateValue: Date, timeValue: Date, includesTime: boolean): string {
  const next = new Date(dateValue)
  if (includesTime) {
    next.setHours(timeValue.getHours(), timeValue.getMinutes(), 0, 0)
  } else {
    next.setHours(12, 0, 0, 0)
  }
  return next.toISOString()
}

export function sortFeedItems(items: FeedItem[]): FeedItem[] {
  return [...items].sort(
    (left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime(),
  )
}
