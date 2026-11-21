import { useState } from 'react';
import { libellePlus, tranche, type Tranche } from '../lib/borne';

export type Unite = { un: string; plusieurs: string; feminin?: boolean };

export const UNITES = {
  lignes: { un: 'ligne', plusieurs: 'lignes', feminin: true },
  documents: { un: 'document', plusieurs: 'documents' },
  dossiers: { un: 'dossier', plusieurs: 'dossiers' },
  blocs: { un: 'bloc', plusieurs: 'blocs' },
  evenements: { un: 'événement', plusieurs: 'événements' },
} satisfies Record<string, Unite>;

/**
 * Rendu borné d'une liste (voir lib/borne.ts) : `visibles` à rendre, `masques` restants,
 * `plus()` rend le paquet suivant, `assurer(n)` garantit que les `n` premiers sont rendus
 * (ex. après l'ajout d'une ligne à la fin d'un tableau).
 */
export function useBorne<T>(items: readonly T[], pas: number): Tranche<T> & { plus: () => void; assurer: (n: number) => void } {
  const [limite, setLimite] = useState(pas);
  return {
    ...tranche(items, limite),
    plus: () => setLimite((l) => l + pas),
    assurer: (n) => setLimite((l) => Math.max(l, n)),
  };
}

/** Bouton « Afficher N … de plus », rien si tout est rendu. Non imprimé. */
export function PlusDElements({ masques, pas, unite, onPlus }: { masques: number; pas: number; unite: Unite; onPlus: () => void }) {
  if (masques <= 0) return null;
  return (
    <button type="button" className="btn no-print" style={{ alignSelf: 'center' }} onClick={onPlus}>
      {libellePlus(masques, pas, unite)}
    </button>
  );
}
