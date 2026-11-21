import { create } from 'zustand';

/*
 * État d'interface de « Dossiers & Archives » (filtres, regroupement, vue, nœuds dépliés).
 * Il vit hors de la page : il survit à la navigation, comme `S.f.d` et `S.open` dans le prototype.
 */
export type Regroupement = 'theme' | 'annee' | 'statut' | 'aucun';
export type VueDossiers = 'groupes' | 'arbo';

interface DossiersUi {
  annee: string; // 'tous' ou une année
  theme: string; // 'tous' ou un nom de catégorie (thème en interne)
  statut: string; // 'tous' ou l'identifiant d'un état (§ 10.1), en texte
  group: Regroupement;
  view: VueDossiers;
  /** Nœuds dépliés de l'arborescence : « {dossierId}: » (dossier) ou « {dossierId}:{sousDossierId} ». */
  ouverts: readonly string[];
  set: (patch: Partial<Pick<DossiersUi, 'annee' | 'theme' | 'statut' | 'group' | 'view'>>) => void;
  basculer: (key: string) => void;
}

export const useDossiersUi = create<DossiersUi>()((set) => ({
  annee: 'tous',
  theme: 'tous',
  statut: 'tous',
  group: 'theme',
  view: 'groupes',
  ouverts: [],
  set: (patch) => set(patch),
  basculer: (key) =>
    set((s) => ({ ouverts: s.ouverts.includes(key) ? s.ouverts.filter((k) => k !== key) : [...s.ouverts, key] })),
}));

export const cleNoeud = (dossierId: number, sousDossierId: number | null) => `${dossierId}:${sousDossierId ?? ''}`;

/**
 * § 15 : dossier supprimé. Ses nœuds dépliés sont oubliés : un nouveau dossier qui recevrait son numéro ne
 * s'afficherait pas déplié.
 */
export const oublierDossier = (dossierId: number): void =>
  useDossiersUi.setState((s) => ({ ouverts: s.ouverts.filter((k) => !k.startsWith(`${dossierId}:`)) }));
