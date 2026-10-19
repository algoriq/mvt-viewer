<template>
  <div
    class="app"
    :data-theme="theme"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <header class="toolbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22">
            <rect x="3" y="3" width="8" height="8" rx="2" fill="currentColor" />
            <rect x="13" y="3" width="8" height="8" rx="2" fill="currentColor" opacity="0.55" />
            <rect x="3" y="13" width="8" height="8" rx="2" fill="currentColor" opacity="0.55" />
            <rect x="13" y="13" width="8" height="8" rx="2" fill="currentColor" opacity="0.55" />
          </svg>
        </span>
        <div class="brand-text">
          <span class="brand-name">MVT Viewer</span>
          <span class="brand-sub">Mapbox Vector Tile inspector</span>
        </div>
      </div>

      <div class="toolbar-controls">
        <input
          ref="filterInput"
          v-model="filter"
          class="filter-input"
          type="search"
          spellcheck="false"
          placeholder="Filter keys & values…"
        />
        <label class="check" title="Hide requests that failed to decode">
          <input v-model="settings.hideFailed" type="checkbox" @change="persistSettings" />
          Hide failed
        </label>
        <div class="segmented" role="tablist" aria-label="View mode">
          <button
            :class="{ active: mode === 'json' }"
            role="tab"
            :aria-selected="mode === 'json'"
            title="Raw decoded tile structure"
            @click="setMode('json')"
          >
            JSON
          </button>
          <button
            :class="{ active: mode === 'geojson' }"
            role="tab"
            :aria-selected="mode === 'geojson'"
            title="WGS84 lon/lat GeoJSON (falls back to tile-local coordinates)"
            @click="setMode('geojson')"
          >
            GeoJSON
          </button>
        </div>
        <button
          class="btn theme-btn"
          :title="`Theme: ${settings.theme} — click to cycle (auto → light → dark)`"
          @click="cycleTheme"
        >
          {{ themeIcon }}
        </button>
        <button class="btn" title="Open local .pbf/.mvt tile files" @click="openFilePicker">Open file</button>
        <input
          ref="fileInput"
          type="file"
          multiple
          accept=".pbf,.mvt,application/x-protobuf,application/vnd.mapbox-vector-tile"
          class="file-input-hidden"
          @change="onFileInputChange"
        />
        <button class="btn" :disabled="doc == null" title="Copy formatted JSON of the current view" @click="copyDoc">
          Copy
        </button>
        <button class="btn" :disabled="!canDownload" title="Download the raw .pbf tile" @click="downloadTile">
          Download .pbf
        </button>
        <button class="btn" title="Clear captured tiles" @click="clearAll">Clear</button>
      </div>
    </header>

    <main class="layout">
      <RequestList :entries="visibleEntries" :selected-id="selectedId" @select="selectEntry" />

      <section class="viewer">
        <div v-if="doc == null" class="empty-state">
          <div class="empty-art" aria-hidden="true">
            <svg viewBox="0 0 64 64" width="84" height="84">
              <rect x="6" y="6" width="24" height="24" rx="5" fill="var(--accent)" />
              <rect x="34" y="6" width="24" height="24" rx="5" fill="var(--accent-soft)" />
              <rect x="6" y="34" width="24" height="24" rx="5" fill="var(--accent-soft)" />
              <rect x="34" y="34" width="24" height="24" rx="5" fill="var(--accent-soft)" />
            </svg>
          </div>
          <h2>Waiting for vector tiles…</h2>
          <p>
            Keep DevTools open and load a map (Mapbox, MapLibre, OpenLayers, MapTiler…), or reload the page.
            Requests ending in <code>.pbf</code> / <code>.mvt</code> and protobuf content types are captured
            automatically and decoded 100% offline.
          </p>
          <div class="empty-actions">
            <button class="btn" @click="openFilePicker">Open .pbf / .mvt file…</button>
          </div>
          <p class="empty-hint">…or drop a tile file anywhere on this panel.</p>
        </div>

        <template v-else>
          <div class="doc-header">
            <div class="doc-title">
              <span class="doc-name" :title="selectedEntry?.url ?? ''">{{ docName }}</span>
              <span class="doc-chips">
                <template v-if="selectedEntry">
                  <span class="chip">{{ selectedEntry.method }} {{ selectedEntry.status }}</span>
                  <span class="chip">{{ formatBytes(selectedEntry.size) }}</span>
                  <span class="chip">{{ selectedEntry.timeMs }} ms</span>
                  <span v-if="selectedEntry.xyz" class="chip">z{{ selectedEntry.xyz.z }}/{{ selectedEntry.xyz.x }}/{{ selectedEntry.xyz.y }}</span>
                  <span v-if="docSummary" class="chip">{{ docSummary }}</span>
                  <span v-if="coordMode" class="chip" :class="coordMode === 'wgs84' ? 'chip-ok' : 'chip-warn'">
                    {{ coordMode === 'wgs84' ? 'WGS84' : 'tile-local coords' }}
                  </span>
                </template>
              </span>
            </div>
            <div class="doc-actions">
              <button class="btn small" @click="treeRef?.expandAll()">Expand all</button>
              <button class="btn small" @click="treeRef?.collapseAll()">Collapse all</button>
            </div>
          </div>
          <div class="tree-wrap">
            <TreeView ref="treeRef" :data="doc" :label="modeLabel" :filter="filterDebounced" />
          </div>
        </template>
      </section>
    </main>

    <footer class="statusbar">
      <span>{{ entries.size }} tile{{ entries.size === 1 ? '' : 's' }}</span>
      <span class="sep">·</span>
      <span>{{ formatBytes(totalBytes) }} captured</span>
      <span class="sep">·</span>
      <span>mode: {{ modeLabel }}</span>
      <template v-if="selectedEntry && selectedEntry.decodeMs != null">
        <span class="sep">·</span>
        <span>decoded in {{ selectedEntry.decodeMs.toFixed(1) }} ms</span>
      </template>
      <span class="spacer"></span>
      <span class="hint">press / to filter · click a leaf to select its text</span>
    </footer>

    <transition name="toast">
      <div v-if="statusFlash" class="toast">{{ statusFlash }}</div>
    </transition>

    <div v-if="isDragging" class="drop-overlay" aria-hidden="true">
      <div class="drop-overlay-inner">
        <svg viewBox="0 0 64 64" width="64" height="64">
          <rect x="6" y="6" width="24" height="24" rx="5" fill="var(--accent)" />
          <rect x="34" y="6" width="24" height="24" rx="5" fill="var(--accent-soft)" />
          <rect x="6" y="34" width="24" height="24" rx="5" fill="var(--accent-soft)" />
          <rect x="34" y="34" width="24" height="24" rx="5" fill="var(--accent-soft)" />
        </svg>
        <div class="drop-overlay-title">Drop .mvt / .pbf tile to open</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue';
