import React from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { CLOUDFLARE_SERVER_URL, LOCAL_SERVER_URL } from '../../lib/constants'
import type { AppColors } from '../../lib/theme'
import { AppleIcon } from '../ui'

type ConnectScreenProps = {
  colors: AppColors
  deviceName: string
  error: string
  locating: boolean
  location: string
  onConnect: () => void
  onDeviceNameChange: (value: string) => void
  onLocationChange: (value: string) => void
  onPairingCodeChange: (value: string) => void
  onServerUrlChange: (value: string) => void
  onUseCurrentLocation: () => void
  pairing: boolean
  pairingCode: string
  serverUrl: string
}

export function ConnectScreen({
  colors,
  deviceName,
  error,
  locating,
  location,
  onConnect,
  onDeviceNameChange,
  onLocationChange,
  onPairingCodeChange,
  onServerUrlChange,
  onUseCurrentLocation,
  pairing,
  pairingCode,
  serverUrl,
}: ConnectScreenProps) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <View className="flex-1 justify-center px-6 pb-10 pt-6">
          <View className="gap-2.5 pb-8">
            <Text className="font-display text-[52px] leading-[56px]" style={{ color: colors.text }}>
              compoota
            </Text>
            <Text className="max-w-[340px] text-[17px] leading-6" style={{ color: colors.secondaryText }}>
              choose a house-server, then enter a fresh pairing code
            </Text>
          </View>

          <View className="gap-3.5">
            <View className="flex-row flex-wrap gap-2.5">
              <ServerTargetButton
                active={serverUrl.trim() === LOCAL_SERVER_URL}
                colors={colors}
                label="Mac local"
                onPress={() => onServerUrlChange(LOCAL_SERVER_URL)}
              />
              {CLOUDFLARE_SERVER_URL ? (
                <ServerTargetButton
                  active={serverUrl.trim() === CLOUDFLARE_SERVER_URL}
                  colors={colors}
                  label="Cloudflare"
                  onPress={() => onServerUrlChange(CLOUDFLARE_SERVER_URL!)}
                />
              ) : null}
            </View>

            <Field label="server url" colors={colors}>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                onChangeText={onServerUrlChange}
                placeholder={LOCAL_SERVER_URL}
                placeholderTextColor={colors.placeholder}
                className="min-h-[50px] rounded-2xl px-3.5 text-base"
                style={{ backgroundColor: colors.input, borderColor: colors.border, borderWidth: 1, color: colors.text }}
                value={serverUrl}
              />
            </Field>

            <Field label="pairing code" colors={colors}>
              <TextInput
                keyboardType="number-pad"
                maxLength={6}
                onChangeText={onPairingCodeChange}
                placeholder="123456"
                placeholderTextColor={colors.placeholder}
                className="min-h-[50px] rounded-2xl px-3.5 text-base"
                style={{
                  backgroundColor: colors.input,
                  borderColor: colors.border,
                  borderWidth: 1,
                  color: colors.text,
                  fontVariant: ['tabular-nums'],
                }}
                value={pairingCode}
              />
            </Field>

            <Field label="nearby area" colors={colors}>
              <View className="flex-row items-center gap-2.5">
                <TextInput
                  autoCapitalize="words"
                  autoCorrect={false}
                  onChangeText={onLocationChange}
                  placeholder="Ann Arbor, MI"
                  placeholderTextColor={colors.placeholder}
                  className="min-h-[50px] flex-1 rounded-2xl px-3.5 text-base"
                  style={{ backgroundColor: colors.input, borderColor: colors.border, borderWidth: 1, color: colors.text }}
                  value={location}
                />
                <Pressable
                  accessibilityLabel="Use current location"
                  className="h-[50px] w-[50px] items-center justify-center rounded-full active:opacity-60"
                  disabled={locating}
                  onPress={onUseCurrentLocation}
                  style={{ backgroundColor: colors.action }}
                >
                  {locating ? (
                    <ActivityIndicator color={colors.actionText} />
                  ) : (
                    <AppleIcon color={colors.actionText} name="location.fill" size={19} />
                  )}
                </Pressable>
              </View>
            </Field>

            <Field label="device name" colors={colors}>
              <TextInput
                autoCapitalize="words"
                onChangeText={onDeviceNameChange}
                placeholder={Platform.select({ ios: 'iPhone', android: 'Android', default: 'compoota device' })}
                placeholderTextColor={colors.placeholder}
                className="min-h-[50px] rounded-2xl px-3.5 text-base"
                style={{ backgroundColor: colors.input, borderColor: colors.border, borderWidth: 1, color: colors.text }}
                value={deviceName}
              />
            </Field>

            {error ? <Text className="text-sm leading-5" style={{ color: colors.error }}>{error}</Text> : null}

            <Pressable
              className="mt-1 h-[54px] items-center justify-center rounded-full active:opacity-60"
              disabled={pairing}
              onPress={onConnect}
              style={{ backgroundColor: colors.action }}
            >
              {pairing ? (
                <ActivityIndicator color={colors.actionText} />
              ) : (
                <Text className="text-base font-bold" style={{ color: colors.actionText }}>
                  connect
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function Field({ children, colors, label }: { children: React.ReactNode; colors: AppColors; label: string }) {
  return (
    <View className="gap-2">
      <Text className="text-[13px] font-semibold" style={{ color: colors.secondaryText }}>
        {label}
      </Text>
      {children}
    </View>
  )
}

function ServerTargetButton({
  active,
  colors,
  label,
  onPress,
}: {
  active: boolean
  colors: AppColors
  label: string
  onPress: () => void
}) {
  return (
    <Pressable
      className="min-h-[38px] items-center justify-center rounded-full px-3.5 active:opacity-60"
      onPress={onPress}
      style={{
        backgroundColor: active ? colors.action : colors.input,
        borderColor: active ? colors.action : colors.border,
        borderWidth: 1,
      }}
    >
      <Text className="text-sm font-bold" style={{ color: active ? colors.actionText : colors.text }}>
        {label}
      </Text>
    </Pressable>
  )
}
