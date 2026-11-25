import { useEffect, useRef, useState } from 'react';

const minimumWidth = 154;
const maximumWidth = 320;
const defaultWidth = 182;
const widthKey = 'mediauto.workspace.navigationWidth';

function clampWidth(width: number) {
  return Math.min(maximumWidth, Math.max(minimumWidth, Math.round(width)));
}

export function useNavigationWidth() {
  const [width, setWidth] = useState<number | undefined>(() => {
    try {
      const saved = localStorage.getItem(widthKey);
      if (saved && Number.isFinite(Number(saved))) return clampWidth(Number(saved));
    } catch { /* The current browser may block storage. */ }
    return undefined;
  });
  useEffect(() => {
    try {
      if (width === undefined) localStorage.removeItem(widthKey);
      else localStorage.setItem(widthKey, String(width));
    } catch { /* Resizing remains available without storage. */ }
  }, [width]);
  return [width, setWidth] as const;
}

export function NavigationResizeHandle({ onResize }: { onResize: (width?: number) => void }) {
  const handle = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; width: number } | null>(null);
  const [width, setWidth] = useState(defaultWidth);

  useEffect(() => {
    const sidebar = handle.current?.parentElement;
    if (!sidebar) return;
    const measure = () => setWidth(clampWidth(sidebar.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(sidebar);
    return () => observer.disconnect();
  }, []);

  return <div ref={handle} className="sidebar-resize-handle" role="separator" tabIndex={0}
    aria-label="Resize Workspace Navigation" aria-controls="main-navigation" aria-orientation="vertical"
    aria-valuemin={minimumWidth} aria-valuemax={maximumWidth} aria-valuenow={width} aria-valuetext={`${width} pixels`}
    title="Drag to resize. Double-click to reset."
    onPointerDown={(event) => {
      if (!event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { id: event.pointerId, x: event.clientX, width: handle.current?.parentElement?.getBoundingClientRect().width ?? width };
    }}
    onPointerMove={(event) => {
      if (drag.current?.id === event.pointerId) onResize(clampWidth(drag.current.width + event.clientX - drag.current.x));
    }}
    onLostPointerCapture={() => { drag.current = null; }}
    onDoubleClick={() => onResize()}
    onKeyDown={(event) => {
      const adjustment = { ArrowLeft: width - 12, ArrowRight: width + 12, Home: minimumWidth, End: maximumWidth };
      if (!Object.hasOwn(adjustment, event.key)) return;
      event.preventDefault();
      onResize(clampWidth(adjustment[event.key as keyof typeof adjustment]));
    }} />;
}
