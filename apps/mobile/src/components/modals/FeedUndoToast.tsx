import React from 'react'
import { Pressable, Text, View } from 'react-native'

import type { AppColors } from '../../lib/theme'

type FeedUndoToastProps = {
  colors: AppColors
  onUndo: () => void
  visible: boolean
}

export function FeedUndoToast({ colors, onUndo, visible }: FeedUndoToastProps) {
  if (!visible) {
    return null
  }

  return (
    <View className="absolute bottom-8 left-4 right-4 z-20" pointerEvents="box-none">
      <View className="mx-auto flex-row items-center gap-3 rounded-full px-4 py-3" style={{ backgroundColor: colors.text }}>
        <Text className="max-w-[230px] text-sm font-semibold" numberOfLines={1} style={{ color: colors.background }}>
          Removed from the household feed
        </Text>
        <Pressable accessibilityLabel="Undo removed feed item" className="active:opacity-60" onPress={onUndo}>
          <Text className="text-sm font-extrabold" style={{ color: colors.action }}>
            Undo
          </Text>
        </Pressable>
      </View>
    </View>
  )
}
