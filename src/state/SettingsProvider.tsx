import { useSQLiteContext } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { SORT_ORDERS, type SortOrder } from '@/models/query';
import { loadSettings, saveSetting } from '@/storage/database';

export type ThemeMode = 'system' | 'light' | 'dark';

/** How a shelf shows its items: a grid of covers, or a list with small covers and details. */
export type ViewMode = 'grid' | 'list';

export interface Settings {
  themeMode: ThemeMode;
  sortOrder: SortOrder;
  viewMode: ViewMode;
}

const DEFAULT_SETTINGS: Settings = { themeMode: 'system', sortOrder: 'newest', viewMode: 'grid' };

interface SettingsContextValue {
  settings: Settings;
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

/** App preferences, saved in the SQLite settings table. Renders nothing until loaded. */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    loadSettings(db)
      .then((stored) => setSettings(parseSettings(stored)))
      .catch((error: unknown) => {
        console.error('Failed to load settings', error);
        setSettings(DEFAULT_SETTINGS);
      });
  }, [db]);

  const setSetting = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]) => {
      setSettings((s) => s && { ...s, [key]: value });
      saveSetting(db, key, value).catch((error: unknown) => console.error('Failed to save setting', key, error));
    },
    [db],
  );

  const value = useMemo(() => settings && { settings, setSetting }, [settings, setSetting]);
  if (!value) return null;
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings must be used inside <SettingsProvider>');
  return value;
}

/** Ignores unknown or outdated stored values instead of trusting them. */
function parseSettings(stored: Record<string, string>): Settings {
  const themeModes: ThemeMode[] = ['system', 'light', 'dark'];
  const viewModes: ViewMode[] = ['grid', 'list'];
  return {
    themeMode: themeModes.find((m) => m === stored.themeMode) ?? DEFAULT_SETTINGS.themeMode,
    sortOrder: SORT_ORDERS.find((o) => o === stored.sortOrder) ?? DEFAULT_SETTINGS.sortOrder,
    viewMode: viewModes.find((m) => m === stored.viewMode) ?? DEFAULT_SETTINGS.viewMode,
  };
}
