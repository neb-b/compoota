import type { MaintenanceTask } from '../../types'

export function parseMaintenanceTasks(value: unknown): MaintenanceTask[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const task = item as Record<string, unknown>
      return {
        id: typeof task.id === 'string' ? task.id : '',
        title: typeof task.title === 'string' ? task.title : '',
        cadenceDays: typeof task.cadenceDays === 'number' ? task.cadenceDays : null,
        nextDueAt: typeof task.nextDueAt === 'string' ? task.nextDueAt : null,
        lastCompletedAt: typeof task.lastCompletedAt === 'string' ? task.lastCompletedAt : null,
        notes: typeof task.notes === 'string' ? task.notes : '',
        status: typeof task.status === 'string' ? task.status : 'active',
      }
    })
    .filter((task) => task.id && task.title)
}

export function formatMaintenanceDate(value: string | null): string {
  if (!value) {
    return 'No due date'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

export function formatMaintenanceCadence(days: number | null): string | null {
  if (!days) {
    return null
  }
  if (days % 365 === 0) {
    const years = days / 365
    return `every ${years} ${years === 1 ? 'year' : 'years'}`
  }
  if (days % 30 === 0) {
    const months = days / 30
    return `every ${months} ${months === 1 ? 'month' : 'months'}`
  }
  if (days % 7 === 0) {
    const weeks = days / 7
    return `every ${weeks} ${weeks === 1 ? 'week' : 'weeks'}`
  }
  return `every ${days} days`
}
