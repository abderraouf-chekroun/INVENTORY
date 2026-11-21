/*
 * Rendu borné des longues listes et des grands tableaux : seuls les `limite` premiers éléments sont rendus,
 * un bouton « Afficher plus » rend les suivants par paquets. Une donnée géante (base reçue de quelqu'un)
 * ne gèle donc pas l'interface. Les éléments rendus sont toujours un PRÉFIXE de la liste : leurs index
 * restent ceux de la liste complète (les modifications par index restent justes).
 */

/** Paquets par défaut. */
export const PAS_LISTE = 200;
export const PAS_TABLEAU = 200;
export const PAS_BLOCS = 300;

export interface Tranche<T> {
  /** Les `limite` premiers éléments (préfixe). */
  visibles: readonly T[];
  /** Nombre d'éléments non rendus. */
  masques: number;
}

export function tranche<T>(items: readonly T[], limite: number): Tranche<T> {
  const n = Math.max(0, Math.floor(limite));
  if (items.length <= n) return { visibles: items, masques: 0 };
  return { visibles: items.slice(0, n), masques: items.length - n };
}

/** Texte du bouton : « Afficher 200 lignes de plus (1 234 non affichées) ». */
export function libellePlus(masques: number, pas: number, unite: { un: string; plusieurs: string; feminin?: boolean }): string {
  const lot = Math.min(masques, pas);
  const nb = (n: number) => n.toLocaleString('fr-FR');
  const mot = (n: number) => (n > 1 ? unite.plusieurs : unite.un);
  const accord = masques > 1 ? (unite.feminin ? 'non affichées' : 'non affichés') : (unite.feminin ? 'non affichée' : 'non affiché');
  return `Afficher ${nb(lot)} ${mot(lot)} de plus (${nb(masques)} ${accord})`;
}
