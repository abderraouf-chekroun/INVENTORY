import { describe, expect, it } from 'vitest';
import type { BlocDocument, BlocModele, Entite } from '../../api';
import {
  basculerChoix, choisisDe, colonneEtroite, colonnes, colonnesBrutes, indexTitrePrincipal, dateSaisieComplete, entiteIdDe, estTypeBloc, formatDateBloc, grouperBlocs,
  iconeBloc, libelleBloc, lignesDe, nbColonnes, niveauTitre, nouveauBloc, optionsDe, PALETTE, pourEnregistrer, TYPES_BLOC,
  valeurDate, valeursExemple, valeursVariables, valeurVariable, variableCanonique, VARIABLES,
  BLOC_AIDE, estSigne, etatSignature, signer,
  blocRempli, estBlocDeSaisie, estObligatoire, marquerObligatoire, messageObligatoires, obligatoiresManquants,
  blocsFichierImporte, blocsLisibles,
} from './blocs';

const bloc = (b: Partial<BlocDocument> & { t: string }) => b as unknown as BlocDocument;

describe('signature (case « Signé »)', () => {
  it('état affiché', () => {
    expect(etatSignature(bloc({ t: 'signature', v: 'Visa' }))).toBe('Non signé');
    expect(etatSignature(bloc({ t: 'signature', v: 'Visa', ok: false, val: '2026-11-20' }))).toBe('Non signé');
    expect(etatSignature(bloc({ t: 'signature', v: 'Visa', ok: true, val: '2026-11-20' }))).toBe('Signé le 20/11/2026');
    expect(etatSignature(bloc({ t: 'signature', v: 'Visa', ok: true, val: '2026-11-20 09:30:00' }))).toBe('Signé le 20/11/2026');
    expect(etatSignature(bloc({ t: 'signature', v: 'Visa', ok: true }))).toBe('Signé');
    // Données inattendues : jamais de plantage.
    expect(etatSignature(bloc({ t: 'signature', v: 'Visa', ok: 'oui', val: 3 } as unknown as BlocDocument))).toBe('Non signé');
    expect(estSigne(bloc({ t: 'signature', ok: true }))).toBe(true);
  });

  it('cocher pose la date du jour, décocher l’efface ; une date existante est gardée', () => {
    const b = bloc({ t: 'signature', v: 'Visa du demandeur' });
    const coche = signer(b, true, '2026-11-20');
    expect(coche).toEqual({ t: 'signature', v: 'Visa du demandeur', ok: true, val: '2026-11-20' });
    expect(signer(coche, true, '2026-12-01').val).toBe('2026-11-20');
    const decoche = signer(coche, false, '2026-11-21');
    expect(decoche).toEqual({ t: 'signature', v: 'Visa du demandeur', ok: false });
    expect('val' in decoche).toBe(false);
  });

  it('l’aide du Studio ne parle plus d’un cadre à signer à la main', () => {
    expect(BLOC_AIDE.signature).toMatch(/Signé/);
    expect(BLOC_AIDE.signature).not.toMatch(/cadre|impression/i);
  });
});

describe('valeurVariable', () => {
  const vars = valeursExemple();

  it('variable connue : sa valeur', () => {
    expect(valeurVariable(vars, 'Employé · Identifiant')).toBe('EMP-7K3QX-9RT4M');
    expect(valeurVariable(vars, 'Machine · RAM')).toBe('16 Go');
  });

  it('anciens noms (version 1.0) : reconnus', () => {
    expect(valeurVariable(vars, 'Entité A · Nom')).toBe('BENALI');
    expect(valeurVariable(vars, 'Entité A · Code')).toBe('EMP-7K3QX-9RT4M');
    expect(valeurVariable(vars, 'Entité B · Nom')).toBe('PC Accueil 01');
    expect(valeurVariable(vars, 'Entité B · Code unique')).toBe('PC-0412');
  });

  it('variable inconnue : « — »', () => {
    expect(valeurVariable(vars, 'Variable inconnue')).toBe('—');
    expect(valeurVariable(vars, '')).toBe('—');
  });

  it('noms hérités du prototype (données piégées) : « — », jamais un objet ou une fonction', () => {
    for (const nom of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', '__defineGetter__']) {
      expect(valeurVariable(vars, nom)).toBe('—');
    }
  });

  it('valeur non textuelle : « — »', () => {
    expect(valeurVariable({ x: 42 } as unknown as Record<string, string>, 'x')).toBe('—');
  });

  it('les douze variables ont une valeur d’exemple', () => {
    expect(VARIABLES).toHaveLength(12);
    for (const v of VARIABLES) expect(valeurVariable(vars, v)).not.toBe('—');
  });

  it('variableCanonique : ancien nom → nouveau, sinon inchangé, jamais le prototype', () => {
    expect(variableCanonique('Entité A · Code')).toBe('Employé · Identifiant');
    expect(variableCanonique('Date du jour')).toBe('Date du jour');
    expect(variableCanonique('constructor')).toBe('constructor');
    expect(variableCanonique(42)).toBe('');
  });
});

