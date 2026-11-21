import { describe, expect, it } from 'vitest';
import type { Entite } from '../../api';
import { FILTRES_INITIAUX, filtrer } from './filtres';

const base: Entite = {
  id: 1, kind: 'a', nom: 'BENALI', code: 'BENSO-140590-TEC', libelle: 'BENALI Sofia', categorieId: 1, categorie: 'Informatique',
  actif: true, creeLe: '', majLe: '', prenom: 'Sofia', dateNaissance: '1990-05-14', poste: 'Technicienne', marque: '', cpu: '', ram: '', stockage: '',
};
const employes: Entite[] = [
  base,
  { ...base, id: 2, nom: 'ÉLIAS', libelle: 'ÉLIAS Karim', prenom: 'Karim', poste: 'Ingénieur', code: null, categorie: 'Physique' },
  { ...base, id: 3, nom: 'AMRANI', libelle: 'AMRANI Lina', prenom: 'Lina', poste: 'Secrétaire', code: 'AMRLI-020288-SEC', actif: false },
];

const noms = (xs: Entite[]) => xs.map((x) => x.libelle);

describe('filtrer (répertoire)', () => {
  it('tri par nom affiché par défaut', () => {
    expect(noms(filtrer(employes, FILTRES_INITIAUX, ''))).toEqual(['AMRANI Lina', 'BENALI Sofia', 'ÉLIAS Karim']);
  });

  it('recherche sans casse ni accents : prénom, poste, identifiant', () => {
    expect(noms(filtrer(employes, { ...FILTRES_INITIAUX, code: 'elias' }, ''))).toEqual(['ÉLIAS Karim']);
    expect(noms(filtrer(employes, { ...FILTRES_INITIAUX, code: 'sofia' }, ''))).toEqual(['BENALI Sofia']);
    expect(noms(filtrer(employes, { ...FILTRES_INITIAUX, code: 'ingénieur' }, ''))).toEqual(['ÉLIAS Karim']);
    expect(noms(filtrer(employes, { ...FILTRES_INITIAUX, code: 'amrli' }, ''))).toEqual(['AMRANI Lina']);
  });

  it('fiches à compléter, statut, catégorie', () => {
    expect(noms(filtrer(employes, { ...FILTRES_INITIAUX, noid: true }, ''))).toEqual(['ÉLIAS Karim']);
    expect(noms(filtrer(employes, { ...FILTRES_INITIAUX, statut: 'archive' }, ''))).toEqual(['AMRANI Lina']);
    expect(noms(filtrer(employes, FILTRES_INITIAUX, 'Physique'))).toEqual(['ÉLIAS Karim']);
  });

  it('tri par identifiant : les fiches sans identifiant à la fin', () => {
    expect(noms(filtrer(employes, { ...FILTRES_INITIAUX, sort: 'code' }, ''))).toEqual(['AMRANI Lina', 'BENALI Sofia', 'ÉLIAS Karim']);
  });

  it('machines : recherche par marque', () => {
    const m: Entite = { ...base, id: 9, kind: 'b', nom: 'PC 01', libelle: 'PC 01', code: 'PC-0001', marque: 'Lenovo ThinkCentre', prenom: '', poste: '' };
    expect(filtrer([m], { ...FILTRES_INITIAUX, code: 'thinkc' }, '')).toHaveLength(1);
    expect(filtrer([m], { ...FILTRES_INITIAUX, code: 'sofia' }, '')).toHaveLength(0);
  });
});
