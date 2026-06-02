import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

export async function registerForPushToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return null
  }

  try {
    const existing = await Notifications.getPermissionsAsync()
    const permission = existing.granted ? existing : await Notifications.requestPermissionsAsync()
    if (!permission.granted) {
      return null
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
    const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)
    return token.data
  } catch {
    return null
  }
}
