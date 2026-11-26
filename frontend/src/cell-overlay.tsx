import { useEffect, useRef } from 'react';
import type { Viewport } from './tile-viewer';

export type CellPoint = [x: number, y: number, grade: number, ...extra: unknown[]];
export type OverlayDensity = { step: number; bins: [x: number, y: number, grade: number, cells: number][] };

function drawDensePoints(ctx: CanvasRenderingContext2D, image: ImageData, points: CellPoint[], view: Viewport,
  ratio: number, colors: Record<number, string>) {
  const palette = new Map(Object.entries(colors).map(([key, color]) => {
    const value = Number.parseInt(color.slice(1), 16);
    return [Number(key), [value >> 16, (value >> 8) & 255, value & 255]];
  }));
  const { data, width, height } = image;
  data.fill(0);
  const scale = view.zoom * ratio;
  const dot = Math.max(1, Math.round(ratio));
  for (const [x, y, grade] of points) {
    const color = palette.get(grade);
    if (!color) continue;
    const px = Math.round((x - view.x) * scale);
    const py = Math.round((y - view.y) * scale);
    if (px + dot <= 0 || py + dot <= 0 || px - dot >= width || py - dot >= height) continue;
    for (let row = Math.max(0, py - dot); row < Math.min(height, py + dot); row++) {
      for (let col = Math.max(0, px - dot); col < Math.min(width, px + dot); col++) {
        const index = (row * width + col) * 4;
        data[index] = color[0];
        data[index + 1] = color[1];
        data[index + 2] = color[2];
        data[index + 3] = 220;
      }
    }
  }
  ctx.putImageData(image, 0, 0);
}

export function CellOverlay({ view, points, density, colors, label, selected, previewGrade, mpp }: {
  view?: Viewport; points?: CellPoint[]; colors: Record<number, string>; label: string;
  density?: OverlayDensity; selected?: CellPoint; previewGrade?: number; mpp?: number | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const raster = useRef<ImageData>(undefined);

  useEffect(() => {
    const element = canvas.current;
    if (!element || !view) return;
    const ctx = element.getContext('2d');
    if (!ctx) return;
    const { x, y, width, height, zoom } = view;
    const ratio = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(width * zoom * ratio);
    const pixelHeight = Math.round(height * zoom * ratio);
    if (element.width !== pixelWidth) element.width = pixelWidth;
    if (element.height !== pixelHeight) element.height = pixelHeight;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width * zoom, height * zoom);
    if (!points && density) {
      const grades = Object.keys(colors).map(Number);
      const columns = Math.max(1, Math.ceil(Math.sqrt(grades.length)));
      const stride = density.step * zoom / columns;
      const offsets = new Map(grades.map((grade, index) => [grade, [index % columns, Math.floor(index / columns)]]));
      for (const [px, py, category, count] of density.bins) {
        const origin = offsets.get(category);
        if (!origin || px + density.step <= x || py + density.step <= y || px >= x + width || py >= y + height) continue;
        ctx.globalAlpha = Math.min(.76, .25 + Math.log1p(count) * .12);
        ctx.fillStyle = colors[category];
        ctx.fillRect((px - x) * zoom + origin[0] * stride, (py - y) * zoom + origin[1] * stride,
          Math.max(.75, stride), Math.max(.75, stride));
      }
      return;
    }
    if (!points) return;
    ctx.globalAlpha = 0.86;
    // SaaS AiViewer uses compact points above 5 µm/px and outlines at higher magnification.
    const effectiveMpp = mpp ? mpp / zoom : Infinity;
    if (points.length > 50_000) {
      if (!raster.current || raster.current.width !== pixelWidth || raster.current.height !== pixelHeight) {
        raster.current = ctx.createImageData(pixelWidth, pixelHeight);
      }
      drawDensePoints(ctx, raster.current, points, view, ratio, colors);
    } else {
      raster.current = undefined;
      const dense = effectiveMpp > 5;
      const radius = Math.max(2, (effectiveMpp < 1 ? 8 : 5) * zoom);
      const byClass = new Map<number, Path2D>();
      for (const [px, py, category] of points) {
        const sx = (px - x) * zoom;
        const sy = (py - y) * zoom;
        if (!colors[category] || sx < 0 || sy < 0 || sx >= width * zoom || sy >= height * zoom) continue;
        const path = byClass.get(category) ?? new Path2D();
        if (dense) path.rect(Math.round(sx) - 1, Math.round(sy) - 1, 2, 2);
        else {
          path.moveTo(sx + radius, sy);
          path.arc(sx, sy, radius, 0, 2 * Math.PI);
        }
        byClass.set(category, path);
      }
      for (const [category, path] of byClass) {
        if (dense) {
          ctx.fillStyle = colors[category];
          ctx.fill(path);
        } else {
          ctx.strokeStyle = colors[category];
          ctx.lineWidth = effectiveMpp < 1 ? 2 : 1.2;
          ctx.stroke(path);
        }
      }
    }
    if (selected) {
      ctx.beginPath();
      ctx.arc((selected[0] - x) * zoom, (selected[1] - y) * zoom, 8, 0, 2 * Math.PI);
      ctx.strokeStyle = previewGrade === undefined ? '#fff' : colors[previewGrade];
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [view, points, density, colors, selected, previewGrade, mpp]);

  if (!view || (!points && !density)) return null;
  return <canvas className="pdl1-overlay" ref={canvas} aria-label={label} data-overlay-mode={points ? 'cells' : 'density'} title={points ? undefined : 'Cell density overview'} />;
}
