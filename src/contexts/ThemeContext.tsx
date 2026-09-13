import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';

import { ThemeAccent, ThemeMode, ThemeTokens, resolveTheme } from '../constants/theme';
import { getSettings, updateSettings } from '../storage/storage';

type ThemeContextValue = {
  theme: ThemeTokens;
  mode: ThemeMode;
  accent: ThemeAccent;
  setMode: (mode: ThemeMode) => Promise<void>;
  setAccent: (accent: ThemeAccent) => Promise<void>;
};

const defaultTheme = resolveTheme('system', 'teal', 'light');

const ThemeContext = createContext<ThemeContextValue>({
  theme: defaultTheme,
  mode: 'system',
  accent: 'teal',
  setMode: async () => {},
  setAccent: async () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const osScheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [accent, setAccentState] = useState<ThemeAccent>('teal');

  useEffect(() => {
    (getSettings() as Promise<any>).then((s) => {
      if (s.themeMode) setModeState(s.themeMode as ThemeMode);
      if (s.themeAccent) setAccentState(s.themeAccent as ThemeAccent);
    });
  }, []);

  const setMode = useCallback(async (newMode: ThemeMode) => {
    setModeState(newMode);
    await updateSettings({ themeMode: newMode });
  }, []);

  const setAccent = useCallback(async (newAccent: ThemeAccent) => {
    setAccentState(newAccent);
    await updateSettings({ themeAccent: newAccent });
  }, []);

  const theme = resolveTheme(mode, accent, osScheme);

  return (
    <ThemeContext.Provider value={{ theme, mode, accent, setMode, setAccent }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useThemeContext() {
  return useContext(ThemeContext);
}
