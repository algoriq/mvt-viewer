<script setup lang="ts">
import {onMounted, onUnmounted} from 'vue';
import {DEFAULT_SETTINGS, loadSettings, type ThemeSetting} from '../shared/storage';

const { name, version } = chrome.runtime.getManifest();

const themeMedia = window.matchMedia('(prefers-color-scheme: dark)');
let themeSetting: ThemeSetting = DEFAULT_SETTINGS.theme;

function applyTheme(): void {
  document.documentElement.dataset.theme = themeSetting === 'auto' ? (themeMedia.matches ? 'dark' : 'light') : themeSetting;
}

onMounted(async () => {
  try {
    themeSetting = (await loadSettings()).theme;
  } catch {
    /* stale context — keep the default theme */
  }
  applyTheme();
  themeMedia.addEventListener('change', applyTheme);
});

onUnmounted(() => {
  themeMedia.removeEventListener('change', applyTheme);
});

function openOptions(): void {
  chrome.runtime.openOptionsPage();
}
</script>

<template>
  <main class="popup">
    <header class="popup-header">
      <span class="popup-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="26" height="26">
          <rect x="3" y="3" width="8" height="8" rx="2" fill="#1A73E8" />
          <rect x="13" y="3" width="8" height="8" rx="2" fill="#E8F0FE" stroke="#D2E3FC" stroke-width="0.5" />
          <rect x="3" y="13" width="8" height="8" rx="2" fill="#E8F0FE" stroke="#D2E3FC" stroke-width="0.5" />
          <rect x="13" y="13" width="8" height="8" rx="2" fill="#E8F0FE" stroke="#D2E3FC" stroke-width="0.5" />
        </svg>
      </span>
      <div>
        <h1>{{ name }}</h1>
        <p>Mapbox Vector Tile inspector · v{{ version }}</p>
      </div>
    </header>

    <p class="popup-body">
      MVT Viewer runs inside DevTools. Open <strong>DevTools</strong> (<kbd>F12</kbd>) and switch to the
      <strong>MVT Viewer</strong> tab — vector tile requests (<code>.pbf</code> / <code>.mvt</code>) are decoded
      there automatically, 100% offline.
    </p>

    <footer class="popup-actions">
      <button class="btn" @click="openOptions">Settings</button>
    </footer>
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
  font: 12px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}

.popup {
  width: 288px;
  padding: 14px;
  color: #202124;
  background: #ffffff;
}

:root[data-theme='dark'] .popup {
  color: #e8eaed;
  background: #202124;
}

.popup-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.popup-mark {
  flex: 0 0 auto;
}

.popup-header h1 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.popup-header p {
  margin: 0;
  font-size: 10px;
  opacity: 0.7;
}

.popup-body {
  margin: 0 0 12px;
  font-size: 12px;
  opacity: 0.92;
}

.popup-body code {
  background: rgba(128, 134, 139, 0.15);
  border-radius: 3px;
  padding: 0 3px;
}

kbd {
  border: 1px solid rgba(128, 134, 139, 0.4);
  border-radius: 3px;
  padding: 0 4px;
  font-size: 11px;
}

.popup-actions {
  display: flex;
  justify-content: flex-end;
}

.btn {
  padding: 4px 12px;
  border: 1px solid rgba(128, 134, 139, 0.4);
  border-radius: 5px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.btn:hover {
  background: rgba(26, 115, 232, 0.12);
  border-color: #1a73e8;
}
</style>
