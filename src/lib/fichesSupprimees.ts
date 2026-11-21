import { create } from 'zustand';
import type { Kind } from '../api';

/**
 * Fiches supprimées pendant cette session (§ 13.2) : une page encore ouverte sur l'une d'elles (historique de
 * navigation, lien d'un ancien événement) affiche « Cette fiche a été supprimée. » sans relire le back, et sait vers
 * quel répertoire revenir.
 */
interface FichesSupprimeesState {
  fiches: Readonly<Record<number, { kind: Kind; nom: string }>>;
  marquer: (id: number, kind: Kind, nom: string) => void;
}

export const useFichesSupprimees = create<FichesSupprimeesState>()((set) => ({
  fiches: {},
  marquer: (id, kind, nom) => set((s) => ({ fiches: { ...s.fiches, [id]: { kind, nom } } })),
}));

export const marquerFicheSupprimee = (id: number, kind: Kind, nom: string): void =>
  useFichesSupprimees.getState().marquer(id, kind, nom);
