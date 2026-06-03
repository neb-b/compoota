import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { GestureDetector } from 'react-native-gesture-handler'
import Animated from 'react-native-reanimated'

import type { ActiveScreen } from '../types'
import { PRIMARY_COLOR, type AppColors } from '../lib/theme'
import { AppleIcon, GlassSurface } from './ui'

export const SIDEBAR_EDGE_HIT_SLOP = 30
export const SIDEBAR_LAYER_RADIUS = 58
export const SIDEBAR_HORIZONTAL_PADDING = 24
export const SIDEBAR_TOGGLE_OPEN_GAP = 10
export const SIDEBAR_TOGGLE_MARGIN = 16
export const SIDEBAR_TOGGLE_CLOSED_SIZE = 46

export const SIDEBAR_SPRING = {
  damping: 28,
  mass: 0.9,
  stiffness: 240,
}

const SIDEBAR_NAV_ITEMS: Array<{
  label: string
  screen?: ActiveScreen
  accessibilityLabel: string
  action?: 'settings'
}> = [
  { label: 'home', screen: 'home', accessibilityLabel: 'Open home feed' },
  // { label: 'Assistant', screen: 'assistant', accessibilityLabel: 'Open assistant', icon: 'sparkles' },
  // { label: 'Media', screen: 'media', accessibilityLabel: 'Open media', icon: 'photo.stack.fill' },
  { label: 'settings', screen: 'settings', accessibilityLabel: 'Open settings' },
  // {
  //   label: 'Maintenance',
  //   screen: 'maintenance',
  //   accessibilityLabel: 'Open maintenance',
  //   icon: 'wrench.and.screwdriver.fill',
  // },
]

const SIDEBAR_ACTIVE_TEXT = PRIMARY_COLOR

type AppSidebarProps = {
  activeScreen: ActiveScreen
  bottomInset: number
  children: React.ReactNode
  colors: AppColors
  isDark: boolean
  liquidGlassEnabled: boolean
  mainPanelStyle: any
  onCloseSidebar: () => void
  onOpenSidebar: () => void
  onSelectScreen: (screen: ActiveScreen) => void
  panGesture: any
  sidebarBackdropStyle: any
  sidebarHamburgerBlackStyle: any
  sidebarHamburgerStyle: any
  sidebarHamburgerWhiteStyle: any
  sidebarOpen: boolean
  sidebarOpenDistance: number
  sidebarToggleStyle: any
  sidebarUnderlayStyle: any
  topInset: number
}

function SidebarGridBackground() {
  return (
    <View
      accessibilityElementsHidden
      className="absolute inset-0"
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{ backgroundColor: '#000000' }}
    />
  )
}

