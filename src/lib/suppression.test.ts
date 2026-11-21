import { describe, expect, it } from 'vitest';
import { entiteDeFicheSupprimee, fichesDesVariables, type BlocDocument, type FicheSupprimee } from '../api';
import {
  aUneCopie, avertissementSuppression, blocAvecFiche, effetsSuppression, ficheSupprimeeDe, identiteSuppression, messageFicheSupprimee,
  messageSuppressionDocument, nomFicheSupprimee, texteFicheSupprimee, titreSuppressionFiche,
} from './suppression';

/** Espaces insécables à l'intérieur des guillemets, comme les écrit effetsSuppression. */
const ins = (s: string) => s.replace(/« /g, '«\u00a0').replace(/ »/g, '\u00a0»');

const apercuVide = { affectationEnCours: null, affectationsEnCours: [], nbAffectationsPassees: 0, nbDocuments: 0, nbDossiers: 0 };

describe('suppression d’un document (§ 13.1)', () => {
  it('nomme le document et son dossier, et finit par « Cette action est irréversible. »', () => {
    expect(messageSuppressionDocument({ nom: 'Document_02', origine: 'modele', fichierChemin: null }, 'Dossier 2025-01'))
      .toBe('Le document « Document_02 » du dossier « Dossier 2025-01 » sera supprimé. Cette action est irréversible.');
  });

  it('précise le cas du fichier importé : sa copie est supprimée', () => {
    const importe = { nom: 'Facture.pdf', origine: 'import' as const, fichierChemin: 'C:\\donnees\\fichiers\\1.pdf' };
    expect(aUneCopie(importe)).toBe(true);
    expect(messageSuppressionDocument(importe, 'Achats'))
      .toBe('Le document « Facture.pdf » du dossier « Achats » sera supprimé, ainsi que sa copie du fichier importé. Cette action est irréversible.');
    // Import sans copie valide : rien à dire sur la copie.
    expect(aUneCopie({ origine: 'import', fichierChemin: null })).toBe(false);
    expect(messageSuppressionDocument({ ...importe, fichierChemin: null }, 'Achats')).not.toContain('copie');
  });

  it('données incomplètes : jamais de « undefined »', () => {
    const m = messageSuppressionDocument({ nom: undefined as unknown as string, origine: 'modele', fichierChemin: null }, '');
    expect(m).toBe('Le document « Document sans nom » sera supprimé. Cette action est irréversible.');
  });
});

