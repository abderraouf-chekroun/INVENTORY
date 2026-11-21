import { describe, expect, it } from 'vitest';
import type { Entite } from '../api';
import {
  caracteristiques, categoryLabel, champsFiche, codeLabel, detailFiche, enumeration, formatDateHeure, kindLabel, lettres, libellesFiche,
  manquesEmploye, nomAffiche, pourComparer, texte,
} from './format';

describe('date et heure (§ 11.2 : moment d’une nomination)', () => {
  it('« JJ/MM/AAAA à HH:MM », la date seule sans heure, « — » si illisible', () => {
    expect(formatDateHeure('2026-05-14 09:30:12')).toBe('14/05/2026 à 09:30');
    expect(formatDateHeure('2026-05-14T17:05')).toBe('14/05/2026 à 17:05');
    expect(formatDateHeure('2026-05-14')).toBe('14/05/2026');
    expect(formatDateHeure('hier')).toBe('—');
    expect(formatDateHeure(null)).toBe('—');
  });
});

const employe: Entite = {
  id: 1, kind: 'a', nom: 'BENALI', code: 'BENSO-140590-TEC', libelle: 'BENALI Sofia', categorieId: 1, categorie: 'Division informatique',
  actif: true, creeLe: '', majLe: '', prenom: 'Sofia', dateNaissance: '1990-05-14', poste: 'Technicienne',
  marque: '', cpu: '', ram: '', stockage: '',
};
const machine: Entite = {
  ...employe, id: 2, kind: 'b', nom: 'PC Accueil 01', code: null, libelle: 'PC Accueil 01', categorie: 'PC de bureau',
  prenom: '', dateNaissance: null, poste: '', marque: 'Dell OptiPlex 7090', cpu: 'Intel Core i5', ram: '16 Go', stockage: '',
};

describe('vocabulaire', () => {
  it('libellés des répertoires et des catégories', () => {
    expect(kindLabel('a')).toBe('Employé');
    expect(kindLabel('b', true)).toBe('Machines');
    expect(categoryLabel('a')).toBe('Structure');
    expect(categoryLabel('b')).toBe('Type de machine');
  });

  it('codeLabel : identifiant tel quel, sinon « Fiche à compléter » (employé) ou « Sans identifiant » (machine)', () => {
    expect(codeLabel('PC-0412')).toBe('PC-0412');
    expect(codeLabel(null, 'a')).toBe('Fiche à compléter');
    expect(codeLabel(null, 'b')).toBe('Sans identifiant');
  });
});

describe('fiches', () => {
  it('nomAffiche : le libellé, sinon le nom', () => {
    expect(nomAffiche(employe)).toBe('BENALI Sofia');
    expect(nomAffiche({ nom: 'Ancien', libelle: '' })).toBe('Ancien');
    expect(nomAffiche({ nom: 'Ancien', libelle: undefined as unknown as string })).toBe('Ancien');
  });

  it('caractéristiques et détail d’une fiche, champs vides omis', () => {
    expect(caracteristiques(machine)).toBe('Intel Core i5 · 16 Go');
    expect(detailFiche(machine)).toBe('Dell OptiPlex 7090 · Intel Core i5 · 16 Go · PC de bureau');
    expect(detailFiche(employe)).toBe('Technicienne · Division informatique');
  });

  it('champsFiche : dans l’ordre des libellés, « — » pour une information vide', () => {
    expect(champsFiche(employe).map(([l]) => l)).toEqual(libellesFiche('a'));
    expect(champsFiche(machine)).toEqual([
      ['Nom', 'PC Accueil 01'], ['Identifiant', 'Sans identifiant'], ['Marque et modèle', 'Dell OptiPlex 7090'],
      ['Processeur', 'Intel Core i5'], ['RAM', '16 Go'], ['Stockage', '—'],
    ]);
  });
});

describe('identifiant d’un employé', () => {
  it('lettres : majuscules sans accents, A à Z seulement', () => {
    expect(lettres('Benali-Zoé d’Été')).toBe('BENALIZOEDETE');
    expect(lettres('  ')).toBe('');
  });

  it('manquesEmploye : ce qui empêche le calcul, dans l’ordre du formulaire', () => {
    expect(manquesEmploye({ nom: 'Benali', prenom: 'Sofia', dateNaissance: '1990-05-14', poste: 'Technicienne' })).toEqual([]);
    expect(manquesEmploye({ nom: 'Benali', prenom: '', dateNaissance: null, poste: '42' }))
      .toEqual(['le prénom', 'la date de naissance', 'le poste']);
    expect(manquesEmploye({ nom: '', prenom: 'S', dateNaissance: '14/05/1990', poste: 'T' })).toEqual(['le nom', 'la date de naissance']);
  });

  it('enumeration', () => {
    expect(enumeration([])).toBe('');
    expect(enumeration(['le nom'])).toBe('le nom');
    expect(enumeration(['a', 'b', 'c'])).toBe('a, b et c');
  });
});

describe('textes venus des données', () => {
  it('texte : une chaîne, sinon vide', () => {
    expect(texte('x')).toBe('x');
    expect(texte(3)).toBe('');
    expect(texte(null)).toBe('');
  });

  it('pourComparer : sans casse, sans accents, sans espaces autour', () => {
    expect(pourComparer('  Élodie ')).toBe('elodie');
  });
});
