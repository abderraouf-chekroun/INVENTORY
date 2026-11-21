import type { DocumentFichier } from '../../api';

/*
 * Aperçu d'un fichier importé et bouton « Ouvrir avec l'application par défaut ».
 *
 * Tout se décide sur ce que le back a constaté dans le fichier stocké :
 * - `apercu` : type reconnu d'après le CONTENU du fichier (octets de signature), jamais d'après son nom ;
 * - `ouvrable` : le back accepte de l'ouvrir avec l'application par défaut.
 * `fichierNom` (nom d'origine) n'est qu'un libellé : il peut ne pas correspondre au contenu.
 */

export type ContenuApercu = 'vide' | 'image' | 'pdf' | 'message';

export interface DecisionApercu {
  /** `vide` : pas de fichier (gabarit gris) ; `image` → `<img>` ; `pdf` → `<iframe>` ; `message` : explication. */
  contenu: ContenuApercu;
  /** Afficher le bouton « Ouvrir avec l'application par défaut ». */
  ouvrir: boolean;
  /** Texte affiché quand il n'y a pas d'aperçu intégré. */
  message: string;
}

export const MESSAGE_SANS_FICHIER = 'Fichier importé : son contenu numérisé s’affiche ici.';

/** Libellé « (nom d'origine) » ajouté aux messages, s'il est connu. */
const libelle = (nom: string | null) => (nom ? ` (${nom})` : '');

export function decisionApercu(
  doc: Pick<DocumentFichier, 'fichierChemin' | 'fichierNom' | 'apercu' | 'ouvrable'>,
): DecisionApercu {
  if (!doc.fichierChemin) {
    return { contenu: 'vide', ouvrir: false, message: MESSAGE_SANS_FICHIER };
  }
  const ouvrir = doc.ouvrable === true;
  if (doc.apercu === 'image') return { contenu: 'image', ouvrir, message: '' };
  if (doc.apercu === 'pdf') return { contenu: 'pdf', ouvrir, message: '' };
  return {
    contenu: 'message',
    ouvrir,
    message: ouvrir
      ? `Ce fichier ne peut pas être affiché ici${libelle(doc.fichierNom)}. Ouvrez-le avec l’application installée sur ce poste.`
      : `Ce fichier ne peut être ni affiché ni ouvert depuis l’application${libelle(doc.fichierNom)} : `
        + 'par mesure de sécurité, ce type de fichier n’est pas pris en charge. '
        + 'Utilisez « Enregistrer une copie… » pour le récupérer.',
  };
}
