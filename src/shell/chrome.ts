import { defaultCrumbs, defaultModule, navEntry, useDeclaredChrome, useNav, type Crumb, type NavId, type Route } from '../nav';

/** Maillon affiché par la coquille : `root` = maillon du module (ouvre avec `nav.root`). */
export interface ShellCrumb extends Crumb {
  root?: boolean;
}

/** Module allumé et fil d'Ariane complet de la page courante (déclaration de la page, sinon valeurs par défaut). */
export function useChrome(): { route: Route; seq: number; module: NavId | null; crumbs: ShellCrumb[] } {
  const route = useNav((s) => s.route);
  const seq = useNav((s) => s.seq);
  const declared = useDeclaredChrome();
  const own = declared.seq === seq ? declared : null;
  const module = own && own.module !== undefined ? own.module : defaultModule(route);
  const pageCrumbs = own?.crumbs ?? defaultCrumbs(route);
  const first: ShellCrumb[] = module ? [{ label: navEntry(module).label, to: navEntry(module).route, root: true }] : [];
  return { route, seq, module, crumbs: [...first, ...pageCrumbs] };
}
