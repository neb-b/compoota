import React from 'react'
import { Modal, Pressable, ScrollView, Text, View } from 'react-native'

import type { AppColors } from '../../lib/theme'
import type { Message } from '../../types'

type ActivityModalProps = {
  colors: AppColors
  message: Message | null
  onClose: () => void
}

export function ActivityModal({ colors, message, onClose }: ActivityModalProps) {
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={Boolean(message)}>
      <View className="flex-1 justify-end bg-black/40 px-3 pb-8">
        <Pressable className="absolute inset-0" onPress={onClose} />
        <View className="max-h-[70%] rounded-[28px] p-4" style={{ backgroundColor: colors.background }}>
          <Text className="mb-3 text-[22px] font-extrabold" style={{ color: colors.text }}>
            Activity
          </Text>
          <ScrollView className="max-h-[420px]" showsVerticalScrollIndicator={false}>
            <View className="gap-3">
              {(message?.activity ?? []).map((step) => (
                <View className="gap-1" key={step.id}>
                  <Text className="text-base font-bold" style={{ color: colors.text }}>
                    {step.label}
                  </Text>
                  {step.detail ? (
                    <Text className="text-[14px] leading-5" style={{ color: colors.secondaryText }}>
                      {step.detail}
                    </Text>
                  ) : null}
                  <Text className="text-xs uppercase tracking-[0px]" style={{ color: colors.subtleText }}>
                    {step.status}
                  </Text>
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}
