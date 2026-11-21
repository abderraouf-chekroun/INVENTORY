import { create } from 'zustand';
import { useNav } from '../nav/store';

/**
 * Message bref affiché par la coquille en haut de la page (« Employé « BENALI Sofia » supprimé. »), après une action
 * qui change de page. Il reste sur la page où il a été montré et disparaît à la page suivante ou par « Fermer ».
 */
interface AvisState {
  texte: string | null;
  /** Page (`seq` de la navigation) où le message est montré. */
  seq: number;
  effacer: () => void;
}

export const useAvis = create<AvisState>()((set) => ({
  texte: null,
  seq: -1,
  effacer: () => set({ texte: null }),
}));

/** Montre `texte` sur la page courante : à appeler juste APRÈS la navigation vers la page qui doit l'afficher. */
export function montrerAvis(texte: string): void {
  useAvis.setState({ texte, seq: useNav.getState().seq });
}

/** Changement de page : le message d'une autre page s'efface. */
export function avisSurPage(seq: number): void {
  const s = useAvis.getState();
  if (s.texte !== null && s.seq !== seq) s.effacer();
}
