import { COULEURS, type Couleur, type RoleStatut, type StatutDossier } from '../api';

/*
 * États de dossier (spécification § 10.1). Trois états fournis (rôles 'cours', 'piece', 'clos'), qui ne se renomment
 * ni ne se suppriment, et les états ajoutés par l'utilisateur (rôle 'perso'). La couleur vient d'une palette fermée :
 * chaque couleur a sa classe CSS (`st-bleu`…), jamais de couleur libre.
 * Les états viennent des données : rôle ou couleur inconnus ne doivent jamais faire planter l'affichage.
 */

/** Noms des couleurs, dans l'ordre de la palette. */
export const COULEUR_LABEL: Record<Couleur, string> = {
  gris: 'Gris',
  bleu: 'Bleu',
  turquoise: 'Turquoise',
  vert: 'Vert',
  ambre: 'Ambre',
  orange: 'Orange',
  rouge: 'Rouge',
  rose: 'Rose',
  violet: 'Violet',
};

const ROLES: readonly RoleStatut[] = ['cours', 'piece', 'clos', 'perso'];

/** Vrai pour une couleur de la palette (jamais pour « constructor », « __proto__ »…). */
export const estCouleur = (c: unknown): c is Couleur =>
  typeof c === 'string' && (COULEURS as readonly string[]).includes(c);

/** Couleur d'un état ; inconnue → « gris ». */
export const couleurDe = (s: { couleur?: unknown } | null | undefined): Couleur =>
  (s && estCouleur(s.couleur) ? s.couleur : 'gris');

/** Rôle d'un état ; inconnu → « perso » (dossier ouvert, modifiable). */
export const roleDe = (s: { role?: unknown } | null | undefined): RoleStatut =>
  (s && typeof s.role === 'string' && (ROLES as readonly string[]).includes(s.role) ? (s.role as RoleStatut) : 'perso');

/** Nom d'un état, lu prudemment. */
export const nomStatut = (s: { nom?: unknown } | null | undefined): string =>
  (s && typeof s.nom === 'string' && s.nom.trim() ? s.nom : 'État inconnu');

/** Classe CSS d'une couleur d'état : « st-bleu ». */
export const classeCouleur = (c: unknown): string => `st-${estCouleur(c) ? c : 'gris'}`;

/** Vrai pour les trois états fournis avec l'application. */
export const estFourni = (s: { role?: unknown }): boolean => roleDe(s) !== 'perso';

/** Dossier clôturé (lecture seule). */
export const estClos = (s: { role?: unknown } | null | undefined): boolean => roleDe(s) === 'clos';

/** États « ouverts » proposés dans l'en-tête d'un dossier et à la création : tous sauf « Clôturé ». */
export const etatsOuverts = (statuts: readonly StatutDossier[]): StatutDossier[] =>
  statuts.filter((s) => roleDe(s) !== 'clos');

/** Premier état d'un rôle donné, ou undefined. */
export const statutDeRole = (statuts: readonly StatutDossier[], role: RoleStatut): StatutDossier | undefined =>
  statuts.find((s) => roleDe(s) === role);

/** « Aucun dossier », « 1 dossier », « 3 dossiers ». */
export function nbDossiersLabel(n: unknown): string {
  const k = typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : 0;
  if (k === 0) return 'Aucun dossier';
  return `${k} dossier${k > 1 ? 's' : ''}`;
}

/** Nombre de dossiers d'un état, lu prudemment (absent ou invalide → 0). */
export const nbDossiersDe = (s: { nbDossiers?: unknown }): number =>
  (typeof s.nbDossiers === 'number' && Number.isInteger(s.nbDossiers) && s.nbDossiers > 0 ? s.nbDossiers : 0);

/** Pourquoi un dossier ne peut pas être clôturé maintenant, ou null. */
export function motifClotureImpossible(s: { role?: unknown }): string | null {
  return roleDe(s) === 'piece'
    ? 'Le dossier est en « Pièce manquante » : ajoutez la pièce finale, ou choisissez un autre état, avant de le clôturer.'
    : null;
}

/** Pourquoi un état ne peut pas être renommé ni changer de couleur, ou null. */
export function motifModificationImpossible(s: { role?: unknown }): string | null {
  return estFourni(s) ? 'Cet état est fourni avec l’application : son nom et sa couleur ne changent pas.' : null;
}

/** Pourquoi un état ne peut pas être supprimé, ou null si la suppression est possible. */
export function motifSuppressionStatut(s: { role?: unknown; nbDossiers?: unknown }): string | null {
  if (estFourni(s)) return 'Cet état est fourni avec l’application : il ne peut pas être supprimé.';
  const n = nbDossiersDe(s);
  if (n === 0) return null;
  return n > 1
    ? `${n} dossiers sont dans cet état. Donnez-leur un autre état avant de le supprimer.`
    : '1 dossier est dans cet état. Donnez-lui un autre état avant de le supprimer.';
}

/** Couleur proposée pour un nouvel état : la première de la palette qu'aucun état n'utilise, sinon « bleu ». */
export function couleurProposee(statuts: readonly { couleur?: unknown }[]): Couleur {
  const prises = new Set(statuts.map((s) => couleurDe(s)));
  return COULEURS.find((c) => !prises.has(c)) ?? 'bleu';
}
