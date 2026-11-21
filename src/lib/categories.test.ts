import { describe, expect, it } from 'vitest';
import {
  contenuCategorieLabel, motifSuppressionCategorie, motifSuppressionImpossible, nbContenuCategorie, nbFichesDe, nbFichesLabel,
} from './categories';

describe('catégories : nombre de fiches et suppression', () => {
  it('nombre de fiches lu prudemment', () => {
    expect(nbFichesDe({ nbFiches: 3 })).toBe(3);
    expect(nbFichesDe({ nbFiches: 0 })).toBe(0);
    expect(nbFichesDe({})).toBe(0);
    expect(nbFichesDe({ nbFiches: '4' })).toBe(0);
    expect(nbFichesDe({ nbFiches: -1 })).toBe(0);
  });

  it('libellé du nombre de fiches', () => {
    expect(nbFichesLabel('a', 0)).toBe('Aucun employé');
    expect(nbFichesLabel('a', 1)).toBe('1 employé');
    expect(nbFichesLabel('a', 3)).toBe('3 employés');
    expect(nbFichesLabel('b', 0)).toBe('Aucune machine');
    expect(nbFichesLabel('b', 2)).toBe('2 machines');
  });

  it('suppression : possible sans fiche, sinon expliquée', () => {
    expect(motifSuppressionImpossible('a', 0)).toBeNull();
    expect(motifSuppressionImpossible('b', 0)).toBeNull();
    expect(motifSuppressionImpossible('a', 3)).toBe(
      'Cette structure contient encore 3 employés. Déplacez-les dans une autre structure avant de la supprimer.');
    expect(motifSuppressionImpossible('a', 1)).toBe(
      'Cette structure contient encore 1 employé. Déplacez-le dans une autre structure avant de la supprimer.');
    expect(motifSuppressionImpossible('b', 1)).toBe(
      'Ce type de machine contient encore 1 machine. Déplacez-la dans un autre type de machine avant de le supprimer.');
    expect(motifSuppressionImpossible('b', 2)).toBe(
      'Ce type de machine contient encore 2 machines. Déplacez-les dans un autre type de machine avant de le supprimer.');
  });
});

describe('catégories des dossiers et des modèles (1.7)', () => {
  it('nombres lus prudemment', () => {
    expect(nbContenuCategorie({ nbDossiers: 3, nbModeles: 2 })).toEqual({ dossiers: 3, modeles: 2 });
    expect(nbContenuCategorie({})).toEqual({ dossiers: 0, modeles: 0 });
    expect(nbContenuCategorie({ nbDossiers: '1', nbModeles: -2 })).toEqual({ dossiers: 0, modeles: 0 });
  });

  it('libellé du contenu', () => {
    expect(contenuCategorieLabel(0, 0)).toBe('Aucun dossier ni modèle');
    expect(contenuCategorieLabel(3, 2)).toBe('3 dossiers · 2 modèles');
    expect(contenuCategorieLabel(1, 0)).toBe('1 dossier · aucun modèle');
    expect(contenuCategorieLabel(0, 4)).toBe('Aucun dossier · 4 modèles');
    expect(contenuCategorieLabel(1, 1)).toBe('1 dossier · 1 modèle');
  });

  it('suppression : possible si vide, sinon refus avec les nombres et les accords', () => {
    expect(motifSuppressionCategorie(0, 0)).toBeNull();
    expect(motifSuppressionCategorie(3, 2)).toBe(
      'Cette catégorie contient encore 3 dossiers et 2 modèles de document. Déplacez-les ou supprimez-les avant de la supprimer.');
    expect(motifSuppressionCategorie(1, 1)).toBe(
      'Cette catégorie contient encore 1 dossier et 1 modèle de document. Déplacez-les ou supprimez-les avant de la supprimer.');
    expect(motifSuppressionCategorie(1, 0)).toBe(
      'Cette catégorie contient encore 1 dossier. Déplacez-le ou supprimez-le avant de la supprimer.');
    expect(motifSuppressionCategorie(2, 0)).toBe(
      'Cette catégorie contient encore 2 dossiers. Déplacez-les ou supprimez-les avant de la supprimer.');
    expect(motifSuppressionCategorie(0, 1)).toBe(
      'Cette catégorie contient encore 1 modèle de document. Déplacez-le ou supprimez-le avant de la supprimer.');
    expect(motifSuppressionCategorie(0, 4)).toBe(
      'Cette catégorie contient encore 4 modèles de document. Déplacez-les ou supprimez-les avant de la supprimer.');
  });
});
