import AsyncStorage from '@react-native-async-storage/async-storage'
import * as ImagePicker from 'expo-image-picker'
import * as Location from 'expo-location'
import { usePathname, useRouter } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  LayoutAnimation,
  Platform,
  ScrollView,
  StatusBar,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import { Gesture } from 'react-native-gesture-handler'
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useQueryClient } from '@tanstack/react-query'

import {
  AppSidebar,
  SIDEBAR_EDGE_HIT_SLOP,
  SIDEBAR_LAYER_RADIUS,
  SIDEBAR_SPRING,
  SIDEBAR_TOGGLE_CLOSED_SIZE,
  SIDEBAR_TOGGLE_MARGIN,
  SIDEBAR_TOGGLE_OPEN_GAP,
} from '../AppSidebar'
import { ConnectScreen } from '../screens/ConnectScreen'
import { AssistantScreen } from '../screens/AssistantScreen'
import { FeedScreen } from '../screens/FeedScreen'
import { MaintenanceScreen } from '../screens/MaintenanceScreen'
import { MediaScreen } from '../screens/MediaScreen'
import { SettingsScreen } from '../screens/SettingsScreen'
import { TopBar } from './TopBar'
import { ActivityModal } from '../modals/ActivityModal'
import { ExpandedMediaModal } from '../modals/ExpandedMediaModal'
import { FeedUndoToast } from '../modals/FeedUndoToast'
import { MediaPickerSheet } from '../modals/MediaPickerSheet'
import { useAuth } from '../../features/auth/AuthProvider'
import {
  feedQueryKey,
  useFeedFeedbackMutation,
  useFeedQuery,
  useRefreshFeedMutation,
} from '../../features/feed/api'
import { isPersonalFeedItem, sortFeedItems } from '../../features/feed/model'
import { mergeActivity, messageId, PENDING_ACTIVITY } from '../../features/assistant/model'
import { useCompleteMaintenanceMutation, useMaintenanceQuery } from '../../features/maintenance/api'
import { removeMediaFromMessages, useDeleteMediaMutation, useMediaQuery } from '../../features/media/api'
import { mergeMediaItems } from '../../features/media/model'
import { streamCommandRequest, userFacingError } from '../../lib/api/client'
import { FEED_REFRESH_REQUEST_KEY } from '../../lib/constants'
import { createColors } from '../../lib/theme'
import { canRenderLiquidGlass } from '../ui'
import type { ActiveScreen, FeedItem, FeedUndoState, FeedView, Message, MessageMedia, PendingMedia } from '../../types'

type AppShellProps = {
  screen?: ActiveScreen
}

