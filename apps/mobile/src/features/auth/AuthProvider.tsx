import AsyncStorage from '@react-native-async-storage/async-storage'
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Platform } from 'react-native'

import { loadFeedPreferences, saveFeedPreferences } from '../feed/api'
import { parseMessages } from '../assistant/model'
import { normalizeServerUrl, request, requestJson, setUnauthorizedHandler, userFacingError } from '../../lib/api/client'
import {
  APPEARANCE_KEY,
  DEV_DEVICE_ID,
  DEV_DEVICE_NAME,
  DEV_DEVICE_TOKEN,
  DEV_ONBOARDING_LOCATION,
  DEV_SERVER_URL,
  FEED_REFRESH_REQUEST_KEY,
  LOCAL_SERVER_URL,
  PREFERENCES_KEY,
  STORAGE_KEY,
  THEME_COLOR_KEY,
  messageHistoryKey,
} from '../../lib/constants'
import { registerForPushToken } from '../../lib/notifications'
import { PRIMARY_COLOR, normalizeThemeColor } from '../../lib/theme'
import type { AppearanceMode, Connection, ConnectionPreferences, FeedPreferences, Message } from '../../types'

type AuthContextValue = {
  appearanceMode: AppearanceMode
  connection: Connection | null
  deviceName: string
  error: string
  homeLocation: string
  isDark: boolean
  loading: boolean
  pairing: boolean
  pairingCode: string
  serverUrl: string
  setAppearanceMode: (mode: AppearanceMode) => void
  setDeviceName: (value: string) => void
  setError: (value: string) => void
  setHomeLocation: (value: string) => void
  setPairingCode: (value: string) => void
  setServerUrl: (value: string) => void
  setThemeColor: (value: string) => void
  themeColor: string
  initialMessages: Message[]
  pair: () => Promise<FeedPreferences | null>
  persistMessages: (messages: Message[]) => Promise<void>
  resetConnection: () => Promise<void>
  updatePushToken: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function defaultServerUrl(): string {
  return DEV_SERVER_URL || LOCAL_SERVER_URL
}

function parseStoredConnection(value: string | null): Connection | null {
  if (!value) {
    return null
  }
  try {
    const parsed = JSON.parse(value) as Connection
    return parsed.serverUrl && parsed.deviceId && parsed.deviceToken ? parsed : null
  } catch {
    return null
  }
}

function parseStoredPreferences(value: string | null): ConnectionPreferences | null {
  if (!value) {
    return null
  }
  try {
    return JSON.parse(value) as ConnectionPreferences
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const appearanceMode: AppearanceMode = 'dark'
  const isDark = true
  const [connection, setConnection] = useState<Connection | null>(null)
  const [serverUrl, setServerUrl] = useState('')
  const [deviceName, setDeviceName] = useState('')
  const [homeLocation, setHomeLocation] = useState('')
  const [themeColor, setThemeColorState] = useState(PRIMARY_COLOR)
  const [pairingCode, setPairingCode] = useState('')
  const [initialMessages, setInitialMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [pairing, setPairing] = useState(false)
  const [error, setError] = useState('')

  const clearConnection = useCallback(async (message = '') => {
    await Promise.all([
      AsyncStorage.removeItem(STORAGE_KEY),
      AsyncStorage.removeItem(FEED_REFRESH_REQUEST_KEY),
    ])
    setConnection(null)
    setInitialMessages([])
    setError(message)
    setServerUrl((current) => current || (__DEV__ ? defaultServerUrl() : ''))
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearConnection('This device is unauthorized. Connect again to continue.').catch(() => undefined)
    })
    return () => setUnauthorizedHandler(null)
  }, [clearConnection])

  useEffect(() => {
    async function loadSession() {
      try {
        const [storedConnection, storedPreferences, storedThemeColor] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY),
          AsyncStorage.getItem(PREFERENCES_KEY),
          AsyncStorage.getItem(THEME_COLOR_KEY),
        ])

        setThemeColorState(normalizeThemeColor(storedThemeColor))
        const preferences = parseStoredPreferences(storedPreferences)
        if (preferences?.serverUrl) {
          setServerUrl(preferences.serverUrl)
        }
        if (preferences?.deviceName) {
          setDeviceName(preferences.deviceName)
        }
        if (preferences?.homeLocation) {
          setHomeLocation(preferences.homeLocation)
        } else if (__DEV__) {
          setHomeLocation(DEV_ONBOARDING_LOCATION)
        }

        const parsedConnection = parseStoredConnection(storedConnection)
        if (parsedConnection) {
          setConnection(parsedConnection)
          setServerUrl(parsedConnection.serverUrl)
          setInitialMessages(
            parseMessages(await AsyncStorage.getItem(messageHistoryKey(parsedConnection.deviceId))) ?? [],
          )
          return
        }

        if (__DEV__) {
          setServerUrl(defaultServerUrl())
        }

        if (!storedConnection && __DEV__ && DEV_SERVER_URL && DEV_DEVICE_ID && DEV_DEVICE_TOKEN) {
          const nextConnection = {
            serverUrl: normalizeServerUrl(DEV_SERVER_URL),
            deviceId: DEV_DEVICE_ID,
            deviceToken: DEV_DEVICE_TOKEN,
          }
          const nextPreferences = {
            serverUrl: nextConnection.serverUrl,
            deviceName: DEV_DEVICE_NAME,
            homeLocation: DEV_ONBOARDING_LOCATION,
          }
          await Promise.all([
            AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(nextConnection)),
            AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify(nextPreferences)),
          ])
          setConnection(nextConnection)
          setServerUrl(nextConnection.serverUrl)
          setDeviceName(DEV_DEVICE_NAME)
          setInitialMessages([])
        }
      } catch {
        setError('Saved connection could not be loaded. Pair again to continue.')
      } finally {
        setLoading(false)
      }
    }

    loadSession()
  }, [])

  const setAppearanceMode = useCallback((_mode: AppearanceMode) => {
    AsyncStorage.setItem(APPEARANCE_KEY, 'dark').catch(() => undefined)
  }, [])

  const setThemeColor = useCallback((value: string) => {
    const nextColor = normalizeThemeColor(value)
    setThemeColorState(nextColor)
    AsyncStorage.setItem(THEME_COLOR_KEY, nextColor).catch(() => undefined)
  }, [])

  const pair = useCallback(
    async () => {
      setError('')
      setPairing(true)
      try {
        const normalizedUrl = normalizeServerUrl(serverUrl)
        const cleanedName =
          deviceName.trim() ||
          Platform.select({ ios: 'iPhone', android: 'Android', default: 'compoota device' })

        await request(`${normalizedUrl}/health`, { method: 'GET', timeoutMs: 6000 })
        const expoPushToken = await registerForPushToken()
        const cleanedPairingCode = pairingCode.replace(/\D/g, '')
        const data = await requestJson<{ deviceId: string; deviceToken: string }>(`${normalizedUrl}/pair`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pairingCode: cleanedPairingCode,
            deviceName: cleanedName,
            expoPushToken,
          }),
        })

        const nextConnection = {
          serverUrl: normalizedUrl,
          deviceId: data.deviceId,
          deviceToken: data.deviceToken,
        }
        const nextPreferences = {
          serverUrl: normalizedUrl,
          deviceName: cleanedName,
          homeLocation: homeLocation.trim(),
        }
        const initialFeedPreferences = homeLocation.trim()
          ? await saveFeedPreferences(nextConnection, {
              homeLocation: homeLocation.trim(),
              radiusMiles: 45,
            })
          : null

        await Promise.all([
          AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(nextConnection)),
          AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify(nextPreferences)),
        ])
        setConnection(nextConnection)
        setServerUrl(normalizedUrl)
        setDeviceName(cleanedName)
        setPairingCode('')
        setInitialMessages([])
        return initialFeedPreferences
      } catch (err) {
        const message = userFacingError(err, 'Pairing failed.')
        setError(message)
        throw new Error(message)
      } finally {
        setPairing(false)
      }
    },
    [deviceName, homeLocation, pairingCode, serverUrl],
  )

  const persistMessages = useCallback(
    async (messages: Message[]) => {
      if (!connection) {
        return
      }
      await AsyncStorage.setItem(messageHistoryKey(connection.deviceId), JSON.stringify(messages))
    },
    [connection],
  )

  const resetConnection = useCallback(async () => {
    await Promise.all([
      AsyncStorage.removeItem(STORAGE_KEY),
      AsyncStorage.removeItem(PREFERENCES_KEY),
      AsyncStorage.removeItem(FEED_REFRESH_REQUEST_KEY),
      AsyncStorage.removeItem(APPEARANCE_KEY),
      AsyncStorage.removeItem(THEME_COLOR_KEY),
    ])
    setConnection(null)
    setInitialMessages([])
    setError('')
    setDeviceName('')
    setHomeLocation(__DEV__ ? DEV_ONBOARDING_LOCATION : '')
    setThemeColorState(PRIMARY_COLOR)
    setPairingCode('')
    setServerUrl(__DEV__ ? defaultServerUrl() : '')
  }, [])

  const updatePushToken = useCallback(async () => {
    if (!connection) {
      return
    }
    const expoPushToken = await registerForPushToken()
    if (!expoPushToken) {
      return
    }
    try {
      await request('/devices/me/push-token', {
        connection,
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expoPushToken }),
      })
    } catch {
      // Push registration should not block the rest of the app.
    }
  }, [connection])

  const value = useMemo<AuthContextValue>(
    () => ({
      appearanceMode,
      connection,
      deviceName,
      error,
      homeLocation,
      initialMessages,
      isDark,
      loading,
      pair,
      pairing,
      pairingCode,
      persistMessages,
      resetConnection,
      serverUrl,
      setAppearanceMode,
      setDeviceName,
      setError,
      setHomeLocation,
      setPairingCode,
      setServerUrl,
      setThemeColor,
      themeColor,
      updatePushToken,
    }),
    [
      appearanceMode,
      connection,
      deviceName,
      error,
      homeLocation,
      initialMessages,
      isDark,
      loading,
      pair,
      pairing,
      pairingCode,
      persistMessages,
      resetConnection,
      serverUrl,
      setAppearanceMode,
      setThemeColor,
      themeColor,
      updatePushToken,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider.')
  }
  return context
}

export async function loadSettingsData(connection: Connection) {
  const [storedPreferences, feedPreferences] = await Promise.all([
    AsyncStorage.getItem(PREFERENCES_KEY),
    loadFeedPreferences(connection),
  ])
  return {
    storedPreferences: parseStoredPreferences(storedPreferences),
    storedAppearance: 'dark' as AppearanceMode,
    feedPreferences,
  }
}

export async function persistSettings({
  connection,
  deviceName,
  homeLocation,
  radiusMiles,
}: {
  connection: Connection
  deviceName: string
  homeLocation: string
  radiusMiles: number
}) {
  const preferences = await saveFeedPreferences(connection, { homeLocation, radiusMiles })
  const storedPreferences: ConnectionPreferences = {
    serverUrl: connection.serverUrl,
    deviceName,
    homeLocation: preferences?.homeLocation ?? homeLocation,
  }
  await Promise.all([
    AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify(storedPreferences)),
    AsyncStorage.setItem(APPEARANCE_KEY, 'dark'),
  ])
  return preferences
}
