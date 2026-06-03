import { Stack } from 'expo-router'

export default function TabsLayout() {
  return (
    <Stack
      screenOptions={{
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: '#0c0a09' },
        fullScreenGestureEnabled: true,
        gestureEnabled: true,
        headerBackTitle: 'Cancel',
        headerShadowVisible: false,
        headerShown: false,
        headerStyle: { backgroundColor: '#0c0a09' },
        headerTintColor: '#d8d2d0',
        headerTitleStyle: { color: '#fbfaf9' },
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
