import type { Kind } from '../api';

/*
 * Structures (employés) et types de machine (spécification § 9.1) : nombre de fiches et suppression.
 */

/** Nombre de fiches d'une catégorie, lu prudemment (absent ou invalide → 0). */
export const nbFichesDe = (c: { nbFiches?: unknown }): number =>
  (typeof c.nbFiches === 'number' && Number.isInteger(c.nbFiches) && c.nbFiches > 0 ? c.nbFiches : 0);

/** « Aucun employé », « 1 employé », « 3 employés » ; « Aucune machine », « 1 machine », « 2 machines ». */
export function nbFichesLabel(kind: Kind, n: number): string {
  const mot = kind === 'a' ? 'employé' : 'machine';
  if (n <= 0) return kind === 'a' ? 'Aucun employé' : 'Aucune machine';
  return `${n} ${mot}${n > 1 ? 's' : ''}`;
}

/**
 * Pourquoi la suppression est indisponible, ou null si elle est possible (aucune fiche, active ou archivée).
 * Ex. : « Cette structure contient encore 3 employés. Déplacez-les dans une autre structure avant de la supprimer. »
 */
export function motifSuppressionImpossible(kind: Kind, n: number): string | null {
  if (n <= 0) return null;
  const pronom = n > 1 ? 'les' : kind === 'a' ? 'le' : 'la';
  return kind === 'a'
    ? `Cette structure contient encore ${nbFichesLabel(kind, n)}. Déplacez-${pronom} dans une autre structure avant de la supprimer.`
    : `Ce type de machine contient encore ${nbFichesLabel(kind, n)}. Déplacez-${pronom} dans un autre type de machine avant de le supprimer.`;
}

/*
 * § 16 (1.7) : catégories des dossiers et des modèles de document (thèmes en interne) : nombres et suppression.
 */

/** Nombre lu prudemment (absent ou invalide → 0). */
const entierPositif = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : 0);

/** Nombres de dossiers et de modèles (actifs et archivés) d'une catégorie. */
export const nbContenuCategorie = (t: { nbDossiers?: unknown; nbModeles?: unknown }): { dossiers: number; modeles: number } =>
  ({ dossiers: entierPositif(t.nbDossiers), modeles: entierPositif(t.nbModeles) });

/** « Aucun dossier · 4 modèles », « 3 dossiers · 1 modèle », « Aucun dossier ni modèle ». */
export function contenuCategorieLabel(dossiers: number, modeles: number): string {
  if (dossiers <= 0 && modeles <= 0) return 'Aucun dossier ni modèle';
  const d = dossiers > 0 ? `${dossiers} dossier${dossiers > 1 ? 's' : ''}` : 'Aucun dossier';
  const m = modeles > 0 ? `${modeles} modèle${modeles > 1 ? 's' : ''}` : 'aucun modèle';
  return `${d} · ${m}`;
}

/**
 * Pourquoi la suppression d'une catégorie est indisponible, ou null si elle est possible (ni dossier ni modèle, actif
 * ou archivé). Même texte que le refus du back. Ex. : « Cette catégorie contient encore 3 dossiers et 2 modèles de
 * document. Déplacez-les ou supprimez-les avant de la supprimer. »
 */
export function motifSuppressionCategorie(dossiers: number, modeles: number): string | null {
  const d = Math.max(0, dossiers);
  const m = Math.max(0, modeles);
  if (d === 0 && m === 0) return null;
  const parties: string[] = [];
  if (d > 0) parties.push(`${d} dossier${d > 1 ? 's' : ''}`);
  if (m > 0) parties.push(`${m} modèle${m > 1 ? 's' : ''} de document`);
  const pronom = d + m > 1 ? 'les' : 'le';
  return `Cette catégorie contient encore ${parties.join(' et ')}. Déplacez-${pronom} ou supprimez-${pronom} avant de la supprimer.`;
}
