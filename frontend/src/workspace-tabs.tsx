import { useRef } from 'react';
import type { LucideIcon } from 'lucide-react';

type Tab<Key extends string> = { key: Key; label: string; icon: LucideIcon; disabled?: boolean };

export function WorkspaceTabs<Key extends string>({ label, tabs, active, onSelect, panelId }: {
  label: string; tabs: readonly Tab<Key>[]; active: Key; onSelect: (key: Key) => void; panelId: string;
}) {
  const controls = useRef<HTMLDivElement>(null);
  const enabled = tabs.filter((tab) => !tab.disabled);
  return <div ref={controls} className="workspace-tabs" role="tablist" aria-label={label}
    onKeyDown={(event) => {
      const current = enabled.findIndex((tab) => tab.key === (event.target as HTMLElement).closest('button')?.dataset.tab);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1
        : event.key === 'ArrowLeft' ? (current - 1 + enabled.length) % enabled.length
          : event.key === 'ArrowRight' ? (current + 1) % enabled.length : -1;
      if (!enabled[index]) return;
      event.preventDefault();
      const next = enabled[index].key;
      controls.current?.querySelector<HTMLButtonElement>('[data-tab="' + next + '"]')?.focus();
    }}>
    {tabs.map(({ key, label: text, icon: Icon, disabled }) => <button key={key} id={panelId + '-tab-' + key}
      data-tab={key} type="button" role="tab" aria-selected={key === active} aria-controls={panelId} tabIndex={key === active ? 0 : -1}
      disabled={disabled} onClick={() => onSelect(key)}>
      <Icon size={16} aria-hidden="true" /> <span>{text}</span>
    </button>)}
  </div>;
}
