import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { useColorScheme, useWindowDimensions } from 'react-native';
import { usePrefs } from '@/lib/prefs';

export type Scheme = 'light' | 'dark';

/** Yinkops Ledger tokens: Studyo's paper-and-ink neutrals with an ink-teal accent. */
const light = {
  canvas: '#FBFBFA',
  surface: '#F3F2EE',
  surfaceRaised: '#FFFFFF',
  tint: '#F6F4EE',
  rule: '#E5E4DE',
  ruleStrong: '#D6D4CC',
  ink: '#1E1E1C',
  lead: '#6F6E69',
  faint: '#9A988F',
  primary: '#1F6F78',
  primaryInk: '#155259',
  onPrimary: '#FFFFFF',
  primarySoft: 'rgba(31, 111, 120, 0.10)',
  sage: '#4A6B5B',
  sageText: '#2F5241',
  sageSoft: 'rgba(74, 107, 91, 0.13)',
  amber: '#A36717',
  amberText: '#804E0B',
  amberSoft: 'rgba(210, 142, 61, 0.15)',
  danger: '#B83A3A',
  dangerText: '#9A2C2C',
  dangerSoft: 'rgba(184, 58, 58, 0.10)',
  scrim: 'rgba(22, 22, 20, 0.48)',
};

const dark: typeof light = {
  canvas: '#161614',
  surface: '#22221F',
  surfaceRaised: '#2A2A26',
  tint: '#1F1D1A',
  rule: '#2D2D29',
  ruleStrong: '#3A3A35',
  ink: '#ECEAE4',
  lead: '#A3A19A',
  faint: '#77756E',
  primary: '#5FB3BC',
  primaryInk: '#86CBD2',
  onPrimary: '#0B1F22',
  primarySoft: 'rgba(95, 179, 188, 0.14)',
  sage: '#8DB5A1',
  sageText: '#A7CBB8',
  sageSoft: 'rgba(141, 181, 161, 0.14)',
  amber: '#E0A75E',
  amberText: '#EBBB7C',
  amberSoft: 'rgba(224, 167, 94, 0.14)',
  danger: '#E07070',
  dangerText: '#EC8C8C',
  dangerSoft: 'rgba(224, 112, 112, 0.14)',
  scrim: 'rgba(0, 0, 0, 0.6)',
};

export type Palette = typeof light;

export const fonts = {
  content: 'Newsreader_400Regular',
  contentItalic: 'Newsreader_400Regular_Italic',
  contentMedium: 'Newsreader_500Medium',
  ui: 'Geist_400Regular',
  uiMedium: 'Geist_500Medium',
  uiSemibold: 'Geist_600SemiBold',
  mono: 'GeistMono_400Regular',
} as const;

/** Newsreader for titles and reading, Geist for everything in lists and controls, Geist Mono for numbers. */
export const type = {
  display: { fontFamily: fonts.content, fontSize: 32, lineHeight: 38, letterSpacing: -0.3 },
  headline: { fontFamily: fonts.content, fontSize: 26, lineHeight: 32, letterSpacing: -0.2 },
  title: { fontFamily: fonts.contentMedium, fontSize: 21, lineHeight: 27 },
  rowTitle: { fontFamily: fonts.uiSemibold, fontSize: 15.5, lineHeight: 21 },
  body: { fontFamily: fonts.ui, fontSize: 15, lineHeight: 22 },
  reading: { fontFamily: fonts.content, fontSize: 17, lineHeight: 26 },
  bodySmall: { fontFamily: fonts.ui, fontSize: 14, lineHeight: 20 },
  label: { fontFamily: fonts.uiMedium, fontSize: 14, lineHeight: 20, letterSpacing: 0.1 },
  meta: { fontFamily: fonts.uiMedium, fontSize: 12.5, lineHeight: 17, letterSpacing: 0.15 },
  caps: {
    fontFamily: fonts.uiSemibold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.6,
    textTransform: 'uppercase' as const,
  },
  mono: { fontFamily: fonts.mono, fontSize: 12.5, lineHeight: 17 },
} as const;

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 40 } as const;
export const radius = { sm: 2, base: 4, md: 6, lg: 8, full: 9999 } as const;
export const hit = { min: 44, big: 56 } as const;
export const MAX_WIDTH = 720;
export const TAB_HEIGHT = 60;
export const RAIL_WIDTH = 84;
/** At this width and up: a left rail, and Jobs shows list and detail side by side. */
export const WIDE = 1024;

export function useWide() {
  const { width } = useWindowDimensions();
  return width >= WIDE;
}

interface Theme {
  scheme: Scheme;
  c: Palette;
}

const ThemeContext = createContext<Theme>({ scheme: 'light', c: light });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const pref = usePrefs((s) => s.theme);
  const scheme: Scheme = pref === 'system' ? (system === 'dark' ? 'dark' : 'light') : pref;
  const value = useMemo(() => ({ scheme, c: scheme === 'dark' ? dark : light }), [scheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
