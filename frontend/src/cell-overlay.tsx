import { useEffect, useRef } from 'react';
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

export function CellOverlay({ view, cells, colors, label, selected, previewGrade, mpp }: {
  view?: Viewport; cells?: CellIndex; colors: Colors; label: string;
  selected?: CellPoint; previewGrade?: number; mpp?: number | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const raster = useRef<ImageData>(undefined);

  useEffect(() => {
    const element = canvas.current;
    if (!element || !view || !cells) return;
    const ctx = element.getContext('2d');
    if (!ctx) return;
    const { x, y, width, height, zoom } = view;
    const ratio = window.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.round(width * zoom * ratio));
    const pixelHeight = Math.max(1, Math.round(height * zoom * ratio));
    if (element.width !== pixelWidth) element.width = pixelWidth;
    if (element.height !== pixelHeight) element.height = pixelHeight;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width * zoom, height * zoom);
    ctx.globalAlpha = 0.86;
    // Match the SaaS AiViewer: actual-coordinate raster points at wide zoom, outlines only up close.
    const effectiveMpp = mpp ? mpp / zoom : Infinity;
    const bounds: [number, number, number, number] = [x, y, x + width, y + height];
    let visible = 0;
    if (effectiveMpp <= 5) cells.forEach(bounds, () => ++visible <= 50_000);
    const usePoints = effectiveMpp > 5 || visible > 50_000;
    element.dataset.overlayMode = usePoints ? 'points' : 'outlines';
    if (usePoints) {
      if (!raster.current || raster.current.width !== pixelWidth || raster.current.height !== pixelHeight) {
        raster.current = ctx.createImageData(pixelWidth, pixelHeight);
      }
      drawDensePoints(ctx, raster.current, cells, view, ratio, colors);
    } else {
      raster.current = undefined;
      const radius = Math.max(2, (effectiveMpp < 1 ? 8 : 5) * zoom);
      const paths = new Map<number, Path2D>();
      cells.forEach(bounds, (px, py, category) => {
        if (!colors[category]) return;
        const sx = (px - x) * zoom;
        const sy = (py - y) * zoom;
        const path = paths.get(category) ?? new Path2D();
        path.moveTo(sx + radius, sy);
        path.arc(sx, sy, radius, 0, 2 * Math.PI);
        paths.set(category, path);
      });
      ctx.lineWidth = effectiveMpp < 1 ? 2 : 1.2;
      for (const [category, path] of paths) {
        ctx.strokeStyle = colors[category];
        ctx.stroke(path);
      }
    }
    if (selected) {
      ctx.beginPath();
      ctx.arc((selected[0] - x) * zoom, (selected[1] - y) * zoom, 8, 0, 2 * Math.PI);
      ctx.strokeStyle = previewGrade === undefined ? '#fff' : colors[previewGrade];
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [view, cells, colors, selected, previewGrade, mpp]);

  if (!view || !cells) return null;
  return <canvas className="pdl1-overlay" ref={canvas} aria-label={label} data-cell-count={cells.count} />;
}
