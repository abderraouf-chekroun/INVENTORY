import type { Key, ReactNode } from 'react';
import type { Entite, Kind } from '../api';
import { PAS_TABLEAU } from '../lib/borne';
import { caracteristiques, categoryLabel, formatDate, nomAffiche, texte } from '../lib/format';
import { PlusDElements, UNITES, useBorne } from './Borne';
import { nav } from '../nav/store';
import { Badge, EntityCode } from './Badge';
import { Empty } from './controls';
import { Icon } from './Icon';

export interface TableProps<T> {
  /** En-têtes de colonnes. Une colonne vide est ajoutée pour le chevron quand `onOpen` est fourni. */
  heads: readonly ReactNode[];
  rows: readonly T[];
  rowKey: (row: T) => Key;
  /** Les cellules <td> de la ligne (sans le chevron). */
  cells: (row: T) => ReactNode;
  /** Clic ou Entrée sur une ligne. Sans `onOpen`, les lignes ne sont ni cliquables ni focalisables. */
  onOpen?: (row: T) => void;
  /** Classe de la ligne, ex. 'arch' pour une fiche archivée. */
  rowClassName?: (row: T) => string | undefined;
  /** Texte affiché quand `rows` est vide. Défaut : « Aucun résultat avec ces filtres. » */
  empty?: ReactNode;
  /** Nom accessible du tableau. */
  label?: string;
  /** Classe ajoutée au cadre du tableau (`.tbl-wrap`), ex. 'fiches'. */
  className?: string;
}

/** Tableau du prototype (`table()`), lignes ouvrables au clic et au clavier (Tab puis Entrée). */
export function Table<T>({ heads, rows, rowKey, cells, onOpen, rowClassName, empty, label, className }: TableProps<T>) {
  // Rendu borné (lib/borne.ts) : un très grand nombre de lignes ne gèle pas l'interface.
  const borne = useBorne(rows, PAS_TABLEAU);
  if (!rows.length) return <Empty>{empty ?? 'Aucun résultat avec ces filtres.'}</Empty>;
  return (
    <>
      <div className={className ? `tbl-wrap ${className}` : 'tbl-wrap'}>
        <table aria-label={label}>
          <thead>
            <tr>
              {heads.map((h, i) => <th key={i}>{h}</th>)}
              {onOpen && <th />}
            </tr>
          </thead>
          <tbody>
            {borne.visibles.map((row) => (
              <tr
                key={rowKey(row)}
                className={rowClassName?.(row)}
                tabIndex={onOpen ? 0 : undefined}
                onClick={onOpen && (() => onOpen(row))}
                onKeyDown={onOpen && ((e) => {
                  if (e.key === 'Enter' && e.target === e.currentTarget) {
                    e.preventDefault();
                    onOpen(row);
                  }
                })}
              >
                {cells(row)}
                {onOpen && <td className="go"><Icon name="right" size={14} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PlusDElements masques={borne.masques} pas={PAS_TABLEAU} unite={UNITES.lignes} onPlus={borne.plus} />
    </>
  );
}

/** En-têtes des colonnes propres à un répertoire (avant Statut et Mise à jour), et leurs cellules. */
export function colonnesFiche(kind: Kind): string[] {
  return kind === 'a'
    ? ['Nom', 'Identifiant', 'Poste', categoryLabel('a')]
    : ['Nom', 'Identifiant', 'Marque et configuration', categoryLabel('b')];
}

/**
 * Cellules d'une fiche. Les textes longs (poste, structure, marque, caractéristiques, type) passent à la ligne :
 * le tableau tient dans la fenêtre, jusqu'à 1024 px de large, sans défilement horizontal.
 * Machine : la marque et modèle, et dessous les caractéristiques (processeur · RAM · stockage).
 * `archive` : le statut n'a pas de colonne (affectations d'une fiche) ; une fiche archivée le dit après son nom.
 */
export function CellulesFiche({ x, archive }: {
  x: Entite;
  /** Badge « Archivé » après le nom d'une fiche archivée (tableaux sans colonne « Statut »). */
  archive?: boolean;
}) {
  const config = x.kind === 'b' ? caracteristiques(x) : '';
  return (
    <>
      <td className="name long"><span><Icon name={x.kind} />{nomAffiche(x)}{archive && !x.actif && <Badge kind="archive" />}</span></td>
      <td><EntityCode code={x.code} kind={x.kind} /></td>
      {x.kind === 'a' ? (
        <td className="long">{texte(x.poste) || '—'}</td>
      ) : (
        <td className="long">
          {texte(x.marque) || '—'}
          {config && <small>{config}</small>}
        </td>
      )}
      <td className="long">{x.categorie}</td>
    </>
  );
}

/**
 * Tableau de fiches (`entRow()` du prototype). Employés : Nom, Identifiant, Poste, Structure ; machines : Nom,
 * Identifiant, Marque et configuration, Type de machine ; puis Statut et Mise à jour.
 * Clic par défaut : ouvre la fiche (`nav.go`).
 */
export function EntityTable({ kind, entites, empty, onOpen, label }: {
  kind: Kind;
  entites: readonly Entite[];
  empty?: ReactNode;
  onOpen?: (e: Entite) => void;
  label?: string;
}) {
  return (
    <Table
      heads={[...colonnesFiche(kind), 'Statut', 'Mise à jour']}
      rows={entites}
      rowKey={(x) => x.id}
      rowClassName={(x) => (x.actif ? undefined : 'arch')}
      onOpen={onOpen ?? ((x) => nav.go({ name: 'fiche', id: x.id }))}
      empty={empty}
      label={label}
      className="fiches"
      cells={(x) => (
        <>
          <CellulesFiche x={x} />
          <td><Badge kind={x.actif ? 'actif' : 'archive'} /></td>
          <td>{formatDate(x.majLe)}</td>
        </>
      )}
    />
  );
}
