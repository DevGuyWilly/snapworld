// Fetches one vector tile and turns it into ready-to-upload geometry, off the main thread.
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { WORLD_SIZE } from '../geo/mercator';
import { buildBuildings } from './builders/buildings';
import { buildGround } from './builders/ground';
import { placeTrees } from './builders/trees';
import { PolygonGrid } from './builders/geom';
import type { MeshArrays, Poi, TileRequest, TileResult } from './types';

self.onmessage = async (e: MessageEvent<TileRequest>) => {
  const req = e.data;
  try {
    const res = await fetch(req.url);
    if (!res.ok) throw new Error(`tile ${req.z}/${req.x}/${req.y}: HTTP ${res.status}`);
    const tile = new VectorTile(new PbfReader(new Uint8Array(await res.arrayBuffer())));
    const extent = tile.layers.building?.extent ?? tile.layers.transportation?.extent ?? 4096;

    const n = 2 ** req.z, size = WORLD_SIZE / n;
    const mx0 = -WORLD_SIZE / 2 + req.x * size, myTop = WORLD_SIZE / 2 - req.y * size;
    const { mx, my, scale } = req.origin;
    const project = (px: number, py: number): [number, number] => [
      (mx0 + (px / extent) * size - mx) * scale,
      (my - (myTop - (py / extent) * size)) * scale,
    ];

    const footprints = new PolygonGrid();
    const { mesh: buildings, walls } = buildBuildings(tile.layers.building, project, footprints);
    const ground = buildGround(tile, project, extent);
    const [bx0, bz0] = project(0, 0), [bx1, bz1] = project(extent, extent);
    const trees = placeTrees(req.x * 73856093 ^ req.y * 19349663, ground.greenAreas, ground.roadLines, footprints, { x0: bx0, z0: bz0, x1: bx1, z1: bz1 });

    const pois: Poi[] = [];
    const poiLayer = tile.layers.poi;
    if (poiLayer) {
      for (let i = 0; i < poiLayer.length; i++) {
        const f = poiLayer.feature(i);
        const name = f.properties['name:latin'] || f.properties.name;
        if (f.type !== 1 || !name) continue;
        const p = f.loadGeometry()[0][0];
        if (p.x < 0 || p.y < 0 || p.x >= extent || p.y >= extent) continue;
        const [x, z] = project(p.x, p.y);
        pois.push({ name: String(name), cls: String(f.properties.class), sub: String(f.properties.subclass ?? ''), rank: Number(f.properties.rank) || 99, x, z });
      }
    }

    const groundOut = { base: ground.base, green: ground.green, water: ground.water, roads: ground.roads };
    const packed = footprints.pack();
    const result: TileResult = { id: req.id, buildings, ground: groundOut, trees, pois, footprints: packed, walls };
    const transfer: Transferable[] = [trees.buffer, packed.coords.buffer, packed.offsets.buffer, walls.buffer];
    for (const m of [buildings, ...Object.values(groundOut)] as MeshArrays[]) {
      for (const a of [m.position, m.normal, m.color, m.wall]) if (a) transfer.push(a.buffer);
    }
    postMessage(result, { transfer });
  } catch (err) {
    postMessage({ id: req.id, error: String(err) } satisfies TileResult);
  }
};
