import { describe, expect, it } from 'vitest';
import type { StatutDossier } from '../api';
import {
  AVERTISSEMENT_SUPPRESSION_DOSSIER, effetsSuppressionDossier, identiteSuppressionDossier, messageDossierSupprime,
  NOM_CORBEILLE_DOSSIER, TITRE_SUPPRESSION_DOSSIER,
} from './suppression';

const enCours: StatutDossier = { id: 1, nom: 'En cours', couleur: 'bleu', role: 'cours', nbDossiers: 3 };
const vide = { nbSousDossiers: 0, nbDocuments: 0, nbFichiersImportes: 0, nbFichesNommees: 0 };

describe('suppression d’un dossier (§ 15) : titre, identité, message bref', () => {
  it('titre, bouton et corbeille', () => {
    expect(TITRE_SUPPRESSION_DOSSIER).toBe('Supprimer le dossier ?');
    expect(NOM_CORBEILLE_DOSSIER).toBe('Supprimer le dossier');
    expect(AVERTISSEMENT_SUPPRESSION_DOSSIER).toBe('Cette action est irréversible.');
  });

  it('identité : nom, catégorie, année et état', () => {
    expect(identiteSuppressionDossier({ nom: 'Dossier 2026-03', theme: 'Support informatique', annee: 2026, statut: enCours }))
      .toBe('Dossier « Dossier 2026-03 » · Support informatique · Année 2026 · En cours');
    const perso: StatutDossier = { id: 9, nom: 'Attente fournisseur', couleur: 'ambre', role: 'perso', nbDossiers: 1 };
    expect(identiteSuppressionDossier({ nom: 'Achats', theme: 'Achats', annee: 2025, statut: perso }))
      .toBe('Dossier « Achats » · Achats · Année 2025 · Attente fournisseur');
  });

  it('données incomplètes : jamais de « undefined »', () => {
    const d = { nom: undefined as unknown as string, theme: '', annee: Number.NaN, statut: null as unknown as StatutDossier };
    expect(identiteSuppressionDossier(d)).toBe('Dossier « Dossier sans nom » · État inconnu');
    expect(messageDossierSupprime({ nom: '  ' })).toBe('Dossier « Dossier sans nom » supprimé.');
  });

  it('message bref après la suppression', () => {
    expect(messageDossierSupprime({ nom: 'Dossier 2026-03' })).toBe('Dossier « Dossier 2026-03 » supprimé.');
  });
});

describe('suppression d’un dossier (§ 15) : effets et accords', () => {
  it('dossier vide', () => {
    expect(effetsSuppressionDossier(vide, false)).toEqual(['Ce dossier est vide.']);
  });

  it('documents et sous-dossiers, au pluriel et au singulier', () => {
    expect(effetsSuppressionDossier({ ...vide, nbDocuments: 7, nbSousDossiers: 2 }, false))
      .toEqual(['Ses 7 documents et ses 2 sous-dossiers seront supprimés.']);
    expect(effetsSuppressionDossier({ ...vide, nbDocuments: 1, nbSousDossiers: 1 }, false))
      .toEqual(['Son document et son sous-dossier seront supprimés.']);
    expect(effetsSuppressionDossier({ ...vide, nbDocuments: 1, nbSousDossiers: 3 }, false))
      .toEqual(['Son document et ses 3 sous-dossiers seront supprimés.']);
    expect(effetsSuppressionDossier({ ...vide, nbDocuments: 4, nbSousDossiers: 1 }, false))
      .toEqual(['Ses 4 documents et son sous-dossier seront supprimés.']);
    expect(effetsSuppressionDossier({ ...vide, nbDocuments: 1 }, false)).toEqual(['Son document sera supprimé.']);
    expect(effetsSuppressionDossier({ ...vide, nbDocuments: 5 }, false)).toEqual(['Ses 5 documents seront supprimés.']);
    expect(effetsSuppressionDossier({ ...vide, nbSousDossiers: 1 }, false))
      .toEqual(['Son sous-dossier sera supprimé ; il ne contient aucun document.']);
    expect(effetsSuppressionDossier({ ...vide, nbSousDossiers: 2 }, false))
      .toEqual(['Ses 2 sous-dossiers seront supprimés ; ils ne contiennent aucun document.']);
  });

  it('copies des fichiers importés, seulement s’il y en a', () => {
    expect(effetsSuppressionDossier({ ...vide, nbDocuments: 3, nbFichiersImportes: 3 }, false))
      .toEqual(['Ses 3 documents seront supprimés.', 'Les copies de ses 3 fichiers importés seront supprimées.']);
    expect(effetsSuppressionDossier({ ...vide, nbDocuments: 1, nbFichiersImportes: 1 }, false))
      .toEqual(['Son document sera supprimé.', 'La copie de son fichier importé sera supprimée.']);
  });

  it('fiches nommées : leurs fiches ne sont pas supprimées', () => {
    expect(effetsSuppressionDossier({ nbDocuments: 7, nbSousDossiers: 2, nbFichiersImportes: 3, nbFichesNommees: 4 }, false)).toEqual([
      'Ses 7 documents et ses 2 sous-dossiers seront supprimés.',
      'Les copies de ses 3 fichiers importés seront supprimées.',
      '4 employés ou machines y sont nommés : ces documents disparaîtront de leur profil. Leurs fiches ne sont pas supprimées.',
    ]);
    expect(effetsSuppressionDossier({ ...vide, nbDocuments: 1, nbFichesNommees: 1 }, false)).toEqual([
      'Son document sera supprimé.',
      '1 employé ou machine y est nommé : ce document disparaîtra de son profil. Sa fiche n’est pas supprimée.',
    ]);
    expect(effetsSuppressionDossier({ ...vide, nbDocuments: 2, nbFichesNommees: 1 }, false)[1])
      .toBe('1 employé ou machine y est nommé : ces documents disparaîtront de son profil. Sa fiche n’est pas supprimée.');
  });

  it('dossier clôturé : une ligne de plus, à la fin', () => {
    expect(effetsSuppressionDossier({ ...vide, nbDocuments: 2 }, true)).toEqual(['Ses 2 documents seront supprimés.', 'Ce dossier est clôturé.']);
    expect(effetsSuppressionDossier(vide, true)).toEqual(['Ce dossier est vide.', 'Ce dossier est clôturé.']);
  });

  it('aperçu incomplet ou invalide : lu comme zéro, jamais « NaN » ni « undefined »', () => {
    expect(effetsSuppressionDossier({}, false)).toEqual(['Ce dossier est vide.']);
    const bizarre = { nbDocuments: -2, nbSousDossiers: Number.NaN, nbFichiersImportes: '3' as unknown as number, nbFichesNommees: 2.7 };
    expect(effetsSuppressionDossier(bizarre, false)).toEqual(['Ce dossier est vide.']);
    expect(effetsSuppressionDossier({ ...bizarre, nbDocuments: 1.9 }, false)).toEqual([
      'Son document sera supprimé.',
      '2 employés ou machines y sont nommés : ce document disparaîtra de leur profil. Leurs fiches ne sont pas supprimées.',
    ]);
  });
});
