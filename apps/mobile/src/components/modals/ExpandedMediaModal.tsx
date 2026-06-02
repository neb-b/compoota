import React from 'react'
import { Image, Modal, Pressable, StyleSheet, View } from 'react-native'
import { GestureDetector } from 'react-native-gesture-handler'
import Animated from 'react-native-reanimated'

import { mediaImageSource } from '../../features/media/model'
import type { AppColors } from '../../lib/theme'
import type { MessageMedia } from '../../types'
import { AppleIcon, GlassSurface } from '../ui'

type ExpandedMediaModalProps = {
  colors: AppColors
  deleting: boolean
  gesture: any
  isDark: boolean
  liquidGlassEnabled: boolean
  media: MessageMedia | null
  mediaStyle: any
  onClose: () => void
  onDelete: () => void
}

export function ExpandedMediaModal({
  colors,
  deleting,
  gesture,
  isDark,
  liquidGlassEnabled,
  media,
  mediaStyle,
  onClose,
  onDelete,
}: ExpandedMediaModalProps) {
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={Boolean(media)}>
      <View className="flex-1 items-center justify-center bg-black/80">
        <Pressable className="absolute inset-0" onPress={onClose} />
        {media ? (
          <>
            <GestureDetector gesture={gesture as never}>
              <Animated.View className="h-[78%] w-[92%]" style={mediaStyle}>
                <Image
                  accessibilityLabel={media.fileName || 'Selected image'}
                  className="h-full w-full"
                  resizeMode="contain"
                  source={mediaImageSource(media)}
                />
              </Animated.View>
            </GestureDetector>
            <View className="absolute right-5 top-16 flex-row gap-2">
              <Pressable
                accessibilityLabel="Delete image"
                className="h-[46px] w-[46px] rounded-full active:scale-[0.97]"
                disabled={deleting}
                onPress={onDelete}
              >
                <GlassSurface
                  colorScheme={isDark ? 'dark' : 'light'}
                  enabled={liquidGlassEnabled}
                  isInteractive
                  style={styles.actionButton}
                  tintColor={colors.glassTint}
                >
                  <AppleIcon color="#ffffff" name="trash" size={20} />
                </GlassSurface>
              </Pressable>
              <Pressable
                accessibilityLabel="Close image"
                className="h-[46px] w-[46px] rounded-full active:scale-[0.97]"
                onPress={onClose}
              >
                <GlassSurface
                  colorScheme={isDark ? 'dark' : 'light'}
                  enabled={liquidGlassEnabled}
                  isInteractive
                  style={styles.actionButton}
                  tintColor={colors.glassTint}
                >
                  <AppleIcon color="#ffffff" name="xmark" size={18} />
                </GlassSurface>
              </Pressable>
            </View>
          </>
        ) : null}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  actionButton: {
    flex: 1,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.42)',
    backgroundColor: 'transparent',
  },
})
