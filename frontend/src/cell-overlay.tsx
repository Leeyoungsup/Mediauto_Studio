import { useLayoutEffect, useMemo, useRef } from 'react';
import type { CellIndex } from './cell-overlay-data';
import type { Viewport } from './tile-viewer';

type CellPoint = [x: number, y: number, grade: number, ...extra: unknown[]];
type Colors = Record<number, string>;

function drawDensePoints(ctx: CanvasRenderingContext2D, image: ImageData, cells: CellIndex, view: Viewport,
  ratio: number, colors: Colors) {
  const palette = new Map(Object.entries(colors).map(([key, color]) => {
    const value = Number.parseInt(color.slice(1), 16);
    return [Number(key), [value >> 16, (value >> 8) & 255, value & 255]];
  }));
  const { data, width, height } = image;
  data.fill(0);
  const scale = view.zoom * ratio;
  const dot = Math.max(1, Math.round(ratio));
  cells.forEach([view.x, view.y, view.x + view.width, view.y + view.height], (x, y, grade) => {
    const color = palette.get(grade);
    if (!color) return;
    const px = Math.round((x - view.x) * scale);
    const py = Math.round((y - view.y) * scale);
    for (let row = Math.max(0, py - dot + 1); row <= Math.min(height - 1, py + dot); row++) {
      for (let col = Math.max(0, px - dot + 1); col <= Math.min(width - 1, px + dot); col++) {
        const index = (row * width + col) * 4;
        data[index] = color[0];
        data[index + 1] = color[1];
        data[index + 2] = color[2];
        data[index + 3] = 220;
      }
    }
  });
  ctx.putImageData(image, 0, 0);
}

// At a fixed scale, adjacent camera positions share the same rasterized outlines.
const contourTileSize = 256;

class CellContours {
  private readonly tiles = new Map<string, HTMLCanvasElement | null>();

  constructor(private readonly cells: CellIndex, private readonly colors: Colors, private readonly scale: number,
    private readonly radius: number, private readonly lineWidth: number) {}

  private renderTile(x: number, y: number) {
    const { scale, radius, lineWidth } = this;
    const padding = radius + lineWidth / 2 + 1;
    const paths = new Map<number, Path2D>();
    this.cells.forEach([(x - padding) / scale, (y - padding) / scale,
      (x + contourTileSize + padding) / scale, (y + contourTileSize + padding) / scale], (px, py, category) => {
      if (!this.colors[category]) return;
      let path = paths.get(category);
      if (!path) {
        path = new Path2D();
        paths.set(category, path);
      }
      const sx = px * scale - x;
      const sy = py * scale - y;
      path.moveTo(sx + radius, sy);
      path.arc(sx, sy, radius, 0, 2 * Math.PI);
    });
    if (!paths.size) return null;

    const tile = document.createElement('canvas');
    tile.width = tile.height = contourTileSize;
    const ctx = tile.getContext('2d');
    if (!ctx) return null;
    ctx.globalAlpha = 0.86;
    ctx.lineWidth = lineWidth;
    // Use the same class paint order on both sides of each tile edge.
    for (const [category, path] of [...paths].sort(([a], [b]) => a - b)) {
      ctx.strokeStyle = this.colors[category];
      ctx.stroke(path);
    }
    return tile;
  }

  draw(ctx: CanvasRenderingContext2D, view: Viewport, width: number, height: number) {
    const left = Math.round(view.x * this.scale);
    const top = Math.round(view.y * this.scale);
    const firstX = Math.floor(left / contourTileSize);
    const firstY = Math.floor(top / contourTileSize);
    const endX = Math.ceil((left + width) / contourTileSize);
    const endY = Math.ceil((top + height) / contourTileSize);
    for (let y = firstY; y < endY; y++) {
      for (let x = firstX; x < endX; x++) {
        const key = `${x}/${y}`;
        const px = x * contourTileSize;
        const py = y * contourTileSize;
        const tile = this.tiles.get(key);
        const current = tile === undefined ? this.renderTile(px, py) : tile;
        this.tiles.delete(key);
        this.tiles.set(key, current);
        if (current) ctx.drawImage(current, px - left, py - top);
      }
    }
    const capacity = 2 * (endX - firstX) * (endY - firstY);
    for (const key of this.tiles.keys()) {
      if (this.tiles.size <= capacity) break;
      this.tiles.delete(key);
    }
  }
}

export function CellOverlay({ view, cells, colors, label, selected, previewGrade, mpp }: {
  view?: Viewport; cells?: CellIndex; colors: Colors; label: string;
  selected?: CellPoint; previewGrade?: number; mpp?: number | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const raster = useRef<ImageData>(undefined);

  const ratio = window.devicePixelRatio || 1;
  const zoom = view?.zoom ?? 0;
  const effectiveMpp = mpp && zoom ? mpp / zoom : Infinity;
  const contours = useMemo(() => cells && effectiveMpp <= 5
    ? new CellContours(cells, colors, zoom * ratio, Math.max(2, (effectiveMpp < 1 ? 8 : 5) * zoom) * ratio,
      (effectiveMpp < 1 ? 2 : 1.2) * ratio)
    : undefined, [cells, colors, zoom, ratio, effectiveMpp]);

  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element || !view || !cells) return;
    const ctx = element.getContext('2d');
    if (!ctx) return;
    const { x, y, width, height, zoom } = view;
    const pixelWidth = Math.max(1, Math.round(width * zoom * ratio));
    const pixelHeight = Math.max(1, Math.round(height * zoom * ratio));
    if (element.width !== pixelWidth) element.width = pixelWidth;
    if (element.height !== pixelHeight) element.height = pixelHeight;
    ctx.resetTransform();
    ctx.clearRect(0, 0, pixelWidth, pixelHeight);
    ctx.globalAlpha = 1;
    // Match the SaaS AiViewer: actual-coordinate raster points at wide zoom, outlines only up close.
    const bounds: [number, number, number, number] = [x, y, x + width, y + height];
    let visible = 0;
    contours && cells.forEach(bounds, () => ++visible <= 50_000);
    const usePoints = !contours || visible > 50_000;
    element.dataset.overlayMode = usePoints ? 'points' : 'outlines';
    if (usePoints) {
      if (!raster.current || raster.current.width !== pixelWidth || raster.current.height !== pixelHeight) {
        raster.current = ctx.createImageData(pixelWidth, pixelHeight);
      }
      drawDensePoints(ctx, raster.current, cells, view, ratio, colors);
    } else {
      raster.current = undefined;
      contours.draw(ctx, view, pixelWidth, pixelHeight);
    }
    if (selected) {
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.globalAlpha = 0.86;
      ctx.beginPath();
      ctx.arc((selected[0] - x) * zoom, (selected[1] - y) * zoom, 8, 0, 2 * Math.PI);
      ctx.strokeStyle = previewGrade === undefined ? '#fff' : colors[previewGrade];
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [view, cells, colors, selected, previewGrade, ratio, contours]);

  if (!view || !cells) return null;
  return <canvas className="pdl1-overlay" ref={canvas} aria-label={label} data-cell-count={cells.count} />;
}
