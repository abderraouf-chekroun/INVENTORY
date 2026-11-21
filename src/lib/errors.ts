import { create } from 'zustand';
import { versApiError, type ApiError } from '../api';

/**
 * Erreur « globale » : affichée par la coquille en haut de la page courante (bandeau .alert.bad),
 * effacée au changement de page ou par le bouton « Fermer ».
 * Toute écriture faite avec `useAction` y envoie automatiquement son erreur (sauf `errors: 'local'`).
 */
interface GlobalErrorState {
  error: ApiError | null;
  show: (e: unknown) => void;
  clear: () => void;
}

export const useGlobalError = create<GlobalErrorState>()((set) => ({
  error: null,
  show: (e) => set({ error: versApiError(e) }),
  clear: () => set({ error: null }),
}));

/** Affiche une erreur dans le bandeau global, depuis n'importe où (hors composant compris). */
export const showError = (e: unknown): void => useGlobalError.getState().show(e);
