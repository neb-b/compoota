import { useRouter } from 'expo-router'
import React from 'react'
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'

import {
  canOpenFeedItem,
  formatFeedMeta,
  isPersonalFeedItem,
} from '../../features/feed/model'
import type { AppColors } from '../../lib/theme'
import type { FeedItem, FeedView } from '../../types'
import { SIDEBAR_EDGE_HIT_SLOP } from '../AppSidebar'
import { AppleIcon, GlassSurface } from '../ui'

const FEED_MONTH_COLUMN_WIDTH = 38
const FEED_DAY_COLUMN_WIDTH = 66
const FEED_ROW_SAVED_EMERALD = '#34d399'
const FEED_ROW_PERSONAL_VIOLET = '#ddd6fe'

type FeedScreenProps = {
  bottomInset: number
  colors: AppColors
  emptyText: string
  emptyTitle: string
  error: string
  isDark: boolean
  items: FeedItem[]
  liquidGlassEnabled: boolean
  loading: boolean
  onSetFeedView: (view: FeedView) => void
  view: FeedView
}

export function FeedScreen({
  bottomInset,
  colors,
  emptyText,
  emptyTitle,
  error,
  isDark,
  items,
  liquidGlassEnabled,
  loading,
  onSetFeedView,
  view,
}: FeedScreenProps) {
  const pagerRef = React.useRef<ScrollView>(null)
  const { width } = useWindowDimensions()
  const feedSections = React.useMemo(() => groupFeedItemsByMonth(items), [items])
  const viewIndex = view === 'calendar' ? 1 : 0

  React.useEffect(() => {
    pagerRef.current?.scrollTo({ animated: false, x: viewIndex * width, y: 0 })
  }, [viewIndex, width])

  const setPage = React.useCallback(
    (nextView: FeedView) => {
      const nextIndex = nextView === 'calendar' ? 1 : 0
      onSetFeedView(nextView)
      pagerRef.current?.scrollTo({ animated: true, x: nextIndex * width, y: 0 })
    },
    [onSetFeedView, width],
  )

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        bounces={false}
        decelerationRate="fast"
        horizontal
        keyboardShouldPersistTaps="handled"
        onMomentumScrollEnd={(event) => {
          const nextIndex = Math.round(event.nativeEvent.contentOffset.x / Math.max(width, 1))
          onSetFeedView(nextIndex === 1 ? 'calendar' : 'list')
        }}
        pagingEnabled
        ref={pagerRef}
        scrollEventThrottle={16}
        showsHorizontalScrollIndicator={false}
        style={{ flex: 1 }}
      >
        <View style={{ width }}>
          {items.length ? (
            <SectionList
              contentContainerStyle={{
                paddingHorizontal: 18,
                paddingBottom: 110 + bottomInset,
                paddingTop: 74,
              }}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item, index, section }) => (
                <View className="w-full max-w-[560px] self-center flex-row">
                  <View style={{ width: FEED_MONTH_COLUMN_WIDTH }} />
                  <View className="flex-1">
                    <FeedRow
                      colors={colors}
                      item={item}
                      showDivider={!section.isLastSection || index < section.data.length - 1}
                    />
                  </View>
                </View>
              )}
              renderSectionHeader={({ section }) => (
                <View
                  className="w-full max-w-[560px] self-center"
                  pointerEvents="none"
                  style={styles.monthStickyHeader}
                >
                  <View style={[styles.monthStickyLabel, { backgroundColor: colors.background, width: FEED_MONTH_COLUMN_WIDTH }]}>
                    <Text
                      className="text-[13px] font-semibold uppercase leading-[16px]"
                      style={{ color: colors.subtleText }}
                    >
                      {section.label}
                    </Text>
                  </View>
                </View>
              )}
              sections={feedSections}
              stickySectionHeadersEnabled
              style={{ flex: 1 }}
            />
          ) : (
            <EmptyFeedState
              colors={colors}
              emptyText={error || emptyText}
              emptyTitle={error ? 'Feed refresh failed' : emptyTitle}
              loading={loading}
              bottomInset={bottomInset}
            />
          )}
        </View>

        <View style={{ width }}>
          <ScrollView
            contentContainerStyle={{
              paddingHorizontal: 18,
              paddingBottom: 110 + bottomInset,
              paddingTop: 88,
            }}
            keyboardShouldPersistTaps="handled"
            style={{ flex: 1 }}
          >
            {items.length ? (
              <FeedCalendar colors={colors} items={items} />
            ) : (
              <EmptyFeedState
                colors={colors}
                emptyText={error || emptyText}
                emptyTitle={error ? 'Feed refresh failed' : emptyTitle}
                loading={loading}
                bottomInset={bottomInset}
              />
            )}
          </ScrollView>
        </View>
      </ScrollView>

      <View pointerEvents="box-only" style={styles.sidebarEdgePassthrough} />

      <View
        className="absolute left-0 right-0 items-center px-4"
        pointerEvents="box-none"
        style={{ bottom: Math.max(bottomInset, 16) }}
      >
        <GlassSurface
          colorScheme={isDark ? 'dark' : 'light'}
          enabled={liquidGlassEnabled}
          isInteractive
          style={[
            styles.feedPagerDotsGlass,
            {
              backgroundColor: liquidGlassEnabled
                ? 'transparent'
                : isDark
                  ? 'rgba(24,24,24,0.82)'
                  : 'rgba(255,255,255,0.82)',
              borderColor: liquidGlassEnabled
                ? isDark
                  ? 'rgba(255,255,255,0.22)'
                  : 'rgba(255,255,255,0.72)'
                : colors.border,
            },
          ]}
          tintColor={colors.glassTint}
        >
          {(['list', 'calendar'] as const).map((nextView) => (
            <Pressable
              accessibilityLabel={nextView === 'list' ? 'Show event list' : 'Show event calendar'}
              className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
              key={nextView}
              onPress={() => setPage(nextView)}
              style={{
                backgroundColor:
                  view === nextView
                    ? isDark
                      ? 'rgba(255,255,255,0.18)'
                      : 'rgba(0,0,0,0.08)'
                    : 'transparent',
              }}
            >
              <AppleIcon
                color={view === nextView ? colors.text : colors.secondaryText}
                name={nextView === 'list' ? 'list.bullet' : 'calendar'}
                size={17}
                weight={view === nextView ? 'semibold' : 'regular'}
              />
            </Pressable>
          ))}
        </GlassSurface>
      </View>
    </View>
  )
}

