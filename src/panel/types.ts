import type { TileEntry } from '../shared/messages';
import type { TileSummary } from './decoder';

/** A captured tile entry enriched with its cheap parse summary. */
export interface PanelEntry extends TileEntry {
  summary: TileSummary | null;
  decodeMs?: number;
}

export type ViewMode = 'json' | 'geojson';
