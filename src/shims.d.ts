/**
 * Minimal type declarations for the decoding libraries
 * (both ship without TypeScript types).
 */

declare module 'pbf' {
  export default class Pbf {
    constructor(buffer?: Uint8Array | ArrayBuffer | number);
    pos: number;
    length: number;
    type: number;
    readVarint(): number;
    readVarint64(): number;
    readSVarint(): number;
    readBoolean(): boolean;
    readFloat(): number;
    readDouble(): number;
    readString(): string;
    readBytes(): Uint8Array;
    skip(wireType: number): void;
    readFields<T>(readField: (tag: number, result: T, pbf: Pbf) => void, result: T, end?: number): T;
  }
}

declare module '@mapbox/vector-tile' {
  export class VectorTileFeature {
    id?: number;
    type: number;
    extent: number;
    properties: Record<string, unknown>;
    loadGeometry(): Array<Array<{ x: number; y: number }>>;
    bbox(): [number, number, number, number];
    toGeoJSON(x?: number, y?: number, z?: number): Record<string, unknown>;
  }
  export class VectorTileLayer {
    version: number;
    name: string;
    extent: number;
    length: number;
    feature(i: number): VectorTileFeature;
  }
  export class VectorTile {
    layers: Record<string, VectorTileLayer>;
    constructor(pbf: unknown, end?: number);
  }
}
