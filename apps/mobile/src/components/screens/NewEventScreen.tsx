import { useLocalSearchParams, useRouter } from 'expo-router'
import React from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useAuth } from '../../features/auth/AuthProvider'
import { useCreateFeedEventMutation, useUpdateFeedEventMutation } from '../../features/feed/api'
import { combineEventDateTime } from '../../features/feed/model'
import { AppleIcon } from '../ui'

const TAUPE_50 = '#fbfaf9'
const TAUPE_100 = '#f3f1f1'
const TAUPE_300 = '#d8d2d0'
const TAUPE_700 = '#473c39'
const TAUPE_800 = '#2b2422'
const TAUPE_900 = '#1d1816'
const TAUPE_950 = '#0c0a09'
const SCREEN = TAUPE_950
const SURFACE = TAUPE_900
const SURFACE_RAISED = TAUPE_800
const BORDER = 'rgba(251,250,249,0.12)'
const TEXT = TAUPE_50
const MUTED = TAUPE_300
const SUBTLE = '#aba09c'
const ERROR = '#f87171'

export function NewEventScreen() {
  const auth = useAuth()
  const router = useRouter()
  const params = useLocalSearchParams<{
    eventId?: string | string[]
    text?: string | string[]
    startsAt?: string | string[]
    endsAt?: string | string[]
  }>()
  const eventId = firstParam(params.eventId)
  const editing = Boolean(eventId)
  const createFeedEventMutation = useCreateFeedEventMutation(auth.connection)
  const updateFeedEventMutation = useUpdateFeedEventMutation(auth.connection)

  const [text, setText] = React.useState(() => firstParam(params.text))
  const [startDate, setStartDate] = React.useState(() => initialEventDate(firstParam(params.startsAt)))
  const [endDate, setEndDate] = React.useState<Date | null>(() => initialEventEndDate(firstParam(params.endsAt)))
  const [remind, setRemind] = React.useState(false)
  const [error, setError] = React.useState('')
  const saving = createFeedEventMutation.isPending || updateFeedEventMutation.isPending

  function selectDate(nextDate: Date) {
    if (!endDate && !sameDay(startDate, nextDate)) {
      if (nextDate < startDate) {
        setEndDate(startDate)
        setStartDate(nextDate)
      } else {
        setEndDate(nextDate)
      }
      return
    }

    setStartDate(nextDate)
    setEndDate(null)
  }

  async function saveEvent() {
    const trimmedText = text.trim()
    if (!trimmedText || saving) {
      return
    }

    setError('')
    try {
      const startsAt = combineEventDateTime(startDate, startDate, false)
      const endsAt = endDate && !sameDay(startDate, endDate)
        ? combineEventDateTime(endDate, endDate, false)
        : null

      const body = {
        startsAt,
        endsAt,
        allDay: true,
        text: trimmedText,
        remindOneWeekBefore: remind,
      }

      if (eventId) {
        await updateFeedEventMutation.mutateAsync({ itemId: eventId, ...body })
      } else {
        await createFeedEventMutation.mutateAsync(body)
      }
      if (router.canGoBack()) {
        router.back()
      } else {
        router.replace('/')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : editing ? 'Event could not be updated.' : 'Event could not be saved.')
    }
  }

  const saveDisabled = !text.trim() || saving

  return (
    <SafeAreaView edges={['bottom']} style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Text style={styles.title}>{editing ? 'Edit event' : 'New event'}</Text>
            <Text style={styles.subtitle}>
              {editing ? 'Update this personal event on the timeline.' : 'Quickly add something to the timeline.'}
            </Text>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Event</Text>
            <TextInput
              autoCapitalize="sentences"
              autoFocus
              multiline
              onChangeText={setText}
              placeholder="What is happening?"
              placeholderTextColor={SUBTLE}
              returnKeyType="done"
              style={styles.eventInput}
              value={text}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>When</Text>

            <DateRangeCalendar
              endDate={endDate}
              onSelectDate={selectDate}
              startDate={startDate}
            />
          </View>

          <View style={styles.fieldGroup}>
            <ToggleRow
              active={remind}
              label="Remind everyone 1 week before"
              onPress={() => setRemind((current) => !current)}
            />
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            accessibilityLabel="Save event"
            disabled={saveDisabled}
            onPress={saveEvent}
            style={[styles.saveButton, saveDisabled ? styles.saveButtonDisabled : null]}
          >
            <Text style={styles.saveButtonText}>
              {saving ? 'Saving...' : editing ? 'Update event' : 'Save event'}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function initialEventDate(value: string) {
  const parsed = value ? new Date(value) : null
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : defaultStartDate()
}

function initialEventEndDate(value: string) {
  const parsed = value ? new Date(value) : null
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null
}

function startOfDay(value: Date) {
  const next = new Date(value)
  next.setHours(0, 0, 0, 0)
  return next
}

function startOfMonth(value: Date) {
  const next = startOfDay(value)
  next.setDate(1)
  return next
}

function ToggleRow({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.toggleRow}>
      <View style={[styles.checkbox, active ? styles.checkboxActive : null]}>
        {active ? <AppleIcon color={TAUPE_950} name="checkmark" size={15} /> : null}
      </View>
      <Text style={styles.toggleText}>{label}</Text>
    </Pressable>
  )
}

function DateRangeCalendar({
  endDate,
  onSelectDate,
  startDate,
}: {
  endDate: Date | null
  onSelectDate: (date: Date) => void
  startDate: Date
}) {
  const [visibleMonth, setVisibleMonth] = React.useState(() => startOfMonth(startDate))
  const days = React.useMemo(() => calendarDaysForMonth(visibleMonth), [visibleMonth])
  const today = startOfDay(new Date())
  const selectedStartDay = startOfDay(startDate)
  const selectedEndDay = endDate ? startOfDay(endDate) : null

  function moveMonth(months: number) {
    setVisibleMonth((current) => addMonths(current, months))
  }

  return (
    <View style={styles.rangeCalendar}>
      <View style={styles.rangeCalendarHeader}>
        <Pressable
          accessibilityLabel="Previous month"
          onPress={() => moveMonth(-1)}
          style={styles.monthButton}
        >
          <AppleIcon color={TEXT} name="chevron.left" size={16} />
        </Pressable>
        <Text style={styles.rangeCalendarTitle}>
          {new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(visibleMonth)}
        </Text>
        <Pressable
          accessibilityLabel="Next month"
          onPress={() => moveMonth(1)}
          style={styles.monthButton}
        >
          <AppleIcon color={TEXT} name="chevron.right" size={16} />
        </Pressable>
      </View>

      <View style={styles.weekdayRow}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
          <Text key={`${day}-${index}`} style={styles.weekdayText}>
            {day}
          </Text>
        ))}
      </View>

      <View style={styles.calendarGrid}>
        {days.map((day) => {
          const disabled = day.date < today
          const selectedStart = sameDay(day.date, startDate)
          const selectedEnd = endDate ? sameDay(day.date, endDate) : false
          const inRange = selectedEndDay ? day.date >= selectedStartDay && day.date <= selectedEndDay : false
          const active = selectedStart || selectedEnd
          const fillLeft = selectedStart || day.date.getDay() === 0 ? '50%' : 0
          const fillRight = selectedEnd || day.date.getDay() === 6 ? '50%' : 0
          return (
            <View key={day.key} style={styles.rangeDayCell}>
              {inRange ? <View style={[styles.rangeDayFill, { left: fillLeft, right: fillRight }]} /> : null}
              <Pressable
                accessibilityLabel={new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(day.date)}
                disabled={disabled}
                onPress={() => onSelectDate(day.date)}
                style={[
                  styles.rangeDayButton,
                  active ? styles.rangeDayButtonActive : null,
                  !day.inMonth ? styles.rangeDayOutside : null,
                  disabled ? styles.rangeDayDisabled : null,
                ]}
              >
                <Text style={[styles.rangeDayText, active ? styles.rangeDayTextActive : null]}>
                  {day.date.getDate()}
                </Text>
              </Pressable>
            </View>
          )
        })}
      </View>
    </View>
  )
}