import RequestList from './RequestList.vue';
import TreeView from './TreeView.vue';
import { decodeMvtGeoJson, decodeMvtRaw, summarizeMvt } from './decoder';
import type { GeoJsonTile, TileSummary } from './decoder';
import { buildLocalEntry, isTileFileName, readTileFile } from './fileTiles';
import type { PanelEntry, ViewMode } from './types';
import { isDevtoolsToPanelMessage, type TileEntry } from '../shared/messages';
import {
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  loadSettings,
  normalizeTheme,
  saveSettings,
  type MvtSettings,
  type ThemeSetting,
} from '../shared/storage';
import './styles.css';

const entries = shallowRef<Map<number, PanelEntry>>(new Map());
const order = ref<number[]>([]);
const selectedId = ref<number | null>(null);
const mode = ref<ViewMode>('json');
const filter = ref('');
const filterDebounced = ref('');
const settings = reactive<MvtSettings>({ ...DEFAULT_SETTINGS });
const theme = ref<'dark' | 'light'>('light');
const doc = ref<unknown>(null);
const statusFlash = ref('');
const treeRef = ref<InstanceType<typeof TreeView> | null>(null);
const filterInput = ref<HTMLInputElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const dragDepth = ref(0);
const isDragging = computed(() => dragDepth.value > 0);
let nextLocalId = -1;

const docCache = new Map<number, { json?: unknown; geo?: unknown }>();
const DOC_CACHE_LIMIT = 100;
let statusTimer = 0;
let filterTimer = 0;

/* ---------------------------------------------------------------- derived */

const modeLabel = computed(() => (mode.value === 'json' ? 'JSON' : 'GeoJSON'));

const selectedEntry = computed<PanelEntry | null>(() =>
  selectedId.value != null ? (entries.value.get(selectedId.value) ?? null) : null,
);