describe('suppression d’un employé ou d’une machine (§ 13.2) : textes et accords', () => {
  const sofia = { kind: 'a' as const, libelle: 'BENALI Sofia', nom: 'BENALI', code: 'EMP-7K2QX-M9D3F' };
  const pc = { kind: 'b' as const, libelle: 'PC Accueil 01', nom: 'PC Accueil 01', code: null };

  it('titre, identité et message bref, accordés au masculin (employé) et au féminin (machine)', () => {
    expect(titreSuppressionFiche('a')).toBe('Supprimer l’employé ?');
    expect(titreSuppressionFiche('b')).toBe('Supprimer la machine ?');
    expect(identiteSuppression(sofia)).toBe('Employé « BENALI Sofia » · EMP-7K2QX-M9D3F');
    expect(identiteSuppression(pc)).toBe('Machine « PC Accueil 01 » · sans identifiant');
    expect(messageFicheSupprimee(sofia)).toBe('Employé « BENALI Sofia » supprimé.');
    expect(messageFicheSupprimee(pc)).toBe('Machine « PC Accueil 01 » supprimée.');
  });

  it('rien d’affecté ni de nommé', () => {
    expect(effetsSuppression('a', apercuVide)).toEqual(['Cet employé n’est nommé dans aucun document.']);
    expect(effetsSuppression('b', apercuVide)).toEqual(['Cette machine n’est nommée dans aucun document.']);
  });

  it('affectation en cours : la phrase dépend du côté supprimé et du nombre', () => {
    const une = { ...apercuVide, affectationEnCours: { id: 7, nom: 'PC Accueil 01' }, affectationsEnCours: [{ id: 7, nom: 'PC Accueil 01' }] };
    expect(effetsSuppression('a', une)[0]).toBe(ins('L’affectation de la machine « PC Accueil 01 » à cet employé prendra fin.'));
    const deux = { ...apercuVide, affectationEnCours: { id: 7, nom: 'PC 01' }, affectationsEnCours: [{ id: 7, nom: 'PC 01' }, { id: 8, nom: 'PC 02' }] };
    expect(effetsSuppression('a', deux)[0]).toBe(ins('Les affectations des machines « PC 01 » et « PC 02 » à cet employé prendront fin.'));
    // Une machine peut rester affectée à d'autres employés : la phrase ne prétend jamais qu'elle ne le sera plus à personne.
    expect(effetsSuppression('a', deux).join(' ')).not.toContain('personne');
    const employe = { ...apercuVide, affectationEnCours: { id: 3, nom: 'BENALI Sofia' }, affectationsEnCours: [{ id: 3, nom: 'BENALI Sofia' }] };
    expect(effetsSuppression('b', employe)[0]).toBe(ins('L’employé « BENALI Sofia » n’aura plus cette machine.'));
    const trois = { ...apercuVide, affectationsEnCours: [{ id: 1, nom: 'A' }, { id: 2, nom: 'B' }, { id: 3, nom: 'C' }] };
    expect(effetsSuppression('b', trois)[0]).toBe(ins('Les employés « A », « B » et « C » n’auront plus cette machine.'));
  });

  it('noms entre guillemets : espaces insécables, aucun guillemet seul en bout de ligne', () => {
    const deux = { ...apercuVide, affectationsEnCours: [{ id: 7, nom: 'PC partagé v15' }, { id: 8, nom: 'PC v15' }] };
    for (const k of ['a', 'b'] as const) {
      const t = effetsSuppression(k, deux)[0];
      expect(t).not.toMatch(/« | »/);
      expect(t).toContain('«\u00a0PC partagé v15\u00a0»');
    }
  });

  it('sans la liste (contrat minimal), la seule affectation en cours suffit', () => {
    const seule = { affectationEnCours: { id: 7, nom: 'PC 01' }, nbAffectationsPassees: 0, nbDocuments: 0, nbDossiers: 0 };
    expect(effetsSuppression('a', seule)[0]).toContain('«\u00a0PC 01\u00a0»');
  });

  it('affectations passées : singulier et pluriel', () => {
    expect(effetsSuppression('a', { ...apercuVide, nbAffectationsPassees: 1 })).toContain('Son affectation passée disparaîtra de son historique.');
    expect(effetsSuppression('a', { ...apercuVide, nbAffectationsPassees: 3 })).toContain('Ses 3 affectations passées disparaîtront de son historique.');
    expect(effetsSuppression('a', apercuVide).join(' ')).not.toContain('affectation');
  });

  it('documents et dossiers : nombres réels, singulier et pluriel, masculin et féminin', () => {
    expect(effetsSuppression('a', { ...apercuVide, nbDocuments: 4, nbDossiers: 2 })).toEqual([
      'Cet employé est nommé dans 4 documents de 2 dossiers. Son nom reste écrit dans ces 4 documents, mais ils ne mèneront plus à sa fiche.',
    ]);
    expect(effetsSuppression('b', { ...apercuVide, nbDocuments: 3, nbDossiers: 1 })).toEqual([
      'Cette machine est nommée dans 3 documents d’un même dossier. Son nom reste écrit dans ces 3 documents, mais ils ne mèneront plus à sa fiche.',
    ]);
    expect(effetsSuppression('b', { ...apercuVide, nbDocuments: 1, nbDossiers: 1 })).toEqual([
      'Cette machine est nommée dans 1 document. Son nom reste écrit dans ce document, mais il ne mènera plus à sa fiche.',
    ]);
  });

  it('nombres illisibles : traités comme zéro', () => {
    const bizarre = { ...apercuVide, nbAffectationsPassees: -2, nbDocuments: Number.NaN, nbDossiers: 'x' as unknown as number };
    expect(effetsSuppression('a', bizarre)).toEqual(['Cet employé n’est nommé dans aucun document.']);
  });

  it('avertissement : « archivez-la plutôt » seulement pour une fiche active', () => {
    expect(avertissementSuppression(true))
      .toBe('Son historique sera supprimé. Cette action est irréversible. Pour garder la fiche et son historique, archivez-la plutôt.');
    expect(avertissementSuppression(false)).toBe('Son historique sera supprimé. Cette action est irréversible.');
  });
});

