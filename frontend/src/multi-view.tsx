import { useRef, useState } from 'react';
import { ImageViewport } from './image-viewport';
import type { Slide } from './demo';
import type { CameraFrame } from './tile-viewer';
import type { Camera } from './viewer-tools';

const MIN_PANES = 2;
const MAX_PANES = 4;
type Frames = Record<string, CameraFrame>;

export function mapCamera(source: CameraFrame, target: CameraFrame, start?: CameraFrame, end?: CameraFrame): Camera {
  const [sourceWidth, sourceHeight] = source.dimensions;
  const [targetWidth, targetHeight] = target.dimensions;
  return {
    x: (end?.x ?? 0) + (source.x - (start?.x ?? 0)) / sourceWidth * targetWidth,
    y: (end?.y ?? 0) + (source.y - (start?.y ?? 0)) / sourceHeight * targetHeight,
    zoom: source.zoom / (start?.zoom ?? source.fitZoom) * (end?.zoom ?? target.fitZoom),
  };
}

export function MultiView({ slides, primary, onClose, onSingle }: {
  slides: Slide[]; primary?: string; onClose: () => void; onSingle: (id: string) => void;
}) {
  const [selection, setSelection] = useState(() => {
    const ids = slides.map((slide) => slide.id);
    return (primary && ids.includes(primary) ? [primary, ...ids.filter((id) => id !== primary)] : ids).slice(0, MIN_PANES);
  });
  const selected = selection.filter((id) => slides.some((slide) => slide.id === id));
  const [activeId, setActiveId] = useState(selection[0]);
  const active = selected.includes(activeId) ? activeId : selected[0];
  const [synchronized, setSynchronized] = useState(false);
  const [focused, setFocused] = useState(false);
  const [loaded, setLoaded] = useState<string[]>([]);
  const [anchors, setAnchors] = useState<Frames>();
  const [commands, setCommands] = useState<Record<string, Camera>>({});
  const frames = useRef<Frames>({});
  const allReady = selected.length >= MIN_PANES && selected.every((id) => loaded.includes(id));

  function publish(driver: string, frame: CameraFrame, bases = anchors) {
    const commands: Record<string, Camera> = {};
    for (const id of selected) {
      const target = frames.current[id];
      if (id !== driver && target?.fitZoom && frame.fitZoom) {
        commands[id] = mapCamera(frame, target, bases?.[driver], bases?.[id]);
      }
    }
    setCommands(commands);
  }

  function toggleSlide(id: string) {
    const checked = selected.includes(id);
    if ((checked && selected.length <= MIN_PANES) || (!checked && selected.length >= MAX_PANES)) return;
    if (checked) {
      delete frames.current[id];
      setLoaded((current) => current.filter((value) => value !== id));
    }
    setSelection(checked ? selected.filter((value) => value !== id) : [...selected, id]);
    setSynchronized(false);
    setCommands({});
    setAnchors(undefined);
  }

  return <section aria-label="Multi View" className="multi-view">
    <div className="panel multi-view-control">
      <div className="panel-title"><h2>Multi View</h2><span>{selected.length} / {MAX_PANES} 화면</span></div>
      <div className="multi-view-options">
        <fieldset className="multi-view-slides" disabled={focused}><legend>같은 케이스의 스캔</legend>
          {slides.map((slide) => {
            const checked = selected.includes(slide.id);
            return <label key={slide.id}>
              <input type="checkbox" checked={checked}
                disabled={checked ? selected.length <= MIN_PANES : selected.length >= MAX_PANES}
                onChange={() => toggleSlide(slide.id)} />
              {slide.label ?? slide.id} · {slide.wsi?.format}
            </label>;
          })}
        </fieldset>
        <div className="actions multi-view-actions">
          <button className="button secondary" aria-pressed={synchronized} disabled={!allReady || focused} onClick={() => {
            const next = !synchronized;
            setSynchronized(next);
            if (next && active && frames.current[active]) publish(active, frames.current[active]);
            else setCommands({});
          }}>위치 동기화</button>
          <button className="button secondary" disabled={!allReady || synchronized || focused} onClick={() => {
            setAnchors(anchors ? undefined : Object.fromEntries(selected.map((id) => [id, frames.current[id]])));
          }}>{anchors ? '기준점 지우기' : '현재 위치를 기준점으로'}</button>
          <button className="button secondary" aria-pressed={focused} disabled={!active || !loaded.includes(active)}
            onClick={() => setFocused(!focused)}>{focused ? '분할 화면 복원' : '활성 화면 확대'}</button>
          <button className="button secondary" disabled={!active} onClick={() => { if (active) onSingle(active); }}>활성 스캔 단일 뷰</button>
          <button className="button secondary" onClick={onClose}>비교 닫기</button>
        </div>
        <p className="muted" role="status">{anchors ? '수동 기준점 사용' : '영상 비율 기준'} · {focused ? '확대 중 동기화 일시 중지' : synchronized ? '동기화 켜짐' : '동기화 꺼짐'}</p>
      </div>
    </div>
    <div className="multi-view-grid" data-count={selected.length} data-focused={focused}>
      {selected.map((id, index) => {
        const slide = slides.find((item) => item.id === id);
        if (!slide?.wsi) return null;
        return <div key={id} role="group" aria-label={`화면 ${index + 1}: ${slide.label ?? id} ${slide.wsi.format}`}
          className="multi-view-pane" data-active={active === id} hidden={focused && active !== id}
          onFocusCapture={() => setActiveId(id)} onPointerDownCapture={() => setActiveId(id)}>
          <button type="button" className="multi-view-activate" aria-pressed={active === id} onClick={() => setActiveId(id)}>
            화면 {index + 1}{active === id ? ' · 활성' : ''}
          </button>
          <ImageViewport scan={slide.wsi} label={slide.label ?? id} stain={slide.stain} comparison={{
            camera: commands[id],
            onFrame: (frame) => {
              if (!frames.current[id]) setLoaded((current) => [...current, id]);
              frames.current[id] = frame;
            },
            onNavigate: (frame) => {
              setActiveId(id);
              if (synchronized && !focused) publish(id, frame);
            },
          }} />
        </div>;
      })}
    </div>
  </section>;
}
