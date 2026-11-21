import { describe, expect, it } from 'vitest';
import {
  basculerModele, compteAffiches, correspond, filtrerDocuments, filtrerEvenements, motsRecherche, textesDocument,
} from './filtrage';

const DOCS = [
  {
    id: 1, nom: 'Document_02', modeleNom: 'Fiche d’intervention informatique', dossierNom: 'Dossier 2026-03',
    champs: ['Utilisateur'], dateDoc: '2026-05-14', depuis: '2026-05-14 09:30:00',
  },
  {
    id: 2, nom: 'Boîte mail', modeleNom: 'Fiche d’identification', dossierNom: 'Dossier 2025-11',
    champs: ['Bénéficiaire', 'Observations'], dateDoc: '2025-11-02', depuis: '2026-01-08 10:00:00',
  },
  {
    id: 3, nom: 'scan.pdf', modeleNom: '', origine: 'import', dossierNom: 'Dossier 2026-03',
    champs: ['Employé concerné'], dateDoc: '2026-02-20', depuis: '2026-02-20 08:00:00',
  },
];
const ids = (xs: readonly { id: number }[]) => xs.map((x) => x.id);
const AUCUN = new Set<string>();

describe('mots de la recherche', () => {
  it('sans casse ni accents, découpés aux espaces', () => {
    expect(motsRecherche('  Fiche   d’INTERVENTION ')).toEqual(['fiche', 'd’intervention']);
    expect(motsRecherche('Bénéficiaire')).toEqual(['beneficiaire']);
    expect(motsRecherche('   ')).toEqual([]);
  });

  it('correspond : chaque mot dans au moins un texte', () => {
    expect(correspond(['Fiche d’intervention', '14/05/2026'], ['intervention', '2026'])).toBe(true);
    expect(correspond(['Fiche d’intervention'], ['intervention', '2025'])).toBe(false);
    expect(correspond([], [])).toBe(true);
  });
});

describe('documents où la fiche est nommée (§ 11.3)', () => {
  it('sans recherche ni filtre : tous, dans l’ordre reçu', () => {
    expect(ids(filtrerDocuments(DOCS, '', AUCUN))).toEqual([1, 2, 3]);
  });

  it('par nom du document, modèle, dossier ou champ, sans casse ni accents', () => {
    expect(ids(filtrerDocuments(DOCS, 'document_02', AUCUN))).toEqual([1]);
    expect(ids(filtrerDocuments(DOCS, 'identification', AUCUN))).toEqual([2]);
    expect(ids(filtrerDocuments(DOCS, 'dossier 2026-03', AUCUN))).toEqual([1, 3]);
    expect(ids(filtrerDocuments(DOCS, 'beneficiaire', AUCUN))).toEqual([2]);
    expect(ids(filtrerDocuments(DOCS, 'fichier importé', AUCUN))).toEqual([3]);
  });

  it('par date (JJ/MM/AAAA, une partie, ou l’année) : date du document ou de la nomination', () => {
    expect(ids(filtrerDocuments(DOCS, '14/05/2026', AUCUN))).toEqual([1]);
    expect(ids(filtrerDocuments(DOCS, '02/11/2025', AUCUN))).toEqual([2]);
    expect(ids(filtrerDocuments(DOCS, '2025', AUCUN))).toEqual([2]);
    expect(ids(filtrerDocuments(DOCS, '08/01/2026', AUCUN))).toEqual([2]);
  });

  it('plusieurs mots : tous doivent se retrouver', () => {
    expect(ids(filtrerDocuments(DOCS, 'intervention 2026', AUCUN))).toEqual([1]);
    expect(ids(filtrerDocuments(DOCS, 'intervention 2025', AUCUN))).toEqual([]);
  });

  it('filtres par modèle cumulables entre eux et avec la recherche', () => {
    const deux = new Set(['Fiche d’identification', 'Fichier importé']);
    expect(ids(filtrerDocuments(DOCS, '', new Set(['Fichier importé'])))).toEqual([3]);
    expect(ids(filtrerDocuments(DOCS, '', deux))).toEqual([2, 3]);
    expect(ids(filtrerDocuments(DOCS, '2026-03', deux))).toEqual([3]);
    expect(ids(filtrerDocuments(DOCS, 'intervention', deux))).toEqual([]);
  });

  it('données incomplètes ou de mauvais type : ne correspondent à rien, sans erreur', () => {
    const bizarre = [{ id: 9, nom: 4, champs: 'Utilisateur', dateDoc: null, depuis: undefined }];
    expect(ids(filtrerDocuments(bizarre, 'utilisateur', AUCUN))).toEqual([]);
    expect(ids(filtrerDocuments(bizarre, '', AUCUN))).toEqual([9]);
    expect(textesDocument({})).toEqual(['', 'Document', '', '—', '—']);
  });

  it('basculerModele : ajoute ou retire, sans modifier l’ensemble reçu', () => {
    const avant = new Set(['A']);
    const apres = basculerModele(avant, 'B');
    expect([...apres]).toEqual(['A', 'B']);
    expect([...basculerModele(apres, 'A')]).toEqual(['B']);
    expect([...avant]).toEqual(['A']);
  });

  it('compte affiché : « N sur M » seulement quand des documents sont masqués', () => {
    const u = { un: 'document', plusieurs: 'documents' };
    expect(compteAffiches(12, 12, u)).toBe('12 documents');
    expect(compteAffiches(3, 12, u)).toBe('3 sur 12 documents');
    expect(compteAffiches(0, 1, u)).toBe('0 sur 1 document');
  });
});

describe('historique d’une fiche (§ 11.3)', () => {
  const EV = [
    { id: 1, titre: 'Nommé dans Fiche d’intervention informatique : Document_02', detail: 'Champ « Utilisateur » · Dossier 2026-03', date: '2026-05-14 09:30:00', champ: 'Utilisateur' },
    { id: 2, titre: 'Affectation de PC Accueil 01', detail: '', date: '2025-09-01 08:00:00' },
    { id: 3, titre: 'Fiche modifiée', detail: 'Poste : Technicienne', date: '2026-01-02 11:00:00' },
  ];

  it('sur le titre, le détail et la date', () => {
    expect(ids(filtrerEvenements(EV, ''))).toEqual([1, 2, 3]);
    expect(ids(filtrerEvenements(EV, 'affectation'))).toEqual([2]);
    expect(ids(filtrerEvenements(EV, 'technicienne'))).toEqual([3]);
    expect(ids(filtrerEvenements(EV, 'utilisateur'))).toEqual([1]);
    expect(ids(filtrerEvenements(EV, '2026'))).toEqual([1, 3]);
    expect(ids(filtrerEvenements(EV, '01/09/2025'))).toEqual([2]);
    expect(ids(filtrerEvenements(EV, 'nomme 2025'))).toEqual([]);
  });

  it('sans recherche : une copie, dans l’ordre reçu', () => {
    const r = filtrerEvenements(EV, ' ');
    expect(r).toEqual(EV);
    expect(r).not.toBe(EV);
  });
});
