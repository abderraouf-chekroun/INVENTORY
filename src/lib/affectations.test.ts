import { describe, expect, it } from 'vitest';
import type { Affectation, Entite } from '../api';
import { autreKind, libelleAffecter, messageRetrait, paireAffectation, repartirAffectations } from './affectations';

const employe: Entite = {
  id: 1, kind: 'a', nom: 'BENALI', code: 'BENSO-140590-TEC', libelle: 'BENALI Sofia', categorieId: 1, categorie: 'Division informatique',
  actif: true, creeLe: '', majLe: '', prenom: 'Sofia', dateNaissance: '1990-05-14', poste: 'Technicienne',
  marque: '', cpu: '', ram: '', stockage: '',
};
const machine: Entite = { ...employe, id: 2, kind: 'b', nom: 'PC Accueil 01', libelle: 'PC Accueil 01', code: 'PC-0412' };

const aff = (id: number, debut: string, fin: string | null): Affectation => ({ id, entite: machine, debut, fin });

describe('repartirAffectations', () => {
  it('sépare en cours et terminées, chacune de la plus récente à la plus ancienne', () => {
    const r = repartirAffectations([
      aff(1, '2024-01-01 10:00:00', '2024-06-01 10:00:00'),
      aff(2, '2025-03-01 09:00:00', null),
      aff(3, '2024-07-01 10:00:00', '2025-01-15 10:00:00'),
      aff(4, '2025-05-01 09:00:00', null),
    ]);
    expect(r.enCours.map((x) => x.id)).toEqual([4, 2]);
    expect(r.terminees.map((x) => x.id)).toEqual([3, 1]);
  });

  it('données absentes ou invalides : listes vides, sans plantage', () => {
    expect(repartirAffectations(undefined)).toEqual({ enCours: [], terminees: [] });
    expect(repartirAffectations([null, 3, { id: 1 }])).toEqual({ enCours: [], terminees: [] });
  });
});

describe('vocabulaire des affectations', () => {
  it('paire (employé, machine) quel que soit le côté affiché', () => {
    expect(paireAffectation(employe, machine)).toEqual([1, 2]);
    expect(paireAffectation(machine, employe)).toEqual([1, 2]);
    expect(autreKind('a')).toBe('b');
    expect(autreKind('b')).toBe('a');
  });

  it('libellés et message de retrait', () => {
    expect(libelleAffecter('a')).toBe('Affecter une machine');
    expect(libelleAffecter('b')).toBe('Affecter à un employé');
    expect(messageRetrait(employe, machine)).toMatch(/^L’affectation de PC Accueil 01 à BENALI Sofia prend fin aujourd’hui\./);
    expect(messageRetrait(machine, employe)).toBe(messageRetrait(employe, machine));
    expect(messageRetrait(employe, machine)).not.toMatch(/associ/i);
    // § 11.1 : un dossier ne relie plus deux fiches ; elles y sont nommées dans ses documents.
    expect(messageRetrait(employe, machine)).not.toMatch(/relient/);
    expect(messageRetrait(employe, machine)).toMatch(/Les documents et les dossiers où ces deux fiches sont nommées ne changent pas\.$/);
  });
});
