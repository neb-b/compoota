import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect'
import { SymbolView, type SFSymbol } from 'expo-symbols'
import React from 'react'
import { Platform, View, type StyleProp, type ViewStyle } from 'react-native'

type GlassSurfaceProps = {
  animate?: boolean
  children: React.ReactNode
  colorScheme: 'light' | 'dark'
  enabled: boolean
  glassEffectStyle?: 'clear' | 'regular'
  isInteractive?: boolean
  style: StyleProp<ViewStyle>
  tintColor?: string
}

type AppleIconProps = {
  color: string
  name: SFSymbol
  size?: number
  weight?: 'regular' | 'medium' | 'semibold' | 'bold'
}

export function canRenderLiquidGlass(): boolean {
  if (Platform.OS !== 'ios') {
    return false
  }

  try {
    return isGlassEffectAPIAvailable()
  } catch {
    return false
  }
}

export function GlassSurface({
  animate = true,
  children,
  colorScheme,
  enabled,
  glassEffectStyle = 'regular',
  isInteractive,
  style,
  tintColor,
}: GlassSurfaceProps) {
  if (!enabled) {
    return <View style={style}>{children}</View>
  }

  return (
    <GlassView
      colorScheme={colorScheme}
      glassEffectStyle={{ style: glassEffectStyle, animate, animationDuration: 0.22 }}
      isInteractive={isInteractive}
      style={style}
      tintColor={tintColor}
    >
      {children}
    </GlassView>
  )
}

export function AppleIcon({ color, name, size = 22, weight = 'medium' }: AppleIconProps) {
  return (
    <SymbolView
      name={name}
      resizeMode="scaleAspectFit"
      size={size}
      tintColor={color}
      type="monochrome"
      weight={weight}
    />
  )
}
