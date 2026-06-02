import React from 'react'
import { Modal, Pressable, Text, View } from 'react-native'

import type { AppColors } from '../../lib/theme'

type MediaPickerSheetProps = {
  colors: AppColors
  onClose: () => void
  onPick: (source: 'camera' | 'library') => void
  visible: boolean
}

export function MediaPickerSheet({ colors, onClose, onPick, visible }: MediaPickerSheetProps) {
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <View className="flex-1 justify-end bg-black/40 px-3 pb-8">
        <Pressable className="absolute inset-0" onPress={onClose} />
        <View className="gap-2 rounded-[28px] p-3" style={{ backgroundColor: colors.background }}>
          <Pressable
            className="min-h-[52px] items-center justify-center rounded-2xl active:opacity-60"
            onPress={() => onPick('camera')}
            style={{ backgroundColor: colors.input }}
          >
            <Text className="text-base font-bold" style={{ color: colors.text }}>
              Take Photo
            </Text>
          </Pressable>
          <Pressable
            className="min-h-[52px] items-center justify-center rounded-2xl active:opacity-60"
            onPress={() => onPick('library')}
            style={{ backgroundColor: colors.input }}
          >
            <Text className="text-base font-bold" style={{ color: colors.text }}>
              Choose From Library
            </Text>
          </Pressable>
          <Pressable
            className="min-h-[52px] items-center justify-center rounded-2xl active:opacity-60"
            onPress={onClose}
          >
            <Text className="text-base font-bold" style={{ color: colors.secondaryText }}>
              Cancel
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}