const visibleEntries = computed<PanelEntry[]>(() => {
  const list = order.value
    .map((id) => entries.value.get(id))
    .filter((item): item is PanelEntry => item !== undefined);
  return settings.hideFailed ? list.filter((item) => !item.error) : list;
});

const totalBytes = computed(() => {
  let total = 0;
  for (const entry of entries.value.values()) total += entry.size;
  return total;
});

const canDownload = computed(() => !!selectedEntry.value?.bytes);

const docName = computed(() => {
  const entry = selectedEntry.value;
  if (!entry) return '';
  if (entry.xyz) return `tile ${entry.xyz.z}/${entry.xyz.x}/${entry.xyz.y}`;
  try {
    const path = new URL(entry.url).pathname;
    const name = path.split('/').filter(Boolean).pop();
    return name ? decodeURIComponent(name) : entry.url;
  } catch {
    return entry.url;
  }
});

const docSummary = computed(() => {
  const summary = selectedEntry.value?.summary;
  if (!summary) return '';
  return `${summary.layerCount} layer${summary.layerCount === 1 ? '' : 's'} · ${summary.featureCount} feature${
    summary.featureCount === 1 ? '' : 's'
  }`;
});

const coordMode = computed(() => {
  if (mode.value !== 'geojson') return null;
  return (doc.value as { coordinateMode?: 'wgs84' | 'tile-local' } | null)?.coordinateMode ?? null;
});

/* ---------------------------------------------------------------- watching */

watch(filter, (value) => {
  window.clearTimeout(filterTimer);
  filterTimer = window.setTimeout(() => {
    filterDebounced.value = value;
  }, 150);
});

watch([selectedId, mode], () => {
  refreshDoc();
});

/* -------------------------------------------------------------------- docs */

function refreshDoc(): void {
  doc.value = buildDoc();
}

function buildDoc(): unknown {
  const entry = selectedEntry.value;
  if (!entry) return null;
  const cached = docCacheFor(entry.id);
  if (mode.value === 'json') {
    if (cached.json === undefined) cached.json = buildJsonDoc(entry);
    return cached.json;
  }
  if (cached.geo === undefined) cached.geo = buildGeoDoc(entry);
  return cached.geo;
}

function docCacheFor(id: number): { json?: unknown; geo?: unknown } {
  let cached = docCache.get(id);
  if (!cached) {
    cached = {};
    docCache.set(id, cached);
    if (docCache.size > DOC_CACHE_LIMIT) {
      const oldest = docCache.keys().next().value;
      if (oldest !== undefined) docCache.delete(oldest);
    }
  }
  return cached;
}

function buildJsonDoc(entry: PanelEntry): unknown {
  if (entry.error || !entry.bytes) return errorDoc(entry);
  const started = performance.now();
  try {
    const tile = decodeMvtRaw(entry.bytes);
    entry.decodeMs = performance.now() - started;
    return { meta: metaDoc(entry), tile };
  } catch (error) {
    entry.error = errorMessage(error);
    return errorDoc(entry);
  }
}

function buildGeoDoc(entry: PanelEntry): unknown {
  if (entry.error || !entry.bytes) return errorDoc(entry);
  const started = performance.now();
  try {
    const tile: GeoJsonTile = decodeMvtGeoJson(entry.bytes, entry.xyz);
    entry.decodeMs = performance.now() - started;
    return { meta: metaDoc(entry), ...tile };
  } catch (error) {
    entry.error = errorMessage(error);
    return errorDoc(entry);
  }
}

function metaDoc(entry: PanelEntry): Record<string, unknown> {
  return {
    url: entry.url,
    method: entry.method,
    status: entry.status,
    mimeType: entry.mimeType,
    size: entry.size,
    timeMs: entry.timeMs,
    capturedAt: new Date(entry.capturedAt).toISOString(),
    tile: entry.xyz ? `${entry.xyz.z}/${entry.xyz.x}/${entry.xyz.y}` : null,
  };
}

function errorDoc(entry: PanelEntry): unknown {
  return {
    meta: metaDoc(entry),
    error: entry.error ?? 'Unknown decode error',
    bytesPreview: previewBytes(entry.bytes),
  };
}

