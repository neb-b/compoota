import React from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'

import { formatMaintenanceCadence, formatMaintenanceDate } from '../../features/maintenance/model'
import type { AppColors } from '../../lib/theme'
import type { MaintenanceTask } from '../../types'

type MaintenanceScreenProps = {
  colors: AppColors
  completingId: string | null
  error: string
  loading: boolean
  onComplete: (task: MaintenanceTask) => void
  onRefresh: () => void
  tasks: MaintenanceTask[]
}

export function MaintenanceScreen({
  colors,
  completingId,
  error,
  loading,
  onComplete,
  onRefresh,
  tasks,
}: MaintenanceScreenProps) {
  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, paddingTop: 80 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={colors.text} />}
      style={{ flex: 1 }}
    >
      <View className="mb-5 gap-1">
        <Text className="text-[30px] font-extrabold leading-[36px]" style={{ color: colors.text }}>
          Maintenance
        </Text>
        <Text className="text-[15px]" style={{ color: colors.secondaryText }}>
          {tasks.length} active {tasks.length === 1 ? 'task' : 'tasks'}
        </Text>
      </View>
      {loading ? (
        <ActivityIndicator color={colors.text} className="mt-8" />
      ) : error ? (
        <Text className="text-[15px] leading-[22px]" style={{ color: colors.secondaryText }}>
          {error}
        </Text>
      ) : tasks.length ? (
        <View className="gap-3">
          {tasks.map((task) => {
            const cadenceLabel = formatMaintenanceCadence(task.cadenceDays)
            const isRecurring = Boolean(task.cadenceDays)
            return (
              <View
                className="flex-row items-center gap-3 rounded-2xl p-3"
                key={task.id}
                style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
              >
                <View className="min-w-0 flex-1 gap-1">
                  <Text className="text-base font-bold" style={{ color: colors.text }}>
                    {task.title}
                  </Text>
                  <Text className="text-[13px] leading-[18px]" style={{ color: colors.secondaryText }}>
                    {isRecurring ? 'Next due' : 'Due'} {formatMaintenanceDate(task.nextDueAt)}
                    {cadenceLabel ? ` · ${cadenceLabel}` : ''}
                  </Text>
                  {task.lastCompletedAt ? (
                    <Text className="text-[13px] leading-[18px]" style={{ color: colors.secondaryText }}>
                      Last done {formatMaintenanceDate(task.lastCompletedAt)}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  accessibilityLabel={isRecurring ? `Log ${task.title} completed` : `Complete ${task.title}`}
                  className="min-h-10 items-center justify-center rounded-full px-4 active:opacity-60"
                  disabled={completingId === task.id}
                  onPress={() => onComplete(task)}
                  style={{ backgroundColor: colors.action }}
                >
                  <Text className="text-sm font-bold" style={{ color: colors.actionText }}>
                    {isRecurring ? 'Log' : 'Complete'}
                  </Text>
                </Pressable>
              </View>
            )
          })}
        </View>
      ) : (
        <Text className="text-[15px] leading-[22px]" style={{ color: colors.secondaryText }}>
          Ask compoota to add maintenance tasks.
        </Text>
      )}
    </ScrollView>
  )
}
