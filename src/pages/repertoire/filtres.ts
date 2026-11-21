import { create } from 'zustand';
import type { Entite, Kind } from '../../api';
import { nomAffiche, pourComparer, texte } from '../../lib/format';

/*
 * Filtres des répertoires Employés (a) et Machines (b) (`S.f.a` / `S.f.b` du prototype).
 * Gardés hors de la page : ils survivent à la navigation (ouvrir une fiche puis revenir).
 */

export type StatutFiltre = 'tous' | 'actif' | 'archive';
export type TriFiltre = 'nom' | 'code';

export interface FiltresRepertoire {
  statut: StatutFiltre;
  /** Nom de la catégorie (structure ou type de machine), ou '' pour « Toutes ». Un nom de catégorie n'est jamais vide. */
  cat: string;
  /** « Fiche à compléter » (employés) / « Sans identifiant » (machines). */
  noid: boolean;
  sort: TriFiltre;
  /** Recherche texte, saisie brute (nom, prénom, poste, marque ou identifiant). */
  code: string;
}

export const FILTRES_INITIAUX: FiltresRepertoire = { statut: 'tous', cat: '', noid: false, sort: 'nom', code: '' };

interface FiltresState {
  a: FiltresRepertoire;
  b: FiltresRepertoire;
  modifier: (kind: Kind, patch: Partial<FiltresRepertoire>) => void;
}

export const useFiltresRepertoire = create<FiltresState>()((set) => ({
  a: FILTRES_INITIAUX,
  b: FILTRES_INITIAUX,
  modifier: (kind, patch) =>
    set((s) => (kind === 'a' ? { a: { ...s.a, ...patch } } : { b: { ...s.b, ...patch } })),
}));

const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });

/** Textes cherchés : nom, prénom, poste, identifiant (employé) ; nom, marque, identifiant (machine). */
function textesCherches(x: Entite): string[] {
  return x.kind === 'a'
    ? [nomAffiche(x), x.nom, texte(x.prenom), texte(x.poste), x.code ?? '']
    : [x.nom, texte(x.marque), x.code ?? ''];
}

/**
 * Filtre et trie comme `rep()` du prototype (casse et accents ignorés dans la recherche).
 * `cat` est une catégorie présente dans la liste, ou '' (toutes).
 */
export function filtrer(liste: readonly Entite[], f: FiltresRepertoire, cat: string): Entite[] {
  const q = pourComparer(f.code);
  const rows = liste.filter((x) =>
    (f.statut === 'tous' || (f.statut === 'actif') === x.actif)
    && (cat === '' || x.categorie === cat)
    && (!f.noid || !x.code)
    && (!q || textesCherches(x).some((s) => pourComparer(s).includes(q))));
  // Tri par identifiant : les fiches sans identifiant à la fin, puis par nom.
  const parCode = (p: Entite, r: Entite) =>
    (p.code === null ? 1 : 0) - (r.code === null ? 1 : 0) || collator.compare(p.code ?? '', r.code ?? '');
  rows.sort((p, r) => (f.sort === 'code' ? parCode(p, r) : 0) || collator.compare(nomAffiche(p), nomAffiche(r)));
  return rows;
}
