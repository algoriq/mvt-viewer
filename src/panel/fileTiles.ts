/**
 * Local tile files (drag & drop / file picker).
 *
 * Pure helpers are covered by tests/run-tests.mjs; only readTileFile touches
 * browser APIs.
 */

import type { TileEntry, TileXYZ } from '../shared/messages';

const TILE_FILE_RE = /\.(pbf|mvt)$/i;

/** Matches tile addresses in file names: z-x-y.pbf / z_x_y.mvt / z.x.y.pbf. */
const NAME_XYZ_RE = /(\d{1,3})[-_.](\d{1,9})[-_.](\d{1,9})\.(?:pbf|mvt)$/i;

export function isTileFileName(name: string): boolean {
  return TILE_FILE_RE.test(name);
}

export function extractTileCoordsFromName(name: string): TileXYZ | null {
  const match = NAME_XYZ_RE.exec(name);
  if (!match) return null;
  const z = Number(match[1]);
  if (!Number.isFinite(z) || z < 0 || z > 30) return null;
  return { z, x: Number(match[2]), y: Number(match[3]) };
}

export async function readTileFile(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

/** Builds a synthetic TileEntry so dropped files flow through the same UI as captured tiles. */
export function buildLocalEntry(id: number, name: string, bytes: Uint8Array): TileEntry {
  return {
    id,
    url: name,
    method: 'FILE',
    status: 200,
    statusText: 'local file',
    mimeType: 'application/x-protobuf',
    timeMs: 0,
    capturedAt: Date.now(),
    xyz: extractTileCoordsFromName(name),
    size: bytes.byteLength,
    bytes,
  };
}
