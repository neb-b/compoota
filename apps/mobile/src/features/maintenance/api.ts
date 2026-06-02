import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { requestJson } from '../../lib/api/client'
import type { Connection, MaintenanceTask } from '../../types'
import { parseMaintenanceTasks } from './model'

export const maintenanceQueryKey = (connection: Connection | null) =>
  ['maintenance', connection?.deviceId] as const

export function useMaintenanceQuery(connection: Connection | null) {
  return useQuery({
    queryKey: maintenanceQueryKey(connection),
    enabled: Boolean(connection),
    queryFn: async () =>
      parseMaintenanceTasks(
        (
          await requestJson<{ tasks?: unknown }>('/maintenance', {
            connection,
          })
        ).tasks,
      ),
  })
}

export function useCompleteMaintenanceMutation(connection: Connection | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (task: MaintenanceTask) =>
      parseMaintenanceTasks(
        (
          await requestJson<{ tasks?: unknown }>(`/maintenance/${task.id}/complete`, {
            connection,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          })
        ).tasks,
      ),
    onSuccess: (tasks) => {
      queryClient.setQueryData(maintenanceQueryKey(connection), tasks)
    },
  })
}
