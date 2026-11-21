import { describe, expect, it } from 'vitest';
import { libellePlus, tranche } from './borne';

describe('tranche', () => {
  it('liste courte : tout est rendu', () => {
    const xs = [1, 2, 3];
    expect(tranche(xs, 10)).toEqual({ visibles: xs, masques: 0 });
  });

  it('liste géante : préfixe borné', () => {
    const xs = Array.from({ length: 1_000_000 }, (_, i) => i);
    const t = tranche(xs, 200);
    expect(t.visibles).toHaveLength(200);
    expect(t.visibles[199]).toBe(199);
    expect(t.masques).toBe(999_800);
  });

  it('limite invalide : rien de rendu plutôt qu’une erreur', () => {
    expect(tranche([1, 2], -5)).toEqual({ visibles: [], masques: 2 });
  });
});

describe('libellePlus', () => {
  it('accorde et borne le lot', () => {
    const lignes = { un: 'ligne', plusieurs: 'lignes', feminin: true };
    expect(libellePlus(1500, 200, lignes)).toBe(`Afficher 200 lignes de plus (${(1500).toLocaleString('fr-FR')} non affichées)`);
    expect(libellePlus(1, 200, lignes)).toBe('Afficher 1 ligne de plus (1 non affichée)');
    expect(libellePlus(3, 200, { un: 'document', plusieurs: 'documents' })).toBe('Afficher 3 documents de plus (3 non affichés)');
  });
});
