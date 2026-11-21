import { describe, expect, it } from 'vitest';
import { messageManquant, nomSansEtoile, premierManquant } from './formulaire';

describe('champs obligatoires d’un formulaire', () => {
  it('premierManquant : le premier champ obligatoire vide, espaces compris', () => {
    expect(premierManquant([
      { nom: 'Année', valeur: '2026', obligatoire: true },
      { nom: 'Employé', valeur: '', obligatoire: false },
      { nom: 'Nom', valeur: '   ', obligatoire: true },
      { nom: 'Catégorie', valeur: '', obligatoire: true },
    ])).toBe(2);
    expect(premierManquant([{ nom: 'Nom', valeur: 'x', obligatoire: true }])).toBe(-1);
    expect(premierManquant([])).toBe(-1);
  });

  it('un champ désactivé n’est jamais contrôlé', () => {
    expect(premierManquant([{ nom: 'Nom', valeur: '', obligatoire: true, inactif: true }])).toBe(-1);
  });

  it('nom et message, sans l’étoile', () => {
    expect(nomSansEtoile('Nom *')).toBe('Nom');
    expect(nomSansEtoile('  Date de\n naissance*  ')).toBe('Date de naissance');
    expect(messageManquant('Prénom*')).toBe('Remplissez le champ obligatoire « Prénom ».');
    expect(messageManquant('')).toBe('Remplissez les champs obligatoires.');
  });
});
