/**
 * MVT Viewer — decoding engine.
 *
 * Implements the Mapbox Vector Tile 2.1 protobuf schema twice:
 *
 *   1. decodeMvtRaw    — schema walk into readable JSON (keys/values, tags,
 *                        raw geometry command integers, resolved properties)
 *   2. decodeMvtGeoJson — features as GeoJSON; WGS84 lon/lat when Z/X/Y tile
 *                        coordinates are known (via @mapbox/vector-tile),
 *                        otherwise tile-local coordinates (0..extent)
 *
 * Pure data functions: no DOM, no browser APIs. The Node test suite
 * (tests/run-tests.mjs) executes this file directly.
 */

import Pbf from 'pbf';
import { VectorTile, type VectorTileFeature } from '@mapbox/vector-tile';
import type { TileXYZ } from '../shared/messages';

/* ------------------------------------------------------------------ fields */

const F = {
  TILE_LAYERS: 3,
  LAYER_NAME: 1,
  LAYER_FEATURES: 2,
  LAYER_KEYS: 3,
  LAYER_VALUES: 4,
  LAYER_EXTENT: 5,
  LAYER_VERSION: 15,
  FEATURE_ID: 1,
  FEATURE_TAGS: 2,
  FEATURE_TYPE: 3,
  FEATURE_GEOMETRY: 4,
  VALUE_STRING: 1,
  VALUE_FLOAT: 2,
  VALUE_DOUBLE: 3,
  VALUE_INT64: 4,
  VALUE_UINT64: 5,
  VALUE_SINT64: 6,
  VALUE_BOOL: 7,
} as const;

export const GEOM_TYPE_NAMES = ['UNKNOWN', 'POINT', 'LINESTRING', 'POLYGON'] as const;

/* ------------------------------------------------------------------- types */

export interface RawFeature {
  id: number;
  type: string;
  tags: number[];
  geometry: number[];
  properties: Record<string, unknown>;
}

export interface RawLayer {
  name: string;
  version: number;
  extent: number;
  keys: string[];
  values: unknown[];
  featureCount: number;
  features: RawFeature[];
}

export interface RawTile {
  layers: RawLayer[];
}

export interface TileSummary {
  layerCount: number;
  featureCount: number;
  layers: Array<{ name: string; featureCount: number }>;
}

export interface GeoJsonFeature {
  type: 'Feature';
  id?: number;
  geometry: { type: string; coordinates?: unknown; geometries?: unknown[] };
  properties: Record<string, unknown>;
  /** Foreign member: the MVT layer this feature came from. */
  layer?: string;
}

export interface GeoJsonLayer {
  name: string;
  version: number;
  extent: number;
  featureCount: number;
  features: GeoJsonFeature[];
}

export interface GeoJsonTile {
  type: 'FeatureCollection';
  coordinateMode: 'wgs84' | 'tile-local';
  layerCount: number;
  featureCount: number;
  layers: GeoJsonLayer[];
}

/* --------------------------------------------------------------- raw walk */

export function decodeMvtRaw(bytes: Uint8Array): RawTile {
  const pbf = new Pbf(bytes);
  const tile: RawTile = { layers: [] };

  while (pbf.pos < pbf.length) {
    const tag = pbf.readVarint();
    const field = tag >> 3;
    if (field === F.TILE_LAYERS) {
      tile.layers.push(readLayer(pbf, pbf.readVarint() + pbf.pos));
    } else {
      pbf.skip(tag);
    }
  }
  return tile;
}

function readLayer(pbf: Pbf, end: number): RawLayer {
  const layer: RawLayer = {
    name: '',
    version: 1,
    extent: 4096,
    keys: [],
    values: [],
    featureCount: 0,
    features: [],
  };

  while (pbf.pos < end) {
    const tag = pbf.readVarint();
    const field = tag >> 3;
    if (field === F.LAYER_VERSION) layer.version = pbf.readVarint();
    else if (field === F.LAYER_NAME) layer.name = pbf.readString();
    else if (field === F.LAYER_EXTENT) layer.extent = pbf.readVarint();
    else if (field === F.LAYER_FEATURES) layer.features.push(readFeature(pbf, pbf.readVarint() + pbf.pos));
    else if (field === F.LAYER_KEYS) layer.keys.push(pbf.readString());
    else if (field === F.LAYER_VALUES) layer.values.push(readValue(pbf));
    else pbf.skip(tag);
  }

  layer.featureCount = layer.features.length;
  for (const feature of layer.features) resolveProperties(layer, feature);
  return layer;
}

function readFeature(pbf: Pbf, end: number): RawFeature {
  const feature: RawFeature = { id: 0, type: 'UNKNOWN', tags: [], geometry: [], properties: {} };

  while (pbf.pos < end) {
    const tag = pbf.readVarint();
    const field = tag >> 3;
    if (field === F.FEATURE_ID) {
      feature.id = pbf.readVarint();
    } else if (field === F.FEATURE_TAGS) {
      const tagsEnd = pbf.readVarint() + pbf.pos;
      while (pbf.pos < tagsEnd) feature.tags.push(pbf.readVarint());
    } else if (field === F.FEATURE_TYPE) {
      const type = pbf.readVarint();
      feature.type = GEOM_TYPE_NAMES[type] ?? 'UNKNOWN';
    } else if (field === F.FEATURE_GEOMETRY) {
      const geometryEnd = pbf.readVarint() + pbf.pos;
      while (pbf.pos < geometryEnd) feature.geometry.push(pbf.readVarint());
    } else {
      pbf.skip(tag);
    }
  }
  return feature;
}

