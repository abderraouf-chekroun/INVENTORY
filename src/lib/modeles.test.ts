import { describe, expect, it } from 'vitest';
import { modeleApresSuppression, motifSuppressionModele, nbDocumentsDe, nbDocumentsLabel } from './modeles';

describe('suppression d’un modèle (§ 11.4)', () => {
  it('nombre de documents lu prudemment', () => {
    expect(nbDocumentsDe({ nbDocuments: 3 })).toBe(3);
    expect(nbDocumentsDe({ nbDocuments: 0 })).toBe(0);
    expect(nbDocumentsDe({ nbDocuments: -2 })).toBe(0);
    expect(nbDocumentsDe({ nbDocuments: '3' })).toBe(0);
    expect(nbDocumentsDe({})).toBe(0);
  });

  it('libellé du nombre de documents', () => {
    expect(nbDocumentsLabel(0)).toBe('Aucun document');
    expect(nbDocumentsLabel(1)).toBe('1 document');
    expect(nbDocumentsLabel(3)).toBe('3 documents');
  });

  it('motif : seulement si des documents viennent du modèle, avec leur nombre', () => {
    expect(motifSuppressionModele(0)).toBeNull();
    expect(motifSuppressionModele(1)).toBe('1 document a été créé à partir de ce modèle. Archivez-le si vous ne voulez plus l’utiliser.');
    expect(motifSuppressionModele(3)).toBe('3 documents ont été créés à partir de ce modèle. Archivez-le si vous ne voulez plus l’utiliser.');
  });

  it('modèle affiché ensuite : le suivant, sinon le précédent, sinon aucun', () => {
    const ms = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(modeleApresSuppression(ms, 1)).toBe(2);
    expect(modeleApresSuppression(ms, 2)).toBe(3);
    expect(modeleApresSuppression(ms, 3)).toBe(2);
    expect(modeleApresSuppression([{ id: 7 }], 7)).toBeUndefined();
    expect(modeleApresSuppression(ms, 99)).toBe(1);
    expect(modeleApresSuppression([], 1)).toBeUndefined();
  });
});
