import { describe, expect, it } from 'vitest';
import { dossiersOuvertsVide, inventaireVide } from './tableauVide';

describe('tableau de bord sans ligne (§ 14)', () => {
  it('base vide : dit quoi faire, sans prétendre que tout est complet', () => {
    expect(inventaireVide('a', 0)).toBe('Aucun employé pour l’instant. Créez le premier depuis Employés, avec « Créer un employé ».');
    expect(inventaireVide('b', 0)).toBe('Aucune machine pour l’instant. Créez la première depuis Machines, avec « Créer une machine ».');
    expect(dossiersOuvertsVide(0)).toBe('Aucun dossier pour l’instant. Créez le premier depuis Dossiers & Archives, avec « Créer un dossier ».');
  });

  it('fiches ou dossiers existants : rien à compléter, rien d’ouvert', () => {
    expect(inventaireVide('a', 3)).toBe('Toutes les fiches des employés sont complètes.');
    expect(inventaireVide('b', 1)).toBe('Toutes les machines ont un identifiant.');
    expect(dossiersOuvertsVide(2)).toBe('Aucun dossier ouvert.');
  });
});
