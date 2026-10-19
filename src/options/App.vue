<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref } from 'vue';
import {
  STORAGE_KEYS,
  clampMaxEntries,
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeTheme,
  saveSettings,
  type ThemeSetting,
} from '../shared/storage';

// A stale tab (open while the extension was reloaded) has no working
// chrome.* APIs — detect it instead of letting the app crash silently.
const manifestInfo = (() => {
  try {
    return { version: chrome.runtime.getManifest().version, valid: true };
  } catch {
    return { version: '?', valid: false };
  }
})();
const version = manifestInfo.version;
const contextInvalid = ref(!manifestInfo.valid);

const settings = reactive({ ...DEFAULT_SETTINGS });
const savedFlash = ref(false);
const savedError = ref(false);
let savedTimer = 0;

const themeMedia = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme(): void {
  const resolved = settings.theme === 'auto' ? (themeMedia.matches ? 'dark' : 'light') : settings.theme;
  document.documentElement.dataset.theme = resolved;
}

function onStorageChanged(changes: Record<string, chrome.storage.StorageChange>, areaName: string): void {
  if (areaName !== 'sync') return;
  const themeChange = changes[STORAGE_KEYS.theme];
  if (themeChange) {
    settings.theme = normalizeTheme(themeChange.newValue);
    applyTheme();
  }
}

onMounted(async () => {
  try {
    Object.assign(settings, await loadSettings());
  } catch {
    contextInvalid.value = true;
  }
  applyTheme();
  themeMedia.addEventListener('change', applyTheme);
  chrome.storage.onChanged.addListener(onStorageChanged);
});

onUnmounted(() => {
  themeMedia.removeEventListener('change', applyTheme);
  chrome.storage.onChanged.removeListener(onStorageChanged);
});

async function save(): Promise<void> {
  settings.maxEntries = clampMaxEntries(settings.maxEntries);
  try {
    await saveSettings({ ...settings });
    savedFlash.value = true;
    savedError.value = false;
  } catch {
    savedFlash.value = false;
    savedError.value = true;
  }
  window.clearTimeout(savedTimer);
  savedTimer = window.setTimeout(() => {
    savedFlash.value = false;
    savedError.value = false;
  }, 2500);
}

function setTheme(theme: ThemeSetting): void {
  settings.theme = normalizeTheme(theme);
  applyTheme();
  void save();
}
</script>

<template>
  <main class="options">
    <header>
      <h1>MVT Viewer — settings</h1>
      <p class="subtitle">v{{ version }} · stored in <code>chrome.storage.sync</code> and shared with the DevTools panel</p>
    </header>

    <p v-if="contextInvalid" class="context-warning">
      ⚠ The extension was reloaded — close this tab and open Options again (right-click the toolbar icon → Options).
    </p>

    <form class="settings-form" @submit.prevent>
      <label class="setting">
        <span class="setting-text">
          <strong>Theme</strong>
          <small>Applies to the DevTools panel, the popup, and this page. Auto follows the browser theme.</small>
        </span>
        <span class="segmented" role="tablist" aria-label="Theme">
          <button type="button" :class="{ active: settings.theme === 'light' }" @click="setTheme('light')">Light</button>
          <button type="button" :class="{ active: settings.theme === 'dark' }" @click="setTheme('dark')">Dark</button>
          <button type="button" :class="{ active: settings.theme === 'auto' }" @click="setTheme('auto')">Auto</button>
        </span>
      </label>

      <label class="setting">
        <input v-model="settings.hideFailed" type="checkbox" @change="save" />
        <span class="setting-text">
          <strong>Hide failed entries</strong>
          <small>Hide requests that were captured but could not be decoded as MVT (e.g. non-tile protobufs).</small>
        </span>
      </label>

      <label class="setting">
        <input v-model="settings.autoSelectNewest" type="checkbox" @change="save" />
        <span class="setting-text">
          <strong>Auto-select newest tile</strong>
          <small>Automatically select the first tile captured after opening the panel.</small>
        </span>
      </label>

      <label class="setting">
        <span class="setting-text">
          <strong>Max captured entries</strong>
          <small>Older entries beyond this limit are dropped from the panel (100 – 10 000).</small>
        </span>
        <input v-model.number="settings.maxEntries" class="number" type="number" min="100" max="10000" step="100" @change="save" />
      </label>
    </form>

    <p class="saved" :class="{ visible: savedFlash }">Saved ✓</p>
    <p class="save-error" :class="{ visible: savedError }">Save failed — reload the extension and reopen this page.</p>
  </main>
</template>

<style>
:root {
  color-scheme: light;
}

:root[data-theme='dark'] {
  color-scheme: dark;
}

body {
  margin: 0;
  font: 13px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  color: #202124;
  background: #ffffff;
}

:root[data-theme='dark'] body {
  color: #e8eaed;
  background: #202124;
}

.options {
  max-width: 560px;
  margin: 0 auto;
  padding: 32px 24px;
}

header h1 {
  margin: 0 0 4px;
  font-size: 20px;
}

.subtitle {
  margin: 0 0 24px;
  font-size: 12px;
  opacity: 0.7;
}

.subtitle code {
  background: rgba(128, 134, 139, 0.15);
  border-radius: 3px;
  padding: 0 3px;
}

.settings-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.setting {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgba(128, 134, 139, 0.35);
  border-radius: 8px;
}

.setting input[type='checkbox'] {
  margin-top: 3px;
  accent-color: #1a73e8;
}

.setting-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1 1 auto;
}

.setting-text strong {
  font-size: 13px;
}

.setting-text small {
  opacity: 0.75;
}

.number {
  width: 90px;
  padding: 4px 6px;
  border: 1px solid rgba(128, 134, 139, 0.4);
  border-radius: 5px;
  background: transparent;
  color: inherit;
  font: inherit;
}

.segmented {
  display: inline-flex;
  flex: 0 0 auto;
  border: 1px solid rgba(128, 134, 139, 0.4);
  border-radius: 5px;
  overflow: hidden;
}

.segmented button {
  border: 0;
  background: transparent;
  color: inherit;
  padding: 4px 12px;
  font: inherit;
  cursor: pointer;
  opacity: 0.75;
}

.segmented button + button {
  border-left: 1px solid rgba(128, 134, 139, 0.4);
}

.segmented button.active {
  background: rgba(26, 115, 232, 0.14);
  color: #1a73e8;
  opacity: 1;
  font-weight: 600;
}

:root[data-theme='dark'] .segmented button.active {
  background: rgba(138, 180, 248, 0.16);
  color: #8ab4f8;
}

.saved {
  margin: 14px 2px 0;
  color: #188038;
  opacity: 0;
  transition: opacity 150ms ease;
}

:root[data-theme='dark'] .saved {
  color: #81c995;
}

.saved.visible {
  opacity: 1;
}

.save-error {
  margin: 14px 2px 0;
  color: #d93025;
  opacity: 0;
  transition: opacity 150ms ease;
}

:root[data-theme='dark'] .save-error {
  color: #f28b82;
}

.save-error.visible {
  opacity: 1;
}

.context-warning {
  margin: 0 0 16px;
  padding: 10px 12px;
  border: 1px solid #b06000;
  border-radius: 8px;
  background: rgba(176, 96, 0, 0.12);
  color: #8a4d00;
}

:root[data-theme='dark'] .context-warning {
  border-color: #fdd663;
  background: rgba(253, 214, 99, 0.1);
  color: #fdd663;
}
</style>
