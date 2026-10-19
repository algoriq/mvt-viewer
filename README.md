# MVT Viewer - Mapbox Vector Tile Inspector

A high-performance, offline-capable **Chrome DevTools extension** for GIS developers, mapping engineers, and web
cartographers. It intercepts **Mapbox Vector Tile (MVT)** network responses and decodes the binary Protocol Buffer
(`.pbf` / `.mvt`) payloads into clean, readable, interactive **JSON or GeoJSON** - directly inside your DevTools panel.

Built on **Vue 3 + Vite + TypeScript**, decoding is powered by
[`pbf`](https://github.com/mapbox/pbf) and [`@mapbox/vector-tile`](https://github.com/mapbox/vector-tile)
(plus `@mapbox/point-geometry`), bundled into the extension at build time.

## Features

- 📡 **Automatic network interception** - listens to finished network requests and catches MVT/PBF tile responses from
  Mapbox, MapLibre, OpenLayers, MapTiler, and custom servers. Zero configuration, zero host permissions.
- 📦 **Zero-setup offline parser** - the decoding engine ships inside the extension. Works 100% offline with zero
  external network requests.
- 🗺️ **WGS84 lon/lat projection** - Z/X/Y coordinates are parsed from URL segments and tile-local geometries
  (0–4096) are translated to WGS84 longitude/latitude in GeoJSON mode. Falls back safely to local coordinates when
  the tile address is unavailable.
- 🚀 **Ultra-fast tree viewer** - an optimized lazy renderer that appends DOM rows in `requestAnimationFrame` batches,
  so massive datasets stay fluid. Collapse, expand, or toggle entire nodes seamlessly.
- 🔍 **Instant text filtering** - real-time search highlights keys and values, auto-expanding parent sections to
  reveal every match.
- 💾 **Developer controls** - copy formatted JSON/GeoJSON with one click, or download the raw tile to disk.
- 🌓 **Theme support** - Light / Dark / Auto: follows the browser & DevTools theme by default, with an explicit
  override in settings applied instantly to the panel, popup, and options page.
- 📂 **Local file support** - drop `.pbf` / `.mvt` tiles onto the panel (or use **Open file**) to decode them with zero
  network traffic; files named `z-x-y.pbf` project to WGS84 automatically.

## Install

1. Build (or use a prebuilt `dist/`):

   ```bash
   bun install
   bun run build
   ```

2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top-right corner).
4. Click **Load unpacked** and select this repo's **`dist/`** folder.
5. Open any page with a vector map (e.g. any MapLibre GL JS demo), open **DevTools (F12)**, and switch to the new
   **MVT Viewer** tab.

> Reload the inspected page with DevTools already open so the first tile requests are captured.

## Usage

| Action            | How                                                                                                      |
|-------------------|----------------------------------------------------------------------------------------------------------|
| Inspect a tile    | Click a request in the left list; the tree view opens it                                                 |
| Switch view       | **JSON** (raw decoded tile structure) / **GeoJSON** (projected features) in the toolbar                  |
| Find data         | Type in the filter box (`/` focuses it); matching branches auto-expand and are highlighted               |
| Expand / collapse | Click any node; **Expand all** / **Collapse all** in the doc header                                      |
| Copy              | **Copy** button - copies the current view as formatted JSON                                              |
| Save tile         | **Download .pbf** - writes the original binary tile (named `z-x-y.pbf` when possible)                    |
| Open local tiles  | Drop `.pbf` / `.mvt` files onto the panel, or click **Open file** (toolbar / empty state)                |
| Switch theme      | Click the **☀ / ☾ / ◐** button in the panel toolbar (cycles auto → light → dark), or set it in Options |
| Reset             | **Clear** - drops all captured entries                                                                   |

The toolbar **Hide failed** toggle hides requests that were captured but could not be decoded as MVT (e.g. a
non-tile protobuf). Settings persist in `chrome.storage.sync` and can also be edited on the extension's
**Options** page (right-click the toolbar icon → Options). The **Theme** setting (Light / Dark / Auto) applies
instantly to the DevTools panel, the popup, and the options page - **Auto** follows the browser/DevTools theme.

## What gets captured

A response is treated as an MVT candidate when **any** of these hold:

- Content type is a protobuf/vector-tile MIME (`application/x-protobuf`,
  `application/vnd.mapbox-vector-tile`, `application/protobuf`, `application/vnd.protobuf`);
- URL ends with `.pbf` / `.mvt`;
- Content type is `application/octet-stream` **and** the URL contains a `…/z/x/y` segment pattern.