export function AppShell({ screen = 'home' }: AppShellProps) {
  const auth = useAuth()
  const insets = useSafeAreaInsets()
  const pathname = usePathname()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { width: screenWidth } = useWindowDimensions()
  const colors = useMemo(() => createColors(auth.isDark, auth.themeColor), [auth.isDark, auth.themeColor])
  const liquidGlassEnabled = useMemo(canRenderLiquidGlass, [])
  const scrollRef = useRef<ScrollView>(null)
  const scrollToEndTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([])
  const feedUndoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sidebarGlassResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [activeScreen, setActiveScreen] = useState<ActiveScreen>(screen)
  const [displayedScreen, setDisplayedScreen] = useState<ActiveScreen>(screen)
  const [locating, setLocating] = useState(false)
  const [command, setCommand] = useState('')
  const [messages, setMessages] = useState<Message[]>(auth.initialMessages)
  const [pendingMedia, setPendingMedia] = useState<PendingMedia[]>([])
  const [mediaSheetVisible, setMediaSheetVisible] = useState(false)
  const [feedView, setFeedView] = useState<FeedView>('list')
  const [feedUndo, setFeedUndo] = useState<FeedUndoState | null>(null)
  const [feedAutoRefreshAttempted, setFeedAutoRefreshAttempted] = useState(false)
  const [selectedActivityMessageId, setSelectedActivityMessageId] = useState<string | null>(null)
  const [selectedMedia, setSelectedMedia] = useState<MessageMedia | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarGlassSuspended, setSidebarGlassSuspended] = useState(false)

  const sidebarOpenDistance = Math.min(screenWidth * 0.76, 340)
  const sidebarTranslateX = useSharedValue(0)
  const sidebarGestureStartTranslateX = useSharedValue(0)
  const sidebarGestureEnabled = useSharedValue(false)
  const sidebarOpenValue = useSharedValue(false)
  const expandedMediaTranslateX = useSharedValue(0)
  const expandedMediaTranslateY = useSharedValue(0)
  const contentOpacity = useSharedValue(1)

  const feedQuery = useFeedQuery(auth.connection)
  const refreshFeedMutation = useRefreshFeedMutation(auth.connection)
  const feedbackMutation = useFeedFeedbackMutation(auth.connection)
  const mediaQuery = useMediaQuery(auth.connection)
  const deleteMediaMutation = useDeleteMediaMutation(auth.connection)
  const maintenanceQuery = useMaintenanceQuery(auth.connection)
  const completeMaintenanceMutation = useCompleteMaintenanceMutation(auth.connection)

  const feedData = feedQuery.data
  const feedItems = feedData?.items ?? []
  const feedPreferences = feedData?.preferences ?? null
  const feedRun = feedData?.run ?? null
  const visibleFeedItems = feedItems.filter(isPersonalFeedItem)
  const feedRefreshInProgress = feedQuery.isLoading || refreshFeedMutation.isPending || feedRun?.status === 'running'
  const feedEmptyTitle =
    feedRefreshInProgress
        ? 'Loading nearby events...'
        : feedRun?.status === 'error'
          ? 'Feed refresh failed'
          : 'No nearby events found'
  const feedEmptyText =
    feedRefreshInProgress
        ? `compoota is looking for real events${feedPreferences ? ` near ${feedPreferences.homeLocation}` : ' near you'}.`
        : feedRun?.status === 'error' && feedRun.errorMessage
          ? feedRun.errorMessage
          : feedPreferences
            ? `Try a wider radius or a nearby city around ${feedPreferences.homeLocation}.`
            : 'Try a wider radius or a nearby city.'
  const selectedActivityMessage = messages.find((message) => message.id === selectedActivityMessageId) ?? null
  const hasMessages = messages.some((message) => message.text || message.media?.length || message.activity?.length)
  const pageTitle =
    displayedScreen === 'chat' || displayedScreen === 'assistant'
      ? 'chat'
      : displayedScreen === 'maintenance'
        ? 'Maintenance'
        : displayedScreen === 'media'
          ? 'Media'
          : displayedScreen === 'settings'
            ? 'Settings'
            : ''
  const mainPanelGlassEnabled = liquidGlassEnabled && !sidebarGlassSuspended

  useEffect(() => {
    setActiveScreen(screen)
  }, [screen])

  useEffect(() => {
    if (activeScreen === displayedScreen) {
      return
    }
    contentOpacity.value = withTiming(0, { duration: 130 }, (finished) => {
      if (!finished) {
        return
      }
      runOnJS(setDisplayedScreen)(activeScreen)
      contentOpacity.value = withTiming(1, { duration: 190 })
    })
  }, [activeScreen, contentOpacity, displayedScreen])

  useEffect(() => {
    setMessages(auth.initialMessages)
  }, [auth.connection?.deviceId, auth.initialMessages])

  useEffect(() => {
    if (!auth.connection || auth.loading) {
      return
    }
    auth.persistMessages(messages).catch(() => undefined)
  }, [auth, auth.connection, auth.loading, messages])

  useEffect(() => {
    if (!auth.connection) {
      return
    }
    auth.updatePushToken()
  }, [auth, auth.connection])

  useEffect(() => {
    if (activeScreen === 'maintenance') {
      maintenanceQuery.refetch()
    }
  }, [activeScreen])

  useEffect(() => {
    if (activeScreen === 'media') {
      mediaQuery.refetch()
    }
  }, [activeScreen])

  useEffect(() => {
    if (!auth.connection || activeScreen !== 'home') {
      return
    }
    let cancelled = false
    async function syncFeedRequest() {
      const refreshRequest = await AsyncStorage.getItem(FEED_REFRESH_REQUEST_KEY)
      if (cancelled || !refreshRequest) {
        return
      }
      await AsyncStorage.removeItem(FEED_REFRESH_REQUEST_KEY)
      if (cancelled) {
        return
      }
      setFeedAutoRefreshAttempted(true)
      refreshFeedMutation.mutate()
    }
    syncFeedRequest().catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [activeScreen, auth.connection, queryClient, refreshFeedMutation])

  useEffect(() => {
    if (
      activeScreen !== 'home' ||
      !auth.connection ||
      feedAutoRefreshAttempted ||
      feedQuery.isLoading ||
      refreshFeedMutation.isPending ||
      feedItems.length > 0
    ) {
      return
    }
    setFeedAutoRefreshAttempted(true)
    refreshFeedMutation.mutate()
  }, [
    activeScreen,
    auth.connection,
    feedAutoRefreshAttempted,
    feedItems.length,
    feedQuery.isLoading,
    refreshFeedMutation,
  ])

  useEffect(() => {
    if (activeScreen !== 'home' || !auth.connection || feedRun?.status !== 'running') {
      return
    }
    const timer = setTimeout(() => {
      feedQuery.refetch()
    }, 5000)
    return () => clearTimeout(timer)
  }, [activeScreen, auth.connection, feedRun?.id, feedRun?.status, feedQuery])

  useEffect(
    () => () => {
      for (const timer of scrollToEndTimersRef.current) {
        clearTimeout(timer)
      }
      scrollToEndTimersRef.current = []
      if (feedUndoTimerRef.current) {
        clearTimeout(feedUndoTimerRef.current)
        feedUndoTimerRef.current = null
      }
      if (sidebarGlassResumeTimerRef.current) {
        clearTimeout(sidebarGlassResumeTimerRef.current)
        sidebarGlassResumeTimerRef.current = null
      }
    },
    [],
  )

  const scrollChatToEnd = useCallback((animated = true) => {
    scrollRef.current?.scrollToEnd({ animated })
  }, [])
  const dismissKeyboard = useCallback(() => {
    Keyboard.dismiss()
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
    if (sidebarGlassResumeTimerRef.current) {
      clearTimeout(sidebarGlassResumeTimerRef.current)
      sidebarGlassResumeTimerRef.current = null
    }
    setSidebarGlassSuspended(true)
    setSidebarOpen(true)
    sidebarOpenValue.value = true
    sidebarTranslateX.value = withSpring(sidebarOpenDistance, SIDEBAR_SPRING)
  }

  const closeSidebar = () => {
    if (sidebarGlassResumeTimerRef.current) {
      clearTimeout(sidebarGlassResumeTimerRef.current)
    }
    setSidebarGlassSuspended(true)
    setSidebarOpen(false)
    sidebarOpenValue.value = false
    sidebarTranslateX.value = withSpring(0, SIDEBAR_SPRING)
    sidebarGlassResumeTimerRef.current = setTimeout(() => {
      setSidebarGlassSuspended(false)
      sidebarGlassResumeTimerRef.current = null
    }, 520)
  }

  const showScreen = (nextScreen: ActiveScreen) => {
    closeSidebar()
    Keyboard.dismiss()
    if (nextScreen === 'home') {
      setActiveScreen('home')
      if (pathname !== '/') {
        router.replace('/')
      }
      return
    }
    if (nextScreen === 'settings') {
      setActiveScreen('settings')
      return
    }
    router.push(`/${nextScreen}`)
  }

  const goBack = () => {
    closeSidebar()
    Keyboard.dismiss()
    if (router.canGoBack()) {
      router.back()
      return
    }
    router.replace('/')
  }

  async function useCurrentLocation() {
    setLocating(true)
    auth.setError('')
    try {
      const permission = await Location.requestForegroundPermissionsAsync()
      if (!permission.granted) {
        throw new Error('Location permission is needed to detect your area.')
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      const [placemark] = await Location.reverseGeocodeAsync(position.coords)
      const city = placemark?.city || placemark?.district || placemark?.subregion
      const region = placemark?.region
      const nextLocation = city && region ? `${city}, ${region}` : city || region || placemark?.country || null
      if (!nextLocation) {
        throw new Error('Could not identify your city from this location.')
      }
      auth.setHomeLocation(nextLocation)
    } catch (err) {
      auth.setError(err instanceof Error ? err.message : 'Location could not be detected.')
    } finally {
      setLocating(false)
    }
  }

  async function connect() {
    try {
      await auth.pair()
      setMessages([])
      setPendingMedia([])
      setFeedAutoRefreshAttempted(false)
      setActiveScreen('home')
    } catch {
      // Auth provider owns the visible error.
    }
  }

  async function sendCommand() {
    if (!auth.connection || busy) {
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
        connection: auth.connection,
        text,
        media: mediaForRequest,
        onMediaStored: (storedMedia) => {
          queryClient.setQueryData(['media', auth.connection?.deviceId], (current?: MessageMedia[]) =>
            mergeMediaItems(current ?? [], storedMedia),
          )
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
        onDelta: (delta) => {
          updateAssistant((message) => ({
            ...message,
            text: `${message.text}${message.text ? delta : delta.replace(/^\s+/, '')}`,
          }))
          scheduleScrollToEnd(true)
        },
        onReply: (reply, activity, media) => {
          updateAssistant((message) => ({
            ...message,
            text: reply.replace(/^\s+/, ''),
            media: media?.length ? media : message.media,
            activity: activity ?? message.activity,
            isStreaming: false,
          }))
          maintenanceQuery.refetch().catch(() => undefined)
        },
      })
      updateAssistant((message) => ({ ...message, isStreaming: false }))
    } catch (err) {
      const message = userFacingError(err, 'Command failed.')
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
      scheduleScrollToEnd(true)
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
        throw new Error(source === 'camera' ? 'Camera permission is needed.' : 'Photo permission is needed.')
      }
      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({
              allowsEditing: false,
              base64: true,
              mediaTypes: ['images'],
              quality: 0.82,
            })
          : await ImagePicker.launchImageLibraryAsync({
              allowsEditing: false,
              base64: true,
              mediaTypes: ['images'],
              quality: 0.82,
            })
      if (result.canceled || !result.assets[0]) {
        return
      }
      const asset = result.assets[0]
      if (!asset.base64) {
        throw new Error('Selected photo could not be read.')
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

  function startFreshChat() {
    Keyboard.dismiss()
    setError('')
    setCommand('')
    setPendingMedia([])
    setSelectedActivityMessageId(null)
    setMessages([])
    setActiveScreen('chat')
    setFeedAutoRefreshAttempted(false)
    scrollRef.current?.scrollTo({ y: 0, animated: true })
  }

  function openNewFeedEvent() {
    Keyboard.dismiss()
    router.push('/new-event')
  }

  async function saveFeedItem(item: FeedItem) {
    setError('')
    try {
      await feedbackMutation.mutateAsync({
        item,
        value: 'save',
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Feedback could not be saved.')
    }
  }

  async function dismissFeedItem(item: FeedItem) {
    setError('')
    if (feedUndoTimerRef.current) {
      clearTimeout(feedUndoTimerRef.current)
    }
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    queryClient.setQueryData(feedQueryKey(auth.connection), (current?: typeof feedData) =>
      current ? { ...current, items: current.items.filter((candidate) => candidate.id !== item.id) } : current,
    )
    setFeedUndo({ item, previousFeedback: item.feedback })
    feedUndoTimerRef.current = setTimeout(() => {
      setFeedUndo(null)
      feedUndoTimerRef.current = null
    }, 6000)
    try {
      await feedbackMutation.mutateAsync({ item, value: 'hide' })
    } catch (err) {
      queryClient.setQueryData(feedQueryKey(auth.connection), (current?: typeof feedData) =>
        current ? { ...current, items: sortFeedItems([...current.items, item]) } : current,
      )
      setFeedUndo(null)
      setError(err instanceof Error ? err.message : 'Feedback could not be saved.')
    }
  }

  async function undoDismissedFeedItem() {
    if (!feedUndo) {
      return
    }
    const { item, previousFeedback } = feedUndo
    if (feedUndoTimerRef.current) {
      clearTimeout(feedUndoTimerRef.current)
      feedUndoTimerRef.current = null
    }
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    queryClient.setQueryData(feedQueryKey(auth.connection), (current?: typeof feedData) =>
      current ? { ...current, items: sortFeedItems([...current.items, item]) } : current,
    )
    setFeedUndo(null)
    try {
      await feedbackMutation.mutateAsync({ item, value: previousFeedback ?? 'clear' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Undo could not be saved.')
    }
  }

  const closeExpandedMedia = useCallback(() => {
    expandedMediaTranslateX.value = 0
    expandedMediaTranslateY.value = 0
    setSelectedMedia(null)
  }, [expandedMediaTranslateX, expandedMediaTranslateY])

  async function deleteSelectedMedia() {
    if (!selectedMedia || deleteMediaMutation.isPending) {
      return
    }
    try {
      const deletedId = await deleteMediaMutation.mutateAsync(selectedMedia)
      closeExpandedMedia()
      setMessages((current) => removeMediaFromMessages(current, deletedId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Media could not be deleted.')
    }
  }

  function confirmDeleteSelectedMedia() {
    Alert.alert('Delete image?', 'This removes the image from compoota media storage.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: deleteSelectedMedia },
    ])
  }

  const sidebarPanGesture = useMemo(
    () =>
      Gesture.Pan()
        .onBegin((event) => {
          sidebarGestureStartTranslateX.value = sidebarTranslateX.value
          sidebarGestureEnabled.value =
            sidebarOpenValue.value || event.absoluteX <= SIDEBAR_EDGE_HIT_SLOP
          if (sidebarGestureEnabled.value) {
            runOnJS(dismissKeyboard)()
          }
        })
        .onUpdate((event) => {
          if (!sidebarGestureEnabled.value) {
            return
          }
          sidebarTranslateX.value = Math.min(
            sidebarOpenDistance,
            Math.max(0, sidebarGestureStartTranslateX.value + event.translationX),
          )
        })
        .onEnd((event) => {
          if (!sidebarGestureEnabled.value) {
            return
          }
          const projectedX = sidebarTranslateX.value + event.velocityX * 0.18
          const shouldOpen =
            event.velocityX > 520 || (event.velocityX > -520 && projectedX > sidebarOpenDistance * 0.48)
          sidebarOpenValue.value = shouldOpen
          sidebarTranslateX.value = withSpring(shouldOpen ? sidebarOpenDistance : 0, SIDEBAR_SPRING)
          runOnJS(setSidebarOpen)(shouldOpen)
        }),
    [
      activeScreen,
      dismissKeyboard,
      sidebarGestureEnabled,
      sidebarGestureStartTranslateX,
      sidebarOpenDistance,
      sidebarOpenValue,
      sidebarTranslateX,
    ],
  )

  const expandedMediaPanGesture = useMemo(
    () =>
      Gesture.Pan()
        .onUpdate((event) => {
          expandedMediaTranslateX.value = event.translationX
          expandedMediaTranslateY.value = event.translationY
        })
        .onEnd((event) => {
          const shouldClose =
            Math.abs(event.translationY) > 140 || Math.abs(event.velocityY) > 900 || Math.abs(event.velocityX) > 1200
          if (shouldClose) {
            runOnJS(closeExpandedMedia)()
            return
          }
          expandedMediaTranslateX.value = withSpring(0)
          expandedMediaTranslateY.value = withSpring(0)
        }),
    [closeExpandedMedia, expandedMediaTranslateX, expandedMediaTranslateY],
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
      borderWidth: interpolate(progress, [0, 1], [0, 1]),
      shadowOpacity: interpolate(progress, [0, 1], [0, 0.34]),
      transform: [{ translateX: sidebarTranslateX.value }, { scale: layerScale }],
    }
  }, [sidebarOpenDistance])

  const sidebarBackdropStyle = useAnimatedStyle(() => {
    const progress = sidebarOpenDistance > 0 ? sidebarTranslateX.value / sidebarOpenDistance : 0
    return { opacity: interpolate(progress, [0, 0.14, 1], [0, 1, 1]) }
  }, [sidebarOpenDistance])

  const sidebarUnderlayStyle = useAnimatedStyle(() => {
    const progress = sidebarOpenDistance > 0 ? sidebarTranslateX.value / sidebarOpenDistance : 0
    return {
      opacity: interpolate(progress, [0, 0.18, 1], [0, 0.62, 1]),
      transform: [{ translateX: interpolate(progress, [0, 1], [-28, 0]) }],
    }
  }, [sidebarOpenDistance])

  const sidebarToggleStyle = useAnimatedStyle(() => {
    const progress = sidebarOpenDistance > 0 ? sidebarTranslateX.value / sidebarOpenDistance : 0
    const openLeft = Math.max(
      24,
      sidebarOpenDistance - SIDEBAR_TOGGLE_CLOSED_SIZE - SIDEBAR_TOGGLE_OPEN_GAP,
    )
    return {
      left: interpolate(progress, [0, 1], [SIDEBAR_TOGGLE_MARGIN, openLeft]),
      transform: [{ scale: interpolate(progress, [0, 1], [1, 0.98]) }],
    }
  }, [sidebarOpenDistance])

  const sidebarHamburgerStyle = useAnimatedStyle(() => {
    const progress = sidebarOpenDistance > 0 ? sidebarTranslateX.value / sidebarOpenDistance : 0
    return { transform: [{ rotate: `${interpolate(progress, [0, 1], [0, 90])}deg` }] }
  }, [sidebarOpenDistance])
  const sidebarHamburgerBlackStyle = useAnimatedStyle(() => {
    const progress = sidebarOpenDistance > 0 ? sidebarTranslateX.value / sidebarOpenDistance : 0
    return { opacity: interpolate(progress, [0, 1], [1, 0]) }
  }, [sidebarOpenDistance])
  const sidebarHamburgerWhiteStyle = useAnimatedStyle(() => {
    const progress = sidebarOpenDistance > 0 ? sidebarTranslateX.value / sidebarOpenDistance : 0
    return { opacity: interpolate(progress, [0, 1], [0, 1]) }
  }, [sidebarOpenDistance])
  const expandedMediaStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: expandedMediaTranslateX.value }, { translateY: expandedMediaTranslateY.value }],
  }))
  const contentFadeStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
  }))

  if (auth.loading) {
    return (
      <SafeAreaView
        className="items-center justify-center"
        style={{ flex: 1, backgroundColor: colors.background }}
      >
        <StatusBar barStyle={auth.isDark ? 'light-content' : 'dark-content'} />
        <ActivityIndicator color={colors.text} />
      </SafeAreaView>
    )
  }

  if (!auth.connection) {
    return (
      <ConnectScreen
        colors={colors}
        deviceName={auth.deviceName}
        error={auth.error}
        locating={locating}
        location={auth.homeLocation}
        onConnect={connect}
        onDeviceNameChange={auth.setDeviceName}
        onLocationChange={auth.setHomeLocation}
        onPairingCodeChange={auth.setPairingCode}
        onServerUrlChange={auth.setServerUrl}
        onUseCurrentLocation={useCurrentLocation}
        pairing={auth.pairing}
        pairingCode={auth.pairingCode}
        serverUrl={auth.serverUrl}
      />
    )
  }

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      <StatusBar barStyle={auth.isDark ? 'light-content' : 'dark-content'} />
      <AppSidebar
        activeScreen={activeScreen}
        bottomInset={insets.bottom}
        colors={colors}
        isDark={auth.isDark}
        liquidGlassEnabled={liquidGlassEnabled}
        mainPanelStyle={sidebarMainStyle}
        onCloseSidebar={closeSidebar}
        onOpenSidebar={openSidebar}
        onSelectScreen={showScreen}
        panGesture={sidebarPanGesture}
        sidebarBackdropStyle={sidebarBackdropStyle}
        sidebarHamburgerBlackStyle={sidebarHamburgerBlackStyle}
        sidebarHamburgerStyle={sidebarHamburgerStyle}
        sidebarHamburgerWhiteStyle={sidebarHamburgerWhiteStyle}
        sidebarOpen={sidebarOpen}
        sidebarOpenDistance={sidebarOpenDistance}
        sidebarToggleStyle={sidebarToggleStyle}
        sidebarUnderlayStyle={sidebarUnderlayStyle}
        topInset={insets.top}
      >
        <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.background }}>
          <View className="flex-1" style={{ backgroundColor: colors.background }}>
            <Animated.View className="flex-1" style={contentFadeStyle}>
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
                style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 132, zIndex: 2 }}
              />
              <TopBar
                activeScreen={displayedScreen}
                colors={colors}
                hasMessages={hasMessages}
                isDark={auth.isDark}
                liquidGlassEnabled={mainPanelGlassEnabled}
                onAddEvent={openNewFeedEvent}
                onBack={goBack}
                onFreshChat={startFreshChat}
                pageTitle={pageTitle}
              />
              {displayedScreen === 'home' ? (
                <FeedScreen
                  bottomInset={insets.bottom}
                  colors={colors}
                  emptyText={feedEmptyText}
                  emptyTitle={feedEmptyTitle}
                  error={error || (feedQuery.error instanceof Error ? feedQuery.error.message : '')}
                  isDark={auth.isDark}
                  items={visibleFeedItems}
                  liquidGlassEnabled={mainPanelGlassEnabled}
                  loading={feedRefreshInProgress}
                  onSetFeedView={setFeedView}
                  view={feedView}
                />
              ) : displayedScreen === 'chat' || displayedScreen === 'assistant' ? (
                <AssistantScreen
                  bottomInset={insets.bottom}
                  busy={busy}
                  colors={colors}
                  command={command}
                  error={error}
                  isDark={auth.isDark}
                  liquidGlassEnabled={liquidGlassEnabled}
                  messages={messages}
                  onCommandChange={setCommand}
                  onComposerFocus={() => {
                    scheduleScrollToEnd(true)
                  }}
                  onOpenMediaSheet={() => setMediaSheetVisible(true)}
                  onRemovePendingMedia={() => setPendingMedia([])}
                  onSelectActivity={setSelectedActivityMessageId}
                  onSend={sendCommand}
                  pendingMedia={pendingMedia}
                  scheduleScrollToEnd={scheduleScrollToEnd}
                  scrollRef={scrollRef}
                />
              ) : displayedScreen === 'maintenance' ? (
                <MaintenanceScreen
                  colors={colors}
                  completingId={completeMaintenanceMutation.variables?.id ?? null}
                  error={maintenanceQuery.error instanceof Error ? maintenanceQuery.error.message : ''}
                  loading={maintenanceQuery.isLoading || maintenanceQuery.isRefetching}
                  onComplete={(task) => completeMaintenanceMutation.mutate(task)}
                  onRefresh={() => maintenanceQuery.refetch()}
                  tasks={maintenanceQuery.data ?? []}
                />
              ) : displayedScreen === 'settings' ? (
                <SettingsScreen
                  bottomInset={insets.bottom}
                  colors={colors}
                  onSaved={() => {
                    setFeedAutoRefreshAttempted(false)
                    setActiveScreen('home')
                  }}
                />
              ) : (
                <MediaScreen
                  colors={colors}
                  error={mediaQuery.error instanceof Error ? mediaQuery.error.message : ''}
                  loading={mediaQuery.isLoading || mediaQuery.isRefetching}
                  media={mediaQuery.data ?? []}
                  onSelect={setSelectedMedia}
                />
              )}
            </Animated.View>
          </View>
        </SafeAreaView>
      </AppSidebar>
      <FeedUndoToast colors={colors} onUndo={undoDismissedFeedItem} visible={Boolean(feedUndo)} />
      <MediaPickerSheet
        colors={colors}
        onClose={() => setMediaSheetVisible(false)}
        onPick={pickMedia}
        visible={mediaSheetVisible}
      />
      <ExpandedMediaModal
        colors={colors}
        deleting={deleteMediaMutation.isPending}
        gesture={expandedMediaPanGesture}
        isDark={auth.isDark}
        liquidGlassEnabled={liquidGlassEnabled}
        media={selectedMedia}
        mediaStyle={expandedMediaStyle}
        onClose={closeExpandedMedia}
        onDelete={confirmDeleteSelectedMedia}
      />
      <ActivityModal
        colors={colors}
        message={selectedActivityMessage}
        onClose={() => setSelectedActivityMessageId(null)}
      />
    </View>
  )
}