function previewBytes(bytes: Uint8Array | null): string {
  if (!bytes) return '';
  const hex: string[] = [];
  const limit = Math.min(bytes.length, 32);
  for (let i = 0; i < limit; i++) hex.push(bytes[i].toString(16).padStart(2, '0'));
  return hex.join(' ');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* --------------------------------------------------------------- messages */

function onWindowMessage(event: MessageEvent): void {
  if (!isDevtoolsToPanelMessage(event.data)) return;
  if (event.data.type === 'entries') applyEntries(event.data.entries);
  else applyEntry(event.data.entry);
}

function enrich(entry: TileEntry): PanelEntry {
  let summary: TileSummary | null = null;
  let error = entry.error;
  if (!error && entry.bytes) {
    try {
      summary = summarizeMvt(entry.bytes);
    } catch (e) {
      error = errorMessage(e);
    }
  }
  return { ...entry, summary, error };
}

function applyEntries(list: TileEntry[]): void {
  const map = new Map<number, PanelEntry>();
  // Local (dropped) entries survive DevTools resyncs; network entries always
  // come fresh from the snapshot.
  const localIds = order.value.filter((id) => entries.value.get(id)?.method === 'FILE');
  for (const id of localIds) {
    const entry = entries.value.get(id);
    if (entry) map.set(entry.id, entry);
  }
  for (const entry of list) map.set(entry.id, enrich(entry));
  entries.value = map;
  order.value = [...localIds, ...list.map((entry) => entry.id).reverse()];
  if (selectedId.value != null && !map.has(selectedId.value)) selectedId.value = null;
  if (selectedId.value == null && order.value.length > 0 && settings.autoSelectNewest) {
    selectedId.value = order.value[0];
  }
  refreshDoc();
}

function applyEntry(entry: TileEntry): void {
  const enriched = enrich(entry);
  const map = new Map(entries.value);
  if (!map.has(entry.id)) order.value.unshift(entry.id);
  map.set(entry.id, enriched);
  while (order.value.length > settings.maxEntries) {
    const last = order.value.pop();
    if (last !== undefined) map.delete(last);
  }
  entries.value = map;
  if (selectedId.value == null && settings.autoSelectNewest) selectedId.value = entry.id;
  if (selectedId.value === entry.id) refreshDoc();
}

/* ------------------------------------------------------------ local files */

function openFilePicker(): void {
  fileInput.value?.click();
}

async function onFileInputChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const files = input.files ? Array.from(input.files) : [];
  await addLocalFiles(files);
  input.value = '';
}

function hasDraggedFiles(event: DragEvent): boolean {
  return !!event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files');
}

function onDragEnter(event: DragEvent): void {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  dragDepth.value++;
}

function onDragOver(event: DragEvent): void {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
}

function onDragLeave(): void {
  dragDepth.value = Math.max(0, dragDepth.value - 1);
}

async function onDrop(event: DragEvent): Promise<void> {
  event.preventDefault();
  dragDepth.value = 0;
  const files = event.dataTransfer ? Array.from(event.dataTransfer.files) : [];
  await addLocalFiles(files);
}

async function addLocalFiles(files: File[]): Promise<void> {
  const tiles = files.filter((file) => isTileFileName(file.name));
  if (tiles.length === 0) {
    flashStatus('No .pbf / .mvt files to open');
    return;
  }
  let opened = 0;
  let failed = 0;
  let lastId: number | null = null;
  for (const file of tiles) {
    try {
      const bytes = await readTileFile(file);
      if (bytes.byteLength === 0) throw new Error('empty file');
      const id = nextLocalId--;
      applyEntry(buildLocalEntry(id, file.name, bytes));
      lastId = id;
      opened++;
    } catch {
      failed++;
    }
  }
  if (lastId !== null) selectedId.value = lastId;
  const skipped = files.length - tiles.length;
  const parts = [`Opened ${opened} tile${opened === 1 ? '' : 's'}`];
  if (failed > 0) parts.push(`${failed} failed`);
  if (skipped > 0) parts.push(`${skipped} skipped`);
  flashStatus(parts.join(' · '));
}

/* ----------------------------------------------------------------- actions */

function selectEntry(id: number): void {
  selectedId.value = id;
}

function setMode(next: ViewMode): void {
  if (mode.value !== next) mode.value = next;
}

async function copyDoc(): Promise<void> {
  if (doc.value == null) return;
  const text = JSON.stringify(doc.value, null, 2);
  const ok = await writeClipboard(text);
  flashStatus(ok ? `Copied ${modeLabel.value} to clipboard` : 'Copy failed');
}

