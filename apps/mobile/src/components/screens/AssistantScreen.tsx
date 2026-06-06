import React from 'react'
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View, Platform } from 'react-native'
import Animated, { useAnimatedStyle } from 'react-native-reanimated'
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller'

import { activityStatusText } from '../../features/assistant/model'
import { mediaImageSource } from '../../features/media/model'
import type { AppColors } from '../../lib/theme'
import type { Message, PendingMedia } from '../../types'
import { AppleIcon, GlassSurface } from '../ui'

const COMPOSER_INPUT_MIN_HEIGHT = 30
const COMPOSER_INPUT_MAX_HEIGHT = 116

type AssistantScreenProps = {
  bottomInset: number
  busy: boolean
  colors: AppColors
  command: string
  error: string
  isDark: boolean
  liquidGlassEnabled: boolean
  messages: Message[]
  onCommandChange: (value: string) => void
  onComposerFocus: () => void
  onOpenMediaSheet: () => void
  onRemovePendingMedia: () => void
  onSelectActivity: (messageId: string) => void
  onSend: () => void
  pendingMedia: PendingMedia[]
  scrollRef: React.RefObject<ScrollView | null>
  scheduleScrollToEnd: (animated?: boolean) => void
}

export function AssistantScreen({
  bottomInset,
  busy,
  colors,
  command,
  error,
  isDark,
  liquidGlassEnabled,
  messages,
  onCommandChange,
  onComposerFocus,
  onOpenMediaSheet,
  onRemovePendingMedia,
  onSelectActivity,
  onSend,
  pendingMedia,
  scrollRef,
  scheduleScrollToEnd,
}: AssistantScreenProps) {
  const visibleMessages = messages.filter((message) => message.text || message.media?.length || message.activity?.length)
  const [composerInputExpanded, setComposerInputExpanded] = React.useState(false)
  const [composerInputScrollable, setComposerInputScrollable] = React.useState(false)
  const keyboard = useReanimatedKeyboardAnimation()
  const composerClosedBottom = Math.max(bottomInset, 16)
  const composerOpenGap = 5
  const composerStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY:
          keyboard.height.value + keyboard.progress.value * (composerClosedBottom - composerOpenGap),
      },
    ],
  }))

  return (
    <>
      <ScrollView
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        contentContainerStyle={{ gap: 26, paddingHorizontal: 18, paddingBottom: 142, paddingTop: 82 }}
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scheduleScrollToEnd(false)}
        onLayout={() => scheduleScrollToEnd(false)}
        ref={scrollRef}
        style={{ flex: 1 }}
      >
        {visibleMessages.length === 0 ? (
          <View className="w-full max-w-[560px] self-center" style={styles.emptyState}>
            <View style={[styles.emptyMark, { backgroundColor: colors.primaryText }]} />
            <Text className="text-[34px]" style={[styles.emptyTitle, { color: colors.text }]}>
              chat
            </Text>
          </View>
        ) : (
          visibleMessages.map((message) => {
            const displayText = message.role === 'assistant' ? message.text.replace(/^\s+/, '') : message.text

            return (
              <View
                className={message.role === 'user' ? 'w-full max-w-[560px] flex-row justify-end self-center' : 'w-full max-w-[560px] flex-row self-center'}
                key={message.id}
              >
                <View className={message.role === 'user' ? 'max-w-[80%]' : 'w-full'}>
                {message.role === 'assistant' && message.isStreaming && !displayText ? (
                  <View className="mb-2 flex-row items-center gap-2 px-1">
                    <View
                      style={[
                        styles.liveDot,
                        { backgroundColor: colors.primaryText },
                      ]}
                    />
                    <Text className="text-[13px]" style={[styles.traceText, { color: colors.subtleText }]}>
                      {activityStatusText(message)}
                    </Text>
                  </View>
                ) : null}
                {message.media?.length ? (
                  <View className="mb-2 flex-row flex-wrap gap-2">
                    {message.media.map((item) => (
                      <View className="h-[132px] w-[132px] overflow-hidden rounded-xl" key={item.id}>
                        <Image
                          accessibilityLabel="Uploaded photo"
                          className="h-full w-full"
                          resizeMode="cover"
                          source={mediaImageSource(item)}
                        />
                      </View>
                    ))}
                  </View>
                ) : null}
                {displayText ? (
                  message.role === 'user' ? (
                    <Text
                      className="rounded-[22px] px-4 py-3 text-[17px] leading-[23px]"
                      style={{
                        backgroundColor: colors.userBubble,
                        color: colors.userText,
                      }}
                    >
                      {displayText}
                    </Text>
                  ) : (
                    <Text className="px-1 text-[18px] leading-[27px]" style={{ color: colors.text }}>
                      {displayText}
                      {message.isStreaming ? (
                        <Text style={{ color: colors.primaryText }}> |</Text>
                      ) : null}
                    </Text>
                  )
                ) : null}
                </View>
              </View>
            )
          })
        )}
      </ScrollView>

      {error ? (
        <Text className="absolute bottom-[98px] left-6 right-6 z-[2] text-center text-[13px]" style={{ color: colors.error }}>
          {error}
        </Text>
      ) : null}

      <Animated.View
        style={[
          styles.composerDock,
          {
            bottom: composerClosedBottom,
          },
          composerStyle,
        ]}
      >
        <View className="flex-row items-end gap-2.5">
          <Pressable
            accessibilityLabel="Add photo"
            className="h-[50px] w-[50px] rounded-full active:scale-[0.97]"
            disabled={busy}
            onPress={onOpenMediaSheet}
          >
            <GlassSurface
              colorScheme={isDark ? 'dark' : 'light'}
              enabled={liquidGlassEnabled}
              isInteractive
              style={styles.attachButton}
              tintColor={colors.glassTint}
            >
              <AppleIcon color={colors.text} name="plus" size={27} weight="regular" />
            </GlassSurface>
          </Pressable>

          <GlassSurface
            colorScheme={isDark ? 'dark' : 'light'}
            enabled={liquidGlassEnabled}
            isInteractive
            style={[
              styles.composer,
              {
                backgroundColor: liquidGlassEnabled ? 'transparent' : colors.input,
                borderColor: colors.border,
              },
            ]}
            tintColor={colors.glassTint}
          >
            {pendingMedia.length ? (
              <View className="mb-2 flex-row gap-2">
                {pendingMedia.map((item) => (
                  <View className="relative h-[58px] w-[58px] overflow-hidden rounded-xl" key={item.id}>
                    <Image className="h-full w-full" resizeMode="cover" source={{ uri: item.uri }} />
                    <Pressable
                      accessibilityLabel="Remove selected photo"
                      className="absolute right-1 top-1 h-5 w-5 items-center justify-center rounded-full bg-black/60"
                      onPress={onRemovePendingMedia}
                    >
                      <AppleIcon color="#ffffff" name="xmark" size={10} />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}
            <View style={[styles.composerInputRow, { alignItems: composerInputExpanded ? 'flex-end' : 'center' }]}>
              <TextInput
                className="flex-1 text-base"
                keyboardAppearance={isDark ? 'dark' : 'light'}
                multiline
                onBlur={() => undefined}
                onChangeText={onCommandChange}
                onContentSizeChange={(event) => {
                  const contentHeight = event.nativeEvent.contentSize.height
                  setComposerInputExpanded(contentHeight > COMPOSER_INPUT_MIN_HEIGHT + 4)
                  setComposerInputScrollable(contentHeight > COMPOSER_INPUT_MAX_HEIGHT)
                }}
                onFocus={() => {
                  onComposerFocus()
                }}
                onKeyPress={(event) => {
                  if (event.nativeEvent.key === 'Enter') {
                    onSend()
                  }
                }}
                onSubmitEditing={onSend}
                placeholder="compoota..."
                placeholderTextColor={colors.placeholder}
                returnKeyType="send"
                scrollEnabled={composerInputScrollable}
                selectionColor={colors.selection}
                style={[
                  styles.composerInput,
                  composerInputExpanded ? styles.composerInputExpanded : styles.composerInputSingleLine,
                  { color: colors.text },
                ]}
                submitBehavior="submit"
                value={command}
              />
              <Pressable
                accessibilityLabel="Send message"
                className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
                disabled={busy}
                onPress={onSend}
                style={{ backgroundColor: colors.action, opacity: busy ? 0.45 : 1 }}
              >
                <AppleIcon color={colors.actionText} name="arrow.up" size={20} weight="bold" />
              </Pressable>
            </View>
          </GlassSurface>
        </View>
      </Animated.View>
    </>
  )
}

const styles = StyleSheet.create({
  attachButton: {
    flex: 1,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.52)',
  },
  composer: {
    flex: 1,
    minHeight: 50,
    borderRadius: 25,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  composerDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: 16,
  },
  composerInputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  composerInput: {
    maxHeight: COMPOSER_INPUT_MAX_HEIGHT,
    minHeight: COMPOSER_INPUT_MIN_HEIGHT,
    includeFontPadding: false,
    lineHeight: 22,
    paddingBottom: 0,
    paddingTop: 0,
  },
  composerInputExpanded: {
    textAlignVertical: 'top',
  },
  composerInputSingleLine: {
    textAlignVertical: 'center',
  },
  emptyMark: {
    height: 2,
    width: 74,
    borderRadius: 1,
    transform: [{ rotate: '-1.7deg' }],
  },
  emptyState: {
    minHeight: 360,
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 8,
  },
  emptyTitle: {
    fontFamily: 'Geist',
    lineHeight: 39,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  traceText: {
    fontFamily: 'Geist',
    lineHeight: 17,
  },
})
