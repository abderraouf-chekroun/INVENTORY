import type { Kind } from '../api';

/*
 * Tableau de bord sans ligne à montrer. Sur une base neuve (§ 14), il n'y a encore ni fiche ni dossier : le texte dit
 * alors quoi faire, plutôt que d'affirmer que « tout est complet ».
 */

/** Inventaire à compléter (1.3) vide : `total` = nombre de fiches du répertoire. */
export function inventaireVide(kind: Kind, total: number): string {
  if (total === 0) {
    return kind === 'a'
      ? 'Aucun employé pour l’instant. Créez le premier depuis Employés, avec « Créer un employé ».'
      : 'Aucune machine pour l’instant. Créez la première depuis Machines, avec « Créer une machine ».';
  }
  return kind === 'a' ? 'Toutes les fiches des employés sont complètes.' : 'Toutes les machines ont un identifiant.';
}

/** Dossiers ouverts (1.4) vide : `total` = nombre de dossiers, clôturés compris. */
export function dossiersOuvertsVide(total: number): string {
  return total === 0
    ? 'Aucun dossier pour l’instant. Créez le premier depuis Dossiers & Archives, avec « Créer un dossier ».'
    : 'Aucun dossier ouvert.';
}
