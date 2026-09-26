import { Platform } from 'react-native';

export const platinum = {
  colors: {
    canvas: '#090a0f',
    surfaceLowest: '#0d0e13',
    surface: '#121318',
    surfaceLow: '#1a1b21',
    surfaceHigh: '#292a2f',
    platinum: '#f4f5f7',
    qrBackground: '#ffffff',
    platinumSoft: '#e1e2e4',
    onPlatinum: '#191c1e',
    text: '#e3e1e9',
    secondaryText: '#c4c7c9',
    mutedText: '#94a3b8',
    faintText: '#64748b',
    emerald: '#4edea3',
    emeraldWash: 'rgba(78, 222, 163, 0.10)',
    cyan: '#38bdf8',
    bitcoin: '#f2a535',
    ethereum: '#8b9eff',
    negative: '#ffb4ab',
    negativeWash: 'rgba(255, 180, 171, 0.10)',
    warning: '#f4c479',
    border: 'rgba(255, 255, 255, 0.08)',
    borderLit: 'rgba(255, 255, 255, 0.20)',
    glass: 'rgba(255, 255, 255, 0.04)',
    glassRaised: 'rgba(255, 255, 255, 0.07)',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
  },
  radius: { sm: 8, md: 12, lg: 16, xl: 24, full: 9999 },
  typography: {
    display: { fontFamily: 'Geist_600SemiBold', fontSize: 36, lineHeight: 44, letterSpacing: -1.08 },
    title: { fontFamily: 'Geist_600SemiBold', fontSize: 28, lineHeight: 34, letterSpacing: -0.7 },
    heading: { fontFamily: 'Geist_600SemiBold', fontSize: 24, lineHeight: 32, letterSpacing: -0.48 },
    subheading: { fontFamily: 'Geist_500Medium', fontSize: 18, lineHeight: 24, letterSpacing: -0.27 },
    cardTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 20, lineHeight: 26, letterSpacing: -0.4 },
    body: { fontFamily: 'Geist_400Regular', fontSize: 16, lineHeight: 24, letterSpacing: -0.16 },
    bodySmall: { fontFamily: 'Geist_400Regular', fontSize: 14, lineHeight: 20 },
    caption: { fontFamily: 'Geist_400Regular', fontSize: 12, lineHeight: 16, letterSpacing: 0.12 },
    label: { fontFamily: 'JetBrainsMono_500Medium', fontSize: 13, lineHeight: 18, letterSpacing: -0.13 },
    labelSmall: { fontFamily: 'JetBrainsMono_500Medium', fontSize: 11, lineHeight: 14, letterSpacing: 0.22 },
    micro: { fontFamily: 'JetBrainsMono_400Regular', fontSize: 10, lineHeight: 12, letterSpacing: 0.4 },
  },
  shadow: { raised: '0 12px 32px rgba(0, 0, 0, 0.32)' },
} as const;

const baseColors = {
  text: platinum.colors.text,
  background: platinum.colors.canvas,
  backgroundElement: platinum.colors.surface,
  backgroundSelected: platinum.colors.surfaceHigh,
  textSecondary: platinum.colors.secondaryText,
};

export const Colors = { light: baseColors, dark: baseColors } as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
