import { Platform } from 'react-native'

export const STORAGE_KEY = 'compoota.connection.v1'
export const PREFERENCES_KEY = 'compoota.connection-preferences.v1'
export const FEED_REFRESH_REQUEST_KEY = 'compoota.feed-refresh-request.v1'
export const APPEARANCE_KEY = 'compoota.appearance.v1'
export const THEME_COLOR_KEY = 'compoota.theme-color.v1'
export const MESSAGE_HISTORY_KEY_PREFIX = 'compoota.messages.v1.'

export const DEV_SERVER_URL = process.env.EXPO_PUBLIC_COMPOOTA_DEV_SERVER_URL
export const DEV_DEVICE_ID = process.env.EXPO_PUBLIC_COMPOOTA_DEV_DEVICE_ID
export const DEV_DEVICE_TOKEN = process.env.EXPO_PUBLIC_COMPOOTA_DEV_DEVICE_TOKEN
export const DEV_DEVICE_NAME = process.env.EXPO_PUBLIC_COMPOOTA_DEV_DEVICE_NAME ?? 'Local Simulator'
export const DEV_ONBOARDING_LOCATION = process.env.EXPO_PUBLIC_COMPOOTA_DEV_HOME_LOCATION ?? 'Saline, MI'
export const CLOUDFLARE_SERVER_URL = process.env.EXPO_PUBLIC_COMPOOTA_CLOUDFLARE_URL

export const LOCAL_SERVER_URL = Platform.select({
  android: 'http://10.0.2.2:8787',
  default: 'http://127.0.0.1:8787',
}) ?? 'http://127.0.0.1:8787'

export function messageHistoryKey(deviceId: string): string {
  return `${MESSAGE_HISTORY_KEY_PREFIX}${deviceId}`
}
