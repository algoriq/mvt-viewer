#!/usr/bin/env node
/**
 * Pack dist/ into assets/mvt-viewer-<version>.zip
 *
 * Zero-dependency, cross-platform zip writer (deflate via node:zlib), so it
 * runs anywhere Node or Bun is installed without adding npm packages.
 * The archive contains the *contents* of dist/ at its root — manifest.json
 * must sit at the top level of the zip for Chrome to load it directly.
 *
 * Usage:
 *   node scripts/pack.mjs        (Node)
 *   bun scripts/pack.mjs         (Bun)
 *   npm run pack                 (after `npm run build`)
 */

import { deflateRawSync } from 'node:zlib';
import { open, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------ paths and configuration */

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST_DIR = join(ROOT, 'dist');
const ASSETS_DIR = join(ROOT, 'assets');

/* ------------------------------------------------------------- helpers */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** DOS date/time from a JS timestamp (clamped to the ZIP epoch of 1980). */
function dosDateTime(timestampMs) {
  const d = new Date(timestampMs);
  const year = Math.max(1980, d.getFullYear());
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

async function listFilesRecursively(dir, base) {
  const files = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(fullPath, base)));
    } else if (entry.isFile()) {
      files.push({ path: fullPath, zipName: relative(base, fullPath).split('\\').join('/') });
    }
  }
  return files;
}

/* ------------------------------------------------------------------ main */

async function main() {
  // 1. Version comes from package.json
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  const version = pkg.version;
  if (!version) {
    console.error('✗ package.json has no "version" field.');
    process.exit(1);
  }

  // 2. dist/ must exist and contain something
  let distStats;
  try {
    distStats = await stat(DIST_DIR);
  } catch {
    console.error(`✗ "${relative(ROOT, DIST_DIR)}" not found — run "npm run build" first.`);
    process.exit(1);
  }
  if (!distStats.isDirectory()) {
    console.error(`✗ "${relative(ROOT, DIST_DIR)}" is not a directory.`);
    process.exit(1);
  }
  const files = (await listFilesRecursively(DIST_DIR, DIST_DIR)).sort((a, b) =>
    a.zipName < b.zipName ? -1 : a.zipName > b.zipName ? 1 : 0,
  );
  if (files.length === 0) {
    console.error(`✗ "${relative(ROOT, DIST_DIR)}" is empty — run "npm run build" first.`);
    process.exit(1);
  }

  // 3. Prepare destination
  await mkdir(ASSETS_DIR, { recursive: true });
  const zipName = `mvt-viewer-${version}.zip`;
  const zipPath = join(ASSETS_DIR, zipName);
  await rm(zipPath, { force: true }); // overwrite a previous archive of the same version

  // 4. Write the archive: local file headers, central directory, EOCD
  const fh = await open(zipPath, 'w');
  let offset = 0;
  const centralEntries = [];
  let totalUncompressed = 0;
  let totalCompressed = 0;

  for (const { path, zipName } of files) {
    const data = await readFile(path);
    const compressed = deflateRawSync(data);
    const crc = crc32(data);
    const stats = await stat(path);
    const { time: dosTime, date: dosDate } = dosDateTime(stats.mtimeMs);

    const nameBuffer = Buffer.from(zipName, 'utf8');

    // --- local file header ---
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // signature
    local.writeUInt16LE(20, 4); // version needed to extract (2.0)
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(8, 8); // compression method: deflate
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28); // extra field length

    await fh.write(local);
    await fh.write(nameBuffer);
    await fh.write(compressed);

    centralEntries.push({ nameBuffer, dosTime, dosDate, crc, compressed, data, offset });
    offset += local.length + nameBuffer.length + compressed.length;
    totalUncompressed += data.length;
    totalCompressed += compressed.length;
  }

  const centralOffset = offset;

  // --- central directory ---
  for (const entry of centralEntries) {
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8); // flags: UTF-8 names
    central.writeUInt16LE(8, 10); // method: deflate
    central.writeUInt16LE(entry.dosTime, 12);
    central.writeUInt16LE(entry.dosDate, 14);
    central.writeUInt32LE(entry.crc, 16);
    central.writeUInt32LE(entry.compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(entry.nameBuffer.length, 28);
    central.writeUInt16LE(0, 30); // extra field length
    central.writeUInt16LE(0, 32); // file comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal file attributes
    central.writeUInt32LE(0, 38); // external file attributes
    central.writeUInt32LE(entry.offset, 42); // local header offset

    await fh.write(central);
    await fh.write(entry.nameBuffer);
    offset += central.length + entry.nameBuffer.length;
  }

  const centralSize = offset - centralOffset;

  // --- end of central directory ---
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central directory
  eocd.writeUInt16LE(centralEntries.length, 8); // entries on this disk
  eocd.writeUInt16LE(centralEntries.length, 10); // total entries
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20); // comment length
  await fh.write(eocd);
  offset += eocd.length;
  await fh.close();

  // 5. Report
  const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
  console.log(
    `✓ packed ${files.length} file(s) → ${join('assets', zipName)}` +
      ` (${kb(totalUncompressed)} → ${kb(offset)})`,
  );
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exit(1);
});
