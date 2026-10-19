/**
 * MVT Viewer — DevTools page script.
 *
 * Runs for the lifetime of DevTools on the inspected page. Intercepts finished
 * network requests, recognizes MVT candidates, reads their bodies and hands
 * raw bytes + metadata to the panel window (the only panel window we own).
 * No background worker or host permissions are required.
 */

import type { DevtoolsToPanelMessage, TileEntry, TileMeta, TileXYZ } from '../shared/messages';

const PANEL_TITLE = 'MVT Viewer';
const PANEL_PAGE = 'panel.html';
const PANEL_ICON = 'icons/icon-32.png';

/** Keep at most this many entries in memory on the DevTools side. */
const MAX_RECORDED_ENTRIES = 2000;

const MIME_HINTS = [
  'application/x-protobuf',
  'application/vnd.mapbox-vector-tile',
  'application/protobuf',
  'application/vnd.protobuf',
];

const TILE_FILE_RE = /\.(pbf|mvt)(?:[?#]|$)/i;
const XYZ_PATH_RE = /\/\d+\/\d+\/\d+(?:\.(?:pbf|mvt))?(?:[?#]|$)/;

let panelWindow: Window | null = null;
const recorded = new Map<number, TileEntry>();
let nextId = 1;

chrome.devtools.panels.create(PANEL_TITLE, PANEL_ICON, PANEL_PAGE, (panel) => {
  // `onShown` fires every time the panel is shown, so sending the full record
  // each time keeps the panel in sync even if it was reloaded in between.
  panel.onShown.addListener((win) => {
    panelWindow = win;
    flushAll();
  });
});

function post(message: DevtoolsToPanelMessage): void {
  try {
    panelWindow?.postMessage(message, '*');
  } catch {
    // The panel window may be mid-reload; the next `onShown` flush resyncs it.
  }
}

function flushAll(): void {
  if (!panelWindow || recorded.size === 0) return;
  post({ source: 'mvt-viewer-devtools', type: 'entries', entries: Array.from(recorded.values()) });
}

function isMvtCandidate(request: chrome.devtools.network.Request): boolean {
  const response = request.response;
  if (!response?.content) return false;
  if (response.status !== 200 && response.status !== 206) return false;

  const mime = (response.content.mimeType || '').toLowerCase();
  const url = request.request?.url || '';

  if (MIME_HINTS.some((hint) => mime.startsWith(hint))) return true;
  if (TILE_FILE_RE.test(url)) return true;
  if (mime === 'application/octet-stream' && XYZ_PATH_RE.test(url)) return true;
  return false;
}

function extractTileCoords(url: string): TileXYZ | null {
  const match = /(\d+)\/(\d+)\/(\d+)(?:\.(?:pbf|mvt))?(?:[?#]|$)/.exec(url);
  if (!match) return null;
  return { z: Number(match[1]), x: Number(match[2]), y: Number(match[3]) };
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function deliver(entry: TileEntry): void {
  recorded.set(entry.id, entry);
  while (recorded.size > MAX_RECORDED_ENTRIES) {
    const oldest = Math.min(...recorded.keys());
    recorded.delete(oldest);
  }
  if (panelWindow) post({ source: 'mvt-viewer-devtools', type: 'entry', entry });
}

chrome.devtools.network.onRequestFinished.addListener((request) => {
  if (!isMvtCandidate(request)) return;

  const meta: TileMeta = {
    id: nextId++,
    url: request.request.url,
    method: request.request.method,
    status: request.response.status,
    statusText: request.response.statusText || '',
    mimeType: request.response.content.mimeType || '',
    timeMs: Math.round((request.time ?? 0) * 1000),
    capturedAt: Date.now(),
    xyz: extractTileCoords(request.request.url),
    size: request.response.content.size ?? 0,
  };

  request.getContent((content, encoding) => {
    if (chrome.runtime.lastError || content == null) {
      meta.error = chrome.runtime.lastError?.message ?? 'Could not read the response body';
      deliver({ ...meta, bytes: null });
      return;
    }
    let bytes: Uint8Array;
    if (encoding === 'base64') {
      bytes = base64ToBytes(content);
    } else {
      // Text-ish body: keep bytes as-is (UTF-8). Binary protobuf responses
      // arrive base64-encoded in practice.
      bytes = new TextEncoder().encode(content);
    }
    meta.size = bytes.byteLength;
    deliver({ ...meta, bytes });
  });
});