export function AppSidebar({
  activeScreen,
  bottomInset,
  children,
  colors,
  isDark,
  liquidGlassEnabled,
  mainPanelStyle,
  onCloseSidebar,
  onOpenSidebar,
  onSelectScreen,
  panGesture,
  sidebarBackdropStyle,
  sidebarHamburgerBlackStyle,
  sidebarHamburgerStyle,
  sidebarHamburgerWhiteStyle,
  sidebarOpen,
  sidebarOpenDistance,
  sidebarToggleStyle,
  sidebarUnderlayStyle,
  topInset,
}: AppSidebarProps) {
  const sidebarButtonFill = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.74)'
  const sidebarButtonBorder = isDark ? 'rgba(255,255,255,0.36)' : 'rgba(255,255,255,0.82)'

  return (
    <View className="flex-1 overflow-hidden bg-slate-950">
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, sidebarBackdropStyle]}>
        <SidebarGridBackground />
      </Animated.View>
      <Animated.View
        pointerEvents={sidebarOpen ? 'auto' : 'none'}
        style={[
          styles.sidebarUnderlay,
          {
            width: sidebarOpenDistance,
            paddingTop: topInset + 17,
            paddingBottom: Math.max(bottomInset, 18) + 18,
          },
          sidebarUnderlayStyle,
        ]}
      >
        <View className="relative z-[1] flex-1 justify-between gap-4">
          <View className="z-[1] gap-2 pt-28">
            <View className="gap-1.5">
              <View className="mr-9 min-h-[58px] justify-center px-3.5">
                <Text
                  className="text-2xl text-white"
                  style={styles.sidebarTitleText}
                >
                  compoota...
                </Text>
              </View>
              <View className="gap-1.5 pt-12">
                {SIDEBAR_NAV_ITEMS.map((item) => {
                  const active = item.screen === activeScreen
                  return (
                    <Pressable
                      accessibilityLabel={item.accessibilityLabel}
                      className="mr-9 min-h-[44px] justify-center rounded-[18px] bg-transparent px-3.5 active:opacity-60"
                      key={item.action ?? item.screen}
                      onPress={() => {
                        if (item.screen) {
                          onSelectScreen(item.screen)
                        }
                      }}
                    >
                      <View className="z-[1] flex-row items-center justify-start">
                        <Text
                          className="text-3xl"
                          style={[styles.sidebarNavText, { color: active ? SIDEBAR_ACTIVE_TEXT : colors.sidebarText }]}
                        >
                          {item.label}
                        </Text>
                      </View>
                    </Pressable>
                  )
                })}
              </View>
            </View>
          </View>
        </View>
      </Animated.View>

      <GestureDetector gesture={panGesture as never}>
        <Animated.View
          className="absolute inset-0 overflow-hidden"
          style={[
            styles.mainPanel,
            {
              backgroundColor: colors.background,
              borderColor: isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.08)',
            },
            mainPanelStyle,
          ]}
        >
          {children}
          {sidebarOpen ? (
            <Pressable
              accessibilityLabel="Close sidebar"
              className="absolute inset-0 z-[8]"
              onPress={onCloseSidebar}
            />
          ) : null}
        </Animated.View>
      </GestureDetector>

      <Animated.View
        style={[
          styles.sidebarToggle,
          {
            top: topInset + 8,
          },
          sidebarToggleStyle,
        ]}
      >
        <GlassSurface
          animate={false}
          colorScheme={isDark ? 'dark' : 'light'}
          enabled={liquidGlassEnabled}
          glassEffectStyle="regular"
          style={[
            styles.sidebarGlassCircle,
            {
              backgroundColor: liquidGlassEnabled ? 'transparent' : sidebarButtonFill,
              borderColor: liquidGlassEnabled ? 'rgba(255,255,255,0.52)' : sidebarButtonBorder,
            },
          ]}
          tintColor={colors.glassTint}
        >
          <Pressable
            accessibilityLabel={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
            className="h-full w-full items-center justify-center rounded-full active:scale-[0.97]"
            onPress={sidebarOpen ? onCloseSidebar : onOpenSidebar}
          >
            <Animated.View style={[styles.sidebarHamburgerIconStack, sidebarHamburgerStyle]}>
              <Animated.View style={[styles.sidebarHamburgerIconLayer, sidebarHamburgerBlackStyle]}>
                <AppleIcon color="#ffffff" name="line.3.horizontal" size={23} />
              </Animated.View>
              <Animated.View style={[styles.sidebarHamburgerIconLayer, sidebarHamburgerWhiteStyle]}>
                <AppleIcon color="#ffffff" name="line.3.horizontal" size={23} />
              </Animated.View>
            </Animated.View>
          </Pressable>
        </GlassSurface>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  sidebarUnderlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    paddingHorizontal: SIDEBAR_HORIZONTAL_PADDING,
    backgroundColor: 'transparent',
    overflow: 'hidden',
    zIndex: 1,
  },
  sidebarTitleText: {
    fontFamily: 'Geist',
    lineHeight: 29,
  },
  sidebarNavText: {
    fontFamily: 'Geist',
    lineHeight: 35,
  },
  mainPanel: {
    zIndex: 3,
    shadowColor: '#000000',
    shadowRadius: 36,
    shadowOffset: { width: -14, height: 0 },
    elevation: 18,
  },
  sidebarToggle: {
    position: 'absolute',
    zIndex: 12,
    width: SIDEBAR_TOGGLE_CLOSED_SIZE,
    height: SIDEBAR_TOGGLE_CLOSED_SIZE,
    borderRadius: SIDEBAR_TOGGLE_CLOSED_SIZE / 2,
  },
  sidebarGlassCircle: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: SIDEBAR_TOGGLE_CLOSED_SIZE / 2,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000000',
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
  },
  sidebarHamburgerIconStack: {
    width: 23,
    height: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidebarHamburgerIconLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
