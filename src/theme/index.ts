import { createContext, useContext } from 'react';
import { useColorScheme } from 'react-native';

import { nightPaper, paperLight, type Palette } from './tokens';

export * from './layout';
export * from './tokens';
export * from './typography';

export type ThemePreference = 'system' | 'light' | 'dark';

/**
 * The active theme preference. The root layout (`src/app/_layout.tsx`) provides it from the
 * settings store, which is the source of truth; the default applies only outside that provider.
 */
export const ThemePreferenceContext = createContext<ThemePreference>('system');

export interface Theme {
  scheme: 'light' | 'dark';
  colors: Palette;
}

export function useTheme(): Theme {
  const preference = useContext(ThemePreferenceContext);
  const systemScheme = useColorScheme();
  const scheme =
    preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;
  return { scheme, colors: scheme === 'dark' ? nightPaper : paperLight };
}
