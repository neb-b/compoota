export function createColors(isDark: boolean) {
  return {
    background: isDark ? '#111111' : '#e9efcf',
    text: isDark ? '#f6f6f4' : '#171717',
    secondaryText: isDark ? '#a7a7a2' : '#686863',
    subtleText: isDark ? '#858580' : '#8f8f88',
    border: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(12,12,12,0.08)',
    input: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.92)',
    placeholder: isDark ? '#8d8d88' : '#9a9a94',
    selection: isDark ? '#ffffff' : '#111111',
    action: isDark ? '#7dd3fc' : '#0ea5e9',
    actionText: isDark ? '#082f49' : '#ffffff',
    accent: isDark ? '#7dd3fc' : '#0369a1',
    accentSoft: isDark ? 'rgba(125,211,252,0.18)' : 'rgba(14,165,233,0.18)',
    sidebarText: '#ffffff',
    sidebarMutedText: 'rgba(255,255,255,0.76)',
    sidebarVideoWash: isDark ? 'rgba(2,6,23,0.42)' : 'rgba(2,6,23,0.36)',
    glassTint: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.58)',
    headerFadeStrong: isDark ? 'rgba(17,17,17,0.98)' : 'rgba(233,239,207,0.98)',
    headerFadeMedium: isDark ? 'rgba(17,17,17,0.72)' : 'rgba(233,239,207,0.72)',
    headerFadeSoft: isDark ? 'rgba(17,17,17,0.38)' : 'rgba(233,239,207,0.38)',
    headerFadeFaint: isDark ? 'rgba(17,17,17,0.12)' : 'rgba(233,239,207,0.12)',
    transparent: isDark ? 'rgba(17,17,17,0)' : 'rgba(233,239,207,0)',
    userBubble: isDark ? '#eeeeea' : '#161616',
    userText: isDark ? '#111111' : '#ffffff',
    error: '#d93d3d',
  }
}

export type AppColors = ReturnType<typeof createColors>
