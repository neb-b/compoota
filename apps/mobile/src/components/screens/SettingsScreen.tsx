import AsyncStorage from '@react-native-async-storage/async-storage'
import React, { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'

import { loadSettingsData, persistSettings, useAuth } from '../../features/auth/AuthProvider'
import { clearFeed } from '../../features/feed/api'
import { FEED_REFRESH_REQUEST_KEY } from '../../lib/constants'
import type { AppColors } from '../../lib/theme'
import type { FeedPreferences } from '../../types'

type SettingsScreenProps = {
  bottomInset: number
  colors: AppColors
  onSaved: () => void
}

export function SettingsScreen({ bottomInset, colors, onSaved }: SettingsScreenProps) {
  const auth = useAuth()
  const [deviceName, setDeviceName] = useState(auth.deviceName)
  const [locationDraft, setLocationDraft] = useState(auth.homeLocation || 'Saline, MI')
  const [radiusDraft, setRadiusDraft] = useState('30')
  const [originalPreferences, setOriginalPreferences] = useState<FeedPreferences | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

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
        setDeviceName(data.storedPreferences?.deviceName || auth.deviceName)
        if (data.storedPreferences?.homeLocation) {
          setLocationDraft(data.storedPreferences.homeLocation)
        }
        if (data.feedPreferences) {
          setOriginalPreferences(data.feedPreferences)
          setLocationDraft(data.feedPreferences.homeLocation)
          setRadiusDraft(String(data.feedPreferences.radiusMiles))
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
  }, [auth.connection, auth.deviceName])

  async function saveSettings() {
    if (!auth.connection || saving) {
      return
    }
    const radiusMiles = Number(radiusDraft)
    if (!Number.isFinite(radiusMiles) || radiusMiles <= 0) {
      setError('Enter a valid radius.')
      return
    }

    const nextLocation = locationDraft.trim() || 'Saline, MI'
    const nextRadius = Math.round(radiusMiles)
    const changed =
      !originalPreferences ||
      originalPreferences.homeLocation !== nextLocation ||
      originalPreferences.radiusMiles !== nextRadius

    setSaving(true)
    setError('')
    try {
      await persistSettings({
        connection: auth.connection,
        deviceName,
        homeLocation: nextLocation,
        radiusMiles: nextRadius,
      })
      auth.setDeviceName(deviceName)
      auth.setHomeLocation(nextLocation)
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
        style={{ flex: 1 }}
      >
        {loading ? (
          <ActivityIndicator color={colors.text} className="mt-8" />
        ) : (
          <>
            <Field colors={colors} label="nearby location">
              <TextInput
                autoCapitalize="words"
                autoCorrect={false}
                className="min-h-[50px] rounded-2xl px-3.5 text-base"
                onChangeText={setLocationDraft}
                placeholder="Saline, MI"
                placeholderTextColor={colors.placeholder}
                style={{ backgroundColor: colors.input, borderColor: colors.border, borderWidth: 1, color: colors.text }}
                value={locationDraft}
              />
            </Field>
            <Field colors={colors} label="radius miles">
              <TextInput
                className="min-h-[50px] rounded-2xl px-3.5 text-base"
                keyboardType="number-pad"
                onChangeText={setRadiusDraft}
                placeholder="30"
                placeholderTextColor={colors.placeholder}
                style={{ backgroundColor: colors.input, borderColor: colors.border, borderWidth: 1, color: colors.text }}
                value={radiusDraft}
              />
            </Field>
            <Field colors={colors} label="device name">
              <TextInput
                autoCapitalize="words"
                className="min-h-[50px] rounded-2xl px-3.5 text-base"
                onChangeText={setDeviceName}
                placeholder="compoota device"
                placeholderTextColor={colors.placeholder}
                style={{ backgroundColor: colors.input, borderColor: colors.border, borderWidth: 1, color: colors.text }}
                value={deviceName}
              />
            </Field>
            {error ? <Text className="text-sm leading-5" style={{ color: colors.error }}>{error}</Text> : null}
            <Pressable
              className="mt-1 h-[54px] items-center justify-center rounded-full active:opacity-60"
              disabled={saving}
              onPress={saveSettings}
              style={{ backgroundColor: colors.action }}
            >
              {saving ? (
                <ActivityIndicator color={colors.actionText} />
              ) : (
                <Text className="text-base font-extrabold" style={{ color: colors.actionText }}>
                  Save settings
                </Text>
              )}
            </Pressable>
            <View className="min-h-8 flex-1" />
            <Pressable className="min-h-[52px] items-center justify-center rounded-full active:opacity-60" onPress={logout}>
              <Text className="text-base font-bold" style={{ color: colors.secondaryText }}>
                Log out
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function Field({ children, colors, label }: { children: React.ReactNode; colors: AppColors; label: string }) {
  return (
    <View className="gap-2">
      <Text className="text-[13px] font-semibold" style={{ color: colors.secondaryText }}>
        {label}
      </Text>
      {children}
    </View>
  )
}
