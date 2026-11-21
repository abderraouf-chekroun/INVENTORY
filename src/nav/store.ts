import { create } from 'zustand';
import type { Route } from './routes';

/*
 * Navigation (comme le prototype) : une route courante et une pile d'historique.
 * `seq` change à chaque nouvelle page : la coquille s'en sert pour remonter la page (état local remis à zéro)
 * et remettre le défilement en haut.
 */
interface NavState {
  route: Route;
  stack: Route[];
  seq: number;
  /** Ouvre une page en empilant la page courante (bouton Retour / Alt+← y reviennent). */
  go: (route: Route) => void;
  /** Ouvre une page en vidant l'historique (entrées de la barre latérale). */
  root: (route: Route) => void;
  /** Revient à la page précédente, s'il y en a une. */
  back: () => void;
  /** Remplace la page courante sans l'empiler (ex. après l'enregistrement d'un formulaire → la fiche créée). */
  replace: (route: Route) => void;
  /**
   * Modifie les paramètres de la route courante SANS changer de page : pas d'historique,
   * la page reste montée et garde son état (ex. choisir le document affiché dans un dossier).
   */
  update: (route: Route) => void;
}

export const useNav = create<NavState>()((set) => ({
  route: { name: 'dashboard' },
  stack: [],
  seq: 0,
  go: (route) => set((s) => ({ route, stack: [...s.stack, s.route], seq: s.seq + 1 })),
  root: (route) => set((s) => ({ route, stack: [], seq: s.seq + 1 })),
  back: () =>
    set((s) => {
      const prev = s.stack[s.stack.length - 1];
      return prev ? { route: prev, stack: s.stack.slice(0, -1), seq: s.seq + 1 } : s;
    }),
  replace: (route) => set((s) => ({ route, seq: s.seq + 1 })),
  update: (route) => set((s) => (route.name === s.route.name ? { route } : { route, seq: s.seq + 1 })),
}));

/** Les mêmes actions, utilisables hors composant ou dans un gestionnaire d'événement : `nav.go({ name: 'dossiers' })`. */
export const nav = {
  go: (route: Route) => useNav.getState().go(route),
  root: (route: Route) => useNav.getState().root(route),
  back: () => useNav.getState().back(),
  replace: (route: Route) => useNav.getState().replace(route),
  update: (route: Route) => useNav.getState().update(route),
};
