import type { Kind } from '../api';

/**
 * Clés de requête react-query, toutes ici. Ne jamais écrire une clé à la main dans une page.
 *
 * Convention d'invalidation (voir lib/action.ts) : après une écriture, `useAction` invalide
 * TOUT le cache par défaut (`invalidate: 'all'`). La base est locale, seules les requêtes affichées
 * sont relues : c'est simple et toujours juste. Ne restreindre (`invalidate: [qk.x, …]` ou `'none'`)
 * que pour les écritures très fréquentes, par exemple l'enregistrement automatique d'un document.
 *
 * Le premier élément de chaque clé est un « domaine » : invalider `qk.dossiers` (['dossiers'])
 * invalide aussi toutes les clés qui commencent par 'dossiers'.
 */
export const qk = {
  parametres: ['parametres'] as const,
  infosSysteme: ['infosSysteme'] as const,
  themes: ['classement', 'themes'] as const,
  categories: (kind: Kind) => ['classement', 'categories', kind] as const,
  magasin: ['classement', 'magasin'] as const,
  entites: (kind: Kind) => ['entites', kind] as const,
  fiche: (id: number) => ['fiche', id] as const,
  /** § 13.2 : ce que supprimerait la suppression de la fiche (sous la clé de la fiche : retiré avec elle). */
  suppressionApercu: (id: number) => ['fiche', id, 'suppression'] as const,
  /** Aide à la saisie (8 propositions au plus). */
  suggestions: (kind: Kind, q: string) => ['entites', kind, 'suggestions', q] as const,
  /** Identifiant d'employé qui serait attribué (formulaire de fiche). */
  identifiantApercu: (nom: string, prenom: string, dateNaissance: string | null, poste: string, idExistant: number | null) =>
    ['identifiantApercu', nom, prenom, dateNaissance, poste, idExistant] as const,
  /** États de dossier (§ 10.1). */
  statuts: ['statuts'] as const,
  dossiers: ['dossiers'] as const,
  dossier: (id: number) => ['dossier', id] as const,
  /** § 15 : ce que supprimerait la suppression du dossier (sous la clé du dossier : retiré avec elle). */
  dossierSuppressionApercu: (id: number) => ['dossier', id, 'suppression'] as const,
  /** Préfixe commun du contenu de tous les dossiers (`dossier(id)`). */
  contenusDossiers: ['dossier'] as const,
  dossierNomSuggere: (annee: number) => ['dossierNomSuggere', annee] as const,
  modeles: ['modeles'] as const,
  recherche: (q: string) => ['recherche', q] as const,
  tableauDeBord: ['tableauDeBord'] as const,
};
