import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, jsonBody } from './session';

export type ViewerSettings = {
  tray_orientation: 'vertical' | 'horizontal';
  tray_visible: boolean;
  gallery: boolean;
  show_label: boolean;
  show_overview: boolean;
  show_minimap: boolean;
  dynamic_minimap: boolean;
  shortcuts: boolean;
  autopan_speed: 60 | 120 | 240;
  autopan_direction: 'right' | 'left' | 'down' | 'up';
};

type Preference = { version: number; settings: ViewerSettings };
const endpoint = '/api/viewer/preferences';
const defaults: ViewerSettings = {
  tray_orientation: 'vertical', tray_visible: true, gallery: false, show_label: false, show_overview: false,
  show_minimap: true, dynamic_minimap: false, shortcuts: true, autopan_speed: 120, autopan_direction: 'right',
};

export function useViewerPreferences() {
  const [saved, setSaved] = useState<Preference>();
  const [changes, setChanges] = useState<Partial<ViewerSettings>>({});
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const settings = { ...(saved?.settings ?? defaults), ...changes };

  useEffect(() => {
    const controller = new AbortController();
    api<Preference>(endpoint, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setSaved(result); })
      .catch((error: Error) => { if (!controller.signal.aborted) setProblem(error.message); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [attempt]);

  function change<K extends keyof ViewerSettings>(name: K, value: ViewerSettings[K]) {
    setChanges((previous) => ({ ...previous, [name]: value }));
  }

  function reload() {
    setBusy(true);
    setProblem('');
    setChanges({});
    setAttempt((value) => value + 1);
  }

  async function save() {
    if (!saved || busy) return;
    setBusy(true);
    setProblem('');
    try {
      const result = await api<Preference>(endpoint, jsonBody('PUT', { version: saved.version, settings }));
      setSaved(result);
      setChanges((previous) => Object.fromEntries(Object.entries(previous).filter(([key, value]) =>
        result.settings[key as keyof ViewerSettings] !== value)));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Unable to save viewer settings.');
    } finally {
      setBusy(false);
    }
  }

  const dirty = Object.keys(changes).some((key) =>
    settings[key as keyof ViewerSettings] !== saved?.settings[key as keyof ViewerSettings]);
  return { settings, change, reload, save, busy, problem, dirty, loaded: !!saved };
}

const trayToggles = [['tray_visible', 'Show slide tray'], ['gallery', 'Use gallery in slide tray']] as const;
const navigatorToggles = [['show_label', 'Show label image'], ['show_overview', 'Show overview image'],
  ['show_minimap', 'Show minimap'], ['dynamic_minimap', 'Dynamic minimap size']] as const;

export function ViewerSettingsPanel({ preferences, onClose }: { preferences: ReturnType<typeof useViewerPreferences>; onClose: () => void }) {
  const { settings, change, save, reload, busy, problem, dirty, loaded } = preferences;
  const toggle = ([key, label]: (typeof trayToggles | typeof navigatorToggles)[number]) => <label key={key} className="viewer-setting-toggle">
    <input type="checkbox" checked={settings[key]} onChange={(event) => change(key, event.target.checked)} />{label}
  </label>;
  return <form className="panel viewer-settings" id="viewer-settings" aria-label="Viewer Settings"
    onSubmit={(event) => { event.preventDefault(); void save(); }}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
    <div className="preview-label"><h2>Viewer Settings</h2>
      <button type="button" className="icon-button" aria-label="Close Viewer Settings" title="Close Viewer Settings" onClick={onClose}><X size={17} /></button>
    </div>
    <fieldset disabled={busy}><legend>Slide Tray</legend>
      {trayToggles.map(toggle)}
      <label className="form-field">Slide Tray Orientation
        <select value={settings.tray_orientation} onChange={(event) => change('tray_orientation', event.target.value as ViewerSettings['tray_orientation'])}>
          <option value="vertical">Vertical</option><option value="horizontal">Horizontal</option>
        </select>
      </label>
    </fieldset>
    <fieldset disabled={busy}><legend>Navigator</legend>
      {navigatorToggles.map(toggle)}
    </fieldset>
    <fieldset disabled={busy}><legend>Autopan</legend>
      <div className="viewer-autopan-settings">
        <label className="form-field">Autopan Direction
          <select value={settings.autopan_direction} onChange={(event) => change('autopan_direction', event.target.value as ViewerSettings['autopan_direction'])}>
            <option value="right">Right</option><option value="left">Left</option><option value="down">Down</option><option value="up">Up</option>
          </select>
        </label>
        <label className="form-field">Autopan Speed
          <select value={settings.autopan_speed} onChange={(event) => change('autopan_speed', Number(event.target.value) as ViewerSettings['autopan_speed'])}>
            <option value={60}>Slow</option><option value={120}>Medium</option><option value={240}>Fast</option>
          </select>
        </label>
      </div>
    </fieldset>
    <fieldset disabled={busy}><legend>Shortcuts</legend>
      <label className="viewer-setting-toggle">
        <input type="checkbox" checked={settings.shortcuts} onChange={(event) => change('shortcuts', event.target.checked)} />Enable keyboard shortcuts
      </label>
    {settings.shortcuts && <p>Focus the slide image to use shortcuts. <kbd>F</kbd> Fullscreen · <kbd>M</kbd> Minimap · <kbd>G</kbd> Gallery · <kbd>Space</kbd> Autopan · <kbd>←↑↓→</kbd> Pan · <kbd>+</kbd>/<kbd>−</kbd> Zoom · <kbd>0</kbd> Fit</p>}
    </fieldset>
    {problem && <p role="alert" className="form-error">{problem}</p>}
    <div className="actions">
      {problem && <button type="button" className="button secondary" disabled={busy} onClick={reload}>Reload Saved Settings</button>}
      <button type="submit" className="button primary" disabled={busy || !loaded || !dirty}>Save as Default</button>
    </div>
  </form>;
}
