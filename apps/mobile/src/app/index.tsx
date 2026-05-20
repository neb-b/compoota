import AsyncStorage from '@react-native-async-storage/async-storage'
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect'
import * as ImagePicker from 'expo-image-picker'
import { LinearGradient } from 'expo-linear-gradient'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react-native'
import {
  ActivityIndicator,
  Image,
  type ImageSourcePropType,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

type Connection = {
  serverUrl: string
  deviceId: string
  deviceToken: string
}

type ConnectionPreferences = {
  serverUrl: string
  deviceName: string
}

type ActivityStep = {
  id: string
  label: string
  detail?: string
  status: 'pending' | 'running' | 'done' | 'error'
  at?: string
}

type MessageMedia = {
  id: string
  remoteUrl: string
  mimeType: string
  fileName?: string
  byteSize?: number
  createdAt?: string
  width?: number
  height?: number
}

type ActiveScreen = 'home' | 'media'

type Message = {
  id: string
  role: 'user' | 'assistant'
  text: string
  media?: MessageMedia[]
  activity?: ActivityStep[]
  isStreaming?: boolean
}

type PendingMedia = Omit<MessageMedia, 'remoteUrl'> & {
  uri: string
  base64: string
}

type GlassSurfaceProps = {
  children: React.ReactNode
  colorScheme: 'light' | 'dark'
  enabled: boolean
  isInteractive?: boolean
  style: StyleProp<ViewStyle>
  tintColor?: string
}

const STORAGE_KEY = 'compoota.connection.v1'
const PREFERENCES_KEY = 'compoota.connection-preferences.v1'
const MESSAGE_HISTORY_KEY_PREFIX = 'compoota.messages.v1.'
const SIDEBAR_EDGE_HIT_SLOP = 30
const SIDEBAR_LAYER_RADIUS = 58
const SIDEBAR_SPRING = {
  damping: 28,
  mass: 0.9,
  stiffness: 240,
}

const PENDING_ACTIVITY: ActivityStep[] = [
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

function canRenderLiquidGlass(): boolean {
  if (Platform.OS !== 'ios') {
    return false
  }

  try {
    return isGlassEffectAPIAvailable()
  } catch {
    return false
  }
}

function GlassSurface({
  children,
  colorScheme,
  enabled,
  isInteractive,
  style,
  tintColor,
}: GlassSurfaceProps) {
  if (!enabled) {
    return <View style={style}>{children}</View>
  }

  return (
    <GlassView
      colorScheme={colorScheme}
      glassEffectStyle="regular"
      isInteractive={isInteractive}
      style={style}
      tintColor={tintColor}
    >
      {children}
    </GlassView>
  )
}

function normalizeServerUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) {
    throw new Error('Enter the house-server URL.')
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('Enter a valid http:// or https:// server URL.')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Use an http:// or https:// server URL.')
  }

  return url.toString().replace(/\/+$/, '')
}

async function readError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string }
    return data.error || `Request failed with status ${response.status}.`
  } catch {
    return `Request failed with status ${response.status}.`
  }
}

function messageId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function messageHistoryKey(deviceId: string): string {
  return `${MESSAGE_HISTORY_KEY_PREFIX}${deviceId}`
}

function activitySummary(activity: ActivityStep[], includeRunning = true): string {
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

function activityDuration(activity: ActivityStep[]): string | null {
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

function activityStatusText(message: Message): string {
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

function mergeActivity(existing: ActivityStep[] = [], next: ActivityStep): ActivityStep[] {
  const filtered = existing.filter((step) => step.id !== next.id)
  return [...filtered, next]
}

function parseSseBlock(block: string): { event: string; data: unknown } | null {
  let event = 'message'
  const dataLines: string[] = []

  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart())
    }
  }

  if (dataLines.length === 0) {
    return null
  }

  try {
    return { event, data: JSON.parse(dataLines.join('\n')) }
  } catch {
    return null
  }
}

function parseMessages(value: string | null): Message[] | null {
  if (!value) {
    return null
  }

  const parsed = JSON.parse(value) as Message[]
  if (!Array.isArray(parsed)) {
    return null
  }

  const messages = parsed
    .filter(
      (message) =>
        message &&
        typeof message.id === 'string' &&
        typeof message.text === 'string' &&
        (message.role === 'user' || message.role === 'assistant'),
    )
    .map((message) => ({
      ...message,
      media: Array.isArray(message.media)
        ? message.media.filter((item) => typeof item.remoteUrl === 'string' && item.remoteUrl)
        : undefined,
      activity: Array.isArray(message.activity) ? message.activity : undefined,
    }))

  return messages.length > 0 ? messages : null
}

function mediaImageSource(media: MessageMedia): ImageSourcePropType {
  return { uri: media.remoteUrl }
}

function parseMediaItems(
  value: unknown,
): MessageMedia[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item) => {
      if (!item || typeof item !== 'object') {
        return false
      }
      const media = item as { id?: unknown; mimeType?: unknown; remoteUrl?: unknown }
      return (
        typeof media.id === 'string' &&
        typeof media.mimeType === 'string' &&
        typeof media.remoteUrl === 'string' &&
        media.remoteUrl.length > 0
      )
    })
    .map((item) => {
      const media = item as {
        id: string
        mimeType: string
        remoteUrl: string
        fileName?: unknown
        byteSize?: unknown
        createdAt?: unknown
      }

      return {
        id: media.id,
        remoteUrl: media.remoteUrl,
        mimeType: media.mimeType,
        fileName: typeof media.fileName === 'string' ? media.fileName : undefined,
        byteSize: typeof media.byteSize === 'number' ? media.byteSize : undefined,
        createdAt: typeof media.createdAt === 'string' ? media.createdAt : undefined,
      }
    })
}

function mergeMediaItems(existing: MessageMedia[], next: MessageMedia[]): MessageMedia[] {
  const byId = new Map<string, MessageMedia>()
  for (const item of [...next, ...existing]) {
    byId.set(item.id, item)
  }
  return [...byId.values()]
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

function streamCommandRequest({
  connection,
  text,
  media,
  onMediaStored,
  onActivity,
  onReply,
}: {
  connection: Connection
  text: string
  media?: PendingMedia[]
  onMediaStored?: (media: MessageMedia[]) => void
  onActivity: (step: ActivityStep) => void
  onReply: (reply: string, activity?: ActivityStep[], media?: MessageMedia[]) => void
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let cursor = 0
    let settled = false
    let streamBuffer = ''

    function fail(error: Error) {
      if (settled) {
        return
      }
      settled = true
      reject(error)
    }

    function consume(final = false) {
      const chunk = xhr.responseText.slice(cursor)
      cursor = xhr.responseText.length
      streamBuffer += chunk
      if (final && streamBuffer.trim()) {
        streamBuffer += '\n\n'
      }
      const blocks = streamBuffer.split(/\n\n/)
      streamBuffer = final ? '' : (blocks.pop() ?? '')

      for (const block of blocks) {
        const parsed = parseSseBlock(block)
        if (!parsed) {
          continue
        }

        if (parsed.event === 'activity') {
          onActivity(parsed.data as ActivityStep)
        } else if (parsed.event === 'media') {
          const data = parsed.data as {
            media?: unknown
          }
          const storedMedia = parseMediaItems(data.media)
          if (storedMedia.length > 0) {
            onMediaStored?.(storedMedia)
          }
        } else if (parsed.event === 'reply') {
          const data = parsed.data as {
            reply?: string
            activity?: ActivityStep[]
            media?: unknown
          }
          const replyMedia = parseMediaItems(data.media)
          onReply(data.reply || '', Array.isArray(data.activity) ? data.activity : undefined, replyMedia)
        } else if (parsed.event === 'error') {
          fail(new Error('Command failed.'))
        }
      }
    }

    xhr.open('POST', `${connection.serverUrl}/command/stream`)
    xhr.timeout = 180000
    xhr.setRequestHeader('Authorization', `Bearer ${connection.deviceToken}`)
    xhr.setRequestHeader('Content-Type', 'application/json')
    xhr.onreadystatechange = () => {
      if (xhr.readyState === 3) {
        consume()
      }
    }
    xhr.onload = () => {
      consume(true)

      if (settled) {
        return
      }

      if (xhr.status === 401) {
        fail(new Error('This device is unauthorized or revoked. Reset and pair again.'))
        return
      }

      if (xhr.status < 200 || xhr.status >= 300) {
        fail(new Error(`Command failed with status ${xhr.status}.`))
        return
      }

      settled = true
      resolve()
    }
    xhr.onerror = () => fail(new Error('Server unreachable. Check the URL and LAN connection.'))
    xhr.ontimeout = () => fail(new Error('compoota is taking too long to respond. Try again in a moment.'))
    xhr.send(
      JSON.stringify({
        text,
        media: media?.map((item) => ({
          base64: item.base64,
          mimeType: item.mimeType,
          fileName: item.fileName,
        })),
      }),
    )
  })
}

