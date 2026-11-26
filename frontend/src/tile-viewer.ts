// Level-0 coordinates, camera bounds and 1024px JPEG stages adapted from
// MeDIAuto-studio_saas frontend/js/tile-viewer.js at d3741bc.
import { request } from './session';

const tileSize = 1024;
const downsamples = [1, 4, 8];
const singleViewerLimits = { loads: 4, tiles: 64 };
export const wheelZoomStep = 1.1;
// Reference calibration from the SaaS TileViewer: 40× at 0.25 µm per CSS pixel.
export const referenceMagnification = 40 * 0.25;

export type SlideInfo = { dimensions: [number, number]; mpp_x: number | null; mpp_y: number | null };
export type CameraFrame = { x: number; y: number; zoom: number; fitZoom: number; dimensions: [number, number] };
export type Viewport = { x: number; y: number; width: number; height: number; zoom: number };
type Tile = { stage: number; x: number; y: number };

function keyOf({ stage, x, y }: Tile) { return `${stage}/${x}/${y}`; }

export async function loadBitmap(url: string, signal: AbortSignal) {
  const response = await request(url, { signal });
  return createImageBitmap(await response.blob());
}

export class TileViewer {
  private readonly context: CanvasRenderingContext2D;
  private readonly resizeObserver: ResizeObserver;
  private readonly cache = new Map<string, ImageBitmap>();
  private readonly requests = new Map<string, AbortController>();
  private readonly failed = new Set<string>();
  private frame = 0;
  private disposed = false;
  private width = 1;
  private height = 1;
  private minZoom = 0;
  private following = false;
  private zoom = 1;
  private centerX = 0;
  private centerY = 0;
  private overview?: ImageBitmap;
  private overviewReady = false;
  private ratio = 1;

