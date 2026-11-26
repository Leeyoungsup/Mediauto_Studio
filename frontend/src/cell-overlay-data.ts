import { useEffect, useMemo, useState } from 'react';
import type { CellPoint, OverlayDensity } from './cell-overlay';
import { api } from './session';
import type { Viewport } from './tile-viewer';

const tileSize = 2048;
const tileLimit = 36;
const retainedTiles = 72;

type Tile = { x: number; y: number; key: string };
type OverlayCache<T> = {
  controller?: AbortController; wanted: Tile[];
  tiles: Map<string, T[]>; pending: Set<string>; failed: Set<string>;
};
type OverlayPage<T> = { points: T[]; next_offset: number | null };

async function loadTile<T>(base: string, query: string, tile: Tile, signal: AbortSignal) {
  const points: T[] = [];
  let offset = 0;
  while (true) {
    const page = await api<OverlayPage<T>>(`${base}/overlay?${query}bx=${tile.x}&by=${tile.y}&offset=${offset}`, { signal });
    for (const point of page.points) points.push(point);
    if (page.next_offset === null) return points;
    if (page.next_offset <= offset) throw new Error('Invalid cell tile cursor.');
    offset = page.next_offset;
  }
}

function scheduleTiles<T>(cache: OverlayCache<T>, base: string, query: string, notify: () => void) {
  const controller = cache.controller;
  if (!controller || controller.signal.aborted) return;
  const wantedKeys = new Set(cache.wanted.map(({ key }) => key));
  for (const key of cache.tiles.keys()) {
    if (cache.tiles.size <= retainedTiles) break;
    if (!wantedKeys.has(key)) cache.tiles.delete(key);
  }
  for (const tile of cache.wanted) {
    if (cache.pending.size >= 4) break;
    if (cache.tiles.has(tile.key) || cache.pending.has(tile.key) || cache.failed.has(tile.key)) continue;
    cache.pending.add(tile.key);
    void loadTile<T>(base, query, tile, controller.signal)
      .then((points) => { if (!controller.signal.aborted) cache.tiles.set(tile.key, points); })
      .catch(() => { if (!controller.signal.aborted) cache.failed.add(tile.key); })
      .finally(() => {
        if (controller.signal.aborted) return;
        cache.pending.delete(tile.key);
        notify();
        scheduleTiles(cache, base, query, notify);
      });
  }
}

export function useCellOverlay<T extends CellPoint>(
  base: string | undefined, version: number | undefined, dimensions: [number, number] | undefined,
  count: number | undefined, enabled: boolean, view: Viewport | undefined, mpp: number | null | undefined, attempt: number,
) {
  const cache = useMemo<OverlayCache<T>>(() => ({
    wanted: [], tiles: new Map(), pending: new Set(), failed: new Set(),
  }), [base, version, attempt]);
  const [resource, setResource] = useState<{ cache: OverlayCache<T>; points?: T[]; density?: OverlayDensity; failed?: boolean }>();
  const [tileUpdate, setTileUpdate] = useState(0);
  const active = enabled && Boolean(base && dimensions && count !== undefined);
  const sparse = count !== undefined && count <= 5000;
  const [width, height] = dimensions ?? [0, 0];
  const query = version === undefined ? '' : `version=${version}&`;
  const xStart = Math.max(0, Math.floor((view?.x ?? 0) / tileSize));
  const yStart = Math.max(0, Math.floor((view?.y ?? 0) / tileSize));
  const xEnd = Math.ceil(Math.min(width, view ? view.x + view.width : 0) / tileSize);
  const yEnd = Math.ceil(Math.min(height, view ? view.y + view.height : 0) / tileSize);
  const extent = Math.max(0, xEnd - xStart) * Math.max(0, yEnd - yStart);
  const wantsTiles = active && !sparse && Boolean(view && (mpp ?? 0.25) / view.zoom <= 5 && extent <= tileLimit);
  const tiles = useMemo(() => {
    const wanted: Tile[] = [];
    if (!wantsTiles) return wanted;
    for (let y = yStart; y < yEnd; y++) {
      for (let x = xStart; x < xEnd; x++) wanted.push({ x, y, key: `${x}/${y}` });
    }
    const cx = (xStart + xEnd - 1) / 2;
    const cy = (yStart + yEnd - 1) / 2;
    return wanted.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
  }, [wantsTiles, xStart, yStart, xEnd, yEnd]);

  useEffect(() => {
    const controller = new AbortController();
    cache.controller = controller;
    cache.pending.clear();
    return () => controller.abort();
  }, [cache]);

  useEffect(() => {
    if (!active || !base) return;
    const controller = new AbortController();
    const url = sparse
      ? `${base}/cells?${query}left=0&top=0&right=${width}&bottom=${height}`
      : `${base}/overlay?${query}`;
    api<OverlayDensity | { points: T[] }>(url, { signal: controller.signal })
      .then((payload) => {
        if (!controller.signal.aborted) setResource({ cache, ...('points' in payload ? { points: payload.points } : { density: payload }) });
      })
      .catch(() => { if (!controller.signal.aborted) setResource({ cache, failed: true }); });
    return () => controller.abort();
  }, [active, cache, base, query, sparse, width, height]);

  useEffect(() => {
    cache.wanted = tiles;
    if (!active || !base || !tiles.length) return;
    const timer = window.setTimeout(() => scheduleTiles(cache, base, query, () => setTileUpdate((current) => current + 1)), 80);
    return () => window.clearTimeout(timer);
  }, [active, base, cache, query, tiles]);

  const visibleTiles = useMemo(() => {
    if (!wantsTiles || !tiles.every(({ key }) => cache.tiles.has(key))) return undefined;
    return tiles.flatMap(({ key }) => cache.tiles.get(key)!);
  }, [wantsTiles, tiles, cache, tileUpdate]);
  const current = active && resource?.cache === cache ? resource : undefined;
  const failed = Boolean(current?.failed || tiles.some(({ key }) => cache.failed.has(key)));
  return {
    points: active ? (sparse ? current?.points : visibleTiles) : undefined,
    density: visibleTiles ? undefined : current?.density,
    loading: active && (!current || (wantsTiles && !visibleTiles && !failed)),
    failed,
  };
}
