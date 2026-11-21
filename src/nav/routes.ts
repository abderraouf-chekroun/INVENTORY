import type { Kind } from '../api';
import type { IconName } from '../ui/Icon';

/** Routes de l'application (spécification § 6). */
export type Route =
  | { name: 'dashboard' }
  | { name: 'rep'; kind: Kind; sansCode?: boolean }
  // onglet : onglet ouvert, gardé dans la route pour que Retour y ramène (historique cliquable, § 9.4).
  | { name: 'fiche'; id: number; focusCode?: boolean; onglet?: number }
  | { name: 'dossiers' }
  | { name: 'dossier'; id: number; sousDossierId?: number | null; documentId?: number }
  | { name: 'creation' }
  | { name: 'form-entite'; kind: Kind; id?: number } // id présent = modification
  | { name: 'form-dossier' }
  | { name: 'studio'; modeleId?: number }
  | { name: 'magasin' }
  | { name: 'parametres' };

export type RouteName = Route['name'];
export type RouteOf<N extends RouteName> = Extract<Route, { name: N }>;

/** Props reçues par chaque page : sa route, typée. Ex. `function Fiche({ route }: PageProps<'fiche'>)`. */
export interface PageProps<N extends RouteName> {
  route: RouteOf<N>;
}

/** Les six entrées de la barre latérale (« modules »), dans l'ordre du prototype. */
export type NavId = 'dashboard' | 'rep-a' | 'rep-b' | 'dossiers' | 'creation' | 'parametres';

export interface NavEntry {
  id: NavId;
  label: string;
  icon: IconName;
  route: Route;
}

export const NAV: readonly NavEntry[] = [
  { id: 'dashboard', label: 'Tableau de bord', icon: 'dash', route: { name: 'dashboard' } },
  { id: 'rep-a', label: 'Employés', icon: 'a', route: { name: 'rep', kind: 'a' } },
  { id: 'rep-b', label: 'Machines', icon: 'b', route: { name: 'rep', kind: 'b' } },
  { id: 'dossiers', label: 'Dossiers & Archives', icon: 'dossier', route: { name: 'dossiers' } },
  { id: 'creation', label: 'Création', icon: 'creation', route: { name: 'creation' } },
  { id: 'parametres', label: 'Paramètres', icon: 'param', route: { name: 'parametres' } },
];

export const navEntry = (id: NavId): NavEntry => NAV.find((n) => n.id === id) ?? NAV[0];

/** Entrée « Employés » (répertoire A) ou « Machines » (répertoire B). */
export const repNavId = (kind: Kind): NavId => (kind === 'a' ? 'rep-a' : 'rep-b');

/**
 * Module mis en évidence dans la barre latérale quand la page ne le précise pas (voir useBreadcrumb).
 * `fiche` renvoie null : seule la page connaît le répertoire de la fiche une fois chargée.
 */
export function defaultModule(r: Route): NavId | null {
  switch (r.name) {
    case 'dashboard':
      return 'dashboard';
    case 'rep':
      return repNavId(r.kind);
    case 'fiche':
      return null;
    case 'dossiers':
    case 'dossier':
      return 'dossiers';
    case 'creation':
    case 'form-entite':
    case 'form-dossier':
    case 'studio':
    case 'magasin':
      return 'creation';
    case 'parametres':
      return 'parametres';
  }
}