function defaultStartDate() {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
  tomorrow.setHours(12, 0, 0, 0)
  return tomorrow
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

function calendarDaysForMonth(month: Date) {
  const start = startOfMonth(month)
  const gridStart = addDays(start, -start.getDay())
  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(gridStart, index)
    return {
      date,
      inMonth: date.getMonth() === month.getMonth(),
      key: `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
    }
  })
}

function sameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}

const styles = StyleSheet.create({
  checkbox: {
    alignItems: 'center',
    borderColor: BORDER,
    borderRadius: 7,
    borderWidth: 1,
    height: 26,
    justifyContent: 'center',
    width: 26,
  },
  checkboxActive: {
    backgroundColor: TAUPE_100,
    borderColor: TAUPE_100,
  },
  content: {
    gap: 22,
    paddingBottom: 36,
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  error: {
    color: ERROR,
    fontSize: 15,
    lineHeight: 21,
  },
  eventInput: {
    backgroundColor: SURFACE_RAISED,
    borderColor: BORDER,
    borderRadius: 18,
    borderWidth: 1,
    color: TEXT,
    fontSize: 18,
    lineHeight: 25,
    minHeight: 116,
    paddingHorizontal: 16,
    paddingVertical: 14,
    textAlignVertical: 'top',
  },
  fieldGroup: {
    gap: 12,
  },
  flex: {
    flex: 1,
  },
  header: {
    gap: 6,
    paddingTop: 2,
  },
  label: {
    color: TEXT,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0,
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  monthButton: {
    alignItems: 'center',
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  rangeCalendar: {
    backgroundColor: SURFACE,
    borderColor: BORDER,
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
    padding: 10,
  },
  rangeCalendarHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  rangeCalendarTitle: {
    color: TEXT,
    fontSize: 17,
    fontWeight: '700',
  },
  rangeDayButton: {
    alignItems: 'center',
    borderRadius: 17,
    height: 34,
    justifyContent: 'center',
    width: 34,
    zIndex: 2,
  },
  rangeDayButtonActive: {
    backgroundColor: TAUPE_300,
  },
  rangeDayCell: {
    alignItems: 'center',
    height: 42,
    justifyContent: 'center',
    position: 'relative',
    width: `${100 / 7}%`,
  },
  rangeDayDisabled: {
    opacity: 0.24,
  },
  rangeDayFill: {
    backgroundColor: 'rgba(216,210,208,0.18)',
    height: 30,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  rangeDayOutside: {
    opacity: 0.34,
  },
  rangeDayText: {
    color: MUTED,
    fontSize: 16,
    fontWeight: '600',
  },
  rangeDayTextActive: {
    color: TAUPE_950,
    fontWeight: '800',
  },
  saveButton: {
    alignItems: 'center',
    backgroundColor: TAUPE_300,
    borderRadius: 16,
    minHeight: 56,
    justifyContent: 'center',
    shadowColor: TAUPE_700,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
  },
  saveButtonDisabled: {
    opacity: 0.46,
    shadowOpacity: 0,
  },
  saveButtonText: {
    color: TAUPE_950,
    fontSize: 17,
    fontWeight: '800',
  },
  screen: {
    backgroundColor: SCREEN,
    flex: 1,
  },
  subtitle: {
    color: MUTED,
    fontSize: 16,
    lineHeight: 22,
  },
  title: {
    color: TEXT,
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 39,
  },
  toggleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 38,
  },
  toggleText: {
    color: TEXT,
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 23,
  },
  weekdayRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  weekdayText: {
    color: SUBTLE,
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
    textAlign: 'center',
  },
})
