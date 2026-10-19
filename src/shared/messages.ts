/**
 * Message protocol between the DevTools page and the MVT Viewer panel.
 *
 * The DevTools page intercepts network responses and forwards raw bytes +
 * metadata to the panel window (window.postMessage, no background worker).
 */

export interface TileXYZ {
  z: number;
  x: number;
  y: number;
}

export interface TileMeta {
  id: number;
  url: string;
  method: string;
  status: number;
  statusText: string;
  mimeType: string;
  /** Total request time in milliseconds. */
  timeMs: number;
  capturedAt: number;
  /** Z/X/Y parsed from URL segments when present. */
  xyz: TileXYZ | null;
  size: number;
  error?: string;
}

export interface TileEntry extends TileMeta {
  /** Raw response body. `null` when the body could not be read. */
  bytes: Uint8Array | null;
}

export interface EntriesSnapshotMessage {
  source: 'mvt-viewer-devtools';
  type: 'entries';
  entries: TileEntry[];
}

export interface EntryMessage {
  source: 'mvt-viewer-devtools';
  type: 'entry';
  entry: TileEntry;
}

export type DevtoolsToPanelMessage = EntriesSnapshotMessage | EntryMessage;

export function isDevtoolsToPanelMessage(value: unknown): value is DevtoolsToPanelMessage {
  if (typeof value !== 'object' || value === null) return false;
  return (value as { source?: unknown }).source === 'mvt-viewer-devtools';
}
