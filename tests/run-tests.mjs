/**
 * MVT Viewer decoder test suite (no test framework required).
 *
 * Builds a synthetic Mapbox Vector Tile with a hand-rolled protobuf writer,
 * then checks the raw walk, the WGS84 GeoJSON projection, the tile-local
 * fallback, and the cheap summary pass.
 *
 * Run with: node tests/run-tests.mjs   (Node >= 23.6 runs the .ts decoder
 * directly via type stripping; the decoder keeps erasable-syntax only.)
 */

import { decodeMvtGeoJson, decodeMvtRaw, summarizeMvt } from '../src/panel/decoder.ts';
import { extractTileCoordsFromName, isTileFileName } from '../src/panel/fileTiles.ts';
import { clampMaxEntries, normalizeTheme } from '../src/shared/storage.ts';

/* ---------------------------------------------------- tiny protobuf writer */

function writeVarint(target, value) {
  let v = typeof value === 'bigint' ? value : BigInt(Math.trunc(value));
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v) b |= 0x80;
    target.push(b);
  } while (v);
}

function writeTag(target, field, wire) {
  writeVarint(target, (field << 3) | wire);
}

function writeVarintField(target, field, value) {
  writeTag(target, field, 0);
  writeVarint(target, value);
}

function writeBytesField(target, field, bytes) {
  writeTag(target, field, 2);
  writeVarint(target, bytes.length);
  target.push(...bytes);
}

function writeStringField(target, field, str) {
  writeBytesField(target, field, Array.from(new TextEncoder().encode(str)));
}

function writeDoubleField(target, field, value) {
  writeTag(target, field, 1);
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, value, true);
  target.push(...new Uint8Array(buf));
}

const zigzag = (n) => (n << 1) ^ (n >> 31);

/* ------------------------------------------------------------- the fixture */

function buildFeature(id, tags, type, geometryInts) {
  const bytes = [];
  writeVarintField(bytes, 1, id);
  writeTag(bytes, 2, 2); // packed tags
  writeVarint(bytes, tags.length);
  for (const tag of tags) writeVarint(bytes, tag);
  writeVarintField(bytes, 3, type);
  writeTag(bytes, 4, 2); // packed geometry
  writeVarint(bytes, geometryInts.length);
  for (const g of geometryInts) writeVarint(bytes, g);
  return bytes;
}

function buildFixtureTile() {
  const layer = [];
  writeVarintField(layer, 15, 2); // version
  writeStringField(layer, 1, 'places');
  writeVarintField(layer, 5, 4096); // extent
  for (const key of ['name', 'pop', 'city', 'big']) writeStringField(layer, 3, key);

  // values: [string, double, bool, uint64]
  const v1 = [];
  writeStringField(v1, 1, 'Test Point');
  writeBytesField(layer, 4, v1);
  const v2 = [];
  writeDoubleField(v2, 3, 1.5);
  writeBytesField(layer, 4, v2);
  const v3 = [];
  writeVarintField(v3, 7, 1);
  writeBytesField(layer, 4, v3);
  const v4 = [];
  writeVarintField(v4, 5, 1234567890123n);
  writeBytesField(layer, 4, v4);

  // POINT at (25, 17)
  writeBytesField(layer, 2, buildFeature(1, [0, 0], 1, [9, zigzag(25), zigzag(17)]));
  // LINESTRING (10,10) → (30,10) → (30,25) → (35,25)
  writeBytesField(
    layer,
    2,
    buildFeature(
      2,
      [1, 1],
      2,
      [9, zigzag(10), zigzag(10), 26, zigzag(20), zigzag(0), zigzag(0), zigzag(15), zigzag(5), zigzag(0)],
    ),
  );
  // POLYGON ring (10,10) → (30,10) → (30,30) → (10,30) → close
  writeBytesField(
    layer,
    2,
    buildFeature(
      3,
      [2, 2],
      3,
      [9, zigzag(10), zigzag(10), 26, zigzag(20), zigzag(0), zigzag(0), zigzag(20), zigzag(-20), zigzag(0), 15],
    ),
  );
  // POINT at (100, 200) with a uint64 property
  writeBytesField(layer, 2, buildFeature(4, [3, 3], 1, [9, zigzag(100), zigzag(200)]));

  const tile = [];
  writeBytesField(tile, 3, layer);
  return new Uint8Array(tile);
}

/* ---------------------------------------------------------------- helpers */

let failures = 0;

function check(label, condition, extra = '') {
  if (condition) {
    console.log(`  \u2713 ${label}`);
  } else {
    failures++;
    console.error(`  \u2717 ${label}${extra ? ` — ${extra}` : ''}`);
  }
}