describe('valeursVariables', () => {
  const base = {
    id: 1, kind: 'a', nom: 'BENALI', code: 'BENSO-140590-TEC', libelle: 'BENALI Sofia', categorieId: 1, categorie: 'Division informatique',
    actif: true, creeLe: '', majLe: '', prenom: 'Sofia', dateNaissance: '1990-05-14', poste: 'Technicienne', marque: '', cpu: '', ram: '', stockage: '',
  } satisfies Entite;
  const machine: Entite = { ...base, id: 2, kind: 'b', nom: 'PC 01', code: null, libelle: 'PC 01', prenom: '', dateNaissance: null, poste: '', marque: 'Dell', cpu: '', ram: '8 Go', stockage: '' };

  it('reprend l’employé, la machine et la date du document', () => {
    const v = valeursVariables(base, machine, '2026-11-20');
    expect(v['Employé · Prénom']).toBe('Sofia');
    expect(v['Employé · Structure']).toBe('Division informatique');
    expect(v['Machine · Marque et modèle']).toBe('Dell');
    expect(v['Machine · Identifiant']).toBe('Sans identifiant');
    expect(v['Machine · Processeur']).toBe('—');
    expect(v['Date du jour']).toBe('20/11/2026');
  });

  it('employé sans identifiant : « Fiche à compléter »', () => {
    expect(valeursVariables({ ...base, code: null }, machine, '2026-11-20')['Employé · Identifiant']).toBe('Fiche à compléter');
  });

  it('document sans employé ou sans machine choisi : « — »', () => {
    const sansA = valeursVariables(null, machine, '2026-11-20');
    expect(sansA['Employé · Nom']).toBe('—');
    expect(sansA['Employé · Identifiant']).toBe('—');
    expect(sansA['Machine · RAM']).toBe('8 Go');
    const sansRien = valeursVariables(null, null, '2026-11-20');
    for (const v of VARIABLES) if (v !== 'Date du jour') expect(sansRien[v]).toBe('—');
    expect(sansRien['Date du jour']).toBe('20/11/2026');
  });

  it('l’identifiant d’exemple ne révèle rien de l’employé (§ 10.5)', () => {
    expect(valeursExemple()['Employé · Identifiant']).toMatch(/^EMP-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
  });

  it('l’aide du Studio ne parle plus de l’employé ou de la machine du dossier (§ 11.1)', () => {
    expect(BLOC_AIDE.variable).not.toMatch(/dossier/i);
    expect(BLOC_AIDE.variable).toMatch(/premier bloc/);
  });
});

describe('blocs lisibles', () => {
  it('garde les objets, écarte le reste, sans erreur', () => {
    const b = bloc({ t: 'employe', v: 'Utilisateur', entiteId: 3 });
    expect(blocsLisibles([null, 3, 'employe', b])).toEqual([b]);
    expect(blocsLisibles('oups')).toEqual([]);
    expect(blocsLisibles(null)).toEqual([]);
  });
});

describe('fichier importé : « Employé concerné » et « Machine concernée » (§ 11.1)', () => {
  it('blocs reçus gardés, index du premier bloc de chaque sorte', () => {
    const recus = [bloc({ t: 'employe', v: 'Employé concerné', entiteId: 3 }), bloc({ t: 'machine', v: 'Machine concernée', entiteId: null })];
    expect(blocsFichierImporte(recus)).toEqual({ blocs: recus, a: 0, b: 1 });
  });

  it('blocs manquants ajoutés à la fin, vides, avec leur libellé', () => {
    expect(blocsFichierImporte(null)).toEqual({
      blocs: [
        { t: 'employe', v: 'Employé concerné', entiteId: null },
        { t: 'machine', v: 'Machine concernée', entiteId: null },
      ],
      a: 0, b: 1,
    });
    const seulMachine = blocsFichierImporte([bloc({ t: 'machine', v: 'Machine', entiteId: 7 })]);
    expect(seulMachine.a).toBe(1);
    expect(seulMachine.b).toBe(0);
    expect(seulMachine.blocs[1]).toEqual({ t: 'employe', v: 'Employé concerné', entiteId: null });
  });

  it('éléments illisibles écartés, sans erreur', () => {
    expect(blocsFichierImporte([3, null, 'x']).blocs.map((b) => b.t)).toEqual(['employe', 'machine']);
    expect(blocsFichierImporte('oups').a).toBe(0);
  });
});

describe('champs obligatoires (§ 10.6)', () => {
  it('estBlocDeSaisie : les dix blocs de saisie, jamais titre, texte, variable ni un type piégé', () => {
    for (const t of ['champ', 'zone', 'date', 'case', 'choix', 'tableau', 'magasin', 'employe', 'machine', 'signature']) expect(estBlocDeSaisie(t)).toBe(true);
    for (const t of ['titre', 'texte', 'variable', 'constructor', '__proto__', '', 3, null]) expect(estBlocDeSaisie(t)).toBe(false);
  });

  it('estObligatoire : seulement true, et seulement sur un bloc de saisie', () => {
    expect(estObligatoire(bloc({ t: 'champ', v: '', obligatoire: true }))).toBe(true);
    expect(estObligatoire(bloc({ t: 'champ', v: '' }))).toBe(false);
    expect(estObligatoire(bloc({ t: 'champ', v: '', obligatoire: 'oui' as unknown as boolean }))).toBe(false);
    expect(estObligatoire(bloc({ t: 'titre', v: '', obligatoire: true }))).toBe(false);
    expect(estObligatoire(null)).toBe(false);
  });

  it('marquerObligatoire : la propriété n’existe que si elle vaut true', () => {
    const b: BlocModele = { t: 'zone', v: 'Motifs' };
    expect(marquerObligatoire(b, true)).toEqual({ t: 'zone', v: 'Motifs', obligatoire: true });
    expect('obligatoire' in marquerObligatoire({ ...b, obligatoire: true }, false)).toBe(false);
    expect('obligatoire' in marquerObligatoire({ t: 'texte', v: '' }, true)).toBe(false);
  });

  it('pourEnregistrer : obligatoire gardé sur un bloc de saisie, retiré ailleurs', () => {
    expect(pourEnregistrer({ t: 'machine', v: 'PC', obligatoire: true }).obligatoire).toBe(true);
    expect('obligatoire' in pourEnregistrer({ t: 'titre', v: 'T', obligatoire: true })).toBe(false);
    expect('obligatoire' in pourEnregistrer({ t: 'champ', v: 'x', obligatoire: false })).toBe(false);
    expect(pourEnregistrer(bloc({ t: 'choix', v: '', options: ['a', ''], obligatoire: true }))).toEqual({ t: 'choix', v: '', options: ['a'], obligatoire: true });
  });

  it('blocRempli : selon le type de bloc', () => {
    expect(blocRempli(bloc({ t: 'champ', v: '', val: '  ' }))).toBe(false);
    expect(blocRempli(bloc({ t: 'champ', v: '', val: 'x' }))).toBe(true);
    expect(blocRempli(bloc({ t: 'magasin', v: '', val: 'Clavier' }))).toBe(true);
    expect(blocRempli(bloc({ t: 'date', v: '', heure: true, val: '2026-11-20' }))).toBe(false);
    expect(blocRempli(bloc({ t: 'date', v: '', val: '2026-11-20' }))).toBe(true);
    expect(blocRempli(bloc({ t: 'case', v: '', ok: false }))).toBe(false);
    expect(blocRempli(bloc({ t: 'signature', v: '', ok: true }))).toBe(true);
    expect(blocRempli(bloc({ t: 'choix', v: '', options: ['A', 'B'], choisis: ['Z'] }))).toBe(false);
    expect(blocRempli(bloc({ t: 'choix', v: '', options: ['A', 'B'], choisis: ['B'] }))).toBe(true);
    expect(blocRempli(bloc({ t: 'tableau', v: '', rows: [['', ' ']] }))).toBe(false);
    expect(blocRempli(bloc({ t: 'tableau', v: '', rows: [['', 'x']] }))).toBe(true);
    expect(blocRempli(bloc({ t: 'employe', v: '', entiteId: null }))).toBe(false);
    expect(blocRempli(bloc({ t: 'machine', v: '', entiteId: 7 }))).toBe(true);
  });

  it('obligatoiresManquants : index des blocs obligatoires vides, blocs illisibles ignorés', () => {
    const blocs = [
      { t: 'titre', v: 'T', obligatoire: true },
      { t: 'champ', v: 'a', obligatoire: true, val: '' },
      { t: 'champ', v: 'b', val: '' },
      null,
      { t: 'employe', v: 'c', obligatoire: true, entiteId: 3 },
      { t: 'tableau', v: '', obligatoire: true, rows: [] },
      'piège',
    ];
    expect(obligatoiresManquants(blocs)).toEqual([1, 5]);
    expect(obligatoiresManquants([])).toEqual([]);
  });

  it('messageObligatoires', () => {
    expect(messageObligatoires(0)).toBe('Tous les champs obligatoires sont remplis.');
    expect(messageObligatoires(1)).toBe('1 champ obligatoire reste à remplir.');
    expect(messageObligatoires(3)).toBe('3 champs obligatoires restent à remplir.');
  });
});

describe('types de bloc', () => {
  it('les treize types, tous dans la palette, chacun une fois', () => {
    expect(TYPES_BLOC).toHaveLength(13);
    const pal = PALETTE.flatMap((g) => g.types);
    expect([...pal].sort()).toEqual([...TYPES_BLOC].sort());
  });

  it('type inconnu ou piégé : jamais reconnu, libellé et icône de repli', () => {
    for (const t of ['inconnu', 'constructor', '__proto__', 'toString', '', 3, null]) {
      expect(estTypeBloc(t)).toBe(false);
      expect(libelleBloc(t)).toBe('Bloc non reconnu');
      expect(iconeBloc(t)).toBe('inconnu');
    }
    expect(estTypeBloc('signature')).toBe(true);
  });

  it('nouveauBloc : des valeurs par défaut valides', () => {
    for (const t of TYPES_BLOC) expect(nouveauBloc(t).t).toBe(t);
    expect(optionsDe(nouveauBloc('choix'))).toHaveLength(2);
    expect(colonnes(nouveauBloc('tableau'))).toEqual(['Colonne 1', 'Colonne 2', 'Colonne 3']);
    expect(niveauTitre(nouveauBloc('titre'))).toBe(1);
  });
});

describe('tableau', () => {
  it('sans en-têtes : 3 colonnes par défaut', () => {
    expect(nbColonnes(bloc({ t: 'tableau', v: '' }))).toBe(3);
    expect(colonnes(bloc({ t: 'tableau', v: '', cols: [] }))).toEqual(['Colonne 1', 'Colonne 2', 'Colonne 3']);
  });

  it('nombre de colonnes borné à 1..8, en-tête vide → « Colonne n »', () => {
    const cols = Array.from({ length: 12 }, (_, i) => `C${i}`);
    expect(nbColonnes(bloc({ t: 'tableau', v: '', cols }))).toBe(8);
    expect(colonnes(bloc({ t: 'tableau', v: '', cols: ['N°', ' ', 'Qté', 'Observations'] }))).toEqual(['N°', 'Colonne 2', 'Qté', 'Observations']);
  });

  it('en-têtes et lignes de mauvais type : du texte, jamais d’erreur', () => {
    const b = bloc({ t: 'tableau', v: '', cols: ['A', 5, null] as unknown as string[], rows: [['x', 2], 'pas une ligne', null] as unknown as string[][] });
    expect(colonnesBrutes(b)).toEqual(['A', '', '']);
    expect(lignesDe(b)).toEqual([['x', '', ''], ['', '', ''], ['', '', '']]);
    expect(lignesDe(bloc({ t: 'tableau', v: '', rows: 'x' as unknown as string[][] }))).toEqual([]);
  });
});

describe('liste d’options', () => {
  const unique = bloc({ t: 'choix', v: 'Demandeur', options: ['Intervenant informatique', 'Utilisateur'], multiple: false });
  const multiple = bloc({ t: 'choix', v: 'Besoin', options: ['Achat', 'Magasin', 'Prestation', 'Travaux'], multiple: true });

  it('options : textes non vides, sans doublon, 12 au plus', () => {
    expect(optionsDe(bloc({ t: 'choix', v: '', options: ['a', '', 'a', ' ', 'b', 4] as unknown as string[] }))).toEqual(['a', 'b']);
    expect(optionsDe(bloc({ t: 'choix', v: '', options: Array.from({ length: 20 }, (_, i) => `o${i}`) }))).toHaveLength(12);
    expect(optionsDe(bloc({ t: 'choix', v: '' }))).toEqual([]);
  });

  it('choisis : seulement des options du bloc, une seule pour un choix unique', () => {
    expect(choisisDe({ ...unique, choisis: ['Utilisateur', 'Intervenant informatique'] })).toEqual(['Intervenant informatique']);
    expect(choisisDe({ ...multiple, choisis: ['Travaux', 'Inconnue', 'Achat'] })).toEqual(['Achat', 'Travaux']);
    expect(choisisDe({ ...multiple, choisis: 'Achat' as unknown as string[] })).toEqual([]);
  });

  it('basculerChoix : unique remplace, multiple ajoute ou retire dans l’ordre des options', () => {
    expect(basculerChoix({ ...unique, choisis: ['Utilisateur'] }, 'Intervenant informatique', true)).toEqual(['Intervenant informatique']);
    expect(basculerChoix({ ...multiple, choisis: ['Travaux'] }, 'Achat', true)).toEqual(['Achat', 'Travaux']);
    expect(basculerChoix({ ...multiple, choisis: ['Achat', 'Travaux'] }, 'Achat', false)).toEqual(['Travaux']);
  });

  it('pourEnregistrer : les options laissées vides ne partent pas', () => {
    expect(pourEnregistrer(bloc({ t: 'choix', v: 'x', options: ['a', '', '  ', 'b'] })).options).toEqual(['a', 'b']);
    const champ = bloc({ t: 'champ', v: 'x' });
    expect(pourEnregistrer(champ)).toBe(champ);
  });
});

describe('date', () => {
  it('valeurDate : seulement le bon format selon l’heure', () => {
    expect(valeurDate(bloc({ t: 'date', v: '', val: '2026-11-20' }))).toBe('2026-11-20');
    expect(valeurDate(bloc({ t: 'date', v: '', heure: true, val: '2026-11-20' }))).toBe('');
    expect(valeurDate(bloc({ t: 'date', v: '', heure: true, val: '2026-11-20T09:30' }))).toBe('2026-11-20T09:30');
    expect(valeurDate(bloc({ t: 'date', v: '', val: 42 as unknown as string }))).toBe('');
  });

  it('dateSaisieComplete : refuse une année en cours de frappe', () => {
    expect(dateSaisieComplete('0002-11-20', false)).toBe(false);
    expect(dateSaisieComplete('2026-11-20', false)).toBe(true);
    expect(dateSaisieComplete('2026-11-20T08:05', true)).toBe(true);
    expect(dateSaisieComplete('2026-11-20', true)).toBe(false);
  });

  it('formatDateBloc', () => {
    expect(formatDateBloc('2026-11-20')).toBe('20/11/2026');
    expect(formatDateBloc('2026-11-20T08:05')).toBe('20/11/2026 à 08:05');
    expect(formatDateBloc('')).toBe('');
  });
});

describe('divers', () => {
  it('entiteIdDe : un entier positif, sinon null', () => {
    expect(entiteIdDe(bloc({ t: 'employe', v: '', entiteId: 4 }))).toBe(4);
    for (const x of [null, undefined, 0, -1, 1.5, '4']) expect(entiteIdDe(bloc({ t: 'employe', v: '', entiteId: x as number }))).toBeNull();
  });

  it('niveauTitre : 2 seulement si demandé', () => {
    expect(niveauTitre({ t: 'titre', v: '', niveau: 2 })).toBe(2);
    expect(niveauTitre({ t: 'titre', v: '', niveau: 7 as unknown as 1 })).toBe(1);
  });

  it('indexTitrePrincipal : premier titre de niveau 1, sinon la fin', () => {
    expect(indexTitrePrincipal([{ t: 'texte', v: '' }, { t: 'titre', v: '', niveau: 2 }, { t: 'titre', v: '' }])).toBe(2);
    expect(indexTitrePrincipal([{ t: 'texte', v: '' }, null])).toBe(2);
  });

  it('colonneEtroite : en-têtes courts', () => {
    expect(colonneEtroite('N°')).toBe(true);
    expect(colonneEtroite('Qté')).toBe(true);
    expect(colonneEtroite('Désignation')).toBe(false);
  });

  it('grouperBlocs : les signatures qui se suivent sont regroupées (éléments invalides tolérés)', () => {
    expect(grouperBlocs([null, { t: 'signature' }] as unknown as BlocModele[])).toEqual([{ t: 'seul', i: 0 }, { t: 'signatures', indices: [1] }]);
  });

  it('grouperBlocs : les signatures qui se suivent sont regroupées', () => {
    const blocs: BlocModele[] = [
      { t: 'titre', v: '' }, { t: 'signature', v: 'A' }, { t: 'signature', v: 'B' }, { t: 'texte', v: '' }, { t: 'signature', v: 'C' },
    ];
    expect(grouperBlocs(blocs)).toEqual([
      { t: 'seul', i: 0 }, { t: 'signatures', indices: [1, 2] }, { t: 'seul', i: 3 }, { t: 'signatures', indices: [4] },
    ]);
    expect(grouperBlocs([])).toEqual([]);
  });
});
