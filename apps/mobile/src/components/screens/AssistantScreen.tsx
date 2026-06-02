import React from 'react'
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View, Platform } from 'react-native'
import { KeyboardStickyView } from 'react-native-keyboard-controller'

import { activityStatusText } from '../../features/assistant/model'
import { mediaImageSource } from '../../features/media/model'
import type { AppColors } from '../../lib/theme'
import type { Message, PendingMedia } from '../../types'
import { AppleIcon, GlassSurface } from '../ui'

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
  return (
    <>
      <ScrollView
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        contentContainerStyle={{ gap: 24, paddingHorizontal: 20, paddingBottom: 142, paddingTop: 64 }}
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scheduleScrollToEnd(false)}
        onLayout={() => scheduleScrollToEnd(false)}
        ref={scrollRef}
        style={{ flex: 1 }}
      >
        {messages
          .filter((message) => message.text || message.media?.length || message.activity?.length)
          .map((message) => (
            <View
              className={message.role === 'user' ? 'w-full max-w-[560px] flex-row justify-end self-center' : 'w-full max-w-[560px] flex-row self-center'}
              key={message.id}
            >
              <View className={message.role === 'user' ? 'max-w-[78%]' : 'max-w-[86%]'}>
                {message.role === 'assistant' && message.activity?.length ? (
                  <Pressable
                    className="mb-2 rounded-full px-3 py-2 active:opacity-70"
                    onPress={() => onSelectActivity(message.id)}
                    style={{ backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }}
                  >
                    <Text className="text-[13px] font-bold" style={{ color: colors.secondaryText }}>
                      {activityStatusText(message)}
                    </Text>
                  </Pressable>
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
                {message.text ? (
                  <Text
                    className={message.role === 'user' ? 'rounded-[22px] px-4 py-3 text-base leading-[22px]' : 'text-base leading-[24px]'}
                    style={{
                      backgroundColor: message.role === 'user' ? colors.userBubble : 'transparent',
                      color: message.role === 'user' ? colors.userText : colors.text,
                    }}
                  >
                    {message.text}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
      </ScrollView>

      {error ? (
        <Text className="absolute bottom-[98px] left-6 right-6 z-[2] text-center text-[13px]" style={{ color: colors.error }}>
          {error}
        </Text>
      ) : null}

      <KeyboardStickyView
        offset={{ opened: Math.max(bottomInset, 16) }}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingBottom: 16 }}
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
                    <View className="h-full w-full items-center justify-center" style={{ backgroundColor: colors.accentSoft }}>
                      <AppleIcon color={colors.accent} name="photo.fill" size={24} />
                    </View>
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
            <View className="flex-row items-end gap-2">
              <TextInput
                className="max-h-[116px] min-h-[34px] flex-1 py-1 text-base leading-[22px]"
                keyboardAppearance={isDark ? 'dark' : 'light'}
                multiline
                onBlur={() => undefined}
                onChangeText={onCommandChange}
                onFocus={onComposerFocus}
                onSubmitEditing={onSend}
                placeholder="Ask compoota"
                placeholderTextColor={colors.placeholder}
                returnKeyType="default"
                selectionColor={colors.selection}
                style={{ color: colors.text }}
                value={command}
              />
              <Pressable
                accessibilityLabel="Send message"
                className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
                disabled={busy}
                onPress={onSend}
                style={{ backgroundColor: colors.action }}
              >
                <AppleIcon color={colors.actionText} name="arrow.up" size={20} weight="bold" />
              </Pressable>
            </View>
          </GlassSurface>
        </View>
      </KeyboardStickyView>
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
})
