import { Platform } from 'react-native';

// 11-token design system

export type ThemeTokens = {
  bg: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  track: string;
  accent: string;
  accentSoft: string;
  accentInk: string;
  onAccent: string;
  danger: string;
  dangerSoft: string;
};

export type ThemeMode = 'light' | 'dark' | 'system';
export type ThemeAccent = 'teal' | 'pink';

export const themes: Record<'light' | 'dark', Record<ThemeAccent, ThemeTokens>> = {
  light: {
    teal: {
      bg: '#F2F6F6',
      surface: '#FFFFFF',
      text: '#0F1E1D',
      muted: '#6E8382',
      border: '#E3EAE9',
      track: '#E3EAE9',
      accent: '#0E8F86',
      accentSoft: '#DBEEEC',
      accentInk: '#0A6A63',
      onAccent: '#FFFFFF',
      danger: '#C0554F',
      dangerSoft: '#F8E7E4',
    },
    pink: {
      bg: '#F6F4F7',
      surface: '#FFFFFF',
      text: '#181723',
      muted: '#797787',
      border: '#E8E5EC',
      track: '#E8E5EC',
      accent: '#CE6B96',
      accentSoft: '#F7E7EF',
      accentInk: '#A44E75',
      onAccent: '#FFFFFF',
      danger: '#C0554F',
      dangerSoft: '#F8E6E6',
    },
  },
  dark: {
    teal: {
      bg: '#0D1318',
      surface: '#151C23',
      text: '#E6EDF3',
      muted: '#8695A3',
      border: '#212A33',
      track: '#212A33',
      accent: '#3CC6B7',
      accentSoft: '#122C30',
      accentInk: '#7FDCD3',
      onAccent: '#04211E',
      danger: '#E8837C',
      dangerSoft: '#2E1E20',
    },
    pink: {
      bg: '#0D1318',
      surface: '#151C23',
      text: '#EDEAF1',
      muted: '#8B92A5',
      border: '#212A33',
      track: '#212A33',
      accent: '#DFA3C4',
      accentSoft: '#2A2431',
      accentInk: '#EEC0D8',
      onAccent: '#231320',
      danger: '#E8837C',
      dangerSoft: '#2E1E20',
    },
  },
};

export function resolveTheme(
  mode: ThemeMode,
  accent: ThemeAccent,
  osScheme: 'light' | 'dark',
): ThemeTokens {
  const m = mode === 'system' ? osScheme : mode;
  return themes[m][accent];
}

// Spacing

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

// left/right padding for every screen
export const ScreenPadding = 24;

// Radii

export const Radii = {
  button: 16,
  card: 18,
  smallCard: 16,
  iconTile: 12,
  chip: 999,
  badge: 6,
  currencyBadge: 9,
  segTrack: 13,
  segThumb: 10,
  emptyTile: 20,
  calendarCell: 11,
} as const;

// Layout

export const TabBarHeight = 84;
export const MaxContentWidth = 800;

// utility colours, kept here so the hex codes aren't repeated
export const WHITE = '#FFFFFF';
export const SHADOW_COLOR = '#000000';
export const EXPO_SPLASH_BLUE = '#208AEF';

// colours for the chart slices

export const ChartPalette = [
  '#E74C3C', '#3498DB', '#2ECC71', '#F39C12', '#9B59B6',
  '#1ABC9C', '#E67E22', '#2980B9', '#27AE60', '#8E44AD',
] as const;

// Font family

export const FontFamily = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  default: 'system-ui',
});
