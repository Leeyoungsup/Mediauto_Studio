import { useEffect, useState } from 'react';
import { request } from './session';

const bucketSize = 2048;
type Bounds = [left: number, top: number, right: number, bottom: number];

// Reuse the same level-0 grid for screen-space drawing and nearest-cell picking.
export class CellIndex {
  private readonly buckets = new Map<string, number[]>();
  readonly count: number;

  constructor(private readonly data: Float64Array, private readonly stride: 3 | 7) {
    this.count = data.length / stride;
    for (let offset = 0; offset < data.length; offset += stride) {
      const x = Math.floor(data[offset] / bucketSize);
      const y = Math.floor(data[offset + 1] / bucketSize);
      const key = `${x}/${y}`;
      const bucket = this.buckets.get(key);
      if (bucket) bucket.push(offset);
      else this.buckets.set(key, [offset]);
    }
  }

  forEach([left, top, right, bottom]: Bounds, visit: (x: number, y: number, grade: number, offset: number) => boolean | void) {
    const xStart = Math.max(0, Math.floor(left / bucketSize));
    const yStart = Math.max(0, Math.floor(top / bucketSize));
    for (let by = yStart; by < Math.ceil(bottom / bucketSize); by++) {
      for (let bx = xStart; bx < Math.ceil(right / bucketSize); bx++) {
        for (const offset of this.buckets.get(`${bx}/${by}`) ?? []) {
          const x = this.data[offset], y = this.data[offset + 1];
          if (x >= left && x < right && y >= top && y < bottom && visit(x, y, this.data[offset + 2], offset) === false) return;
        }
      }
    }
  }

  reviewCell(offset: number): [number, number, number, number, number, number, boolean] {
    return [this.data[offset], this.data[offset + 1], this.data[offset + 2], this.data[offset + 3],
      this.data[offset + 4], this.data[offset + 5], Boolean(this.data[offset + 6])];
  }
}

const nativeLittleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

async function loadCells(url: string, stride: 3 | 7, signal: AbortSignal) {
  const response = await request(url, { signal });
  const bytes = await response.arrayBuffer();
  if (response.headers.get('X-Cell-Stride') !== String(stride) || bytes.byteLength % (stride * 8)) {
    throw new Error('Invalid cell overlay data.');
  }
  if (signal.aborted) return;
  if (nativeLittleEndian) return new CellIndex(new Float64Array(bytes), stride);
  const packed = new DataView(bytes);
  const cells = new Float64Array(bytes.byteLength / 8);
  for (let index = 0; index < cells.length; index++) cells[index] = packed.getFloat64(index * 8, true);
  return new CellIndex(cells, stride);
}

export function useCellOverlay(base: string | undefined, version: number | undefined, stride: 3 | 7, enabled: boolean, attempt: number) {
  const url = base && `${base}/overlay${version === undefined ? '' : '?version=' + version}`;
  const [resource, setResource] = useState<{ url: string; attempt: number; cells?: CellIndex; failed?: boolean }>();
  const current = url && resource?.url === url && resource.attempt === attempt ? resource : undefined;

  useEffect(() => {
    if (!enabled || !url || current) return;
    const controller = new AbortController();
    void loadCells(url, stride, controller.signal).then((cells) => {
      if (!controller.signal.aborted) setResource({ url, attempt, cells });
    }).catch(() => {
      if (!controller.signal.aborted) setResource({ url, attempt, failed: true });
    });
    return () => controller.abort();
  }, [enabled, url, stride, attempt, current]);

  return { cells: enabled ? current?.cells : undefined, loading: enabled && Boolean(url && !current), failed: enabled && Boolean(current?.failed) };
}
