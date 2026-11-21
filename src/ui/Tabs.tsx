import type { KeyboardEvent, ReactNode } from 'react';

export interface TabDef {
  label: ReactNode;
  /** Pastille de compteur (`.count`), absente si non fourni. */
  count?: number;
}

/**
 * Onglets (`.tabs`, role tablist). État géré par la page : `const [tab, setTab] = useState(0)`.
 * Clavier : ← → Début Fin déplacent l'onglet actif. Le contenu s'affiche juste après le composant.
 */
export function Tabs({ tabs, value, onChange, label }: {
  tabs: readonly TabDef[];
  value: number;
  onChange: (index: number) => void;
  label?: string;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = tabs.length;
    const next =
      e.key === 'ArrowRight' ? (value + 1) % n
      : e.key === 'ArrowLeft' ? (value - 1 + n) % n
      : e.key === 'Home' ? 0
      : e.key === 'End' ? n - 1
      : null;
    if (next === null) return;
    e.preventDefault();
    onChange(next);
    const btn = e.currentTarget.children[next];
    if (btn instanceof HTMLElement) btn.focus();
  };
  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((t, i) => (
        <button key={i} type="button" role="tab" aria-selected={i === value} tabIndex={i === value ? 0 : -1} onClick={() => onChange(i)}>
          {t.label}
          {t.count != null && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
