/**
 * theme.ts
 *
 * Sistema de Design Tokens do Sonary Pro
 *
 * Filosofia: "Deep Dark Mode & Atmospheric Gradients" + Detalhes Emil Kowalski
 */

export const colors = {
  // Fundos & Superfícies (Pitch Black OLED)
  background: '#030303',
  surface: '#0f0f0f',
  card: '#181818',
  elevated: '#212121',
  chipInactive: '#1d1d1d',
  chipHover: '#2b2b2b',
  chipActive: '#FFFFFF',

  // Bordas & Divisores
  border: 'rgba(255, 255, 255, 0.1)',
  borderSubtle: 'rgba(255, 255, 255, 0.08)',
  borderElevated: '#282828',

  // Marca Sonary
  brandPrimary: '#FF0000',
  brandPrimaryHover: '#D60000',
  brandAccent: '#FFFFFF',

  // Tipografia
  textPrimary: '#FFFFFF',
  textSecondary: '#AAAAAA',
  textMuted: '#717171',
  textInverse: '#030303',

  // Estados & Feedback
  success: '#2BA640',
  danger: '#FF4E45',
  warning: '#FFC107',
  info: '#2196F3',

  // Overlays Atmosféricos & Scrim
  overlayDark: 'rgba(0, 0, 0, 0.5)',
  overlayScrub: 'rgba(0, 0, 0, 0.85)',
  atmosphericRedGlow: 'rgba(255, 0, 0, 0.12)',
  atmosphericTopGlow: 'rgba(40, 20, 25, 0.35)',

  // Skeleton shimmer
  skeletonBase: '#1a1a1a',
  skeletonHighlight: '#262626',
} as const;

export const typography = {
  fontFamily: {
    base: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  fontSize: {
    display: 28,
    sectionTitle: 24,
    cardTitle: 16,
    trackTitle: 14,
    caption: 12,
    badge: 11,
    micro: 10,
  },
  fontWeight: {
    regular: '400' as const,
    medium: '500' as const,
    semiBold: '600' as const,
    bold: '700' as const,
    extraBold: '800' as const,
  },
  lineHeight: {
    display: 34,
    sectionTitle: 30,
    cardTitle: 22,
    trackTitle: 20,
    caption: 16,
  },
} as const;

export const radii = {
  track: 4,
  card: 8,
  chip: 8,
  dialog: 12,
  sheet: 16,
  circular: 9999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
  massive: 64,
} as const;

export const dimensions = {
  playerBarHeight: 64,
  bottomNavHeight: 56,
  sidebarCollapsedWidth: 72,
  sidebarExpandedWidth: 240,
  trackThumbnail: 48,
  miniPlayerThumbnail: 44,
  nowPlayingArtworkMax: 340,
} as const;

export const transitions = {
  // Emil Kowalski: Active feedback scale
  pressScale: 0.97,
  // Easing curvas
  easeOut: 'cubic-bezier(0.22, 1, 0.36, 1)',
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  // Durações padrão únicas de navegação, sheets e overlays (ms)
  screenOutMs: 30,
  screenInMs: 65,
  sheetInMs: 100,
  sheetOutMs: 90,
  toastMs: 85,
  glowEntryMs: 65,
} as const;

export function getEaseOutCubic(easingMod?: {
  out?: (fn: (t: number) => number) => (t: number) => number;
  cubic?: (t: number) => number;
}): ((t: number) => number) | undefined {
  return typeof easingMod?.out === 'function' && typeof easingMod?.cubic === 'function'
    ? easingMod.out(easingMod.cubic)
    : undefined;
}

export const theme = {
  colors,
  typography,
  radii,
  spacing,
  dimensions,
  transitions,
};

export default theme;