describe('bloc dont la fiche a été supprimée (§ 13.2, effet 2)', () => {
  const copie: FicheSupprimee = {
    kind: 'a', nom: 'BENALI', code: 'EMP-7K2QX-M9D3F', libelle: 'BENALI Sofia', categorie: 'Support', prenom: 'Sofia',
    dateNaissance: '1990-05-14', poste: 'Technicienne', marque: '', cpu: '', ram: '', stockage: '', supprimeeLe: '2026-11-20 10:00:00',
  };
  const orphelin: BlocDocument = { t: 'employe', v: 'Utilisateur', entiteId: null, ficheSupprimee: copie };

  it('est reconnu seulement sans fiche choisie et pour le bon répertoire', () => {
    expect(ficheSupprimeeDe(orphelin, 'a')).toBe(copie);
    expect(ficheSupprimeeDe(orphelin, 'b')).toBeNull();
    expect(ficheSupprimeeDe({ ...orphelin, entiteId: 12 }, 'a')).toBeNull();
    expect(ficheSupprimeeDe({ t: 'employe', v: 'Utilisateur', entiteId: null }, 'a')).toBeNull();
    expect(ficheSupprimeeDe({ ...orphelin, ficheSupprimee: 'x' as unknown as FicheSupprimee }, 'a')).toBeNull();
    expect(ficheSupprimeeDe({ ...orphelin, ficheSupprimee: { ...copie, libelle: '', nom: ' ' } }, 'a')).toBeNull();
  });

  it('s’affiche en texte : nom, identifiant, mention « fiche supprimée »', () => {
    expect(nomFicheSupprimee(copie)).toBe('BENALI Sofia');
    expect(texteFicheSupprimee(copie)).toBe('BENALI Sofia · EMP-7K2QX-M9D3F · fiche supprimée');
    expect(texteFicheSupprimee({ libelle: '', nom: 'PC 01', code: null })).toBe('PC 01 · Sans identifiant · fiche supprimée');
  });

  it('choisir une autre fiche remplace la copie ; « Retirer » ne vide que le choix', () => {
    const choisi = blocAvecFiche(orphelin, 42);
    expect(choisi.entiteId).toBe(42);
    expect('ficheSupprimee' in choisi).toBe(false);
    expect(ficheSupprimeeDe(choisi, 'a')).toBeNull();
    expect(blocAvecFiche({ t: 'employe', v: 'Utilisateur', entiteId: 42 }, null)).toEqual({ t: 'employe', v: 'Utilisateur', entiteId: null });
    // Le bloc d'origine n'est pas modifié.
    expect(orphelin.ficheSupprimee).toBe(copie);
  });

  it('les variables du document gardent les valeurs de la fiche supprimée, qui ne mène nulle part (id 0)', () => {
    const { a } = fichesDesVariables([orphelin], []);
    expect(a).toEqual(entiteDeFicheSupprimee(copie));
    expect(a?.id).toBe(0);
    expect(a?.actif).toBe(false);
  });
});