function downloadTile(): void {
  const entry = selectedEntry.value;
  if (!entry?.bytes) return;
  const blob = new Blob([entry.bytes], { type: 'application/x-protobuf' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = downloadName(entry);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  flashStatus(`Downloaded ${anchor.download}`);
}

function downloadName(entry: PanelEntry): string {
  if (entry.xyz) return `${entry.xyz.z}-${entry.xyz.x}-${entry.xyz.y}.pbf`;
  try {
    const path = new URL(entry.url).pathname;
    const name = path.split('/').filter(Boolean).pop();
    if (name) return /\.(pbf|mvt)$/i.test(name) ? decodeURIComponent(name) : `${decodeURIComponent(name)}.pbf`;
  } catch {
    /* fall through */
  }
  return `tile-${entry.id}.pbf`;
}

function clearAll(): void {
  entries.value = new Map();
  order.value = [];
  selectedId.value = null;
  docCache.clear();
  doc.value = null;
  flashStatus('Cleared');
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall back below */
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

function flashStatus(message: string): void {
  statusFlash.value = message;
  window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => {
    statusFlash.value = '';
  }, 2500);
}

/* ------------------------------------------------------------- lifecycle */

function resolvePanelTheme(setting: ThemeSetting): 'dark' | 'light' {
  if (setting !== 'auto') return setting;
  try {
    const name = (chrome.devtools.panels as { themeName?: string }).themeName;
    if (name === 'dark' || name === 'light') return name;
  } catch {
    /* chrome.devtools unavailable outside DevTools */
  }
  return themeMedia.matches ? 'dark' : 'light';
}

function applyTheme(): void {
  theme.value = resolvePanelTheme(settings.theme);
}

function onKeyDown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  const typing =
    !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
  if (event.key === '/' && !typing) {
    event.preventDefault();
    filterInput.value?.focus();
  }
}

async function persistSettings(): Promise<void> {
  await saveSettings({ ...settings });
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

const themeMedia = window.matchMedia('(prefers-color-scheme: dark)');

const THEME_CYCLE: ThemeSetting[] = ['auto', 'light', 'dark'];
const themeIcon = computed(() => (settings.theme === 'dark' ? '☾' : settings.theme === 'light' ? '☀' : '◐'));

function cycleTheme(): void {
  const index = THEME_CYCLE.indexOf(settings.theme);
  settings.theme = THEME_CYCLE[(index + 1) % THEME_CYCLE.length];
  applyTheme();
  void saveSettings({ ...settings });
  flashStatus(`Theme: ${settings.theme}`);
}

function onStorageChanged(changes: Record<string, chrome.storage.StorageChange>, areaName: string): void {
  if (areaName !== 'sync') return;
  const themeChange = changes[STORAGE_KEYS.theme];
  if (themeChange) {
    settings.theme = normalizeTheme(themeChange.newValue);
    applyTheme();
  }
}

/**
 * Safety net: some DevTools environments do not deliver storage/media events
 * reliably to panel pages, so re-read the setting and re-resolve the theme
 * once a second. Cheap and idempotent.
 */
let themeSyncTimer = 0;

async function syncThemeFromStorage(): Promise<void> {
  try {
    const stored = (await chrome.storage.sync.get(STORAGE_KEYS.theme)) as Record<string, unknown>;
    const next = normalizeTheme(stored[STORAGE_KEYS.theme]);
    if (next !== settings.theme) settings.theme = next;
    applyTheme();
  } catch {
    /* storage unavailable (e.g. stale extension context) */
  }
}

onMounted(async () => {
  const saved = await loadSettings();
  Object.assign(settings, saved);
  applyTheme();
  themeMedia.addEventListener('change', applyTheme);
  chrome.storage.onChanged.addListener(onStorageChanged);
  themeSyncTimer = window.setInterval(syncThemeFromStorage, 1000);
  window.addEventListener('message', onWindowMessage);
  window.addEventListener('keydown', onKeyDown);
});

onBeforeUnmount(() => {
  themeMedia.removeEventListener('change', applyTheme);
  chrome.storage.onChanged.removeListener(onStorageChanged);
  window.clearInterval(themeSyncTimer);
  window.removeEventListener('message', onWindowMessage);
  window.removeEventListener('keydown', onKeyDown);
});
</script>
