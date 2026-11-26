import { useEffect, useRef } from 'react';
import type { Viewport } from './tile-viewer';

export type CellPoint = [x: number, y: number, grade: number, ...extra: unknown[]];

export function CellOverlay({ view, points, colors, label, selected, previewGrade, mpp }: {
  view?: Viewport; points?: CellPoint[]; colors: Record<number, string>; label: string;
  selected?: CellPoint; previewGrade?: number; mpp?: number | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    if (!element || !view || !points) return;
    const ctx = element.getContext('2d');
    if (!ctx) return;
    const { x, y, width, height, zoom } = view;
    const ratio = window.devicePixelRatio || 1;
    element.width = Math.round(width * zoom * ratio);
    element.height = Math.round(height * zoom * ratio);
    ctx.scale(ratio, ratio);
    ctx.globalAlpha = 0.86;
    // SaaS AiViewer uses compact points above 5 µm/px and outlines at higher magnification.
    const effectiveMpp = mpp ? mpp / zoom : Infinity;
    const dense = effectiveMpp > 5 || points.length > 50_000;
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
    if (selected) {
      ctx.beginPath();
      ctx.arc((selected[0] - x) * zoom, (selected[1] - y) * zoom, 8, 0, 2 * Math.PI);
      ctx.strokeStyle = previewGrade === undefined ? '#fff' : colors[previewGrade];
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [view, points, colors, selected, previewGrade, mpp]);

  if (!view || !points) return null;
  return <canvas className="pdl1-overlay" ref={canvas} aria-label={label} />;
}
