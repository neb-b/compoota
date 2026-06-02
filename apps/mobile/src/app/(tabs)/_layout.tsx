import { Stack } from 'expo-router'

export default function TabsLayout() {
  return (
    <Stack
      screenOptions={{
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: '#111111' },
        fullScreenGestureEnabled: true,
        gestureEnabled: true,
        headerBackTitle: 'Cancel',
        headerShadowVisible: false,
        headerShown: false,
        headerStyle: { backgroundColor: '#111111' },
        headerTintColor: '#3b82f6',
        headerTitleStyle: { color: '#f8fafc' },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="assistant" />
      <Stack.Screen name="maintenance" />
      <Stack.Screen name="media" />
      <Stack.Screen
        name="new-event"
        options={{
          headerShown: true,
          title: '',
        }}
      />
    </Stack>
  )
}