  constructor(private canvas: HTMLCanvasElement, private slide: SlideInfo, private endpoint: string,
    private onView: (viewport: Viewport) => void, private onTileStatus: (state: 'loading' | 'ok' | 'partial' | 'unavailable') => void,
    private readonly limits: { loads: number; tiles: number; keepCameraOnResize?: boolean } = singleViewerLimits) {
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('This browser cannot open the slide canvas.');
    this.context = context;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  setOverview(bitmap?: ImageBitmap) {
    this.overview = bitmap;
    this.overviewReady = true;
    this.schedule();
  }

  retryTiles() {
    this.failed.clear();
    this.schedule();
  }

  private resize() {
    if (this.disposed) return;
    const width = Math.round(this.canvas.clientWidth);
    const height = Math.round(this.canvas.clientHeight);
    if (!width || !height) return;
    const firstSize = !this.minZoom;
    const ratio = window.devicePixelRatio || 1;
    if (!firstSize && width === this.width && height === this.height && ratio === this.ratio) return;
    const wasFit = firstSize || this.zoom <= this.minZoom;
    this.width = width;
    this.height = height;
    this.ratio = ratio;
    this.canvas.width = Math.round(width * this.ratio);
    this.canvas.height = Math.round(height * this.ratio);
    this.minZoom = Math.min(width / this.slide.dimensions[0], height / this.slide.dimensions[1]);
    if (!firstSize && this.limits.keepCameraOnResize) this.schedule();
    else if (wasFit && !this.following) this.fitToWindow();
    else this.update();
  }

  fitToWindow() {
    this.centerX = this.slide.dimensions[0] / 2;
    this.centerY = this.slide.dimensions[1] / 2;
    this.zoom = this.minZoom || 1;
    this.update();
  }

  magnify(factor: number) {
    this.zoomTo(this.zoom * factor);
  }

  zoomTo(zoom: number) {
    this.zoom = Math.min(Math.max(4, this.minZoom), Math.max(this.minZoom, zoom));
    this.update();
  }

  pan(dx: number, dy: number) {
    this.centerAt(this.centerX - dx / this.zoom, this.centerY - dy / this.zoom);
  }

  cameraFrame(): CameraFrame {
    return { x: this.centerX, y: this.centerY, zoom: this.zoom, fitZoom: this.minZoom, dimensions: this.slide.dimensions };
  }

  restoreCamera(camera: { x: number; y: number; zoom: number }) {
    this.zoom = Math.min(Math.max(4, this.minZoom), Math.max(this.minZoom, camera.zoom));
    this.centerAt(camera.x, camera.y);
  }

  followCamera(camera?: Pick<CameraFrame, 'x' | 'y' | 'zoom'>) {
    this.following = Boolean(camera);
    if (!camera) return;
    // The tracked camera is shared in slide coordinates and can be below this pane's fit zoom.
    this.zoom = Math.max(1e-9, Math.min(64, camera.zoom));
    this.centerAt(camera.x, camera.y);
  }

  centerAt(x: number, y: number) {
    this.centerX = x;
    this.centerY = y;
    this.update();
  }

  private update() {
    if (this.following) { this.schedule(); return; }
    const [width, height] = this.slide.dimensions;
    const halfX = this.width / this.zoom / 2;
    const halfY = this.height / this.zoom / 2;
    this.centerX = width > halfX * 2 ? Math.min(width - halfX, Math.max(halfX, this.centerX)) : width / 2;
    this.centerY = height > halfY * 2 ? Math.min(height - halfY, Math.max(halfY, this.centerY)) : height / 2;
    this.schedule();
  }

  private schedule() {
    if (!this.frame && !this.disposed) this.frame = requestAnimationFrame(() => { this.frame = 0; this.render(); });
  }

  private visibleTiles(stage: number, view: Viewport) {
    const size = tileSize * downsamples[stage];
    const [width, height] = this.slide.dimensions;
    const xMin = Math.floor(Math.max(0, view.x) / size);
    const yMin = Math.floor(Math.max(0, view.y) / size);
    const xMax = Math.ceil(Math.min(width, view.x + view.width) / size) - 1;
    const yMax = Math.ceil(Math.min(height, view.y + view.height) / size) - 1;
    const tiles: Tile[] = [];
    for (let y = yMin; y <= yMax; y++) {
      for (let x = xMin; x <= xMax; x++) tiles.push({ stage, x, y });
    }
    return tiles;
  }

  private render() {
    const [width, height] = this.slide.dimensions;
    const view = {
      x: this.centerX - this.width / this.zoom / 2, y: this.centerY - this.height / this.zoom / 2,
      width: this.width / this.zoom, height: this.height / this.zoom, zoom: this.zoom,
    };
    const ctx = this.context;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.fillStyle = '#282433';
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.save();
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-view.x, -view.y);
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();
    if (this.overview) ctx.drawImage(this.overview, 0, 0, width, height);

    const effectiveMpp = (this.slide.mpp_x ?? 0.25) / (this.zoom * this.ratio);
    const stage = effectiveMpp < 2 ? 0 : effectiveMpp < 15 ? 1 : 2;
    const wanted = this.visibleTiles(stage, view);
    // The pyramid overview covers low magnifications without fetching every coarse tile.
    const targets = this.overview && this.zoom * Math.max(width, height) <= Math.min(960, Math.max(width, height)) / this.ratio
      ? [] : wanted;
    for (let level = 2; level >= stage; level--) {
      const size = tileSize * downsamples[level];
      for (const tile of this.visibleTiles(level, view)) {
        const bitmap = this.cache.get(keyOf(tile));
        if (bitmap) ctx.drawImage(bitmap, tile.x * size, tile.y * size, size, size);
      }
    }
    ctx.restore();

    this.onView(view);
    if (!this.overviewReady) return;

    const distance = (tile: Tile) => {
      const size = tileSize * downsamples[tile.stage];
      return Math.hypot((tile.x + 0.5) * size - this.centerX, (tile.y + 0.5) * size - this.centerY);
    };
    const ordered = targets.sort((a, b) => distance(a) - distance(b)).slice(0, this.limits.tiles / 2);
    const keys = new Set(ordered.map(keyOf));
    for (const [key, controller] of this.requests) {
      if (!keys.has(key)) { controller.abort(); this.requests.delete(key); }
    }
    for (const key of this.failed) {
      if (!keys.has(key)) this.failed.delete(key);
    }
    for (const tile of ordered) {
      if (this.requests.size >= this.limits.loads) break;
      const key = keyOf(tile);
      if (this.cache.has(key) || this.failed.has(key) || this.requests.has(key)) continue;
      this.fetchTile(key);
    }
    const hasVisibleTile = wanted.some((tile) => this.cache.has(keyOf(tile)));
    if (!this.overview && !hasVisibleTile) {
      this.onTileStatus(this.requests.size ? 'loading' : 'unavailable');
    } else {
      this.onTileStatus(this.failed.size ? 'partial' : 'ok');
    }
  }

  private fetchTile(key: string) {
    const controller = new AbortController();
    this.requests.set(key, controller);
    void loadBitmap(`${this.endpoint}/${key}.jpeg`, controller.signal).then((bitmap) => {
      if (controller.signal.aborted) { bitmap.close(); return; }
      this.cache.set(key, bitmap);
      if (this.cache.size > this.limits.tiles) {
        const [oldest, image] = this.cache.entries().next().value!;
        image.close();
        this.cache.delete(oldest);
      }
    }).catch(() => {
      if (!controller.signal.aborted) this.failed.add(key);
    }).finally(() => {
      if (this.requests.get(key) === controller) this.requests.delete(key);
      if (!controller.signal.aborted) this.schedule();
    });
  }

  destroy() {
    this.disposed = true;
    this.resizeObserver.disconnect();
    cancelAnimationFrame(this.frame);
    for (const controller of this.requests.values()) controller.abort();
    this.requests.clear();
    for (const bitmap of this.cache.values()) bitmap.close();
    this.cache.clear();
  }
}
