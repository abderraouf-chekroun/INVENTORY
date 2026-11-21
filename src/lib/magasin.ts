/*
 * § 17 (1.8) : mots-clés du Magasin : nombre de documents qui les ont choisis et confirmation de suppression.
 */

/** Nombre de documents d'un mot-clé, lu prudemment (absent ou invalide → 0). */
export const nbDocumentsDe = (k: { nbDocuments?: unknown }): number =>
  (typeof k.nbDocuments === 'number' && Number.isInteger(k.nbDocuments) && k.nbDocuments > 0 ? k.nbDocuments : 0);

const documents = (n: number) => `${n} document${n > 1 ? 's' : ''}`;

/** « Choisi dans aucun document », « Choisi dans 1 document », « Choisi dans 3 documents ». */
export function nbDocumentsLabel(n: number): string {
  return n > 0 ? `Choisi dans ${documents(n)}` : 'Choisi dans aucun document';
}

/**
 * Texte de la confirmation de suppression d'un mot-clé (toujours possible) : les documents gardent la valeur écrite.
 * Ex. : « Ce mot-clé est choisi dans 3 documents. Il y restera écrit, mais ne sera plus proposé. Cette action est
 * irréversible. »
 */
export function messageSuppressionMotCle(n: number): string {
  const usage = n > 0
    ? `Ce mot-clé est choisi dans ${documents(n)}. Il y restera écrit, mais ne sera plus proposé.`
    : 'Ce mot-clé n’est choisi dans aucun document.';
  return `${usage} Cette action est irréversible.`;
}
