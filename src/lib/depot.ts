/*
 * Dépôt de fichiers sur la fenêtre (glisser depuis l'Explorateur) : neutralisé.
 *
 * Sans cela, WebView2 ouvre le fichier déposé À LA PLACE de l'application (la fenêtre quitte
 * l'application). L'import passe uniquement par « Importer un fichier ».
 * Le glisser-déposer des blocs du Studio transporte du texte (`text/plain`), pas des fichiers :
 * il n'est pas touché.
 */

/** Vrai si l'opération de glisser transporte des fichiers venus du système. */
export function transporteDesFichiers(types: ArrayLike<string> | null | undefined): boolean {
  if (!types) return false;
  for (let i = 0; i < types.length; i++) if (types[i] === 'Files') return true;
  return false;
}

/** Événement minimal (testable sans DOM). */
export interface EvenementGlisser {
  dataTransfer: { types: ArrayLike<string>; dropEffect: string } | null;
  preventDefault: () => void;
}

/**
 * Refuse un dépôt de fichiers : l'événement par défaut (ouvrir le fichier) est annulé et le curseur
 * indique « interdit ». Renvoie vrai si l'événement a été neutralisé.
 */
export function refuserDepotFichiers(e: EvenementGlisser): boolean {
  if (!e.dataTransfer || !transporteDesFichiers(e.dataTransfer.types)) return false;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'none';
  return true;
}

/** Installe le blocage sur la fenêtre (phase de capture : avant tout autre gestionnaire). */
export function installerBlocageDepot(cible: Pick<Window, 'addEventListener'>): void {
  const h = (e: DragEvent) => {
    refuserDepotFichiers(e);
  };
  for (const type of ['dragenter', 'dragover', 'drop'] as const) cible.addEventListener(type, h, true);
}