function EmptyFeedState({
  bottomInset,
  colors,
  emptyText,
  emptyTitle,
  loading,
}: {
  bottomInset: number
  colors: AppColors
  emptyText: string
  emptyTitle: string
  loading: boolean
}) {
  return (
    <View
      className="items-center justify-center px-8"
      style={{ minHeight: 360, paddingBottom: 110 + bottomInset, paddingTop: 74 }}
    >
      {loading ? <ActivityIndicator color={colors.text} className="mb-3" /> : null}
      <Text className="text-center text-xl font-extrabold" style={{ color: colors.text }}>
        {emptyTitle}
      </Text>
      <Text className="mt-2 text-center text-[15px] leading-[22px]" style={{ color: colors.secondaryText }}>
        {emptyText}
      </Text>
    </View>
  )
}

type FeedMonthSection = {
  data: FeedItem[]
  isLastSection: boolean
  key: string
  label: string
}

function groupFeedItemsByMonth(items: FeedItem[]): FeedMonthSection[] {
  const sectionMap = new Map<string, Omit<FeedMonthSection, 'isLastSection'>>()
  const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'short' })

  for (const item of items) {
    const start = new Date(item.startsAt)
    const key = Number.isNaN(start.getTime())
      ? 'unknown'
      : `${start.getFullYear()}-${String(start.getMonth()).padStart(2, '0')}`
    const label = Number.isNaN(start.getTime()) ? 'Later' : monthFormat.format(start)
    const section = sectionMap.get(key)

    if (section) {
      section.data.push(item)
      continue
    }

    sectionMap.set(key, {
      data: [item],
      key,
      label,
    })
  }

  return Array.from(sectionMap.values()).map((section, index, sections) => ({
    ...section,
    isLastSection: index === sections.length - 1,
  }))
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
                { backgroundColor: colors.primary },
              ]}
            />
          ) : (
            items
              .slice(0, 3)
              .map((item) => (
                <View
                  key={item.id}
                  style={[styles.calendarDot, { backgroundColor: colors.primary }]}
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
                style={{ color: colors.primaryForeground }}
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
  showDivider,
}: {
  colors: AppColors
  item: FeedItem
  showDivider: boolean
}) {
  const router = useRouter()
  const personal = isPersonalFeedItem(item)
  const meta = personal ? '' : formatFeedMeta(item)
  const dayLabel = formatFeedDayRange(item)
  const soonLabel = formatSoonLabel(item)
  const saved = personal || item.feedback === 'save' || item.feedback === 'like'
  const rowBackgroundColor = personal ? 'rgba(0,0,0,0.035)' : colors.background
  const savedTextColor = personal ? FEED_ROW_PERSONAL_VIOLET : FEED_ROW_SAVED_EMERALD
  const rowTextColor = personal ? colors.text : saved ? savedTextColor : colors.text

  return (
    <View
      style={{
        backgroundColor: personal ? rowBackgroundColor : 'transparent',
      }}
    >
      <Pressable
        accessibilityLabel={`Open ${item.title}`}
        accessibilityRole="link"
        className={
          personal ? 'gap-[5px] px-2.5 pt-4 active:opacity-70' : 'gap-[5px] pt-4 active:opacity-70'
        }
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
        style={{
          backgroundColor: rowBackgroundColor,
        }}
      >
        <View className="flex-row items-start">
          <View style={styles.feedDayColumn}>
            {dayLabel ? (
              <Text className="text-[14px] font-normal leading-[19px]" style={{ color: colors.subtleText }}>
                {dayLabel}
              </Text>
            ) : null}
          </View>
          <View
            className="flex-1 gap-[3px] pb-4"
            style={{ borderBottomColor: colors.border, borderBottomWidth: showDivider ? StyleSheet.hairlineWidth : 0 }}
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
            <Text className="text-[14px] font-normal leading-[19px]" style={{ color: rowTextColor }}>
              {item.title}
            </Text>
            {soonLabel ? (
              <Text className="text-[13px] font-normal leading-[18px]" style={{ color: colors.primaryText }}>
                {soonLabel}
              </Text>
            ) : null}
            {meta ? (
              <Text className="text-[13px] font-normal leading-[18px]" style={{ color: colors.secondaryText }}>
                {meta}
              </Text>
            ) : null}
            {item.summary ? (
              <Text className="text-[13px] font-normal leading-[19px]" style={{ color: colors.secondaryText }}>
                {item.summary}
              </Text>
            ) : null}
          </View>
        </View>
      </Pressable>
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
    connectsPrevious: day > start && day.getDay() !== 0,
    connectsNext: day < end && day.getDay() !== 6,
  }
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

function formatFeedDayRange(item: FeedItem) {
  const start = new Date(item.startsAt)
  if (Number.isNaN(start.getTime())) {
    return ''
  }

  const startDay = new Intl.DateTimeFormat(undefined, { day: 'numeric' }).format(start)
  if (!item.endsAt) {
    return startDay
  }

  const end = new Date(item.endsAt)
  if (Number.isNaN(end.getTime()) || dateKey(start) === dateKey(end)) {
    return startDay
  }

  const endDay = new Intl.DateTimeFormat(undefined, { day: 'numeric' }).format(end)
  return `${startDay}-${endDay}`
}

function formatSoonLabel(item: FeedItem) {
  const start = startOfDay(new Date(item.startsAt))
  if (Number.isNaN(start.getTime())) {
    return ''
  }

  const today = startOfDay(new Date())
  const daysAway = Math.round((start.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
  if (daysAway < 0 || daysAway >= 14) {
    return ''
  }
  if (daysAway === 0) {
    return 'today'
  }
  if (daysAway === 1) {
    return 'tomorrow'
  }

  return `${daysAway} days away`
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
    borderRadius: 3.5,
    height: 7,
    width: 7,
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
  feedDayColumn: {
    width: FEED_DAY_COLUMN_WIDTH,
    paddingTop: 1,
    paddingRight: 14,
  },
  feedPagerDotsGlass: {
    width: 88,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#6f6f68',
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: 3,
    overflow: 'hidden',
  },
  monthStickyHeader: {
    height: 44,
    marginBottom: -44,
    zIndex: 4,
  },
  monthStickyLabel: {
    paddingTop: 15,
    paddingBottom: 4,
  },
  sidebarEdgePassthrough: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    top: 82,
    width: SIDEBAR_EDGE_HIT_SLOP,
    zIndex: 3,
  },
})