export default function HomeScreen() {
  const colorScheme = useColorScheme()
  const insets = useSafeAreaInsets()
  const { width: screenWidth, height: screenHeight } = useWindowDimensions()
  const isDark = colorScheme === 'dark'
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const composerBottom = keyboardHeight > 0 ? Math.max(8, keyboardHeight - insets.bottom + 8) : 12
  const liquidGlassEnabled = useMemo(canRenderLiquidGlass, [])
  const styles = useMemo(
    () => createStyles(isDark, insets, composerBottom, liquidGlassEnabled),
    [composerBottom, insets, isDark, liquidGlassEnabled],
  )
  const colors = useMemo(() => createColors(isDark), [isDark])
  const scrollRef = useRef<ScrollView>(null)
  const scrollToEndTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([])
  const sidebarOpenDistance = Math.min(screenWidth * 0.76, 340)

  const [connection, setConnection] = useState<Connection | null>(null)
  const [serverUrl, setServerUrl] = useState('')
  const [pairingCode, setPairingCode] = useState('')
  const [deviceName, setDeviceName] = useState('')
  const [command, setCommand] = useState('')
  const [pendingMedia, setPendingMedia] = useState<PendingMedia[]>([])
  const [mediaSheetVisible, setMediaSheetVisible] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [mediaLibrary, setMediaLibrary] = useState<MessageMedia[]>([])
  const [mediaLibraryLoading, setMediaLibraryLoading] = useState(false)
  const [mediaLibraryError, setMediaLibraryError] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [selectedActivityMessageId, setSelectedActivityMessageId] = useState<string | null>(null)
  const [selectedMedia, setSelectedMedia] = useState<MessageMedia | null>(null)
  const [deletingMediaId, setDeletingMediaId] = useState<string | null>(null)
  const [activeScreen, setActiveScreen] = useState<ActiveScreen>('home')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [composerFocused, setComposerFocused] = useState(false)
  const sidebarTranslateX = useSharedValue(0)
  const sidebarGestureStartTranslateX = useSharedValue(0)
  const sidebarGestureEnabled = useSharedValue(false)
  const sidebarOpenValue = useSharedValue(false)

  const selectedActivityMessage = messages.find((message) => message.id === selectedActivityMessageId)
  const hasMessages = messages.some(
    (message) => message.text || message.media?.length || message.activity?.length,
  )
  const sidebarServerHost = useMemo(() => {
    if (!connection) {
      return ''
    }

    try {
      return new URL(connection.serverUrl).host
    } catch {
      return connection.serverUrl
    }
  }, [connection])

  const scrollChatToEnd = useCallback((animated = true) => {
    scrollRef.current?.scrollToEnd({ animated })
  }, [])

  const scheduleScrollToEnd = useCallback(
    (animated = true) => {
      requestAnimationFrame(() => scrollChatToEnd(animated))
      for (const delay of [60, 180, 420]) {
        const timer = setTimeout(() => scrollChatToEnd(animated), delay)
        scrollToEndTimersRef.current.push(timer)
      }
    },
    [scrollChatToEnd],
  )
  const openSidebar = () => {
    setSidebarOpen(true)
    sidebarOpenValue.value = true
    sidebarTranslateX.value = withSpring(sidebarOpenDistance, SIDEBAR_SPRING)
  }

  const closeSidebar = () => {
    setSidebarOpen(false)
    sidebarOpenValue.value = false
    sidebarTranslateX.value = withSpring(0, SIDEBAR_SPRING)
  }

  const showScreen = (screen: ActiveScreen) => {
    setActiveScreen(screen)
    closeSidebar()
    Keyboard.dismiss()
  }

  const loadMediaLibrary = useCallback(async () => {
    if (!connection) {
      return
    }

    setMediaLibraryLoading(true)
    setMediaLibraryError('')
    try {
      const response = await fetchWithTimeout(
        `${connection.serverUrl}/media`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${connection.deviceToken}`,
          },
        },
        12000,
      )

      if (!response.ok) {
        throw new Error(await readError(response))
      }

      const data = (await response.json()) as { media?: unknown }
      setMediaLibrary(parseMediaItems(data.media))
    } catch (err) {
      setMediaLibraryError(err instanceof Error ? err.message : 'Media could not be loaded.')
    } finally {
      setMediaLibraryLoading(false)
    }
  }, [connection])

  const deleteSelectedMedia = useCallback(async () => {
    if (!connection || !selectedMedia || deletingMediaId) {
      return
    }

    setDeletingMediaId(selectedMedia.id)
    setMediaLibraryError('')
    try {
      const response = await fetchWithTimeout(
        `${connection.serverUrl}/media/${selectedMedia.id}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${connection.deviceToken}`,
          },
        },
        12000,
      )

      if (!response.ok) {
        throw new Error(await readError(response))
      }

      const deletedId = selectedMedia.id
      setSelectedMedia(null)
      setMediaLibrary((current) => current.filter((item) => item.id !== deletedId))
      setMessages((current) =>
        current.map((message) => ({
          ...message,
          media: message.media?.filter((item) => item.id !== deletedId),
        })),
      )
    } catch (err) {
      setMediaLibraryError(err instanceof Error ? err.message : 'Media could not be deleted.')
    } finally {
      setDeletingMediaId(null)
    }
  }, [connection, deletingMediaId, selectedMedia])

  const dismissKeyboard = useCallback(() => {
    Keyboard.dismiss()
  }, [])

  const sidebarPanGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-8, 8])
        .failOffsetY([-16, 16])
        .onBegin((event) => {
          sidebarGestureStartTranslateX.value = sidebarTranslateX.value
          sidebarGestureEnabled.value = sidebarOpenValue.value || event.absoluteX <= SIDEBAR_EDGE_HIT_SLOP
          if (sidebarGestureEnabled.value) {
            runOnJS(dismissKeyboard)()
          }
        })
        .onUpdate((event) => {
          if (!sidebarGestureEnabled.value) {
            return
          }

          const nextTranslateX = Math.min(
            sidebarOpenDistance,
            Math.max(0, sidebarGestureStartTranslateX.value + event.translationX),
          )
          sidebarTranslateX.value = nextTranslateX
        })
        .onEnd((event) => {
          if (!sidebarGestureEnabled.value) {
            return
          }

          const projectedX = sidebarTranslateX.value + event.velocityX * 0.18
          const shouldOpen =
            event.velocityX > 520 || (event.velocityX > -520 && projectedX > sidebarOpenDistance * 0.48)
          sidebarOpenValue.value = shouldOpen
          sidebarTranslateX.value = withSpring(shouldOpen ? sidebarOpenDistance : 0, {
            ...SIDEBAR_SPRING,
            velocity: event.velocityX,
          })
          runOnJS(setSidebarOpen)(shouldOpen)
        }),
    [
      sidebarGestureEnabled,
      sidebarGestureStartTranslateX,
      sidebarOpenDistance,
      sidebarOpenValue,
      sidebarTranslateX,
      dismissKeyboard,
    ],
  )

  const sidebarMainStyle = useAnimatedStyle(() => {
    const progress = sidebarOpenDistance > 0 ? sidebarTranslateX.value / sidebarOpenDistance : 0
    const radius = interpolate(progress, [0, 1], [0, SIDEBAR_LAYER_RADIUS])
    const layerScale = interpolate(progress, [0, 1], [1, 0.94])

    return {
      borderTopLeftRadius: radius,
      borderTopRightRadius: radius,
      borderBottomLeftRadius: radius,
      borderBottomRightRadius: radius,
      borderWidth: interpolate(progress, [0, 1], [0, StyleSheet.hairlineWidth]),
      shadowOpacity: interpolate(progress, [0, 1], [0, 0.34]),
      transform: [{ translateX: sidebarTranslateX.value }, { scale: layerScale }],
    }
  }, [sidebarOpenDistance])

  const sidebarUnderlayStyle = useAnimatedStyle(() => {
    const progress = sidebarOpenDistance > 0 ? sidebarTranslateX.value / sidebarOpenDistance : 0

    return {
      opacity: interpolate(progress, [0, 0.18, 1], [0.1, 0.62, 1]),
      transform: [{ translateX: interpolate(progress, [0, 1], [-28, 0]) }],
    }
  }, [sidebarOpenDistance])

  useEffect(() => {
    if (sidebarOpenValue.value) {
      sidebarTranslateX.value = withSpring(sidebarOpenDistance, SIDEBAR_SPRING)
    }
  }, [sidebarOpenDistance, sidebarOpenValue, sidebarTranslateX])

  useEffect(() => {
    const updateKeyboardFrame = (event: KeyboardEvent) => {
      Keyboard.scheduleLayoutAnimation(event)
      setKeyboardHeight(Math.max(0, screenHeight - event.endCoordinates.screenY))
      scheduleScrollToEnd(true)
    }

    const hideKeyboard = (event: KeyboardEvent) => {
      Keyboard.scheduleLayoutAnimation(event)
      setKeyboardHeight(0)
    }

    const changeFrameSubscription = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow',
      updateKeyboardFrame,
    )
    const hideSubscription = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      hideKeyboard,
    )

    return () => {
      changeFrameSubscription.remove()
      hideSubscription.remove()
    }
  }, [scheduleScrollToEnd, screenHeight])

  useEffect(
    () => () => {
      for (const timer of scrollToEndTimersRef.current) {
        clearTimeout(timer)
      }
      scrollToEndTimersRef.current = []
    },
    [],
  )

  useEffect(() => {
    async function loadConnection() {
      try {
        const [stored, preferences] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY),
          AsyncStorage.getItem(PREFERENCES_KEY),
        ])

        if (preferences) {
          const parsedPreferences = JSON.parse(preferences) as ConnectionPreferences
          if (parsedPreferences.serverUrl) {
            setServerUrl(parsedPreferences.serverUrl)
          }
          if (parsedPreferences.deviceName) {
            setDeviceName(parsedPreferences.deviceName)
          }
        }

        if (stored) {
          const parsed = JSON.parse(stored) as Connection
          if (parsed.serverUrl && parsed.deviceId && parsed.deviceToken) {
            const storedMessages = parseMessages(
              await AsyncStorage.getItem(messageHistoryKey(parsed.deviceId)),
            )
            setConnection(parsed)
            setServerUrl(parsed.serverUrl)
            setMessages(storedMessages ?? [])
          }
        }
      } catch {
        setError('Saved connection could not be loaded. Pair again to continue.')
      } finally {
        setLoading(false)
      }
    }

    loadConnection()
  }, [])

  useEffect(() => {
    scheduleScrollToEnd(!loading)
  }, [loading, messages, scheduleScrollToEnd])

  useEffect(() => {
    if (!connection || loading) {
      return
    }

    AsyncStorage.setItem(messageHistoryKey(connection.deviceId), JSON.stringify(messages)).catch(
      () => undefined,
    )
  }, [connection, loading, messages])

  useEffect(() => {
    if (activeScreen === 'media') {
      loadMediaLibrary()
    }
  }, [activeScreen, loadMediaLibrary])

  async function connect() {
    setError('')
    setBusy(true)

    try {
      const normalizedUrl = normalizeServerUrl(serverUrl)
      const cleanedCode = pairingCode.trim()
      const cleanedName =
        deviceName.trim() ||
        Platform.select({ ios: 'iPhone', android: 'Android', default: 'compoota device' })

      if (!/^\d{6}$/.test(cleanedCode)) {
        throw new Error('Enter the 6-digit pairing code from the setup page.')
      }

      const health = await fetchWithTimeout(`${normalizedUrl}/health`, { method: 'GET' }, 6000)
      if (!health.ok) {
        throw new Error(`Server health check failed with status ${health.status}.`)
      }

      const response = await fetchWithTimeout(
        `${normalizedUrl}/pair`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pairingCode: cleanedCode,
            deviceName: cleanedName,
          }),
        },
        12000,
      )

      if (!response.ok) {
        throw new Error(await readError(response))
      }

      const data = (await response.json()) as { deviceId: string; deviceToken: string }
      const nextConnection = {
        serverUrl: normalizedUrl,
        deviceId: data.deviceId,
        deviceToken: data.deviceToken,
      }
      const nextPreferences = {
        serverUrl: normalizedUrl,
        deviceName: cleanedName,
      }

      await Promise.all([
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(nextConnection)),
        AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify(nextPreferences)),
      ])
      setConnection(nextConnection)
      setServerUrl(normalizedUrl)
      setPairingCode('')
      setDeviceName(cleanedName)
      setMessages([])
      setMediaLibrary([])
      setActiveScreen('home')
    } catch (err) {
      const message =
        err instanceof TypeError
          ? 'Server unreachable. Check the URL and network connection.'
          : err instanceof Error && err.name === 'AbortError'
            ? 'Server did not respond. Check that the phone can reach the Pi.'
            : err instanceof Error
              ? err.message
              : 'Pairing failed.'
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  async function sendCommand() {
    if (!connection || busy) {
      return
    }

    Keyboard.dismiss()

    const text = command.trim()
    if (!text && pendingMedia.length === 0) {
      setError('Type a command or add a photo first.')
      return
    }

    setError('')
    setBusy(true)
    setCommand('')
    const mediaForRequest = pendingMedia
    setPendingMedia([])
    const userId = messageId()
    const assistantId = messageId()
    setMessages((current) => [
      ...current,
      { id: userId, role: 'user', text: text || 'Photo' },
      {
        id: assistantId,
        role: 'assistant',
        text: '',
        activity: PENDING_ACTIVITY,
        isStreaming: true,
      },
    ])

    function updateAssistant(updater: (message: Message) => Message) {
      setMessages((current) =>
        current.map((message) => (message.id === assistantId ? updater(message) : message)),
      )
    }

    try {
      await streamCommandRequest({
        connection,
        text,
        media: mediaForRequest,
        onMediaStored: (storedMedia) => {
          setMediaLibrary((current) => mergeMediaItems(current, storedMedia))
          setMessages((current) =>
            current.map((message) =>
              message.id === userId
                ? {
                    ...message,
                    media: storedMedia,
                  }
                : message,
            ),
          )
        },
        onActivity: (step) => {
          updateAssistant((message) => ({
            ...message,
            activity: mergeActivity(message.activity, step),
          }))
        },
        onReply: (reply, activity, media) => {
          updateAssistant((message) => ({
            ...message,
            text: reply,
            media: media?.length ? media : message.media,
            activity: activity ?? message.activity,
            isStreaming: false,
          }))
        },
      })

      updateAssistant((message) => ({ ...message, isStreaming: false }))
    } catch (err) {
      const message =
        err instanceof TypeError
          ? 'Server unreachable. Check the URL and network connection.'
          : err instanceof Error && err.name === 'AbortError'
            ? 'compoota is taking too long to respond. Try again in a moment.'
            : err instanceof Error
              ? err.message
              : 'Command failed.'
      setError(message)
      updateAssistant((current) => ({
        ...current,
        text: current.text || message,
        activity: mergeActivity(current.activity, {
          id: 'compoota.client.error',
          label: message,
          status: 'error',
          at: new Date().toISOString(),
        }),
        isStreaming: false,
      }))
    } finally {
      setBusy(false)
    }
  }

  async function pickMedia(source: 'camera' | 'library') {
    setMediaSheetVisible(false)
    setError('')

    try {
      const permission =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync()

      if (!permission.granted) {
        setError(
          source === 'camera'
            ? 'Camera access is needed to take a photo.'
            : 'Photo library access is needed to choose a photo.',
        )
        return
      }

      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({
              base64: true,
              mediaTypes: ['images'],
              quality: 0.82,
            })
          : await ImagePicker.launchImageLibraryAsync({
              base64: true,
              mediaTypes: ['images'],
              quality: 0.82,
              selectionLimit: 1,
            })

      if (result.canceled) {
        return
      }

      const asset = result.assets[0]
      if (!asset?.base64) {
        setError('That photo could not be prepared for upload.')
        return
      }

      setPendingMedia([
        {
          id: messageId(),
          uri: asset.uri,
          base64: asset.base64,
          mimeType: asset.mimeType || 'image/jpeg',
          fileName: asset.fileName ?? undefined,
          width: asset.width,
          height: asset.height,
        },
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Photo picker failed.')
    }
  }

  async function resetConnection() {
    await AsyncStorage.removeItem(STORAGE_KEY)
    closeSidebar()
    setConnection(null)
    setCommand('')
    setPendingMedia([])
    setError('')
    setMessages([])
    setMediaLibrary([])
    setMediaLibraryError('')
    setSelectedMedia(null)
    setActiveScreen('home')
  }

  async function startFreshChat() {
    if (connection) {
      await AsyncStorage.removeItem(messageHistoryKey(connection.deviceId))
    }
    Keyboard.dismiss()
    setError('')
    setCommand('')
    setPendingMedia([])
    setSelectedActivityMessageId(null)
    setMessages([])
    setActiveScreen('home')
    scrollRef.current?.scrollTo({ y: 0, animated: true })
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator color={colors.text} />
      </SafeAreaView>
    )
  }

  if (!connection) {
    return (
      <SafeAreaView style={styles.screen}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboard}
        >
          <View style={styles.connectPage}>
            <View style={styles.connectContent}>
              <Text style={styles.connectTitle}>compoota</Text>
              <Text style={styles.connectCopy}>
                enter your server url and a fresh pairing code from your pi
              </Text>
            </View>

            <View style={styles.connectForm}>
              <View style={styles.field}>
                <Text style={styles.label}>server url</Text>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  onChangeText={setServerUrl}
                  placeholder="http://192.168.1.50:8787"
                  placeholderTextColor={colors.placeholder}
                  style={styles.input}
                  value={serverUrl}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>pairing code</Text>
                <TextInput
                  keyboardType="number-pad"
                  maxLength={6}
                  onChangeText={setPairingCode}
                  placeholder="123456"
                  placeholderTextColor={colors.placeholder}
                  style={[styles.input, styles.codeInput]}
                  value={pairingCode}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>your name</Text>
                <TextInput
                  onChangeText={setDeviceName}
                  placeholder="Sean iPhone"
                  placeholderTextColor={colors.placeholder}
                  style={styles.input}
                  value={deviceName}
                />
              </View>

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <View style={styles.connectActions}>
                <Pressable
                  disabled={busy}
                  onPress={connect}
                  style={({ pressed }) => [styles.connectButton, (pressed || busy) && styles.pressed]}
                >
                  {busy ? (
                    <ActivityIndicator color={colors.actionText} />
                  ) : (
                    <Text style={styles.connectButtonText}>connect</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    )
  }

  return (
    <View style={styles.screen}>
      <View style={styles.sidebarStage}>
        <Animated.View
          pointerEvents={sidebarOpen ? 'auto' : 'none'}
          style={[styles.sidebarUnderlay, { width: sidebarOpenDistance }, sidebarUnderlayStyle]}
        >
          <View style={styles.sidebarPanel}>
            <View style={styles.sidebarTop}>
              <Text style={styles.sidebarTitle}>compoota</Text>
              <Text numberOfLines={1} style={styles.sidebarMeta}>
                {sidebarServerHost ? `connected to ${sidebarServerHost}` : 'local companion'}
              </Text>
              <View style={styles.sidebarNav}>
                <Pressable
                  accessibilityLabel="Open chat"
                  onPress={() => showScreen('home')}
                  style={({ pressed }) => [
                    styles.sidebarNavItem,
                    activeScreen === 'home' && styles.sidebarNavItemActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.sidebarNavText,
                      activeScreen === 'home' && styles.sidebarNavTextActive,
                    ]}
                  >
                    Home
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityLabel="Open media"
                  onPress={() => showScreen('media')}
                  style={({ pressed }) => [
                    styles.sidebarNavItem,
                    activeScreen === 'media' && styles.sidebarNavItemActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.sidebarNavText,
                      activeScreen === 'media' && styles.sidebarNavTextActive,
                    ]}
                  >
                    Media
                  </Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.sidebarFooter}>
              <Pressable
                onPress={resetConnection}
                style={({ pressed }) => [styles.sidebarLogout, pressed && styles.pressed]}
              >
                <Text style={styles.sidebarLogoutText}>logout</Text>
              </Pressable>
            </View>
          </View>
        </Animated.View>

        <GestureDetector gesture={sidebarPanGesture}>
          <Animated.View style={[styles.mainPanel, sidebarMainStyle]}>
            <SafeAreaView style={styles.chatSafeArea}>
              <View style={styles.chatShell}>
                <LinearGradient
                  colors={[
                    colors.headerFadeStrong,
                    colors.headerFadeMedium,
                    colors.headerFadeSoft,
                    colors.headerFadeFaint,
                    colors.transparent,
                  ]}
                  locations={[0, 0.2, 0.48, 0.76, 1]}
                  pointerEvents="none"
                  style={styles.topFade}
                />
                <View style={styles.topButtons}>
                  <Pressable
                    accessibilityLabel="Open sidebar"
                    onPress={openSidebar}
                    style={({ pressed }) => [styles.topIconButtonHitbox, pressed && styles.glassPressed]}
                  >
                    <GlassSurface
                      colorScheme={isDark ? 'dark' : 'light'}
                      enabled={liquidGlassEnabled}
                      isInteractive
                      style={styles.topIconButton}
                      tintColor={colors.glassTint}
                    >
                      <View style={styles.sidebarGlyph}>
                        <View style={styles.sidebarGlyphLine} />
                        <View style={[styles.sidebarGlyphLine, styles.sidebarGlyphLineShort]} />
                      </View>
                    </GlassSurface>
                  </Pressable>

                  {activeScreen === 'home' && hasMessages ? (
                    <Pressable
                      accessibilityLabel="Start new chat"
                      onPress={startFreshChat}
                      style={({ pressed }) => [styles.topIconButtonHitbox, pressed && styles.glassPressed]}
                    >
                      <GlassSurface
                        colorScheme={isDark ? 'dark' : 'light'}
                        enabled={liquidGlassEnabled}
                        isInteractive
                        style={styles.topIconButton}
                        tintColor={colors.glassTint}
                      >
                        <View style={styles.newChatGlyph}>
                          <View style={styles.newChatPad} />
                          <View style={styles.newChatPadTop} />
                          <View style={styles.newChatPencil}>
                            <View style={styles.newChatPencilBody} />
                            <View style={styles.newChatPencilTip} />
                          </View>
                        </View>
                      </GlassSurface>
                    </Pressable>
                  ) : null}
                </View>

                {activeScreen === 'home' ? (
                  <>
                    <ScrollView
                      ref={scrollRef}
                      contentContainerStyle={styles.messagesContent}
                      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                      keyboardShouldPersistTaps="handled"
                      onContentSizeChange={() => scheduleScrollToEnd(false)}
                      onLayout={() => scheduleScrollToEnd(false)}
                      style={styles.messages}
                    >
                      {messages
                        .filter((message) => message.text || message.media?.length || message.activity?.length)
                        .map((message) => (
                          <View
                            key={message.id}
                            style={[styles.messageRow, message.role === 'user' && styles.userMessageRow]}
                          >
                            <View style={[styles.message, message.role === 'user' && styles.userMessage]}>
                              {message.role === 'assistant' && message.activity?.length ? (
                                <Pressable
                                  onPress={() => setSelectedActivityMessageId(message.id)}
                                  style={({ pressed }) => [
                                    styles.activityLine,
                                    pressed && styles.activityLinePressed,
                                  ]}
                                >
                                  <View style={styles.activityLineTextWrap}>
                                    <Text style={styles.activityLineTitle}>{activityStatusText(message)}</Text>
                                  </View>
                                </Pressable>
                              ) : null}
                              {message.media?.length ? (
                                <View style={styles.messageMediaGrid}>
                                  {message.media.map((item) => (
                                    <View key={item.id} style={styles.messageMediaItem}>
                                      <Image
                                        accessibilityLabel="Uploaded photo"
                                        resizeMode="cover"
                                        source={mediaImageSource(item)}
                                        style={styles.messageImage}
                                      />
                                    </View>
                                  ))}
                                </View>
                              ) : null}
                              {message.text ? (
                                <Text
                                  style={[
                                    styles.messageText,
                                    message.role === 'assistant' &&
                                      Boolean(message.activity?.length) &&
                                      styles.assistantResponseText,
                                    message.role === 'user' && styles.userMessageText,
                                  ]}
                                >
                                  {message.text}
                                </Text>
                              ) : null}
                            </View>
                          </View>
                        ))}
                    </ScrollView>

                    {error ? <Text style={styles.chatError}>{error}</Text> : null}

                    <View style={styles.composerWrap}>
                      <Pressable
                        accessibilityLabel="Add photo"
                        disabled={busy}
                        onPress={() => setMediaSheetVisible(true)}
                        style={({ pressed }) => [
                          styles.attachButtonHitbox,
                          (pressed || busy) && styles.glassPressed,
                        ]}
                      >
                        <GlassSurface
                          colorScheme={isDark ? 'dark' : 'light'}
                          enabled={liquidGlassEnabled}
                          isInteractive
                          style={styles.attachButton}
                          tintColor={colors.glassTint}
                        >
                          <Text style={styles.attachIcon}>+</Text>
                        </GlassSurface>
                      </Pressable>

                      <GlassSurface
                        colorScheme={isDark ? 'dark' : 'light'}
                        enabled={liquidGlassEnabled}
                        isInteractive
                        style={[styles.composer, composerFocused && styles.composerFocused]}
                        tintColor={colors.glassTint}
                      >
                        {pendingMedia.length ? (
                          <View style={styles.pendingMediaStrip}>
                            {pendingMedia.map((item) => (
                              <View key={item.id} style={styles.pendingMediaItem}>
                                <View accessibilityLabel="Selected photo" style={styles.pendingMediaImage}>
                                  <View style={styles.pendingMediaGlyphFrame}>
                                    <View style={styles.pendingMediaGlyphSun} />
                                    <View style={styles.pendingMediaGlyphHill} />
                                  </View>
                                </View>
                                <Pressable
                                  accessibilityLabel="Remove selected photo"
                                  onPress={() => setPendingMedia([])}
                                  style={({ pressed }) => [styles.removeMediaButton, pressed && styles.pressed]}
                                >
                                  <View style={styles.removeMediaGlyph}>
                                    <View style={[styles.removeMediaGlyphLine, styles.removeMediaGlyphLineA]} />
                                    <View style={[styles.removeMediaGlyphLine, styles.removeMediaGlyphLineB]} />
                                  </View>
                                </Pressable>
                              </View>
                            ))}
                          </View>
                        ) : null}
                        <View style={styles.composerInputRow}>
                          <TextInput
                            keyboardAppearance={isDark ? 'dark' : 'light'}
                            multiline
                            onBlur={() => setComposerFocused(false)}
                            onChangeText={setCommand}
                            onFocus={() => setComposerFocused(true)}
                            onSubmitEditing={sendCommand}
                            placeholder="Ask compoota"
                            placeholderTextColor={colors.placeholder}
                            returnKeyType="default"
                            selectionColor={colors.selection}
                            style={styles.commandInput}
                            value={command}
                          />
                          <Pressable
                            accessibilityLabel="Send message"
                            disabled={busy}
                            onPress={sendCommand}
                            style={({ pressed }) => [styles.sendButton, (pressed || busy) && styles.pressed]}
                          >
                            {busy ? (
                              <Text style={styles.busyText}>...</Text>
                            ) : (
                              <Text style={styles.sendIcon}>↑</Text>
                            )}
                          </Pressable>
                        </View>
                      </GlassSurface>
                    </View>
                  </>
                ) : (
                  <ScrollView
                    contentContainerStyle={styles.mediaContent}
                    keyboardShouldPersistTaps="handled"
                    style={styles.messages}
                  >
                    <View style={styles.mediaHeader}>
                      <Text style={styles.mediaTitle}>Media</Text>
                      <Text style={styles.mediaSubtitle}>
                        {mediaLibrary.length} {mediaLibrary.length === 1 ? 'item' : 'items'}
                      </Text>
                    </View>
                    {mediaLibraryLoading ? (
                      <ActivityIndicator color={colors.text} style={styles.mediaLoader} />
                    ) : mediaLibraryError ? (
                      <Text style={styles.mediaEmptyText}>{mediaLibraryError}</Text>
                    ) : mediaLibrary.length ? (
                      <View style={styles.mediaLibraryGrid}>
                        {mediaLibrary
                          .filter((item) => item.mimeType.startsWith('image/'))
                          .map((item) => (
                            <Pressable
                              accessibilityLabel="Open image"
                              key={item.id}
                              onPress={() => setSelectedMedia(item)}
                              style={({ pressed }) => [
                                styles.mediaLibraryItem,
                                pressed && styles.pressed,
                              ]}
                            >
                              <Image
                                accessibilityLabel={item.fileName || 'Stored image'}
                                resizeMode="cover"
                                source={mediaImageSource(item)}
                                style={styles.mediaLibraryImage}
                              />
                            </Pressable>
                          ))}
                      </View>
                    ) : (
                      <Text style={styles.mediaEmptyText}>No stored media yet.</Text>
                    )}
                  </ScrollView>
                )}
              </View>
            </SafeAreaView>
            {sidebarOpen ? (
              <Pressable
                accessibilityLabel="Close sidebar"
                onPress={closeSidebar}
                style={styles.sidebarCloseCatcher}
              />
            ) : null}
          </Animated.View>
        </GestureDetector>
      </View>
      <Modal
        animationType="fade"
        onRequestClose={() => setMediaSheetVisible(false)}
        transparent
        visible={mediaSheetVisible}
      >
        <View style={styles.mediaModalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setMediaSheetVisible(false)} />
          <View style={styles.mediaSheet}>
            <Pressable
              onPress={() => pickMedia('camera')}
              style={({ pressed }) => [styles.mediaSheetAction, pressed && styles.pressed]}
            >
              <Text style={styles.mediaSheetActionText}>Take Photo</Text>
            </Pressable>
            <Pressable
              onPress={() => pickMedia('library')}
              style={({ pressed }) => [styles.mediaSheetAction, pressed && styles.pressed]}
            >
              <Text style={styles.mediaSheetActionText}>Choose From Library</Text>
            </Pressable>
            <Pressable
              onPress={() => setMediaSheetVisible(false)}
              style={({ pressed }) => [styles.mediaSheetCancel, pressed && styles.pressed]}
            >
              <Text style={styles.mediaSheetCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        animationType="fade"
        onRequestClose={() => setSelectedMedia(null)}
        transparent
        visible={Boolean(selectedMedia)}
      >
        <View style={styles.expandedMediaRoot}>
          <Pressable style={styles.expandedMediaBackdrop} onPress={() => setSelectedMedia(null)} />
          {selectedMedia ? (
            <>
              <Image
                accessibilityLabel={selectedMedia.fileName || 'Selected image'}
                resizeMode="contain"
                source={mediaImageSource(selectedMedia)}
                style={styles.expandedMediaImage}
              />
              <View style={styles.expandedMediaActions}>
                <Pressable
                  accessibilityLabel="Delete image"
                  disabled={deletingMediaId === selectedMedia.id}
                  onPress={deleteSelectedMedia}
                  style={({ pressed }) => [
                    styles.expandedDeleteButtonHitbox,
                    (pressed || deletingMediaId === selectedMedia.id) && styles.glassPressed,
                  ]}
                >
                  <GlassSurface
                    colorScheme={isDark ? 'dark' : 'light'}
                    enabled={liquidGlassEnabled}
                    isInteractive
                    style={styles.expandedDeleteButton}
                    tintColor={colors.glassTint}
                  >
                    {deletingMediaId === selectedMedia.id ? (
                      <ActivityIndicator color={colors.text} size="small" />
                    ) : (
                      <View style={styles.trashGlyph}>
                        <View style={styles.trashGlyphLid} />
                        <View style={styles.trashGlyphHandle} />
                        <View style={styles.trashGlyphCan} />
                      </View>
                    )}
                  </GlassSurface>
                </Pressable>
              </View>
            </>
          ) : null}
        </View>
      </Modal>
      <Modal
        animationType="slide"
        onRequestClose={() => setSelectedActivityMessageId(null)}
        transparent
        visible={Boolean(selectedActivityMessage?.activity?.length)}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setSelectedActivityMessageId(null)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>compoota’s work</Text>
                <Text style={styles.sheetSubtitle}>
                  {selectedActivityMessage ? activityStatusText(selectedActivityMessage) : ''}
                </Text>
              </View>
              <Pressable onPress={() => setSelectedActivityMessageId(null)} style={styles.sheetClose}>
                <Text style={styles.sheetCloseText}>Done</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.sheetSteps} showsVerticalScrollIndicator={false}>
              {selectedActivityMessage?.activity?.map((step, index) => (
                <View
                  key={`${step.id}-${index}`}
                  style={[
                    styles.sheetStep,
                    step.status === 'done' &&
                      index < (selectedActivityMessage.activity?.length ?? 0) - 1 &&
                      styles.sheetStepQuiet,
                  ]}
                >
                  <View
                    style={[
                      styles.sheetStepDot,
                      selectedActivityMessage?.isStreaming &&
                        step.status === 'running' &&
                        styles.sheetStepDotRunning,
                      step.status === 'error' && styles.sheetStepDotError,
                    ]}
                  />
                  <View style={styles.sheetStepText}>
                    <Text style={styles.sheetStepLabel}>{step.label}</Text>
                    {step.detail ? <Text style={styles.sheetStepDetail}>{step.detail}</Text> : null}
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  )
}

function createColors(isDark: boolean) {
  return {
    background: isDark ? '#111111' : '#f8f8f7',
    text: isDark ? '#f6f6f4' : '#171717',
    secondaryText: isDark ? '#a7a7a2' : '#686863',
    subtleText: isDark ? '#858580' : '#8f8f88',
    border: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(12,12,12,0.08)',
    input: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.92)',
    placeholder: isDark ? '#8d8d88' : '#9a9a94',
    selection: isDark ? '#ffffff' : '#111111',
    action: isDark ? '#ffffff' : '#0b0b0b',
    actionText: isDark ? '#111111' : '#ffffff',
    glassTint: isDark ? 'rgba(24,24,24,0.62)' : 'rgba(255,255,255,0.58)',
    headerFadeStrong: isDark ? 'rgba(17,17,17,0.98)' : 'rgba(248,248,247,0.98)',
    headerFadeMedium: isDark ? 'rgba(17,17,17,0.72)' : 'rgba(248,248,247,0.72)',
    headerFadeSoft: isDark ? 'rgba(17,17,17,0.38)' : 'rgba(248,248,247,0.38)',
    headerFadeFaint: isDark ? 'rgba(17,17,17,0.12)' : 'rgba(248,248,247,0.12)',
    transparent: isDark ? 'rgba(17,17,17,0)' : 'rgba(248,248,247,0)',
    userBubble: isDark ? '#eeeeea' : '#161616',
    userText: isDark ? '#111111' : '#ffffff',
    error: '#d93d3d',
  }
}

function createStyles(
  isDark: boolean,
  insets: { top: number; bottom: number },
  composerBottom: number,
  liquidGlassEnabled: boolean,
) {
  const colors = createColors(isDark)
  const shadowColor = isDark ? '#000000' : '#6f6f68'
  const bottomInset = insets.bottom
  const topInset = insets.top

  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
      overflow: 'hidden',
    },
    keyboard: {
      flex: 1,
    },
    loading: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
    },
    connectPage: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: 24,
      paddingTop: 24,
      paddingBottom: Math.max(bottomInset, 16) + 8,
    },
    connectContent: {
      gap: 10,
      paddingBottom: 34,
    },
    connectTitle: {
      color: colors.text,
      fontFamily: 'OcclusionGrotesqueYear3',
      fontSize: 52,
      lineHeight: 56,
      letterSpacing: 0,
    },
    connectCopy: {
      color: colors.secondaryText,
      fontSize: 17,
      lineHeight: 24,
      maxWidth: 340,
    },
    connectForm: {
      gap: 14,
    },
    field: {
      gap: 8,
    },
    label: {
      color: colors.secondaryText,
      fontSize: 13,
      fontWeight: '600',
    },
    input: {
      minHeight: 50,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.input,
      color: colors.text,
      paddingHorizontal: 14,
      fontSize: 16,
    },
    codeInput: {
      fontVariant: ['tabular-nums'],
      letterSpacing: 0,
    },
    error: {
      color: colors.error,
      fontSize: 14,
      lineHeight: 20,
    },
    connectActions: {
      gap: 10,
      marginTop: 4,
    },
    connectButton: {
      height: 54,
      borderRadius: 27,
      backgroundColor: colors.action,
      alignItems: 'center',
      justifyContent: 'center',
    },
    connectButtonText: {
      color: colors.actionText,
      fontSize: 16,
      fontWeight: '700',
    },
    pressed: {
      opacity: 0.62,
    },
    glassPressed: {
      transform: [{ scale: 0.97 }],
    },
    sidebarStage: {
      flex: 1,
      backgroundColor: isDark ? '#050505' : '#f4f2ee',
      overflow: 'hidden',
    },
    mainPanel: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.background,
      borderColor: isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.08)',
      overflow: 'hidden',
      shadowColor: '#000000',
      shadowRadius: 36,
      shadowOffset: { width: -14, height: 0 },
      elevation: 18,
    },
    chatSafeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    chatShell: {
      flex: 1,
      backgroundColor: colors.background,
    },
    topFade: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 92,
      zIndex: 2,
    },
    topButtons: {
      position: 'absolute',
      top: 8,
      left: 16,
      right: 16,
      zIndex: 3,
      flexDirection: 'row',
      justifyContent: 'space-between',
      pointerEvents: 'box-none',
    },
    topIconButtonHitbox: {
      width: 46,
      height: 46,
      borderRadius: 23,
    },
    topIconButton: {
      flex: 1,
      borderRadius: 23,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: liquidGlassEnabled
        ? 'transparent'
        : isDark
          ? 'rgba(24,24,24,0.82)'
          : 'rgba(255,255,255,0.82)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: liquidGlassEnabled
        ? isDark
          ? 'rgba(255,255,255,0.22)'
          : 'rgba(255,255,255,0.72)'
        : colors.border,
      shadowColor,
      shadowOpacity: 0.14,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 10 },
    },
    newChatGlyph: {
      width: 22,
      height: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
    newChatPad: {
      position: 'absolute',
      left: 3,
      top: 5,
      width: 13,
      height: 14,
      borderRadius: 3,
      borderWidth: 1.8,
      borderColor: colors.text,
    },
    newChatPadTop: {
      position: 'absolute',
      left: 6,
      top: 3,
      width: 9,
      height: 1.8,
      borderRadius: 1,
      backgroundColor: colors.text,
    },
    newChatPencil: {
      position: 'absolute',
      right: 2,
      top: 3,
      width: 14,
      height: 14,
      transform: [{ rotate: '-42deg' }],
    },
    newChatPencilBody: {
      position: 'absolute',
      left: 5,
      top: 1,
      width: 4,
      height: 13,
      borderRadius: 2,
      backgroundColor: colors.text,
    },
    newChatPencilTip: {
      position: 'absolute',
      left: 5,
      top: 13,
      width: 0,
      height: 0,
      borderLeftWidth: 2,
      borderRightWidth: 2,
      borderTopWidth: 4,
      borderLeftColor: 'transparent',
      borderRightColor: 'transparent',
      borderTopColor: colors.text,
    },
    sidebarGlyph: {
      width: 20,
      gap: 6,
    },
    sidebarGlyphLine: {
      width: 20,
      height: 2.25,
      borderRadius: 2,
      backgroundColor: colors.text,
    },
    sidebarGlyphLineShort: {
      width: 15,
    },
    sidebarUnderlay: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 0,
      paddingTop: 64,
      paddingHorizontal: 24,
      paddingBottom: Math.max(bottomInset, 18) + 18,
      backgroundColor: isDark ? '#050505' : '#f4f2ee',
    },
    sidebarPanel: {
      flex: 1,
      justifyContent: 'space-between',
    },
    sidebarTop: {
      gap: 8,
    },
    sidebarTitle: {
      color: colors.text,
      fontSize: 34,
      lineHeight: 40,
      fontWeight: '700',
      letterSpacing: 0,
    },
    sidebarMeta: {
      color: colors.subtleText,
      fontSize: 14,
      lineHeight: 20,
    },
    sidebarNav: {
      gap: 8,
      paddingTop: 22,
      marginLeft: -16,
    },
    sidebarNavItem: {
      height: 46,
      borderRadius: 23,
      paddingHorizontal: 16,
      alignItems: 'flex-start',
      justifyContent: 'center',
      backgroundColor: 'transparent',
    },
    sidebarNavItemActive: {
      backgroundColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)',
    },
    sidebarNavText: {
      color: colors.secondaryText,
      fontSize: 16,
      fontWeight: '600',
    },
    sidebarNavTextActive: {
      color: colors.text,
    },
    sidebarFooter: {
      gap: 12,
    },
    sidebarLogout: {
      height: 50,
      borderRadius: 25,
      paddingHorizontal: 18,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'flex-start',
      backgroundColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)',
    },
    sidebarLogoutText: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
    },
    sidebarCloseCatcher: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 8,
      backgroundColor: 'transparent',
    },
    messages: {
      flex: 1,
    },
    messagesContent: {
      paddingTop: 64,
      paddingHorizontal: 20,
      paddingBottom: composerBottom + 118,
      gap: 24,
    },
    messageRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      maxWidth: 560,
      width: '100%',
      alignSelf: 'center',
    },
    userMessageRow: {
      justifyContent: 'flex-end',
    },
    message: {
      flexShrink: 1,
      maxWidth: '86%',
      paddingVertical: 2,
    },
    userMessage: {
      maxWidth: '78%',
      borderRadius: 20,
      paddingHorizontal: 16,
      paddingVertical: 11,
      backgroundColor: colors.userBubble,
    },
    activityLine: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      maxWidth: '100%',
      paddingVertical: 2,
      marginBottom: 7,
    },
    activityLinePressed: {
      opacity: 0.58,
    },
    activityLineTextWrap: {
      flexShrink: 1,
      maxWidth: '100%',
    },
    activityLineTitle: {
      color: colors.subtleText,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '500',
      flexShrink: 1,
    },
    messageText: {
      color: colors.text,
      fontSize: 17,
      lineHeight: 25,
    },
    messageMediaGrid: {
      gap: 8,
      marginBottom: 8,
    },
    messageMediaItem: {
      gap: 6,
    },
    messageImage: {
      width: 210,
      height: 210,
      borderRadius: 16,
      backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    },
    assistantResponseText: {
      marginTop: 2,
    },
    userMessageText: {
      color: colors.userText,
      fontSize: 16,
      lineHeight: 22,
    },
    chatError: {
      position: 'absolute',
      left: 24,
      right: 24,
      bottom: composerBottom + 86,
      color: colors.error,
      textAlign: 'center',
      fontSize: 13,
      zIndex: 2,
    },
    mediaContent: {
      paddingTop: 86,
      paddingHorizontal: 18,
      paddingBottom: Math.max(bottomInset, 18) + 28,
    },
    mediaHeader: {
      maxWidth: 560,
      width: '100%',
      alignSelf: 'center',
      paddingBottom: 22,
    },
    mediaTitle: {
      color: colors.text,
      fontSize: 34,
      lineHeight: 40,
      fontWeight: '700',
      letterSpacing: 0,
    },
    mediaSubtitle: {
      color: colors.secondaryText,
      fontSize: 15,
      lineHeight: 21,
      marginTop: 6,
    },
    mediaLoader: {
      marginTop: 28,
    },
    mediaEmptyText: {
      color: colors.secondaryText,
      fontSize: 15,
      lineHeight: 22,
      textAlign: 'center',
      marginTop: 32,
    },
    mediaLibraryGrid: {
      maxWidth: 560,
      width: '100%',
      alignSelf: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    mediaLibraryItem: {
      width: '31.8%',
      aspectRatio: 1,
      borderRadius: 12,
      overflow: 'hidden',
      backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    },
    mediaLibraryImage: {
      width: '100%',
      height: '100%',
    },
    expandedMediaRoot: {
      flex: 1,
      backgroundColor: isDark ? 'rgba(0,0,0,0.92)' : 'rgba(248,248,247,0.92)',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 14,
      paddingVertical: Math.max(topInset, 18) + 18,
    },
    expandedMediaBackdrop: {
      ...StyleSheet.absoluteFillObject,
    },
    expandedMediaImage: {
      width: '100%',
      height: '100%',
      borderRadius: 18,
    },
    expandedMediaActions: {
      position: 'absolute',
      top: Math.max(topInset, 14) + 10,
      right: 18,
    },
    expandedDeleteButtonHitbox: {
      width: 48,
      height: 48,
      borderRadius: 24,
    },
    expandedDeleteButton: {
      flex: 1,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: liquidGlassEnabled
        ? 'transparent'
        : isDark
          ? 'rgba(24,24,24,0.82)'
          : 'rgba(255,255,255,0.82)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: liquidGlassEnabled
        ? isDark
          ? 'rgba(255,255,255,0.22)'
          : 'rgba(255,255,255,0.72)'
        : colors.border,
    },
    trashGlyph: {
      width: 20,
      height: 22,
      alignItems: 'center',
    },
    trashGlyphLid: {
      position: 'absolute',
      top: 4,
      width: 17,
      height: 2,
      borderRadius: 1,
      backgroundColor: colors.text,
    },
    trashGlyphHandle: {
      position: 'absolute',
      top: 1,
      width: 8,
      height: 2,
      borderRadius: 1,
      backgroundColor: colors.text,
    },
    trashGlyphCan: {
      position: 'absolute',
      top: 8,
      width: 14,
      height: 12,
      borderRadius: 3,
      borderWidth: 2,
      borderTopWidth: 0,
      borderColor: colors.text,
    },
    modalRoot: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    modalBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: isDark ? 'rgba(0,0,0,0.06)' : 'rgba(0,0,0,0.03)',
    },
    mediaModalRoot: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    mediaSheet: {
      marginHorizontal: 14,
      marginBottom: Math.max(bottomInset, 14) + 8,
      borderRadius: 22,
      padding: 8,
      gap: 7,
      backgroundColor: isDark ? '#1d1d1d' : '#ffffff',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      shadowColor,
      shadowOpacity: 0.16,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 10 },
    },
    mediaSheetAction: {
      height: 50,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.045)',
    },
    mediaSheetActionText: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
    },
    mediaSheetCancel: {
      height: 50,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    mediaSheetCancelText: {
      color: colors.secondaryText,
      fontSize: 16,
      fontWeight: '600',
    },
    sheet: {
      maxHeight: '74%',
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      paddingTop: 10,
      paddingHorizontal: 22,
      paddingBottom: Math.max(bottomInset, 16) + 18,
      backgroundColor: isDark ? '#171717' : '#fbfbfa',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      shadowColor,
      shadowOpacity: 0.18,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: -8 },
    },
    sheetHandle: {
      width: 42,
      height: 5,
      borderRadius: 3,
      alignSelf: 'center',
      backgroundColor: isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.14)',
      marginBottom: 18,
    },
    sheetHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 18,
      marginBottom: 18,
    },
    sheetTitle: {
      color: colors.text,
      fontSize: 21,
      lineHeight: 26,
      fontWeight: '700',
    },
    sheetSubtitle: {
      color: colors.secondaryText,
      fontSize: 13,
      lineHeight: 18,
      marginTop: 2,
    },
    sheetClose: {
      minWidth: 64,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    },
    sheetCloseText: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '600',
    },
    sheetSteps: {
      gap: 16,
      paddingBottom: 8,
    },
    sheetStep: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
    },
    sheetStepQuiet: {
      opacity: 0.46,
    },
    sheetStepDot: {
      width: 7,
      height: 7,
      borderRadius: 3.5,
      marginTop: 7,
      backgroundColor: colors.secondaryText,
      opacity: 0.72,
    },
    sheetStepDotRunning: {
      opacity: 1,
      backgroundColor: '#147ef5',
    },
    sheetStepDotError: {
      opacity: 1,
      backgroundColor: colors.error,
    },
    sheetStepText: {
      flex: 1,
      gap: 3,
    },
    sheetStepLabel: {
      color: colors.text,
      fontSize: 15,
      lineHeight: 21,
      fontWeight: '600',
    },
    sheetStepDetail: {
      color: colors.secondaryText,
      fontSize: 13,
      lineHeight: 18,
    },
    composerWrap: {
      position: 'absolute',
      left: 16,
      right: 16,
      bottom: composerBottom,
      zIndex: 4,
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 10,
      shadowColor,
      shadowOpacity: isDark ? 0.18 : 0.12,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 10 },
    },
    composer: {
      flex: 1,
      minWidth: 0,
      minHeight: 54,
      borderRadius: 27,
      gap: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      backgroundColor: liquidGlassEnabled
        ? 'transparent'
        : isDark
          ? 'rgba(24,24,24,0.92)'
          : 'rgba(255,255,255,0.92)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: liquidGlassEnabled
        ? isDark
          ? 'rgba(255,255,255,0.22)'
          : 'rgba(255,255,255,0.72)'
        : isDark
          ? 'rgba(255,255,255,0.14)'
          : 'rgba(0,0,0,0.12)',
    },
    composerFocused: {
      borderColor: isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.18)',
    },
    composerInputRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 8,
    },
    commandInput: {
      flex: 1,
      minHeight: 38,
      maxHeight: 118,
      color: colors.text,
      paddingHorizontal: 8,
      paddingTop: 9,
      paddingBottom: 9,
      fontSize: 17,
      lineHeight: 21,
      textAlignVertical: 'top',
    },
    pendingMediaStrip: {
      flexDirection: 'row',
      paddingHorizontal: 6,
      paddingTop: 2,
    },
    pendingMediaItem: {
      width: 72,
      minHeight: 72,
    },
    pendingMediaImage: {
      width: 72,
      height: 72,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    },
    pendingMediaGlyphFrame: {
      width: 34,
      height: 28,
      borderRadius: 5,
      borderWidth: 1.8,
      borderColor: colors.secondaryText,
      overflow: 'hidden',
    },
    pendingMediaGlyphSun: {
      position: 'absolute',
      top: 5,
      right: 6,
      width: 5,
      height: 5,
      borderRadius: 2.5,
      backgroundColor: colors.secondaryText,
    },
    pendingMediaGlyphHill: {
      position: 'absolute',
      left: 5,
      bottom: -7,
      width: 25,
      height: 18,
      borderRadius: 10,
      transform: [{ rotate: '-18deg' }],
      backgroundColor: colors.secondaryText,
    },
    removeMediaButton: {
      position: 'absolute',
      top: -6,
      right: -6,
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.action,
      borderWidth: 2,
      borderColor: isDark ? '#181818' : '#ffffff',
    },
    removeMediaGlyph: {
      width: 12,
      height: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    removeMediaGlyphLine: {
      position: 'absolute',
      width: 13,
      height: 2,
      borderRadius: 1,
      backgroundColor: colors.actionText,
    },
    removeMediaGlyphLineA: {
      transform: [{ rotate: '45deg' }],
    },
    removeMediaGlyphLineB: {
      transform: [{ rotate: '-45deg' }],
    },
    attachButtonHitbox: {
      width: 52,
      height: 52,
      borderRadius: 26,
    },
    attachButton: {
      flex: 1,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: liquidGlassEnabled
        ? 'transparent'
        : isDark
          ? 'rgba(24,24,24,0.92)'
          : 'rgba(255,255,255,0.92)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: liquidGlassEnabled
        ? isDark
          ? 'rgba(255,255,255,0.22)'
          : 'rgba(255,255,255,0.72)'
        : isDark
          ? 'rgba(255,255,255,0.14)'
          : 'rgba(0,0,0,0.12)',
    },
    attachIcon: {
      color: colors.text,
      width: 52,
      height: 52,
      fontSize: 38,
      fontWeight: '300',
      lineHeight: 48,
      textAlign: 'center',
    },
    sendButton: {
      width: 36,
      height: 36,
      borderRadius: 21,
      backgroundColor: colors.action,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendIcon: {
      color: colors.actionText,
      width: 42,
      height: 42,
      fontSize: 25,
      fontWeight: '800',
      lineHeight: 36,
      textAlign: 'center',
    },
    busyText: {
      color: colors.actionText,
      fontSize: 15,
      fontWeight: '900',
      letterSpacing: 0,
    },
  })
}
