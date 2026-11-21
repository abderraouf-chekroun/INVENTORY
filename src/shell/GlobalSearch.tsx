import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { DossierResume, Entite } from '../api';
import { indexIdentifiantExact } from '../lib/aideSaisie';
import { nomAffiche, texte } from '../lib/format';
import { useRecherche } from '../lib/queries';
import { noteGroupe, nomGroupe, titreGroupe, totalGroupe } from '../lib/recherche';
import { nav } from '../nav';
import { EntityCode, StatutBadge } from '../ui/Badge';
import { Kbd } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { isModalOpen } from '../ui/Modal';
import { Surligne } from '../ui/Surligne';

type Hit = { k: 'a' | 'b'; item: Entite } | { k: 'd'; item: DossierResume };
type Group = { label: string; hits: Hit[]; total: number };

/** Saut de PageUp / PageDown dans la liste. */
const PAS_PAGE = 8;

/**
 * Recherche globale (prototype « global search », § 8.4 et § 10.2) : employés par nom, prénom ou identifiant, machines
 * par nom, marque ou identifiant, dossiers par nom ; jusqu'à 50 résultats par groupe, le titre du groupe annonce leur
 * nombre (et le total quand il y en a davantage). La liste a une hauteur maximale et défile, à la molette comme au
 * clavier (↑ ↓, Page préc. / Page suiv.) : l'élément choisi reste visible. Entrée ouvre, Échap ferme, Ctrl+K pour y
 * aller ; un identifiant saisi exactement présélectionne la fiche.
 */
