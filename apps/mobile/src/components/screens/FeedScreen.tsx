import { useRouter } from 'expo-router'
import React from 'react'
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'

import {
  canOpenFeedItem,
  formatFeedDate,
  formatFeedMeta,
  isPersonalFeedItem,
} from '../../features/feed/model'
import { PRIMARY_COLOR, PRIMARY_FOREGROUND_COLOR, type AppColors } from '../../lib/theme'
import type { FeedItem, FeedView } from '../../types'
import { AppleIcon } from '../ui'

const FEED_ROW_ACTION_WIDTH = 78
const FEED_ROW_ACTIONS_WIDTH = FEED_ROW_ACTION_WIDTH * 2
const FEED_ROW_SAVED_EMERALD = '#34d399'
const FEED_ROW_PERSONAL_VIOLET = '#ddd6fe'
const FEED_ROW_SPRING = {
  damping: 25,
  mass: 0.9,
  stiffness: 260,
}

type FeedScreenProps = {
  colors: AppColors
  emptyText: string
  emptyTitle: string
  error: string
  items: FeedItem[]
  loading: boolean
  onDismiss: (item: FeedItem) => void
  onSave: (item: FeedItem) => void
  view: FeedView
}

export function FeedScreen({
  colors,
  emptyText,
  emptyTitle,
  error,
  items,
  loading,
  onDismiss,
  onSave,
  view,
}: FeedScreenProps) {
  return (
    <ScrollView
      contentContainerStyle={{
        paddingHorizontal: 18,
        paddingBottom: 24,
        paddingTop: view === 'calendar' ? 88 : 74,
      }}
      keyboardShouldPersistTaps="handled"
      style={{ flex: 1 }}
    >
      {error && !items.length ? (
        <Text className="text-center text-[15px] leading-[22px]" style={{ color: colors.secondaryText }}>
          {error}
        </Text>
      ) : items.length ? (
        view === 'calendar' ? (
          <FeedCalendar colors={colors} items={items} />
        ) : (
          <View className="w-full max-w-[560px] self-center">
            {items.map((item) => (
              <FeedRow
                colors={colors}
                item={item}
                key={item.id}
                onDismiss={() => onDismiss(item)}
                onSave={() => onSave(item)}
              />
            ))}
          </View>
        )
      ) : (
        <View className="min-h-[360px] items-center justify-center px-8">
          {loading ? <ActivityIndicator color={colors.text} className="mb-3" /> : null}
          <Text className="text-center text-xl font-extrabold" style={{ color: colors.text }}>
            {emptyTitle}
          </Text>
          <Text
            className="mt-2 text-center text-[15px] leading-[22px]"
            style={{ color: colors.secondaryText }}
          >
            {emptyText}
          </Text>
        </View>
      )}
    </ScrollView>
  )
}

