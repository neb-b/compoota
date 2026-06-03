export function createColors(isDark: boolean) {
  return {
    background: isDark ? '#0c0a09' : '#f3f1f1',
    text: isDark ? '#fbfaf9' : '#0c0a09',
    secondaryText: isDark ? '#d8d2d0' : '#5b4f4b',
    subtleText: isDark ? '#aba09c' : '#7c6d67',
    border: isDark ? 'rgba(251,250,249,0.12)' : 'rgba(12,10,9,0.08)',
    input: isDark ? 'rgba(251,250,249,0.07)' : 'rgba(251,250,249,0.92)',
    placeholder: isDark ? '#aba09c' : '#7c6d67',
    selection: isDark ? '#fbfaf9' : '#0c0a09',
    action: isDark ? '#d8d2d0' : '#473c39',
    actionText: isDark ? '#0c0a09' : '#fbfaf9',
    accent: isDark ? '#d8d2d0' : '#473c39',
    accentSoft: isDark ? 'rgba(216,210,208,0.18)' : 'rgba(71,60,57,0.16)',
    sidebarText: '#ffffff',
    sidebarMutedText: 'rgba(255,255,255,0.76)',
    sidebarVideoWash: isDark ? 'rgba(12,10,9,0.42)' : 'rgba(12,10,9,0.36)',
    glassTint: isDark ? 'rgba(251,250,249,0.10)' : 'rgba(251,250,249,0.58)',
    headerFadeStrong: isDark ? 'rgba(12,10,9,0.98)' : 'rgba(243,241,241,0.98)',
    headerFadeMedium: isDark ? 'rgba(12,10,9,0.72)' : 'rgba(243,241,241,0.72)',
    headerFadeSoft: isDark ? 'rgba(12,10,9,0.38)' : 'rgba(243,241,241,0.38)',
    headerFadeFaint: isDark ? 'rgba(12,10,9,0.12)' : 'rgba(243,241,241,0.12)',
    transparent: isDark ? 'rgba(12,10,9,0)' : 'rgba(243,241,241,0)',
    userBubble: isDark ? '#f3f1f1' : '#1d1816',
    userText: isDark ? '#0c0a09' : '#fbfaf9',
    error: '#d93d3d',
  }
}

export type AppColors = ReturnType<typeof createColors>
