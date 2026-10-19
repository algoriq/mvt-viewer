<template>
  <aside class="sidebar">
    <div class="sidebar-head">
      <span class="sidebar-title">Requests</span>
      <span class="count-badge">{{ entries.length }}</span>
    </div>
    <ul class="request-list">
      <li v-if="entries.length === 0" class="request-empty">
        No vector tiles captured yet.<br />
        Keep DevTools open and load a map — or reload the page.
      </li>
      <li
        v-for="entry in entries"
        :key="entry.id"
        class="request-item"
        :class="{ selected: entry.id === selectedId, failed: !!entry.error }"
        :title="entry.url"
        @click="$emit('select', entry.id)"
      >
        <div class="req-top">
          <span class="req-status" :class="entry.error ? 'err' : 'ok'">{{ entry.error ? 'ERR' : entry.status }}</span>
          <span class="req-path">{{ pathLabel(entry) }}</span>
        </div>
        <div class="req-meta">
          <span>{{ formatBytes(entry.size) }}</span>
          <span>{{ entry.timeMs }} ms</span>
          <span v-if="entry.xyz" class="req-xyz">z{{ entry.xyz.z }}/{{ entry.xyz.x }}/{{ entry.xyz.y }}</span>
          <span v-if="summaryText(entry)">{{ summaryText(entry) }}</span>
        </div>
      </li>
    </ul>
  </aside>
</template>

<script setup lang="ts">
import type { PanelEntry } from './types';

defineProps<{
  entries: PanelEntry[];
  selectedId: number | null;
}>();

defineEmits<{
  select: [id: number];
}>();

function pathLabel(entry: PanelEntry): string {
  if (entry.xyz) return `${entry.xyz.z}/${entry.xyz.x}/${entry.xyz.y}`;
  try {
    const url = new URL(entry.url);
    const name = url.pathname.split('/').filter(Boolean).pop();
    return name ? decodeURIComponent(name) : entry.url;
  } catch {
    return entry.url;
  }
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function summaryText(entry: PanelEntry): string {
  if (entry.error) return 'failed to parse';
  if (!entry.summary) return '';
  const s = entry.summary;
  return `${s.layerCount} layer${s.layerCount === 1 ? '' : 's'} · ${s.featureCount} feature${s.featureCount === 1 ? '' : 's'}`;
}
</script>
