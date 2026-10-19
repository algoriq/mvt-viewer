/**
 * chrome.storage.sync keys and defaults shared by the panel, popup, and
 * options page.
 */

export const STORAGE_KEYS = {
  hideFailed: 'hideFailed',
  maxEntries: 'maxEntries',
  autoSelectNewest: 'autoSelectNewest',
  theme: 'theme',
} as const;

export type ThemeSetting = 'light' | 'dark' | 'auto';

export interface MvtSettings {
  /** Hide requests that were captured but could not be decoded as MVT. */
  hideFailed: boolean;
  /** Maximum number of captured entries kept in memory. */
  maxEntries: number;
  /** Auto-select the first tile captured after the panel opens. */
  autoSelectNewest: boolean;
  /** Light / dark / auto (follow the browser + DevTools theme). */
  theme: ThemeSetting;
}

export const DEFAULT_SETTINGS: MvtSettings = {
  hideFailed: true,
  maxEntries: 2000,
  autoSelectNewest: true,
  theme: 'auto',
};

export function normalizeTheme(value: unknown): ThemeSetting {
  return value === 'light' || value === 'dark' ? value : 'auto';
}

export function clampMaxEntries(value: number): number {
  return Math.min(10000, Math.max(100, Math.round(value)));
}

export async function loadSettings(): Promise<MvtSettings> {
  const result = (await chrome.storage.sync.get(DEFAULT_SETTINGS)) as Partial<MvtSettings>;
  return {
    hideFailed: result.hideFailed ?? DEFAULT_SETTINGS.hideFailed,
    maxEntries: clampMaxEntries(Number(result.maxEntries) || DEFAULT_SETTINGS.maxEntries),
    autoSelectNewest: result.autoSelectNewest ?? DEFAULT_SETTINGS.autoSelectNewest,
    theme: normalizeTheme(result.theme),
  };
}

export async function saveSettings(settings: MvtSettings): Promise<void> {
  await chrome.storage.sync.set({
    [STORAGE_KEYS.hideFailed]: settings.hideFailed,
    [STORAGE_KEYS.maxEntries]: clampMaxEntries(settings.maxEntries),
    [STORAGE_KEYS.autoSelectNewest]: settings.autoSelectNewest,
    [STORAGE_KEYS.theme]: normalizeTheme(settings.theme),
  });
}
