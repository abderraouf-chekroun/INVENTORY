import { describe, expect, it } from 'vitest';
import { texteBandeau } from './bandeau';
import { messageSuppressionMotCle, nbDocumentsDe, nbDocumentsLabel } from './magasin';

describe('mots-clés du Magasin (1.8)', () => {
  it('nombre de documents lu prudemment', () => {
    expect(nbDocumentsDe({ nbDocuments: 3 })).toBe(3);
    expect(nbDocumentsDe({ nbDocuments: 0 })).toBe(0);
    expect(nbDocumentsDe({})).toBe(0);
    expect(nbDocumentsDe({ nbDocuments: '2' })).toBe(0);
    expect(nbDocumentsDe({ nbDocuments: -1 })).toBe(0);
    expect(nbDocumentsDe({ nbDocuments: 1.5 })).toBe(0);
  });

  it('libellé du nombre de documents', () => {
    expect(nbDocumentsLabel(0)).toBe('Choisi dans aucun document');
    expect(nbDocumentsLabel(1)).toBe('Choisi dans 1 document');
    expect(nbDocumentsLabel(3)).toBe('Choisi dans 3 documents');
  });

  it('confirmation de suppression : nombre réel et accords', () => {
    expect(messageSuppressionMotCle(3)).toBe(
      'Ce mot-clé est choisi dans 3 documents. Il y restera écrit, mais ne sera plus proposé. Cette action est irréversible.');
    expect(messageSuppressionMotCle(1)).toBe(
      'Ce mot-clé est choisi dans 1 document. Il y restera écrit, mais ne sera plus proposé. Cette action est irréversible.');
    expect(messageSuppressionMotCle(0)).toBe('Ce mot-clé n’est choisi dans aucun document. Cette action est irréversible.');
  });
});

describe('bandeau au-dessus du titre (1.8)', () => {
  it('« Module N » retiré, le reste gardé', () => {
    expect(texteBandeau('Module 4 · Dossier ouvert', 'Dossier 2026-01')).toBe('Dossier ouvert');
    expect(texteBandeau('Module 2 · Fiche', 'BENALI Sofia')).toBe('Fiche');
    expect(texteBandeau('Module 5 · Formulaire', 'Créer un dossier')).toBe('Formulaire');
    expect(texteBandeau('Module 5 · Studio de Modèles', 'Modèles de document')).toBe('Studio de Modèles');
    expect(texteBandeau('Dossier ouvert', 'Dossier 2026-01')).toBe('Dossier ouvert');
  });

  it('rien ne reste, ou le reste répète le titre : pas de bandeau', () => {
    expect(texteBandeau('Module 1', 'Tableau de bord')).toBeNull();
    expect(texteBandeau('Module 6 ·', 'Paramètres')).toBeNull();
    expect(texteBandeau('Module 5 · Magasin', 'Magasin')).toBeNull();
    expect(texteBandeau('magasin', ' Magasin ')).toBeNull();
    expect(texteBandeau(undefined, 'Magasin')).toBeNull();
    expect(texteBandeau('', 'Magasin')).toBeNull();
    expect(texteBandeau('   ', 'Magasin')).toBeNull();
  });

  it('titre non textuel : le bandeau reste', () => {
    expect(texteBandeau('Fiche', null)).toBe('Fiche');
  });
});