function approx(actual, expected, tolerance = 1e-6) {
  return Math.abs(actual - expected) <= tolerance;
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/* ------------------------------------------------------------------- tests */

console.log('MVT Viewer — decoder tests\n');

const bytes = buildFixtureTile();
const raw = decodeMvtRaw(bytes);

console.log('decodeMvtRaw:');
check('one layer decoded', raw.layers.length === 1);
const layer = raw.layers[0];
check('layer name', layer.name === 'places', layer.name);
check('layer version', layer.version === 2);
check('layer extent', layer.extent === 4096);
check('layer keys', deepEqual(layer.keys, ['name', 'pop', 'city', 'big']), JSON.stringify(layer.keys));
check(
  'layer values',
  deepEqual(layer.values, ['Test Point', 1.5, true, 1234567890123]),
  JSON.stringify(layer.values),
);
check('feature count', layer.featureCount === 4);

const [f0, f1, f2, f3] = layer.features;
check('feature 0 type', f0.type === 'POINT');
check('feature 0 id', f0.id === 1);
check('feature 0 tags', deepEqual(f0.tags, [0, 0]));
check('feature 0 geometry commands', deepEqual(f0.geometry, [9, 50, 34]), JSON.stringify(f0.geometry));
check('feature 0 resolved property', f0.properties.name === 'Test Point');
check('feature 1 type', f1.type === 'LINESTRING');
check('feature 1 property (double)', f1.properties.pop === 1.5);
check('feature 2 type', f2.type === 'POLYGON');
check('feature 2 property (bool)', f2.properties.city === true);
check('feature 3 property (uint64)', f3.properties.big === 1234567890123, String(f3.properties.big));

console.log('\nsummarizeMvt:');
const summary = summarizeMvt(bytes);
check('summary layer count', summary.layerCount === 1);
check('summary feature count', summary.featureCount === 4);
check('summary layer name', summary.layers[0]?.name === 'places');

console.log('\ndecodeMvtGeoJson (WGS84, z=1 x=1 y=0):');
const geo = decodeMvtGeoJson(bytes, { z: 1, x: 1, y: 0 });
check('coordinate mode', geo.coordinateMode === 'wgs84');
check('feature count', geo.featureCount === 4);
const gf0 = geo.layers[0].features[0];
check('feature id preserved', gf0.id === 1);
check('foreign layer member', gf0.layer === 'places');
check('geometry type', gf0.geometry.type === 'Point');
const [lon0, lat0] = gf0.geometry.coordinates;
check('lon projection', approx(lon0, 1.0986328125), String(lon0));
check('lat projection (near 85°N)', lat0 > 84.5 && lat0 < 85.5, String(lat0));

const gf1 = geo.layers[0].features[1];
check('linestring type', gf1.geometry.type === 'LineString');
check('linestring point count', gf1.geometry.coordinates.length === 4);
check('linestring first lon', approx(gf1.geometry.coordinates[0][0], 0.439453125), String(gf1.geometry.coordinates[0][0]));

const gf2 = geo.layers[0].features[2];
check('polygon type', gf2.geometry.type === 'Polygon');
const ring = gf2.geometry.coordinates[0];
check('polygon ring closed (5 points)', ring.length === 5);
check('polygon first == last', deepEqual(ring[0], ring[4]), JSON.stringify(ring[0]));
check('polygon first lon', approx(ring[0][0], 0.439453125), String(ring[0][0]));

const gf3 = geo.layers[0].features[3];
check('second point lon', approx(gf3.geometry.coordinates[0], 4.39453125), String(gf3.geometry.coordinates[0]));

console.log('\ndecodeMvtGeoJson (tile-local fallback):');
const local = decodeMvtGeoJson(bytes, null);
check('coordinate mode', local.coordinateMode === 'tile-local');
check('point local coords', deepEqual(local.layers[0].features[0].geometry.coordinates, [25, 17]));
const localRing = local.layers[0].features[2].geometry.coordinates[0];
check(
  'polygon local ring',
  deepEqual(localRing, [
    [10, 10],
    [30, 10],
    [30, 30],
    [10, 30],
    [10, 10],
  ]),
  JSON.stringify(localRing),
);

console.log('\nedge cases:');
const empty = decodeMvtRaw(new Uint8Array(0));
check('empty buffer → empty tile', deepEqual(empty, { layers: [] }));
const emptySummary = summarizeMvt(new Uint8Array(0));
check('empty buffer → empty summary', emptySummary.layerCount === 0 && emptySummary.featureCount === 0);

console.log('\nlocal file helpers:');
check('z-x-y.pbf name', deepEqual(extractTileCoordsFromName('12-2000-1000.pbf'), { z: 12, x: 2000, y: 1000 }));
check('underscore-separated name', deepEqual(extractTileCoordsFromName('3_4_5.mvt'), { z: 3, x: 4, y: 5 }));
check('dot-separated name', deepEqual(extractTileCoordsFromName('7.1.2.pbf'), { z: 7, x: 1, y: 2 }));
check('plain name → no coords', extractTileCoordsFromName('tiles.pbf') === null);
check('wrong extension → no coords', extractTileCoordsFromName('12-2000-1000.bin') === null);
check('z out of range → no coords', extractTileCoordsFromName('31-2000-1000.pbf') === null);
check(
  'tile file detection',
  isTileFileName('tiles.mvt') && isTileFileName('A.PBF') && !isTileFileName('x.pbfx') && !isTileFileName('x.json'),
);

console.log('\nsettings helpers:');
check('theme normalization', normalizeTheme('dark') === 'dark' && normalizeTheme('light') === 'light');
check('theme falls back to auto', normalizeTheme('bogus') === 'auto' && normalizeTheme(undefined) === 'auto');
check(
  'max entries clamp',
  clampMaxEntries(10) === 100 && clampMaxEntries(50000) === 10000 && clampMaxEntries(1234.9) === 1235,
);

console.log('');
if (failures === 0) {
  console.log('All MVT decoder tests passed.');
  process.exit(0);
} else {
  console.error(`${failures} test(s) FAILED.`);
  process.exit(1);
}
