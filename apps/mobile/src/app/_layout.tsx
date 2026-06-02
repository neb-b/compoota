import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React from 'react';
import { StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import '../../global.css';
import { AuthProvider } from '../features/auth/AuthProvider';
import { AppQueryProvider } from '../lib/query';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    OcclusionGrotesqueYear3: require('../../assets/fonts/OcclusionGrotesque-Year3.ttf'),
  });

  React.useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <AppQueryProvider>
          <AuthProvider>
            <StatusBar
              backgroundColor="transparent"
              barStyle="light-content"
              translucent
            />
            <ThemeProvider value={DarkTheme}>
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="settings" />
              </Stack>
            </ThemeProvider>
          </AuthProvider>
        </AppQueryProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
