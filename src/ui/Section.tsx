import { useId, type ReactNode } from 'react';

/**
 * § 17 (1.8) : les numéros de section (« 5.7 »), dérivés des numéros de module, ne s'affichent plus. Pour les
 * remettre, passer cette constante à `true` : chaque section garde son numéro dans `num`.
 */
const AFFICHER_NUMERO_SECTION = false;

export interface SectionProps {
  /** Numéro de section du prototype : « 4.3 » (non affiché depuis la 1.8, voir `AFFICHER_NUMERO_SECTION`). */
  num: string;
  title: ReactNode;
  /** À droite du titre : compteur `<span className="cnt">…</span>`, contrôle segmenté… */
  extra?: ReactNode;
  children?: ReactNode;
}

/** Section titrée (`sec()` du prototype). */
export function Section({ num, title, extra, children }: SectionProps) {
  const id = useId();
  return (
    <section className="sec" aria-labelledby={id}>
      <div className="sec-h">
        <h2 id={id}>
          {AFFICHER_NUMERO_SECTION && <span>{num}</span>}
          {title}
        </h2>
        {extra}
      </div>
      {children}
    </section>
  );
}
