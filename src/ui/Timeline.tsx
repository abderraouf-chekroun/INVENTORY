import { Fragment, type Key, type ReactNode } from 'react';
import type { Evenement } from '../api';
import { PAS_LISTE } from '../lib/borne';
import { formatDate, yearOf } from '../lib/format';
import { mentionSupprime, morceauxEvenement, ROLE_LIEN, type LienEvenement, type Morceau } from '../lib/liensEvenement';
import { nav } from '../nav/store';
import { PlusDElements, UNITES, useBorne } from './Borne';
import { Empty } from './controls';

/**
 * Ce qu'il faut pour une ligne de frise : un `Evenement` du back convient tel quel.
 * Les fiches et le dossier cités (`aId`, `aLibelle`…) sont facultatifs : sans eux, la ligne reste du texte.
 */
export type TimelineItem = Pick<Evenement, 'classe' | 'titre' | 'detail' | 'date'> & { id: Key }
  & Partial<Pick<Evenement, 'aId' | 'bId' | 'dossierId' | 'aLibelle' | 'bLibelle' | 'dossierNom' | 'documentId' | 'documentNom' | 'champ'
    | 'aSupprime' | 'bSupprime'>>;

/** Ouvre la fiche, le dossier ou le document (dans son dossier) en empilant la page courante : Retour ramène à l'historique. */
function ouvrir(l: LienEvenement) {
  if (l.role === 'dossier') nav.go({ name: 'dossier', id: l.id });
  else if (l.role === 'document' || l.role === 'champ') { if (l.dossierId !== undefined) nav.go({ name: 'dossier', id: l.dossierId, documentId: l.id }); }
  else nav.go({ name: 'fiche', id: l.id });
}

const TITRE_LIEN: Record<LienEvenement['role'], string> = {
  a: 'Ouvrir la fiche', b: 'Ouvrir la fiche', dossier: 'Ouvrir le dossier', document: 'Ouvrir le document dans son dossier',
  champ: 'Ouvrir le document dans son dossier',
};

/** Nom cité par un événement : un vrai bouton (clavier, lecteur d'écran) qui ouvre la fiche, le dossier ou le document. */
function Lien({ lien, children }: { lien: LienEvenement; children: ReactNode }) {
  return (
    <button type="button" className="tl-lien" title={TITRE_LIEN[lien.role]} onClick={() => ouvrir(lien)}>
      {children}
    </button>
  );
}

/** § 13.2 : nom d'une fiche supprimée, en texte non cliquable (la mention « supprimé(e) » suit). */
function NomSupprime({ children }: { children: ReactNode }) {
  return <span className="tl-supprime">{children}</span>;
}

function Texte({ morceaux }: { morceaux: readonly Morceau[] }) {
  return (
    <>
      {morceaux.map((m, i) => {
        if (!m.lien) return <Fragment key={i}>{m.texte}</Fragment>;
        if (m.lien.supprimee) return <NomSupprime key={i}>{m.texte}{m.mention ?? ''}</NomSupprime>;
        return <Lien key={i} lien={m.lien}>{m.texte}</Lien>;
      })}
    </>
  );
}

/**
 * Frise chronologique (`.tl`) regroupée par année (`.tl-year`), dates au format JJ/MM/AAAA.
 * Les événements sont affichés dans l'ordre reçu (le back les donne du plus récent au plus ancien) ;
 * filtrez-les avant (ex. onglet « Historique des affectations » : début et fin des affectations).
 * Historique cliquable (§ 9.4, § 11.2) : le nom d'un employé, d'une machine, d'un dossier, d'un document ou du champ
 * d'une nomination devient un lien, sauf `courante` (la fiche affichée). Un nom cité mais absent du texte est proposé
 * sous le détail. Rendu borné (lib/borne.ts) : un historique de milliers d'événements ne gèle pas l'interface.
 */
export function Timeline({ items, empty = 'Aucun événement pour cette fiche.', courante }: {
  items: readonly TimelineItem[];
  empty?: ReactNode;
  /** Identifiant de la fiche affichée : son nom n'est pas un lien. */
  courante?: number;
}) {
  const borne = useBorne(items, PAS_LISTE);
  if (!items.length) return <Empty>{empty}</Empty>;
  const groups: { year: string; items: TimelineItem[] }[] = [];
  for (const it of borne.visibles) {
    const year = String(yearOf(it.date) ?? '—');
    const last = groups[groups.length - 1];
    if (last && last.year === year) last.items.push(it);
    else groups.push({ year, items: [it] });
  }
  return (
    <div>
      {groups.map((g, gi) => (
        <Fragment key={`${g.year}-${gi}`}>
          <p className="tl-year">{g.year}</p>
          <ol className="tl">
            {g.items.map((e) => {
              const m = morceauxEvenement(e, courante);
              return (
                <li key={e.id} className={e.classe || undefined}>
                  <i aria-hidden="true" />
                  <b><Texte morceaux={m.titre} /></b>
                  <time dateTime={String(e.date).slice(0, 10)}>{formatDate(e.date)}</time>
                  <p><Texte morceaux={m.detail} /></p>
                  {m.autres.length > 0 && (
                    <p className="tl-liens">
                      {m.autres.map((l) => (
                        <span key={`${l.role}-${l.id}-${l.supprimee ? 's' : ''}`}>
                          {ROLE_LIEN[l.role]} : {l.supprimee
                            ? <NomSupprime>{l.nom} ({mentionSupprime(l.role)})</NomSupprime>
                            : <Lien lien={l}>{l.nom}</Lien>}
                        </span>
                      ))}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        </Fragment>
      ))}
      <PlusDElements masques={borne.masques} pas={PAS_LISTE} unite={UNITES.evenements} onPlus={borne.plus} />
    </div>
  );
}
