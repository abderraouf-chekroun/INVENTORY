import type { CSSProperties, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/* Petits contrôles du prototype : contrôle segmenté, puce, liste déroulante, touche, état vide. */

export interface SegOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: IconName;
  /** Pastille de compteur après le libellé (`.count`). */
  count?: number;
}

/** Contrôle segmenté (`.seg`), boutons aria-pressed. */
export function Seg<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: readonly SegOption<T>[];
  onChange: (value: T) => void;
  /** Nom accessible du groupe. */
  label?: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.icon && <Icon name={o.icon} size={14} />}
          {o.label}
          {o.count != null && <span className="count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Puce à bascule (`.chip` avec sa case), ex. « Sans identifiant » dans une barre de filtres. */
export function Chip({ pressed, onToggle, children }: { pressed: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <button type="button" className="chip" aria-pressed={pressed} onClick={onToggle}>
      <span className="box">{pressed && <Icon name="check" size={10} />}</span>
      {children}
    </button>
  );
}

/** Option de `Select` : une valeur seule (libellé = valeur) ou [valeur, libellé]. */
export type SelectOption<T extends string> = T | readonly [T, string];

/** Liste déroulante `.field` (`sel()` du prototype), typée par ses valeurs. */
export function Select<T extends string>({ value, options, onChange, id, label, disabled, required, className, style }: {
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  id?: string;
  /** aria-label, si la liste n'est pas déjà dans un <label>. */
  label?: string;
  disabled?: boolean;
  /** Choix obligatoire (§ 10.6) : l'étoile est portée par le libellé. */
  required?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const pairs = options.map((o): readonly [T, string] => (typeof o === 'string' ? [o as T, o] : (o as readonly [T, string])));
  return (
    <select
      className={className ? `field ${className}` : 'field'}
      id={id}
      aria-label={label}
      disabled={disabled}
      required={required}
      style={style}
      value={value}
      onChange={(e) => {
        const found = pairs.find(([v]) => v === e.target.value);
        if (found) onChange(found[0]);
      }}
    >
      {pairs.map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </select>
  );
}

/** Touche de clavier (`.kbd`). */
export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>;
}

/** État vide (`<p class="empty">`) : « Aucun dossier avec ces filtres. » */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
