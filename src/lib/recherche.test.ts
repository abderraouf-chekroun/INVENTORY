import { describe, expect, it } from 'vitest';
import { noteGroupe, nomGroupe, titreGroupe, totalGroupe } from './recherche';

describe('groupes de la recherche globale', () => {
  it('total : jamais moins que les résultats reçus, valeur invalide ignorée', () => {
    expect(totalGroupe(50, 134)).toBe(134);
    expect(totalGroupe(12, 12)).toBe(12);
    expect(totalGroupe(12, 3)).toBe(12);
    expect(totalGroupe(7, undefined)).toBe(7);
    expect(totalGroupe(7, '99')).toBe(7);
  });

  it('titre et nom accessible annoncent le nombre de résultats', () => {
    expect(titreGroupe('Employés', 12, 12)).toBe('Employés · 12');
    expect(titreGroupe('Employés', 50, 134)).toBe('Employés · 50 sur 134');
    expect(nomGroupe('Machines', 1, 1)).toBe('Machines : 1 résultat');
    expect(nomGroupe('Dossiers', 50, 60)).toBe('Dossiers : 50 résultats affichés sur 60');
  });

  it('note : seulement quand il y en a davantage', () => {
    expect(noteGroupe(12, 12)).toBeNull();
    expect(noteGroupe(50, 51)).toBe('1 autre : précisez la recherche pour le voir.');
    expect(noteGroupe(50, 134)).toBe('84 autres : précisez la recherche pour les voir.');
  });
});
