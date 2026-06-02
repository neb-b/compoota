import React from 'react'
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native'

import { mediaImageSource } from '../../features/media/model'
import type { AppColors } from '../../lib/theme'
import type { MessageMedia } from '../../types'

type MediaScreenProps = {
  colors: AppColors
  error: string
  loading: boolean
  media: MessageMedia[]
  onSelect: (media: MessageMedia) => void
}

export function MediaScreen({ colors, error, loading, media, onSelect }: MediaScreenProps) {
  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, paddingTop: 80 }}
      keyboardShouldPersistTaps="handled"
      style={{ flex: 1 }}
    >
      <View className="mb-5 gap-1">
        <Text className="text-[30px] font-extrabold leading-[36px]" style={{ color: colors.text }}>
          Media
        </Text>
        <Text className="text-[15px]" style={{ color: colors.secondaryText }}>
          {media.length} {media.length === 1 ? 'item' : 'items'}
        </Text>
      </View>
      {loading ? (
        <ActivityIndicator color={colors.text} className="mt-8" />
      ) : error ? (
        <Text className="text-[15px] leading-[22px]" style={{ color: colors.secondaryText }}>
          {error}
        </Text>
      ) : media.length ? (
        <View className="flex-row flex-wrap gap-3">
          {media
            .filter((item) => item.mimeType.startsWith('image/'))
            .map((item) => (
              <Pressable
                accessibilityLabel="Open image"
                className="aspect-square w-[31%] overflow-hidden rounded-xl active:opacity-70"
                key={item.id}
                onPress={() => onSelect(item)}
              >
                <Image
                  accessibilityLabel={item.fileName || 'Stored image'}
                  className="h-full w-full"
                  resizeMode="cover"
                  source={mediaImageSource(item)}
                />
              </Pressable>
            ))}
        </View>
      ) : (
        <Text className="text-[15px] leading-[22px]" style={{ color: colors.secondaryText }}>
          No stored media yet.
        </Text>
      )}
    </ScrollView>
  )
}
