import { useEffect, useRef, useState } from 'react';
import { auditAttemptId, request } from './session';

export function viewportScale(mpp: number, zoom: number) {
  const target = 120 * mpp / zoom;
  const power = 10 ** Math.floor(Math.log10(target));
  const length = (target >= 5 * power ? 5 : target >= 2 * power ? 2 : 1) * power;
  const label = length >= 1000 ? `${length / 1000} mm` : `${Number(length.toPrecision(3))} µm`;
  return { label, width: length * zoom / mpp };
}

type Scale = ReturnType<typeof viewportScale>;
export type ViewportSnapshot = { image: HTMLCanvasElement; annotations?: string; scale?: Scale; cssWidth: number };

export function snapshotViewport(canvas: HTMLCanvasElement, scale?: Scale): ViewportSnapshot {
  const image = document.createElement('canvas');
  image.width = canvas.width;
  image.height = canvas.height;
  image.getContext('2d')!.drawImage(canvas, 0, 0);
  const overlay = canvas.parentElement?.querySelector<SVGSVGElement>('svg[aria-label="Review Annotation Overlay"]');
  const saved = overlay?.querySelectorAll<SVGGElement>('[data-saved-annotation]');
  let annotations: string | undefined;
  if (overlay && saved?.length) {
    const exported = overlay.cloneNode(false) as SVGSVGElement;
    exported.removeAttribute('class');
    exported.setAttribute('width', String(canvas.clientWidth));
    exported.setAttribute('height', String(canvas.clientHeight));
    for (const mark of saved) {
      const copy = mark.cloneNode(true) as SVGGElement;
      const originals = mark.querySelectorAll<SVGElement>('*');
      copy.querySelectorAll<SVGElement>('*').forEach((node, index) => {
        const style = getComputedStyle(originals[index]);
        for (const property of ['fill', 'stroke', 'stroke-width', 'paint-order', 'font-size', 'font-family', 'text-anchor']) {
          node.style.setProperty(property, style.getPropertyValue(property));
        }
      });
      exported.appendChild(copy);
    }
    annotations = new XMLSerializer().serializeToString(exported);
  }
  return { image, annotations, scale, cssWidth: canvas.clientWidth };
}

async function render(snapshot: ViewportSnapshot, resolution: number, format: string, markup: boolean, scaleBar: boolean) {
  const output = document.createElement('canvas');
  output.width = Math.max(1, Math.round(snapshot.image.width * resolution));
  output.height = Math.max(1, Math.round(snapshot.image.height * resolution));
  const context = output.getContext('2d')!;
  context.drawImage(snapshot.image, 0, 0, output.width, output.height);
  if (markup && snapshot.annotations) {
    const image = new Image();
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(snapshot.annotations);
    await image.decode();
    context.drawImage(image, 0, 0, output.width, output.height);
  }
  if (scaleBar && snapshot.scale) {
    const { width, label } = snapshot.scale;
    const ratio = output.width / snapshot.cssWidth;
    context.scale(ratio, ratio);
    context.font = '12px sans-serif';
    const barWidth = Math.max(width, context.measureText(label).width);
    const bottom = output.height / ratio - 10;
    context.fillStyle = '#171326';
    context.fillRect(12, bottom - 30, barWidth + 16, 30);
    const center = 20 + barWidth / 2;
    context.fillStyle = '#fff';
    context.textAlign = 'center';
    context.fillText(label, center, bottom - 15);
    context.strokeStyle = '#fff';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(center - width / 2, bottom - 11);
    context.lineTo(center - width / 2, bottom - 6);
    context.lineTo(center + width / 2, bottom - 6);
    context.lineTo(center + width / 2, bottom - 11);
    context.stroke();
  }
  return new Promise<Blob>((resolve, reject) => output.toBlob(
    (blob) => blob && blob.type === format ? resolve(blob) : reject(Error('Could not encode the image.')), format, 0.96,
  ));
}

export function ViewportExport({ snapshot, endpoint, onClose }: { snapshot: ViewportSnapshot; endpoint: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [markup, setMarkup] = useState(!!snapshot.annotations);
  const [scaleBar, setScaleBar] = useState(!!snapshot.scale);
  const [resolution, setResolution] = useState(1);
  const [format, setFormat] = useState('image/png');
  const [zoom, setZoom] = useState(100);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const attempt = useRef<string>(undefined);
  const pending = useRef<AbortController>(undefined);

  useEffect(() => {
    dialog.current?.showModal();
    return () => pending.current?.abort();
  }, []);
  useEffect(() => {
    let active = true;
    let url = '';
    setPreview('');
    setError('');
    render(snapshot, resolution, format, markup, scaleBar).then((blob) => {
      if (active) {
        url = URL.createObjectURL(blob);
        setPreview(url);
      }
    }).catch(() => { if (active) setError('Unable to prepare the image. Change an option to try again.'); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [snapshot, resolution, format, markup, scaleBar]);

  async function download() {
    if (!preview || busy) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError('');
    try {
      attempt.current ??= auditAttemptId();
      await request(`${endpoint}/viewer-records/viewport-export`, {
        method: 'POST', signal: controller.signal, headers: { 'X-Audit-Attempt': attempt.current },
      });
      const link = document.createElement('a');
      link.href = preview;
      link.download = `slide-current-view.${format === 'image/png' ? 'png' : 'jpg'}`;
      link.click();
      attempt.current = undefined;
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Download failed.');
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }

  return <dialog className="viewport-export" ref={dialog} aria-labelledby="viewport-export-title"
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <h2 id="viewport-export-title">Export Current View</h2>
    <fieldset disabled={busy} className="viewport-export-options">
      <label><input type="checkbox" checked={markup} disabled={!snapshot.annotations} onChange={(event) => setMarkup(event.target.checked)} /> Include Saved Annotations</label>
      <label><input type="checkbox" checked={scaleBar} disabled={!snapshot.scale} onChange={(event) => setScaleBar(event.target.checked)} /> Include Scale Bar</label>
      <label>Format <select value={format} onChange={(event) => setFormat(event.target.value)}><option value="image/png">PNG</option><option value="image/jpeg">JPEG</option></select></label>
      <label>Resolution <select value={resolution} onChange={(event) => setResolution(Number(event.target.value))}>
        {[1, .75, .5].map((factor) => <option key={factor} value={factor}>{Math.max(1, Math.round(snapshot.image.width * factor))} × {Math.max(1, Math.round(snapshot.image.height * factor))} px</option>)}
      </select></label>
    </fieldset>
    <label className="viewport-preview-zoom">Preview Zoom <input type="range" min={100} max={300} step={25} value={zoom}
      onChange={(event) => setZoom(Number(event.target.value))} /><output>{zoom}%</output></label>
    <div className="viewport-export-preview" tabIndex={0} aria-label="Scrollable Export Preview">
      {preview && <img src={preview} alt="Current slide view preview" style={{ width: `${zoom}%` }} />}
    </div>
    {error && <p className="notice" role="alert">{error}</p>}
    <div className="dialog-actions">
      <button type="button" className="button secondary" disabled={busy} onClick={onClose}>Close</button>
      <button type="button" className="button primary" disabled={busy || !preview} onClick={() => void download()}>{busy ? 'Preparing…' : 'Download Image'}</button>
    </div>
  </dialog>;
}
