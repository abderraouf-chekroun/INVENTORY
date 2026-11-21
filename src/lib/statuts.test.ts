import { describe, expect, it } from 'vitest';
import type { StatutDossier } from '../api';
import {
  classeCouleur, COULEUR_LABEL, couleurDe, couleurProposee, estClos, estCouleur, estFourni, etatsOuverts, motifClotureImpossible,
  motifModificationImpossible, motifSuppressionStatut, nbDossiersDe, nbDossiersLabel, nomStatut, roleDe, statutDeRole,
} from './statuts';

const st = (id: number, nom: string, role: StatutDossier['role'], couleur: StatutDossier['couleur'], nbDossiers = 0): StatutDossier =>
  ({ id, nom, role, couleur, nbDossiers });
const cours = st(1, 'En cours', 'cours', 'ambre', 4);
const piece = st(2, 'Pièce manquante', 'piece', 'orange', 1);
const clos = st(3, 'Clôturé', 'clos', 'vert', 7);
const attente = st(4, 'En attente de livraison', 'perso', 'violet', 0);
const tous = [cours, piece, clos, attente];

describe('couleurs', () => {
  it('neuf couleurs nommées, toutes reconnues ; jamais une valeur piégée', () => {
    expect(Object.keys(COULEUR_LABEL)).toEqual(['gris', 'bleu', 'turquoise', 'vert', 'ambre', 'orange', 'rouge', 'rose', 'violet']);
    for (const c of Object.keys(COULEUR_LABEL)) expect(estCouleur(c)).toBe(true);
    for (const c of ['noir', '', '#ff0000', 'constructor', '__proto__', 3, null]) expect(estCouleur(c)).toBe(false);
  });

  it('couleur inconnue → gris ; classe CSS sans injection', () => {
    expect(couleurDe(attente)).toBe('violet');
    expect(couleurDe({ couleur: 'url(x)' })).toBe('gris');
    expect(couleurDe(null)).toBe('gris');
    expect(classeCouleur('rose')).toBe('st-rose');
    expect(classeCouleur('rose" onclick="x')).toBe('st-gris');
  });

  it('couleurProposee : la première de la palette encore libre', () => {
    expect(couleurProposee(tous)).toBe('gris');
    expect(couleurProposee([{ couleur: 'gris' }, { couleur: 'bleu' }])).toBe('turquoise');
    expect(couleurProposee(Object.keys(COULEUR_LABEL).map((couleur) => ({ couleur })))).toBe('bleu');
    expect(couleurProposee([])).toBe('gris');
  });
});

describe('rôles', () => {
  it('rôle inconnu → perso ; nom absent → « État inconnu »', () => {
    expect(roleDe(piece)).toBe('piece');
    expect(roleDe({ role: 'autre' })).toBe('perso');
    expect(roleDe(undefined)).toBe('perso');
    expect(nomStatut({ nom: '  ' })).toBe('État inconnu');
    expect(nomStatut(attente)).toBe('En attente de livraison');
  });

  it('états fournis, clôture, états ouverts', () => {
    expect(estFourni(cours)).toBe(true);
    expect(estFourni(attente)).toBe(false);
    expect(estClos(clos)).toBe(true);
    expect(estClos(piece)).toBe(false);
    expect(etatsOuverts(tous).map((s) => s.id)).toEqual([1, 2, 4]);
    expect(statutDeRole(tous, 'clos')).toBe(clos);
    expect(statutDeRole([attente], 'cours')).toBeUndefined();
  });
});

describe('motifs', () => {
  it('clôture interdite en « Pièce manquante » seulement', () => {
    expect(motifClotureImpossible(piece)).toMatch(/Pièce manquante/);
    expect(motifClotureImpossible(cours)).toBeNull();
    expect(motifClotureImpossible(attente)).toBeNull();
  });

  it('modification : impossible pour les états fournis', () => {
    expect(motifModificationImpossible(clos)).toMatch(/fourni/);
    expect(motifModificationImpossible(attente)).toBeNull();
  });

  it('suppression : fourni, ou porté par des dossiers (avec leur nombre)', () => {
    expect(motifSuppressionStatut(cours)).toMatch(/fourni/);
    expect(motifSuppressionStatut(attente)).toBeNull();
    expect(motifSuppressionStatut({ ...attente, nbDossiers: 3 })).toBe('3 dossiers sont dans cet état. Donnez-leur un autre état avant de le supprimer.');
    expect(motifSuppressionStatut({ ...attente, nbDossiers: 1 })).toBe('1 dossier est dans cet état. Donnez-lui un autre état avant de le supprimer.');
  });

  it('nombre de dossiers, lu prudemment', () => {
    expect(nbDossiersLabel(0)).toBe('Aucun dossier');
    expect(nbDossiersLabel(1)).toBe('1 dossier');
    expect(nbDossiersLabel(12)).toBe('12 dossiers');
    expect(nbDossiersLabel('4')).toBe('Aucun dossier');
    expect(nbDossiersDe({ nbDossiers: -2 })).toBe(0);
    expect(nbDossiersDe({ nbDossiers: 1.5 })).toBe(0);
    expect(nbDossiersDe(cours)).toBe(4);
  });
});