export function GlobalSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const [auto, setAuto] = useState(true); // vrai tant que l'utilisateur n'a pas utilisé ↑ ↓
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const liste = useRef<HTMLDivElement>(null);
  const term = q.trim();
  // Pendant la frappe, l'ancien résultat reste affiché (placeholder) : il ne correspond pas encore à `term`.
  const { data, isPlaceholderData } = useRecherche(term);
  const aJour = data !== undefined && !isPlaceholderData;
  /** Entrée pressée avant l'arrivée des résultats de la saisie : on ouvre dès qu'ils arrivent. */
  const [entreeEnAttente, setEntreeEnAttente] = useState(false);

  const tableau = <T,>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
  const groups: Group[] = data
    ? ([
        { label: 'Employés', hits: tableau<Entite>(data.a).map((item): Hit => ({ k: 'a', item })), total: 0 },
        { label: 'Machines', hits: tableau<Entite>(data.b).map((item): Hit => ({ k: 'b', item })), total: 0 },
        { label: 'Dossiers', hits: tableau<DossierResume>(data.dossiers).map((item): Hit => ({ k: 'd', item })), total: 0 },
      ] satisfies Group[])
        .map((g, i) => ({ ...g, total: totalGroupe(g.hits.length, [data.aTotal, data.bTotal, data.dossiersTotal][i]) }))
        .filter((g) => g.hits.length > 0)
    : [];
  const flat = groups.flatMap((g) => g.hits);
  const exact = indexIdentifiantExact(flat.map((h) => (h.k === 'd' ? null : h.item.code)), term);
  const active = flat.length ? Math.max(0, Math.min(exact >= 0 && auto ? exact : sel, flat.length - 1)) : -1;
  const shown = open && term !== '' && data !== undefined;

  // Ctrl+K : aller à la recherche ; clic en dehors : fermer la liste.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !isModalOpen()) {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
        setOpen(true);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (box.current && e.target instanceof Node && !box.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, []);

  // L'élément choisi reste visible dans la liste qui défile (le titre de son groupe aussi, pour le premier).
  useEffect(() => {
    if (!shown || active < 0 || !liste.current) return;
    const el = liste.current.querySelector<HTMLElement>(`#res-${active}`);
    if (!el) return;
    const grp = el.closest('.grp');
    const premier = grp?.querySelector('.res') === el;
    (premier && grp instanceof HTMLElement ? grp : el).scrollIntoView({ block: 'nearest' });
    if (premier) el.scrollIntoView({ block: 'nearest' });
  }, [shown, active]);

  // Nouvelle saisie : la liste revient en haut.
  useEffect(() => {
    if (liste.current) liste.current.scrollTop = 0;
  }, [term]);

  const openHit = (h: Hit | undefined) => {
    if (!h) return;
    setQ('');
    setOpen(false);
    input.current?.blur();
    nav.go(h.k === 'd' ? { name: 'dossier', id: h.item.id } : { name: 'fiche', id: h.item.id });
  };

  // Entrée pressée trop tôt : les résultats de la saisie sont arrivés, on ouvre le bon.
  useEffect(() => {
    if (!entreeEnAttente || !aJour) return;
    setEntreeEnAttente(false);
    openHit(flat[active]);
  });

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      input.current?.blur();
      return;
    }
    if (e.key === 'Enter' && term !== '') {
      e.preventDefault();
      // Résultats pas encore arrivés, ou encore ceux d'une frappe précédente : ouvrir maintenant
      // ouvrirait la mauvaise fiche (ou rien). On ouvre dès que les résultats de la saisie sont là.
      if (aJour) openHit(flat[active]);
      else setEntreeEnAttente(true);
      return;
    }
    if (!shown) return;
    const pas = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : e.key === 'PageDown' ? PAS_PAGE : e.key === 'PageUp' ? -PAS_PAGE : 0;
    if (pas !== 0 && flat.length) {
      e.preventDefault();
      setAuto(false);
      const next = (active < 0 ? 0 : active) + pas;
      setSel(Math.max(0, Math.min(next, flat.length - 1)));
    }
  };

  let n = -1;
  return (
    <div className="search" ref={box}>
      <label htmlFor="q">
        <Icon name="search" />
        <input id="q" type="text" autoComplete="off" spellCheck={false} placeholder="Rechercher un nom ou un identifiant…"
          aria-label="Recherche globale" role="combobox" aria-autocomplete="list" aria-expanded={shown} aria-controls="dd"
          aria-activedescendant={shown && active >= 0 ? `res-${active}` : undefined}
          ref={input} value={q}
          onChange={(e) => { setQ(e.target.value); setSel(0); setAuto(true); setOpen(true); setEntreeEnAttente(false); }}
          onFocus={() => setOpen(true)} onKeyDown={onKeyDown} />
        <Kbd>Ctrl</Kbd>
        <Kbd>K</Kbd>
      </label>
      <div className="dd" id="dd" role="listbox" aria-label="Résultats de la recherche" aria-busy={shown && !aJour} hidden={!shown}>
        {shown && (
          <div className="info" role="status">
            {flat.length
              ? `Résultats pour « ${term} »${exact >= 0 ? ' · identifiant exact : Entrée ouvre la fiche' : ''}`
              : `Aucun résultat pour « ${term} ». Essayez un nom, un prénom, une marque ou un identifiant.`}
          </div>
        )}
        {/* Zone qui défile (molette, barre de défilement) ; un clic dedans ne fait pas perdre la saisie. */}
        <div className="dd-liste" ref={liste} onMouseDown={(e) => e.preventDefault()}>
          {shown && groups.map((g) => {
            const note = noteGroupe(g.hits.length, g.total);
            return (
              <div className="grp" role="group" aria-label={nomGroupe(g.label, g.hits.length, g.total)} key={g.label}>
                <h4 aria-hidden="true">{titreGroupe(g.label, g.hits.length, g.total)}</h4>
                {g.hits.map((h) => {
                  n++;
                  const i = n;
                  return (
                    <button type="button" key={`${h.k}${h.item.id}`} id={`res-${i}`} role="option" aria-selected={i === active}
                      tabIndex={-1} className={i === active ? 'res on' : 'res'}
                      onMouseDown={(e) => e.preventDefault()} onClick={() => openHit(h)}>
                      <Icon name={h.k === 'd' ? 'dossier' : h.k} />
                      {h.k === 'd' ? (
                        <>
                          <b><Surligne texte={h.item.nom} q={term} /></b>
                          <span className="res-d">{h.item.theme} · {h.item.annee}</span>
                          <span className="sp" />
                          <StatutBadge statut={h.item.statut} />
                        </>
                      ) : (
                        <>
                          <b><Surligne texte={nomAffiche(h.item)} q={term} /></b>
                          <span className="res-d">{h.k === 'a' ? texte(h.item.poste) : texte(h.item.marque)}</span>
                          <span className="sp" />
                          {h.item.code
                            ? <span className="mono"><Surligne texte={h.item.code} q={term.replace(/^#/, '')} /></span>
                            : <EntityCode code={null} kind={h.item.kind} />}
                        </>
                      )}
                    </button>
                  );
                })}
                {note && <p className="dd-plus">{note}</p>}
              </div>
            );
          })}
        </div>
        {shown && flat.length > 0 && (
          <div className="foot">
            <span><Kbd>↑</Kbd><Kbd>↓</Kbd>Naviguer</span>
            <span><Kbd>Entrée</Kbd>Ouvrir</span>
            <span><Kbd>Échap</Kbd>Fermer</span>
            <span className="foot-n">{`${flat.length} résultat${flat.length > 1 ? 's' : ''}`}</span>
          </div>
        )}
      </div>
    </div>
  );
}
