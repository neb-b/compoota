import DateTimePicker from '@react-native-community/datetimepicker'
import { useRouter } from 'expo-router'
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
import { useCreateFeedEventMutation } from '../../features/feed/api'
import { combineEventDateTime } from '../../features/feed/model'
import { AppleIcon } from '../ui'

const BLUE_50 = '#eff6ff'
const BLUE_100 = '#dbeafe'
const BLUE_500 = '#3b82f6'
const BLUE_600 = '#2563eb'
const BLUE_950 = '#172554'
const SCREEN = '#111111'
const SURFACE = '#1f1f1f'
const SURFACE_RAISED = '#262626'
const BORDER = 'rgba(255,255,255,0.12)'
const TEXT = '#f8fafc'
const MUTED = '#a1a1aa'
const SUBTLE = '#71717a'
const ERROR = '#f87171'

export function NewEventScreen() {
  const auth = useAuth()
  const router = useRouter()
  const createFeedEventMutation = useCreateFeedEventMutation(auth.connection)

  const [text, setText] = React.useState('')
  const [date, setDate] = React.useState(() => defaultStartDate())
  const [durationDays, setDurationDays] = React.useState(1)
  const [remind, setRemind] = React.useState(false)
  const [error, setError] = React.useState('')

  async function saveEvent() {
    const trimmedText = text.trim()
    if (!trimmedText || createFeedEventMutation.isPending) {
      return
    }

    setError('')
    try {
      const startsAt = combineEventDateTime(date, date, false)
      const endsAt =
        durationDays > 1
          ? combineEventDateTime(addDays(date, durationDays - 1), date, false)
          : null

      await createFeedEventMutation.mutateAsync({
        startsAt,
        endsAt,
        allDay: true,
        text: trimmedText,
        remindOneWeekBefore: remind,
      })
      if (router.canGoBack()) {
        router.back()
      } else {
        router.replace('/')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Event could not be saved.')
    }
  }

  const saveDisabled = !text.trim() || createFeedEventMutation.isPending

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
            <Text style={styles.title}>New event</Text>
            <Text style={styles.subtitle}>Quickly add something to the timeline.</Text>
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

            <View style={styles.calendarBlock}>
              <Text style={styles.calendarLabel}>Start date</Text>
              <DateTimePicker
                accentColor={BLUE_500}
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                minimumDate={new Date()}
                mode="date"
                onChange={(_event, selectedDate) => {
                  if (selectedDate) {
                    setDate(selectedDate)
                  }
                }}
                textColor={TEXT}
                themeVariant="dark"
                value={date}
              />
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Duration</Text>
            <View style={styles.durationSelector}>
              {[1, 2, 3, 4, 5].map((dayCount) => (
                <Pressable
                  accessibilityLabel={`${dayCount} ${dayCount === 1 ? 'day' : 'days'}`}
                  key={dayCount}
                  onPress={() => setDurationDays(dayCount)}
                  style={[
                    styles.durationButton,
                    durationDays === dayCount ? styles.durationButtonActive : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.durationButtonText,
                      durationDays === dayCount ? styles.durationButtonTextActive : null,
                    ]}
                  >
                    {dayCount}
                  </Text>
                </Pressable>
              ))}
            </View>
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
              {createFeedEventMutation.isPending ? 'Saving...' : 'Save event'}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function ToggleRow({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.toggleRow}>
      <View style={[styles.checkbox, active ? styles.checkboxActive : null]}>
        {active ? <AppleIcon color={BLUE_950} name="checkmark" size={15} /> : null}
      </View>
      <Text style={styles.toggleText}>{label}</Text>
    </Pressable>
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

const styles = StyleSheet.create({
  calendarBlock: {
    gap: 6,
  },
  calendarLabel: {
    color: MUTED,
    fontSize: 13,
    fontWeight: '700',
  },
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
    backgroundColor: BLUE_100,
    borderColor: BLUE_100,
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
  durationButton: {
    alignItems: 'center',
    borderRadius: 13,
    flex: 1,
    minHeight: 42,
    justifyContent: 'center',
  },
  durationButtonActive: {
    backgroundColor: BLUE_500,
  },
  durationButtonText: {
    color: MUTED,
    fontSize: 16,
    fontWeight: '800',
  },
  durationButtonTextActive: {
    color: BLUE_50,
  },
  durationSelector: {
    backgroundColor: SURFACE,
    borderColor: BORDER,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 3,
    padding: 4,
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
  saveButton: {
    alignItems: 'center',
    backgroundColor: BLUE_500,
    borderRadius: 16,
    minHeight: 56,
    justifyContent: 'center',
    shadowColor: BLUE_600,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
  },
  saveButtonDisabled: {
    opacity: 0.46,
    shadowOpacity: 0,
  },
  saveButtonText: {
    color: BLUE_50,
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
})
