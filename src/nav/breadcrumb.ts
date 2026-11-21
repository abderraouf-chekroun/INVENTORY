import { useLayoutEffect } from 'react';
import { create } from 'zustand';
import type { NavId, Route } from './routes';
import { useNav } from './store';

/** Un maillon du fil d'Ariane. Le dernier maillon est toujours affiché en gras, non cliquable. */
export interface Crumb {
  label: string;
  /** Page ouverte au clic (avec empilement, comme un lien du prototype). */
  to?: Route;
}

interface DeclaredChrome {
  /** `seq` de la page qui a déclaré : une déclaration d'une page précédente est ignorée. */
  seq: number;
  crumbs: Crumb[] | null;
  module: NavId | null | undefined;
}

export const useDeclaredChrome = create<DeclaredChrome>()(() => ({ seq: -1, crumbs: null, module: undefined }));

/**
 * Déclare le fil d'Ariane de la page, APRÈS le maillon du module (ajouté par la coquille).
 *
 *   // Fiche : « Machines › PC Accueil 03 », et « Machines » allumé dans la barre latérale
 *   useBreadcrumb(fiche && [{ label: fiche.entite.nom }], { module: fiche && repNavId(fiche.entite.kind) });
 *
 *   // Dossier dans un sous-dossier : « Dossiers & Archives › Dossier 2025-01 › Sous-dossier A »
 *   useBreadcrumb([{ label: d.nom, to: { name: 'dossier', id: d.id } }, { label: s.nom }]);
 *
 * - `crumbs` null/undefined (données pas encore chargées) : fil par défaut de la route.
 * - `module` : entrée de la barre latérale à allumer (et 1er maillon). Absent : `defaultModule(route)`.
 * Appelez-le inconditionnellement, en haut du composant de page (c'est un hook).
 */
export function useBreadcrumb(
  crumbs: Crumb[] | null | undefined | false,
  options: { module?: NavId | null | false } = {},
): void {
  const seq = useNav((s) => s.seq);
  const list = crumbs || null;
  const module = options.module === false ? undefined : options.module;
  const key = JSON.stringify([list, module]);
  useLayoutEffect(() => {
    useDeclaredChrome.setState({ seq, crumbs: list, module });
  }, [seq, key]); // `key` résume `list` et `module` : on ne redéclare que si leur contenu change.
}

/** Fil par défaut (après le module) quand la page n'en déclare pas. */
export function defaultCrumbs(r: Route): Crumb[] {
  switch (r.name) {
    case 'form-entite':
      return [{ label: r.id === undefined ? (r.kind === 'a' ? 'Créer un employé' : 'Créer une machine') : 'Modifier la fiche' }];
    case 'form-dossier':
      return [{ label: 'Créer un dossier' }];
    case 'studio':
      return [{ label: 'Studio de Modèles' }];
    case 'magasin':
      return [{ label: 'Magasin' }];
    default:
      return [];
  }
}
