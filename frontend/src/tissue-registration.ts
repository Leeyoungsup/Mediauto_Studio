import type { Point } from './viewer-tools';
import type { SlideInfo } from './tile-viewer';

export type Transform = { axis: Point; offset: Point; scale: number };
export const identity: Transform = { axis: [1, 0], offset: [0, 0], scale: 1 };

export function project([x, y]: Point, { axis: [a, b], offset: [tx, ty] }: Transform): Point {
  return [a * x - b * y + tx, b * x + a * y + ty];
}

export function unproject([x, y]: Point, { axis: [a, b], offset: [tx, ty], scale }: Transform): Point {
  return [(a * (x - tx) + b * (y - ty)) / scale ** 2, (-b * (x - tx) + a * (y - ty)) / scale ** 2];
}

export function fitTissue(source: Point[], target: Point[], info: Pick<SlideInfo, 'mpp_x' | 'mpp_y'>) {
  if (source.length < 3 || source.length !== target.length) return;
  const [[x, y], [x2, y2]] = source;
  const [[u, v], [u2, v2]] = target;
  const dx = x2 - x, dy = y2 - y, du = u2 - u, dv = v2 - v;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 16 || du * du + dv * dv < 16) return;
  const a = (dx * du + dy * dv) / lengthSquared;
  const b = (dx * dv - dy * du) / lengthSquared;
  const fit: Transform = { axis: [a, b], offset: [u - (a * x - b * y), v - (b * x + a * y)], scale: Math.hypot(a, b) };
  const calibrated = Boolean(info.mpp_x && info.mpp_y);
  const sx = calibrated ? info.mpp_x! : 1, sy = calibrated ? info.mpp_y! : 1;
  const distances = source.slice(2).map((point, index) => {
    const [x, y] = project(point, fit);
    const [u, v] = target[index + 2];
    return Math.hypot((x - u) * sx, (y - v) * sy);
  });
  return { fit, unit: calibrated ? 'µm' : 'px', maximum: Math.max(...distances),
    rms: Math.sqrt(distances.reduce((sum, distance) => sum + distance ** 2, 0) / distances.length) };
}