function FeedCalendar({ colors, items }: { colors: AppColors; items: FeedItem[] }) {
  const months = React.useMemo(() => calendarMonthsForItems(items), [items])
  const itemsKey = React.useMemo(() => items.map((item) => item.id).join('|'), [items])
  const [preview, setPreview] = React.useState<{ date: Date; items: FeedItem[]; weekDay: number } | null>(
    null,
  )

  React.useEffect(() => {
    setPreview(null)
  }, [itemsKey])

  return (
    <View className="w-full max-w-[560px] self-center gap-7">
      {preview ? <Pressable className="absolute inset-0 z-[5]" onPress={() => setPreview(null)} /> : null}
      {preview ? (
        <View style={[styles.calendarScreenPreview, calendarScreenPreviewPosition(preview.weekDay)]}>
          <CalendarPopoverCard colors={colors} date={preview.date} items={preview.items} />
        </View>
      ) : null}
      {months.map((month) => (
        <View className="gap-3" key={month.key}>
          <Text className="text-[22px] font-extrabold" style={{ color: colors.text }}>
            {month.label}
          </Text>
          <View className="flex-row">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
              <Text
                className="flex-1 text-center text-xs font-bold"
                key={`${day}-${index}`}
                style={{ color: colors.subtleText }}
              >
                {day}
              </Text>
            ))}
          </View>
          <View>
            {chunkWeeks(month.days).map((week) => (
              <View className="flex-row" key={week[0]?.key}>
                {week.map((day) => {
                  const dayItems = day.inMonth ? items.filter((item) => isEventOnDate(item, day.date)) : []
                  return (
                    <CalendarDay
                      colors={colors}
                      date={day.date}
                      inMonth={day.inMonth}
                      items={dayItems}
                      key={day.key}
                      rangeSegment={calendarRangeSegment(dayItems, day.date)}
                      onPreview={setPreview}
                      weekDay={day.weekDay}
                    />
                  )
                })}
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  )
}

function CalendarDay({
  colors,
  date,
  inMonth,
  items,
  onPreview,
  rangeSegment,
  weekDay,
}: {
  colors: AppColors
  date: Date
  inMonth: boolean
  items: FeedItem[]
  onPreview: (preview: { date: Date; items: FeedItem[]; weekDay: number }) => void
  rangeSegment: CalendarRangeSegment | null
  weekDay: number
}) {
  const hasItems = items.length > 0

  const cell = (
    <Pressable
      className="h-[58px] items-center justify-center rounded-2xl active:opacity-70"
      disabled={!hasItems}
      onPress={() => onPreview({ date, items, weekDay })}
      style={{ opacity: inMonth ? 1 : 0.22 }}
    >
      <Text
        className="text-[17px] font-semibold"
        style={{ color: hasItems ? colors.text : colors.secondaryText }}
      >
        {date.getDate()}
      </Text>
      <View className="mt-1 h-2.5 flex-row items-center justify-center gap-1">
        {hasItems ? (
          rangeSegment ? (
            <View
              style={[
                styles.calendarRangeSegment,
                rangeSegment.connectsPrevious
                  ? styles.calendarRangeSegmentConnectedLeft
                  : styles.calendarRangeSegmentStart,
                rangeSegment.connectsNext
                  ? styles.calendarRangeSegmentConnectedRight
                  : styles.calendarRangeSegmentEnd,
                { backgroundColor: rangeSegment.color },
              ]}
            />
          ) : (
            items
              .slice(0, 3)
              .map((item) => (
                <View
                  key={item.id}
                  style={[styles.calendarDot, { backgroundColor: calendarItemColor(item) }]}
                />
              ))
          )
        ) : null}
      </View>
    </Pressable>
  )

  return <View style={styles.calendarCell}>{cell}</View>
}

function CalendarPopoverCard({ colors, date, items }: { colors: AppColors; date: Date; items: FeedItem[] }) {
  const router = useRouter()

  return (
    <View style={styles.calendarPopoverCard}>
      <Text className="text-[13px]" style={{ color: colors.secondaryText }}>
        {new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).format(date)}
      </Text>
      <View className="mt-2 gap-3">
        {items.map((item) => {
          const personal = isPersonalFeedItem(item)
          const meta = personal ? '' : formatFeedMeta(item)
          return (
            <Pressable
              className="gap-1 active:opacity-70"
              key={item.id}
              onPress={() => {
                if (personal) {
                  router.push({
                    pathname: '/new-event',
                    params: {
                      eventId: item.id,
                      text: item.title,
                      startsAt: item.startsAt,
                      endsAt: item.endsAt ?? '',
                    },
                  })
                  return
                }
                if (canOpenFeedItem(item)) {
                  Linking.openURL(item.sourceUrl).catch(() => undefined)
                }
              }}
            >
              <Text
                className="text-[16px] font-semibold leading-[20px]"
                numberOfLines={2}
                style={{ color: PRIMARY_FOREGROUND_COLOR }}
              >
                {item.title}
              </Text>
              {item.allDay ? null : (
                <Text className="mt-1 text-[13px] leading-[18px]" style={{ color: colors.secondaryText }}>
                  {formatFeedTime(item)}
                </Text>
              )}
              {meta ? (
                <Text className="text-[13px] leading-[18px]" style={{ color: colors.secondaryText }}>
                  {meta}
                </Text>
              ) : null}
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

function FeedRow({
  colors,
  item,
  onDismiss,
  onSave,
}: {
  colors: AppColors
  item: FeedItem
  onDismiss: () => void
  onSave: () => void
}) {
  const router = useRouter()
  const personal = isPersonalFeedItem(item)
  const meta = personal ? '' : formatFeedMeta(item)
  const proximity = formatFeedProximity(item)
  const saved = personal || item.feedback === 'save' || item.feedback === 'like'
  const rowBackgroundColor = personal ? 'rgba(0,0,0,0.035)' : colors.background
  const savedTextColor = personal ? FEED_ROW_PERSONAL_VIOLET : FEED_ROW_SAVED_EMERALD
  const rowTextColor = personal ? colors.text : saved ? savedTextColor : colors.text
  const rowDateTextColor = colors.secondaryText
  const translateX = useSharedValue(0)
  const gestureStartX = useSharedValue(0)
  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }))
  const actionsStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      -translateX.value,
      [0, FEED_ROW_ACTIONS_WIDTH * 0.45, FEED_ROW_ACTIONS_WIDTH],
      [0, 1, 1],
    ),
  }))

  const closeActions = React.useCallback(() => {
    translateX.value = withSpring(0, FEED_ROW_SPRING)
  }, [translateX])

  const triggerSave = React.useCallback(() => {
    closeActions()
    onSave()
  }, [closeActions, onSave])

  const triggerHide = React.useCallback(() => {
    translateX.value = withSpring(-FEED_ROW_ACTIONS_WIDTH, FEED_ROW_SPRING)
    onDismiss()
  }, [onDismiss, translateX])

  const panGesture = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-10, 10])
    .onBegin(() => {
      gestureStartX.value = translateX.value
    })
    .onUpdate((event) => {
      const nextX = gestureStartX.value + event.translationX
      translateX.value = Math.max(-FEED_ROW_ACTIONS_WIDTH, Math.min(0, nextX))
    })
    .onEnd((event) => {
      const projectedX = translateX.value + event.velocityX * 0.12
      const shouldOpen = projectedX < -FEED_ROW_ACTIONS_WIDTH * 0.42
      translateX.value = withSpring(shouldOpen ? -FEED_ROW_ACTIONS_WIDTH : 0, FEED_ROW_SPRING)
    })

  return (
    <View
      style={{
        backgroundColor: personal ? rowBackgroundColor : 'transparent',
      }}
    >
      <Animated.View
        className="absolute bottom-0 right-0 top-0 flex-row justify-end"
        style={[styles.feedRowActions, actionsStyle]}
      >
        <Pressable
          accessibilityLabel="Save feed item"
          className="items-center justify-center gap-1 active:opacity-85"
          onPress={triggerSave}
          style={[styles.feedRowAction, { backgroundColor: saved ? colors.action : colors.accent }]}
        >
          <AppleIcon color="#ffffff" name={saved ? 'bookmark.fill' : 'bookmark'} size={21} />
          <Text className="text-xs font-semibold" style={{ color: '#ffffff' }}>
            save
          </Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Hide feed item"
          className="items-center justify-center gap-1 active:opacity-85"
          onPress={triggerHide}
          style={[styles.feedRowAction, { backgroundColor: '#ff3b30' }]}
        >
          <AppleIcon color="#ffffff" name="eye.slash" size={21} />
          <Text className="text-xs font-semibold" style={{ color: '#ffffff' }}>
            hide
          </Text>
        </Pressable>
      </Animated.View>

      <GestureDetector gesture={panGesture}>
        <Animated.View style={contentStyle}>
          <Pressable
            accessibilityLabel={`Open ${item.title}`}
            accessibilityRole="link"
            className={
              personal ? 'gap-[5px] px-2.5 pt-4 active:opacity-70' : 'gap-[5px] pt-4 active:opacity-70'
            }
            onPress={() => {
              if (translateX.value < -4) {
                closeActions()
                return
              }
              if (personal) {
                router.push({
                  pathname: '/new-event',
                  params: {
                    eventId: item.id,
                    text: item.title,
                    startsAt: item.startsAt,
                    endsAt: item.endsAt ?? '',
                  },
                })
                return
              }
              if (canOpenFeedItem(item)) {
                Linking.openURL(item.sourceUrl).catch(() => undefined)
              }
            }}
            style={{
              backgroundColor: rowBackgroundColor,
            }}
          >
            {item.imageUrl ? (
              <Image
                accessibilityLabel={item.title}
                className="mb-1 h-[168px] w-full rounded-[10px]"
                resizeMode="cover"
                source={{ uri: item.imageUrl }}
                style={{ backgroundColor: 'rgba(0,0,0,0.06)' }}
              />
            ) : null}
            <View className="flex-row items-start gap-1.5">
              <View className="w-[58px]">
                <Text
                  className="text-[14px] font-normal leading-[19px]"
                  numberOfLines={1}
                  style={{ color: rowDateTextColor }}
                >
                  {formatFeedDate(item)}
                </Text>
              </View>
              <View className="flex-1 gap-[3px] border-b pb-4" style={{ borderBottomColor: colors.border }}>
                {proximity ? (
                  <Text
                    className="text-[14px] font-normal leading-[19px]"
                    style={{ color: colors.subtleText }}
                  >
                    {proximity}
                  </Text>
                ) : null}
                <Text className="text-[14px] font-normal leading-[19px]" style={{ color: rowTextColor }}>
                  {item.title}
                </Text>
              </View>
            </View>
            {meta ? (
              <Text
                className="text-[13px] font-normal leading-[18px]"
                style={{ color: colors.secondaryText }}
              >
                {meta}
              </Text>
            ) : null}
            {item.summary ? (
              <Text
                className="text-[13px] font-normal leading-[19px]"
                style={{ color: colors.secondaryText }}
              >
                {item.summary}
              </Text>
            ) : null}
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </View>
  )
}

