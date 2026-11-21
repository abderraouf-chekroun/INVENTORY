import { describe, expect, it } from 'vitest';
import { champsDe, faconsDe, libelleChamps, libelleFacon, libelleNomination, modeleNomDe, resumeParModele } from './citations';

describe('façons d’être nommé', () => {
  it('libellés simples, accordés au type de fiche', () => {
    expect(libelleFacon('bloc', 'a')).toBe('Choisi dans le document');
    expect(libelleFacon('bloc', 'b')).toBe('Choisie dans le document');
    expect(libelleFacon('texte', 'a')).toBe('Nom écrit dans le document');
    expect(libelleFacon('texte', 'b')).toBe('Identifiant écrit dans le document');
  });

  it('faconsDe : connues, sans doublon, dans l’ordre bloc, texte (l’ancienne façon « dossier » est ignorée)', () => {
    expect(faconsDe(['texte', 'bloc', 'texte', 'inconnue', 3, 'dossier'])).toEqual(['bloc', 'texte']);
    expect(faconsDe('bloc')).toEqual([]);
    expect(faconsDe(undefined)).toEqual([]);
  });
});

describe('champs et moment de la nomination (§ 11.2)', () => {
  it('champsDe : textes sans doublon, dans l’ordre reçu ; un champ sans libellé gardé une fois', () => {
    expect(champsDe({ champs: ['Utilisateur', 'Observations', 'Utilisateur', 4, null] })).toEqual(['Utilisateur', 'Observations']);
    expect(champsDe({ champs: ['', 'Utilisateur', ' '] })).toEqual(['', 'Utilisateur']);
    expect(champsDe({ champs: 'Utilisateur' })).toEqual([]);
    expect(champsDe({})).toEqual([]);
  });

  it('libelleChamps : au singulier ou au pluriel, entre guillemets ; champ sans libellé dit comme tel', () => {
    expect(libelleChamps(['Utilisateur'])).toBe('Champ « Utilisateur »');
    expect(libelleChamps(['Utilisateur', 'N°', 'Observations'])).toBe('Champs « Utilisateur », « N° » et « Observations »');
    expect(libelleChamps([''])).toBe('Champ sans libellé');
    expect(libelleChamps(['', 'Utilisateur'])).toBe('Champ « Utilisateur » et un champ sans libellé');
    expect(libelleChamps([])).toBe('');
  });

  it('libelleNomination : accordé, avec l’heure si elle est connue', () => {
    expect(libelleNomination('a', '2026-05-14 09:30:00')).toBe('Nommé le 14/05/2026 à 09:30');
    expect(libelleNomination('b', '2026-05-14')).toBe('Nommée le 14/05/2026');
    expect(libelleNomination('a', null)).toBe('');
    expect(libelleNomination('a', 'jamais')).toBe('');
  });
});

describe('modèle d’un document', () => {
  it('nom du modèle, sinon « Fichier importé » ou la source', () => {
    expect(modeleNomDe({ modeleNom: 'Fiche d’identification', origine: 'modele', source: 'x' })).toBe('Fiche d’identification');
    expect(modeleNomDe({ modeleNom: '', origine: 'import', source: 'scan.pdf' })).toBe('Fichier importé');
    expect(modeleNomDe({ origine: 'modele', source: 'Bon de prêt' })).toBe('Bon de prêt');
    expect(modeleNomDe({ modeleNom: 4 })).toBe('Document');
  });

  it('résumé par modèle : du plus fréquent au moins fréquent', () => {
    const docs = [
      { modeleNom: 'Fiche d’identification' },
      { modeleNom: 'Fiche d’intervention informatique' },
      { modeleNom: 'Fiche d’intervention informatique' },
      { modeleNom: '', origine: 'import' },
    ];
    expect(resumeParModele(docs)).toEqual([
      { nom: 'Fiche d’intervention informatique', n: 2 },
      { nom: 'Fiche d’identification', n: 1 },
      { nom: 'Fichier importé', n: 1 },
    ]);
    expect(resumeParModele([])).toEqual([]);
  });
});
