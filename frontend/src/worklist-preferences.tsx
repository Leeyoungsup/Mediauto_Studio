import { useEffect, useRef, useState } from 'react';
import { ArrowDownWideNarrow } from 'lucide-react';
import { api, jsonBody } from './session';
import { initialPreferences, sortFields } from './worklist-config';
import type { ColumnSetting, Preferences, SavedView, Scope, SortField, SortTerm, ViewConfig } from './worklist-config';

const path = '/api/worklist';
type Catalog = { views: SavedView[]; preferences: Preferences };

async function loadCatalog(signal?: AbortSignal): Promise<Catalog> {
  const [views, preferences] = await Promise.all([
    api<SavedView[]>(path + '/views', { signal }), api<Preferences>(path + '/preferences', { signal }),
  ]);
  return { views, preferences };
}

export function useSavedViews(scope: Scope, apply: (configuration: ViewConfig | undefined, columns: ColumnSetting[] | null, restoreScope?: boolean, startup?: boolean) => boolean | undefined) {
  const [catalog, setCatalog] = useState<Catalog>({ views: [], preferences: initialPreferences });
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const startupScope = useRef(location.hash ? scope : undefined);
  const { views, preferences } = catalog;
  const active = views.find((view) => view.id === selected);

  useEffect(() => {
    const controller = new AbortController();
    loadCatalog(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setCatalog(result);
      const initial = result.views.find(({ id, configuration }) =>
        id === result.preferences.default_view_id && (!startupScope.current || configuration.scope === startupScope.current));
      const applied = apply(initial?.configuration, result.preferences.columns, Boolean(initial), true);
      if (initial && applied) setSelected(initial.id);
      setReady(true);
    }).catch(() => {
      if (!controller.signal.aborted) setError('Unable to load saved Worklist settings.');
    });
    return () => controller.abort();
  }, [apply]);

  function choose(id: string) {
    const view = views.find((entry) => entry.id === id);
    setSelected(view?.id ?? '');
    apply(view?.configuration, preferences.columns);
    setNotice('');
    setError('');
  }

  async function perform(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try { await task(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to update saved settings.'); }
    finally { setBusy(false); }
  }

  async function refresh() {
    const fresh = await loadCatalog();
    setCatalog(fresh);
    setReady(true);
    if (selected && !fresh.views.some(({ id }) => id === selected)) setSelected('');
  }

  function save(name: string, configuration: ViewConfig, visibility: SavedView['visibility'], overwrite: boolean) {
    if (overwrite && !active?.can_edit) return;
    void perform(async () => {
      const payload = { name, configuration };
      const view = await (overwrite && active
        ? api<SavedView>(`${path}/views/${active.id}`, jsonBody('PUT', { ...payload, version: active.version }))
        : api<SavedView>(path + '/views', jsonBody('POST', { ...payload, visibility })));
      setCatalog((current) => ({ ...current, views: [...current.views.filter(({ id }) => id !== view.id), view] }));
      setSelected(view.id);
      setNotice('View saved.');
    });
  }

  function changePreference(defaultView: string | null, columns: ColumnSetting[] | null) {
    void perform(async () => {
      const value = await api<Preferences>(path + '/preferences', jsonBody('PUT', {
        default_view_id: defaultView, columns, version: preferences.version,
      }));
      setCatalog((current) => ({ ...current, preferences: value }));
      setNotice('Worklist defaults saved.');
    });
  }

  function remove() {
    if (!active?.can_edit) return;
    void perform(async () => {
      await api(`${path}/views/${active.id}?version=${active.version}`, { method: 'DELETE' });
      await refresh();
      setNotice('View deleted.');
    });
  }

  return { views, preferences, active, choose, save, remove, error, notice, busy, ready,
    refresh: () => void perform(refresh),
    setDefault: () => changePreference(active?.id ?? null, preferences.columns),
    saveColumns: (value: ColumnSetting[]) => changePreference(preferences.default_view_id, value),
  };
}

type Controller = ReturnType<typeof useSavedViews>;

export function SavedViewControls({ controller, configuration, mayShare }: {
  controller: Controller; configuration: ViewConfig; mayShare: boolean;
}) {
  const { views, preferences, active, busy, ready } = controller;
  const [editing, setEditing] = useState<'new' | 'current'>();
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<SavedView['visibility']>('private');
  const [saveColumns, setSaveColumns] = useState(true);

  function open(next: 'new' | 'current') {
    setName(next === 'current' ? active?.name ?? '' : '');
    setSaveColumns(next === 'new' || active?.configuration.columns != null);
    setVisibility('private');
    setEditing(next);
  }

  return <section className="panel saved-views" aria-label="Manage Saved Views">
    <div className="actions">
      <label className="saved-view-select">Saved View<select aria-label="Saved View" value={active?.id ?? ''} disabled={!ready || busy}
        onChange={(event) => { setEditing(undefined); controller.choose(event.target.value); }}>
        <option value="">Default Worklist</option>
        {views.map((view) => <option value={view.id} key={view.id}>
          {view.name} · {view.visibility === 'shared' ? 'Organization' : 'Private'}{view.id === preferences.default_view_id ? ' · Startup' : ''}
        </option>)}
      </select></label>
      <button className="button secondary" disabled={!ready || busy} onClick={() => open('new')}>Save New View</button>
      {active?.can_edit && <button className="button secondary" disabled={busy} onClick={() => open('current')}>Edit Selected View</button>}
      <button className="button secondary" disabled={!ready || busy || (active?.id ?? null) === preferences.default_view_id}
        onClick={controller.setDefault}>Set as Startup View</button>
      <button className="button secondary" disabled={busy} onClick={controller.refresh}>Refresh Views</button>
    </div>
    {controller.error && <p className="form-error" role="alert">{controller.error}</p>}
    {controller.notice && <p role="status">{controller.notice}</p>}
    {editing && <form className="saved-view-form" onSubmit={(event) => {
      event.preventDefault();
      if (!name.trim()) return;
      controller.save(name, { ...configuration, columns: saveColumns ? configuration.columns : null }, visibility, editing === 'current');
    }}>
      <label className="form-field">View Name<input required value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></label>
      {editing === 'new' && <label className="form-field">Visibility<select value={visibility}
        onChange={(event) => setVisibility(event.target.value === 'shared' ? 'shared' : 'private')}>
        <option value="private">Private</option>
        {mayShare && <option value="shared">Organization</option>}
      </select></label>}
      <label><input type="checkbox" checked={saveColumns} onChange={(event) => setSaveColumns(event.target.checked)} /> Include current columns</label>
      <div className="actions">
        <button className="button primary" disabled={busy}>Save View</button>
        <button className="button secondary" type="button" disabled={busy} onClick={() => setEditing(undefined)}>Close</button>
        {editing === 'current' && active?.can_edit && <button className="button secondary" type="button" disabled={busy}
          onClick={() => { if (window.confirm('Delete this saved view?')) { controller.remove(); setEditing(undefined); } }}>Delete View</button>}
      </div>
    </form>}
  </section>;
}

export function SortControls({ order, onChange }: { order: SortTerm[]; onChange: (value: SortTerm[]) => void }) {
  const keys = Object.keys(sortFields) as SortField[];
  function update(index: number, changes: Partial<SortTerm>) {
    onChange(order.map((term, row) => row === index ? { ...term, ...changes } : term));
  }
  return <details className="column-menu sort-menu">
    <summary className="button secondary"><ArrowDownWideNarrow size={15} /> Multi-Level Sort</summary>
    <div className="column-options">
      {order.map(({ field, direction }, index) => <div className="sort-row" key={index}>
        <select aria-label={`${index + 1}: Sort Field`} value={field} onChange={(event) => update(index, { field: event.target.value as SortField })}>
          {keys.filter((key) => key === field || !order.some((term) => term.field === key))
            .map((key) => <option key={key} value={key}>{sortFields[key]}</option>)}
        </select>
        <select aria-label={`${index + 1}: Sort Direction`} value={direction}
          onChange={(event) => update(index, { direction: event.target.value === 'desc' ? 'desc' : 'asc' })}>
          <option value="asc">Ascending</option><option value="desc">Descending</option>
        </select>
        <button className="icon-button" aria-label={`${index + 1}: Remove Sort Level`} disabled={order.length === 1}
          onClick={() => onChange(order.filter((_, row) => index !== row))}>×</button>
      </div>)}
      <button className="button secondary" disabled={order.length >= 3} onClick={() => {
        const next = keys.find((key) => !order.some((term) => term.field === key));
        if (next) onChange([...order, { field: next, direction: 'asc' }]);
      }}>Add Sort Level</button>
    </div>
  </details>;
}