function calendarMonthsForItems(items: FeedItem[]) {
  const today = new Date()
  const start = startOfMonth(today)
  const end = addMonths(start, 5)
  const months = []
  let current = start

  while (current <= end) {
    months.push({
      key: monthKey(current),
      label: new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(current),
      days: calendarDaysForMonth(current),
    })
    current = addMonths(current, 1)
  }

  return months
}

function calendarDaysForMonth(month: Date) {
  const first = startOfMonth(month)
  const gridStart = addDays(first, -first.getDay())
  return Array.from({ length: 42 }, (_value, index) => {
    const date = addDays(gridStart, index)
    return {
      date,
      inMonth: date.getMonth() === month.getMonth(),
      key: dateKey(date),
      weekDay: date.getDay(),
    }
  })
}

function chunkWeeks<T>(days: T[]) {
  const weeks = []
  for (let index = 0; index < days.length; index += 7) {
    weeks.push(days.slice(index, index + 7))
  }
  return weeks
}

function isEventOnDate(item: FeedItem, date: Date) {
  const start = startOfDay(new Date(item.startsAt))
  const end = startOfDay(item.endsAt ? new Date(item.endsAt) : new Date(item.startsAt))
  const day = startOfDay(date)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return false
  }
  return day >= start && day <= end
}

