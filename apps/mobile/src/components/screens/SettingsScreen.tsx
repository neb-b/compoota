import AsyncStorage from '@react-native-async-storage/async-storage'
import React, { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

import { loadSettingsData, persistSettings, useAuth } from '../../features/auth/AuthProvider'
import { clearFeed } from '../../features/feed/api'
import { FEED_REFRESH_REQUEST_KEY } from '../../lib/constants'
import { createColors, normalizeThemeColor, type AppColors } from '../../lib/theme'
import type { FeedPreferences } from '../../types'

const DEFAULT_RADIUS_MILES = 45
const COLOR_FIELD_COLUMNS = 18
const COLOR_FIELD_ROWS = 8
const COLOR_FIELD_LIGHT_MAX = 0.76
const COLOR_FIELD_LIGHT_MIN = 0.24

type SettingsScreenProps = {
  bottomInset: number
  colors: AppColors
  onSaved: () => void
}

export function SettingsScreen({ bottomInset, colors, onSaved }: SettingsScreenProps) {
  const auth = useAuth()
  const [locationDraft, setLocationDraft] = useState(auth.homeLocation || 'Saline, MI')
  const [themeDraft, setThemeDraft] = useState(auth.themeColor)
  const [colorPickerOpen, setColorPickerOpen] = useState(false)
  const [originalPreferences, setOriginalPreferences] = useState<FeedPreferences | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const draftColors = React.useMemo(() => createColors(auth.isDark, themeDraft), [auth.isDark, themeDraft])

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!auth.connection) {
        setError('Pair this device before editing settings.')
        setLoading(false)
        return
      }
      try {
        const data = await loadSettingsData(auth.connection)
        if (cancelled) {
          return
        }
        if (data.storedPreferences?.homeLocation) {
          setLocationDraft(data.storedPreferences.homeLocation)
        }
        setThemeDraft(auth.themeColor)
        if (data.feedPreferences) {
          setOriginalPreferences(data.feedPreferences)
          setLocationDraft(data.feedPreferences.homeLocation)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Settings could not be loaded.')
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [auth.connection, auth.themeColor])

  async function saveSettings() {
    if (!auth.connection || saving) {
      return
    }
    const nextLocation = locationDraft.trim() || 'Saline, MI'
    const nextRadius = DEFAULT_RADIUS_MILES
    const nextThemeColor = normalizeThemeColor(themeDraft)
    const changed =
      !originalPreferences ||
      originalPreferences.homeLocation !== nextLocation ||
      originalPreferences.radiusMiles !== nextRadius

    setSaving(true)
    setError('')
    try {
      await persistSettings({
        connection: auth.connection,
        deviceName: auth.deviceName,
        homeLocation: nextLocation,
        radiusMiles: nextRadius,
      })
      auth.setHomeLocation(nextLocation)
      auth.setThemeColor(nextThemeColor)
      if (changed) {
        await clearFeed(auth.connection)
        await AsyncStorage.setItem(
          FEED_REFRESH_REQUEST_KEY,
          JSON.stringify({ homeLocation: nextLocation, radiusMiles: nextRadius, requestedAt: Date.now() }),
        )
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Settings could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function logout() {
    setSaving(true)
    setError('')
    try {
      await auth.resetConnection()
    } catch {
      setError('Logout failed. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
      <ScrollView
        contentContainerStyle={{
          gap: 16,
          paddingBottom: Math.max(bottomInset, 18) + 18,
          paddingHorizontal: 20,
          paddingTop: 88,
        }}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={!colorPickerOpen}
        style={{ flex: 1 }}
      >
        {loading ? (
          <ActivityIndicator color={colors.text} className="mt-8" />
        ) : (
          <>
            <View className="gap-5">
              <Field colors={colors} label="Nearby location">
                <TextInput
                  autoCapitalize="words"
                  autoCorrect={false}
                  onChangeText={setLocationDraft}
                  placeholder="Saline, MI"
                  placeholderTextColor={colors.placeholder}
                  style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]}
                  value={locationDraft}
                />
              </Field>
              <Field colors={colors} label="Theme color">
                <Pressable
                  className="min-h-[54px] flex-row items-center justify-between rounded-2xl px-3.5 active:opacity-70"
                  onPress={() => setColorPickerOpen((open) => !open)}
                  style={{ backgroundColor: colors.input, borderColor: colors.border, borderWidth: 1 }}
                >
                  <View className="flex-row items-center gap-3">
                    <View style={[styles.colorPreview, { backgroundColor: normalizeThemeColor(themeDraft) }]} />
                    <Text className="text-base" style={{ color: colors.text }}>
                      {normalizeThemeColor(themeDraft)}
                    </Text>
                  </View>
                  <Text className="text-[15px]" style={{ color: colors.secondaryText }}>
                    {colorPickerOpen ? 'Close' : 'Change'}
                  </Text>
                </Pressable>
                {colorPickerOpen ? (
                  <ColorPickerPanel
                    colors={colors}
                    draft={themeDraft}
                    onChange={setThemeDraft}
                  />
                ) : null}
              </Field>
            </View>
            {error ? <Text className="text-sm leading-5" style={{ color: colors.error }}>{error}</Text> : null}
            <Pressable
              className="mt-1 h-[54px] items-center justify-center rounded-full active:opacity-60"
              disabled={saving}
              onPress={saveSettings}
              style={{ backgroundColor: draftColors.primary }}
            >
              {saving ? (
                <ActivityIndicator color={draftColors.primaryForeground} />
              ) : (
                <Text className="text-base font-medium" style={{ color: draftColors.primaryForeground }}>
                  Save settings
                </Text>
              )}
            </Pressable>
            <View className="min-h-8 flex-1" />
            {colorPickerOpen ? null : (
              <Pressable className="min-h-[52px] items-center justify-center rounded-full active:opacity-60" onPress={logout}>
                <Text className="text-base font-medium" style={{ color: colors.secondaryText }}>
                  Log out
                </Text>
              </Pressable>
            )}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function Field({ children, colors, label }: { children: React.ReactNode; colors: AppColors; label: string }) {
  return (
    <View className="gap-2">
      <Text className="text-[13px] font-normal" style={{ color: colors.secondaryText }}>
        {label}
      </Text>
      {children}
    </View>
  )
}

function ColorPickerPanel({
  colors,
  draft,
  onChange,
}: {
  colors: AppColors
  draft: string
  onChange: (value: string) => void
}) {
  const normalizedDraft = normalizeThemeColor(draft)
  const pickerColors = createColors(true, normalizedDraft)
  const [fieldSize, setFieldSize] = React.useState({ width: 1, height: 1 })
  const selection = pickerSelectionForColor(normalizedDraft, fieldSize.width, fieldSize.height)
  const panResponder = React.useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onPanResponderGrant: (event) => {
          onChange(colorAtPickerPoint(event.nativeEvent.locationX, event.nativeEvent.locationY, fieldSize.width, fieldSize.height))
        },
        onPanResponderMove: (event) => {
          onChange(colorAtPickerPoint(event.nativeEvent.locationX, event.nativeEvent.locationY, fieldSize.width, fieldSize.height))
        },
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
      }),
    [fieldSize.height, fieldSize.width, onChange],
  )

  return (
    <View className="gap-4 rounded-[18px] p-3.5" style={{ backgroundColor: colors.input, borderColor: colors.border, borderWidth: 1 }}>
      <View
        onLayout={(event) => {
          setFieldSize({
            width: Math.max(1, event.nativeEvent.layout.width),
            height: Math.max(1, event.nativeEvent.layout.height),
          })
        }}
        style={styles.colorField}
      >
        {Array.from({ length: COLOR_FIELD_ROWS }).map((_, row) => (
          <View className="flex-1 flex-row" key={`row-${row}`} pointerEvents="none">
            {Array.from({ length: COLOR_FIELD_COLUMNS }).map((__, column) => (
              <View
                className="flex-1"
                key={`${row}-${column}`}
                style={{ backgroundColor: colorAtPickerCell(column, row) }}
              />
            ))}
          </View>
        ))}
        <View style={StyleSheet.absoluteFill} {...panResponder.panHandlers} />
        <View
          pointerEvents="none"
          style={[
            styles.colorFieldHandle,
            {
              backgroundColor: normalizedDraft,
              borderColor: pickerColors.primaryForeground,
              left: selection.x - 11,
              top: selection.y - 11,
            },
          ]}
        />
      </View>

    </View>
  )
}

function hexToRgb(hex: string) {
  const normalized = normalizeThemeColor(hex).slice(1)
  return {
    r: parseInt(normalized.slice(0, 2), 16) / 255,
    g: parseInt(normalized.slice(2, 4), 16) / 255,
    b: parseInt(normalized.slice(4, 6), 16) / 255,
  }
}

function hexToHsl(hex: string) {
  const { r, g, b } = hexToRgb(hex)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const delta = max - min

  if (delta === 0) {
    return { h: 0, s: 0.6, l }
  }

  const s = delta / (1 - Math.abs(2 * l - 1))
  let h = 0
  if (max === r) {
    h = ((g - b) / delta) % 6
  } else if (max === g) {
    h = (b - r) / delta + 2
  } else {
    h = (r - g) / delta + 4
  }

  return { h: (h * 60 + 360) % 360, s, l }
}

function hslToHex(h: number, s: number, l: number) {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    h < 60 ? [c, x, 0] :
    h < 120 ? [x, c, 0] :
    h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] :
    h < 300 ? [x, 0, c] :
    [c, 0, x]

  return `#${[r, g, b].map((value) => Math.round((value + m) * 255).toString(16).padStart(2, '0')).join('')}`
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function colorAtPickerPoint(x: number, y: number, width: number, height: number) {
  const hue = clamp(x / width, 0, 1) * 360
  const lightness =
    COLOR_FIELD_LIGHT_MAX - clamp(y / height, 0, 1) * (COLOR_FIELD_LIGHT_MAX - COLOR_FIELD_LIGHT_MIN)
  return hslToHex(hue, 0.78, lightness)
}

function colorAtPickerCell(column: number, row: number) {
  const hue = (column / Math.max(1, COLOR_FIELD_COLUMNS - 1)) * 360
  const lightness =
    COLOR_FIELD_LIGHT_MAX -
    (row / Math.max(1, COLOR_FIELD_ROWS - 1)) * (COLOR_FIELD_LIGHT_MAX - COLOR_FIELD_LIGHT_MIN)
  return hslToHex(hue, 0.78, lightness)
}

function pickerSelectionForColor(hex: string, width: number, height: number) {
  const hsl = hexToHsl(hex)
  return {
    x: clamp(hsl.h / 360, 0, 1) * width,
    y:
      clamp((COLOR_FIELD_LIGHT_MAX - hsl.l) / (COLOR_FIELD_LIGHT_MAX - COLOR_FIELD_LIGHT_MIN), 0, 1) *
      height,
  }
}

const styles = StyleSheet.create({
  colorField: {
    borderRadius: 16,
    height: 176,
    overflow: 'hidden',
    position: 'relative',
  },
  colorFieldHandle: {
    borderRadius: 11,
    borderWidth: 2,
    height: 22,
    position: 'absolute',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.36,
    shadowRadius: 6,
    width: 22,
  },
  colorPreview: {
    borderRadius: 12,
    height: 24,
    width: 24,
  },
  input: {
    borderRadius: 16,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 54,
    paddingHorizontal: 14,
    paddingVertical: 0,
    textAlignVertical: 'center',
  },
})