Candidates that fail to parse are listed with an error chip instead of being dropped, so you can see what was
(and wasn't) a real tile.

## Local files

Capturing network traffic is optional. Drag **`.pbf` / `.mvt` files** onto the panel - or use the **Open file**
button - and they appear in the request list like any captured tile (marked `FILE`). Files named `z-x-y.pbf` /
`z-x-y.mvt` (e.g. `12-2000-1000.pbf`) are recognized as that tile address and get WGS84 projection in GeoJSON
mode; other names decode in tile-local coordinates. Local entries survive panel resyncs; **Clear** removes them.

## Projection details

- The tile address is extracted with `/z/x/y(.pbf|.mvt)` from the URL. In **GeoJSON** mode features are projected to
  WGS84 lon/lat via `@mapbox/vector-tile`'s `toGeoJSON(z, x, y)`.
- When no address is found, features are emitted in **tile-local coordinates** (0–extent, y-down) and the doc is
  marked `tile-local coords` so it's never mistaken for WGS84.
- TMS-flipped Y sources (where the origin is the bottom instead of the top) will show mirrored latitudes in WGS84
  mode - a known tradeoff of pure URL-based detection.
- `uint64`/`int64` property values beyond 2⁵³ may lose precision in JSON display (inherent to JS numbers); the raw
  varints remain visible in JSON mode.

## Architecture

```
src/
├── devtools/index.ts   # DevTools page: onRequestFinished → candidate filter → getContent()
│                       # → bytes + metadata → window.postMessage to the panel window
├── panel/              # Vue 3 panel (DevTools tab)
│   ├── App.vue         # toolbar, mode switch, copy/download, settings, theme
│   ├── RequestList.vue # captured request list with status/size/time/z-x-y badges
│   ├── TreeView.vue    # thin Vue host around the tree engine
│   ├── tree.ts         # lazy, batch-rendered JSON tree + filter index (framework-free DOM)
│   ├── decoder.ts      # MVT 2.1 schema walk (raw JSON), GeoJSON/WGS84 + local fallback,
│   │                   # cheap summary pass - pure functions, executed by the Node tests
│   └── styles.css      # theme-aware styles (CSS custom properties, data-theme)
├── popup/              # toolbar popup: what it does + link to options
├── options/            # settings page (chrome.storage.sync)
└── shared/             # message protocol (devtools ⇄ panel), storage keys/defaults
```

- **No background service worker, no content script.** The DevTools page lives as long as DevTools is open and talks
  to the panel window directly (`chrome.devtools.panels.create` + `panel.onShown`), re-sending the full record every
  time the panel is shown so it always resyncs.
- **Permissions:** only `storage` (for the three settings). No host permissions at all - the
  `chrome.devtools.network` API grants access to the inspected page's traffic without them.
- **Performance:** the request list is fed by a cheap count-only parse (`summarizeMvt`); full decoding happens on
  selection. The tree renders children on expand in ~1200-row animation-frame batches; filtering walks the document
  once to index matches and expands only their ancestors.

## Development

```bash
bun install        # flat node_modules - pbf's CJS deps resolve out of the box
bun run dev        # vite build --watch → rebuilds dist/ on every change
bun run build      # production build into dist/
bun run typecheck  # vue-tsc + tsc, no emit
bun run test       # decoder/settings test suite
```

Reload policy: panel/popup/options changes apply after re-opening the pages; `devtools.js` and manifest changes
require the ↻ button in `chrome://extensions` and reopening DevTools.

### Tests

`tests/run-tests.mjs` builds a synthetic MVT tile with a hand-rolled protobuf writer and verifies the raw walk,
property resolution across all value types (string/float/double/bool/uint64), the WGS84 projection math, the
tile-local fallback, and edge cases. It runs the exact `src/panel/decoder.ts` the panel ships - under Bun
(native TypeScript support) or Node ≥ 23.6 (type stripping).

## Third-party libraries & licenses

| Package                                                            | Version      | License      |
|--------------------------------------------------------------------|--------------|--------------|
| [pbf](https://github.com/mapbox/pbf)                               | ^3.2.1       | BSD-3-Clause |
| [@mapbox/vector-tile](https://github.com/mapbox/vector-tile)       | ^1.3.1       | BSD-3-Clause |
| [@mapbox/point-geometry](https://github.com/mapbox/point-geometry) | (dependency) | ISC          |
| [Vue 3](https://vuejs.org/)                                        | ^3.5         | MIT          |
| [Vite](https://vitejs.dev/)                                        | ^6           | MIT          |

These are bundled into `dist/` at build time - the extension makes no network requests at runtime.

## Privacy

MVT Viewer performs **all** decoding locally. Captured tile bytes exist only in DevTools memory for the current
session and are never uploaded, logged remotely, or shared with third parties.