function isRangeEvent(item: FeedItem) {
  if (!item.endsAt) {
    return false
  }
  return dateKey(new Date(item.startsAt)) !== dateKey(new Date(item.endsAt))
}

type CalendarRangeSegment = {
  color: string
  connectsNext: boolean
  connectsPrevious: boolean
}

function calendarRangeSegment(items: FeedItem[], date: Date): CalendarRangeSegment | null {
  const item = items.find((candidate) => isRangeEvent(candidate))
  if (!item) {
    return null
  }

  const start = startOfDay(new Date(item.startsAt))
  const end = startOfDay(new Date(item.endsAt ?? item.startsAt))
  const day = startOfDay(date)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null
  }

  return {
    color: calendarItemColor(item),
    connectsPrevious: day > start && day.getDay() !== 0,
    connectsNext: day < end && day.getDay() !== 6,
  }
}

function calendarItemColor(_item: FeedItem) {
  return PRIMARY_COLOR
}

function formatFeedTime(item: FeedItem) {
  const start = new Date(item.startsAt)
  if (Number.isNaN(start.getTime())) {
    return ''
  }

  const timeFormat = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })

  if (item.endsAt) {
    const end = new Date(item.endsAt)
    if (!Number.isNaN(end.getTime()) && dateKey(start) === dateKey(end)) {
      return `${timeFormat.format(start)} - ${timeFormat.format(end)}`
    }
  }

  return timeFormat.format(start)
}