function readValue(pbf: Pbf): unknown {
  const end = pbf.readVarint() + pbf.pos;
  let value: unknown = null;

  while (pbf.pos < end) {
    const tag = pbf.readVarint();
    const field = tag >> 3;
    if (field === F.VALUE_STRING) value = pbf.readString();
    else if (field === F.VALUE_FLOAT) value = pbf.readFloat();
    else if (field === F.VALUE_DOUBLE) value = pbf.readDouble();
    else if (field === F.VALUE_INT64 || field === F.VALUE_UINT64) value = pbf.readVarint64();
    else if (field === F.VALUE_SINT64) value = pbf.readSVarint();
    else if (field === F.VALUE_BOOL) value = pbf.readBoolean();
    else pbf.skip(tag);
  }
  return value;
}

function resolveProperties(layer: RawLayer, feature: RawFeature): void {
  const tags = feature.tags;
  for (let i = 0; i + 1 < tags.length; i += 2) {
    const key = layer.keys[tags[i]];
    const value = layer.values[tags[i + 1]];
    if (key !== undefined) feature.properties[key] = value === undefined ? null : value;
  }
}

/* ------------------------------------------------------- lightweight count */

/**
 * Cheap validity + stats pass used to badge the request list.
 * Counts layers/features without materializing geometry or properties.
 */
export function summarizeMvt(bytes: Uint8Array): TileSummary {
  const pbf = new Pbf(bytes);
  const layers: TileSummary['layers'] = [];
  let featureCount = 0;

  while (pbf.pos < pbf.length) {
    const tag = pbf.readVarint();
    const field = tag >> 3;
    if (field === F.TILE_LAYERS) {
      const end = pbf.readVarint() + pbf.pos;
      let name = '';
      let count = 0;
      while (pbf.pos < end) {
        const innerTag = pbf.readVarint();
        const innerField = innerTag >> 3;
        if (innerField === F.LAYER_NAME) name = pbf.readString();
        else if (innerField === F.LAYER_FEATURES) count++;
        if (innerField !== F.LAYER_NAME) pbf.skip(innerTag);
      }
      layers.push({ name, featureCount: count });
      featureCount += count;
    } else {
      pbf.skip(tag);
    }
  }
  return { layerCount: layers.length, featureCount, layers };
}

/* ----------------------------------------------------------------- GeoJSON */

export function decodeMvtGeoJson(bytes: Uint8Array, xyz: TileXYZ | null): GeoJsonTile {
  const tile = new VectorTile(new Pbf(bytes));
  const layers: GeoJsonLayer[] = [];
  let featureCount = 0;

  for (const name of Object.keys(tile.layers)) {
    const layer = tile.layers[name];
    const features: GeoJsonFeature[] = [];

    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i);
      const geojson = xyz
        ? (feature.toGeoJSON(xyz.x, xyz.y, xyz.z) as unknown as GeoJsonFeature)
        : featureToLocalGeoJSON(feature);
      geojson.layer = name;
      features.push(geojson);
    }

    featureCount += features.length;
    layers.push({
      name,
      version: layer.version,
      extent: layer.extent,
      featureCount: features.length,
      features,
    });
  }

  return {
    type: 'FeatureCollection',
    coordinateMode: xyz ? 'wgs84' : 'tile-local',
    layerCount: layers.length,
    featureCount,
    layers,
  };
}

type Ring = Array<[number, number]>;
type Polygon = Ring[];
type MultiPolygon = Polygon[];

function featureToLocalGeoJSON(feature: VectorTileFeature): GeoJsonFeature {
  const lines = feature.loadGeometry().map((line) => line.map((p) => [p.x, p.y] as [number, number]));
  const id = feature.id;

  let geometry: GeoJsonFeature['geometry'];
  if (feature.type === 1) {
    geometry = { type: 'Point', coordinates: lines[0]?.[0] ?? [] };
  } else if (feature.type === 2) {
    geometry = { type: 'LineString', coordinates: lines[0] ?? [] };
  } else if (feature.type === 3) {
    const polygons = classifyRings(lines);
    geometry =
      polygons.length === 1
        ? { type: 'Polygon', coordinates: polygons[0] }
        : { type: 'MultiPolygon', coordinates: polygons };
  } else {
    geometry = { type: 'GeometryCollection', geometries: [] };
  }

  return {
    type: 'Feature',
    geometry,
    properties: { ...feature.properties },
    ...(id !== undefined ? { id } : {}),
  };
}

function signedArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0, len = ring.length, j = len - 1; i < len; j = i++) {
    const p1 = ring[i];
    const p2 = ring[j];
    sum += (p2[0] - p1[0]) * (p1[1] + p2[1]);
  }
  return sum;
}

/**
 * Ring → polygon classification (same winding rule as @mapbox/vector-tile,
 * with a guard for the degenerate "hole before exterior" case).
 */
function classifyRings(rings: Ring[]): MultiPolygon {
  if (rings.length <= 1) return [rings];

  const polygons: MultiPolygon = [];
  let polygon: Polygon | null = null;
  let ccw: boolean | undefined;

  for (const ring of rings) {
    const area = signedArea(ring);
    if (area === 0) continue;
    if (ccw === undefined) ccw = area < 0;
    if (ccw === area < 0) {
      if (polygon) polygons.push(polygon);
      polygon = [ring];
    } else if (polygon) {
      polygon.push(ring);
    }
  }
  if (polygon) polygons.push(polygon);
  return polygons.length > 0 ? polygons : [rings];
}
