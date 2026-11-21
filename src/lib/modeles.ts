/*
 * Modèles de document (spécification § 11.4) : nombre de documents issus d'un modèle et suppression.
 * Un modèle ne se supprime que si aucun document n'a été créé à partir de lui ; sinon, on l'archive.
 */

/** Nombre de documents créés à partir du modèle, lu prudemment (absent ou invalide → 0). */
export const nbDocumentsDe = (m: { nbDocuments?: unknown }): number =>
  (typeof m.nbDocuments === 'number' && Number.isInteger(m.nbDocuments) && m.nbDocuments > 0 ? m.nbDocuments : 0);

/** « Aucun document », « 1 document », « 3 documents ». */
export function nbDocumentsLabel(n: number): string {
  if (n <= 0) return 'Aucun document';
  return `${n} document${n > 1 ? 's' : ''}`;
}

/**
 * Pourquoi la suppression est indisponible, ou null si elle est possible.
 * Ex. : « 3 documents ont été créés à partir de ce modèle. Archivez-le si vous ne voulez plus l’utiliser. »
 */
export function motifSuppressionModele(n: number): string | null {
  if (n <= 0) return null;
  const cree = n > 1 ? `${n} documents ont été créés` : '1 document a été créé';
  return `${cree} à partir de ce modèle. Archivez-le si vous ne voulez plus l’utiliser.`;
}

/** Modèle à afficher après la suppression de `id` : le suivant dans la liste, sinon le précédent, sinon aucun. */
export function modeleApresSuppression(modeles: readonly { id: number }[], id: number): number | undefined {
  const i = modeles.findIndex((m) => m.id === id);
  if (i < 0) return modeles[0]?.id;
  return (modeles[i + 1] ?? modeles[i - 1])?.id;
}
