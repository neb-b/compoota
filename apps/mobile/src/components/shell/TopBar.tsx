import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import type { ActiveScreen } from '../../types'
import type { AppColors } from '../../lib/theme'
import { AppleIcon, GlassSurface } from '../ui'

type TopBarProps = {
  activeScreen: ActiveScreen
  colors: AppColors
  hasMessages: boolean
  isDark: boolean
  liquidGlassEnabled: boolean
  onAddEvent: () => void
  onBack: () => void
  onFreshChat: () => void
  pageTitle: string
}

export function TopBar({
  activeScreen,
  colors,
  hasMessages,
  isDark,
  liquidGlassEnabled,
  onAddEvent,
  onBack,
  onFreshChat,
  pageTitle,
}: TopBarProps) {
  const isChatScreen = activeScreen === 'chat' || activeScreen === 'assistant'

  return (
    <View className="absolute left-4 right-4 top-2 z-[3] flex-row items-center justify-between">
      {activeScreen === 'home' ? (
        <>
          <View className="h-[46px] w-[46px]" pointerEvents="none" />
          <View className="h-[46px] w-[46px]" pointerEvents="none" />
          <IconButton
            accessibilityLabel="Add event"
            colors={colors}
            icon="plus"
            isDark={isDark}
            liquidGlassEnabled={liquidGlassEnabled}
            onPress={onAddEvent}
            size={24}
          />
        </>
      ) : activeScreen === 'settings' ? (
        <>
          <View className="h-[46px] w-[46px]" pointerEvents="none" />
          <Text className="max-w-[190px] text-center text-lg font-extrabold" numberOfLines={1} style={{ color: colors.text }}>
            Settings
          </Text>
          <View className="h-[46px] w-[46px]" pointerEvents="none" />
        </>
      ) : (
        <>
          {isChatScreen ? (
            <View className="h-[46px] w-[46px]" pointerEvents="none" />
          ) : (
            <IconButton
              accessibilityLabel="Back to home"
              colors={colors}
              icon="chevron.left"
              isDark={isDark}
              liquidGlassEnabled={liquidGlassEnabled}
              onPress={onBack}
              size={22}
            />
          )}
          <Text className="max-w-[190px] text-center text-lg font-extrabold" numberOfLines={1} style={{ color: colors.text }}>
            {pageTitle}
          </Text>
          {isChatScreen && hasMessages ? (
            <IconButton
              accessibilityLabel="Start new chat"
              colors={colors}
              icon="square.and.pencil"
              isDark={isDark}
              liquidGlassEnabled={liquidGlassEnabled}
              onPress={onFreshChat}
              size={22}
            />
          ) : (
            <View className="h-[46px] w-[46px]" pointerEvents="none" />
          )}
        </>
      )}
    </View>
  )
}

function IconButton({
  accessibilityLabel,
  colors,
  icon,
  isDark,
  liquidGlassEnabled,
  onPress,
  size,
}: {
  accessibilityLabel: string
  colors: AppColors
  icon: Parameters<typeof AppleIcon>[0]['name']
  isDark: boolean
  liquidGlassEnabled: boolean
  onPress: () => void
  size: number
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      className="h-[46px] w-[46px] rounded-full active:scale-[0.97]"
      onPress={onPress}
    >
      <GlassSurface
        colorScheme={isDark ? 'dark' : 'light'}
        enabled={liquidGlassEnabled}
        isInteractive
        style={[
          styles.iconGlass,
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
        <AppleIcon color={colors.text} name={icon} size={size} />
      </GlassSurface>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  iconGlass: {
    flex: 1,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#6f6f68',
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  tabBarGlass: {
    borderRadius: 23,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#6f6f68',
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
})