function formatFeedProximity(item: FeedItem) {
  const start = startOfDay(new Date(item.startsAt))
  if (Number.isNaN(start.getTime())) {
    return ''
  }

  const today = startOfDay(new Date())
  const daysAway = Math.round((start.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
  if (daysAway < 0 || daysAway > 30) {
    return ''
  }
  if (daysAway === 0) {
    return 'today'
  }
  if (daysAway < 14) {
    return `${daysAway} ${daysAway === 1 ? 'day' : 'days'} away`
  }

  const weeksAway = Math.ceil(daysAway / 7)
  return `${weeksAway} ${weeksAway === 1 ? 'week' : 'weeks'} away`
}

function calendarScreenPreviewPosition(weekDay: number) {
  if (weekDay >= 5) {
    return styles.calendarScreenPreviewRight
  }
  if (weekDay >= 2) {
    return styles.calendarScreenPreviewCenter
  }
  return styles.calendarScreenPreviewLeft
}

function startOfDay(value: Date) {
  const next = new Date(value)
  next.setHours(0, 0, 0, 0)
  return next
}

function startOfMonth(value: Date) {
  const next = new Date(value)
  next.setDate(1)
  next.setHours(0, 0, 0, 0)
  return next
}

function addDays(value: Date, days: number) {
  const next = new Date(value)
  next.setDate(next.getDate() + days)
  return next
}

function addMonths(value: Date, months: number) {
  const next = new Date(value)
  next.setMonth(next.getMonth() + months)
  return next
}

function monthKey(value: Date) {
  return `${value.getFullYear()}-${value.getMonth()}`
}

function dateKey(value: Date) {
  return `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`
}

const styles = StyleSheet.create({
  calendarCell: {
    flex: 1,
  },
  calendarDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  calendarPopoverCard: {
    backgroundColor: '#18181b',
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 270,
    minWidth: 250,
    padding: 14,
    width: 270,
  },
  calendarRangeSegment: {
    height: 7,
    width: '100%',
  },
  calendarRangeSegmentConnectedLeft: {
    marginLeft: -1,
  },
  calendarRangeSegmentConnectedRight: {
    marginRight: -1,
  },
  calendarRangeSegmentEnd: {
    borderBottomRightRadius: 4,
    borderTopRightRadius: 4,
    marginRight: 10,
  },
  calendarRangeSegmentStart: {
    borderBottomLeftRadius: 4,
    borderTopLeftRadius: 4,
    marginLeft: 10,
  },
  calendarScreenPreview: {
    position: 'absolute',
    top: 116,
    zIndex: 7,
  },
  calendarScreenPreviewCenter: {
    left: '50%',
    transform: [{ translateX: -135 }],
  },
  calendarScreenPreviewLeft: {
    left: 8,
  },
  calendarScreenPreviewRight: {
    right: 8,
  },
  feedRowActions: {
    width: FEED_ROW_ACTIONS_WIDTH,
  },
  feedRowAction: {
    width: FEED_ROW_ACTION_WIDTH,
  },
})
