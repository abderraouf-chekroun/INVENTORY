import type {
  BlocDocument, DocumentFichier, DossierResume, DossierSuppressionApercu, Entite, FicheSupprimee, Kind, SuppressionApercu,
} from '../api';
import { nomAffiche, texte } from './format';
import { nomStatut } from './statuts';

/*
 * Suppression directe (spécification § 13) : textes des confirmations, accords, et lecture prudente des données
 * laissées par une fiche supprimée (blocs de document). Aucune de ces fonctions n'appelle le back.
 */

/** Explication d'une action indisponible dans un dossier clôturé (§ 10.1, § 13.1). */
export const LECTURE_SEULE = 'Rouvrez le dossier pour le modifier.';

// ---------------------------------------------------------------- documents (§ 13.1)

/** Ce qu'il faut savoir d'un document pour confirmer sa suppression. */
export type DocumentASupprimer = Pick<DocumentFichier, 'id' | 'nom' | 'origine' | 'fichierChemin'>;

/** Vrai si supprimer le document supprime aussi la copie d'un fichier importé (dans `fichiers/`). */
export const aUneCopie = (d: Pick<DocumentFichier, 'origine' | 'fichierChemin'>): boolean =>
  d.origine === 'import' && typeof d.fichierChemin === 'string' && d.fichierChemin !== '';

/**
 * Message de la confirmation : nomme le document et son dossier, précise le cas du fichier importé (sa copie est
 * supprimée), puis « Cette action est irréversible. ».
 */
export function messageSuppressionDocument(d: Pick<DocumentFichier, 'nom' | 'origine' | 'fichierChemin'>, dossierNom: string): string {
  const nom = texte(d.nom).trim() || 'Document sans nom';
  const dossier = texte(dossierNom).trim();
  const ou = dossier ? ` du dossier « ${dossier} »` : '';
  const copie = aUneCopie(d) ? ', ainsi que sa copie du fichier importé' : '';
  return `Le document « ${nom} »${ou} sera supprimé${copie}. Cette action est irréversible.`;
}

// ---------------------------------------------------------------- employés et machines (§ 13.2)

/** « employé » / « machine » accordés : masculin pour un employé, féminin pour une machine. */
const accord = (kind: Kind, masculin: string, feminin: string): string => (kind === 'a' ? masculin : feminin);

/** Titre de la fenêtre : « Supprimer l’employé ? » / « Supprimer la machine ? ». */
export const titreSuppressionFiche = (kind: Kind): string => accord(kind, 'Supprimer l’employé ?', 'Supprimer la machine ?');

/** Identifiant affiché dans la confirmation : l'identifiant, sinon « sans identifiant ». */
export const identifiantPourSuppression = (code: string | null | undefined): string => texte(code).trim() || 'sans identifiant';

/** Ligne d'identité : « Employé « BENALI Sofia » · EMP-… » / « Machine « PC Accueil 01 » · sans identifiant ». */
export function identiteSuppression(e: Pick<Entite, 'kind' | 'libelle' | 'nom' | 'code'>): string {
  return `${accord(e.kind, 'Employé', 'Machine')} « ${nomAffiche(e)} » · ${identifiantPourSuppression(e.code)}`;
}

const nombre = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/** Affectations en cours de l'aperçu, lues prudemment (liste, sinon la seule `affectationEnCours`). */
function enCoursDe(a: Partial<SuppressionApercu>): { id: number; nom: string }[] {
  const liste: unknown = a.affectationsEnCours;
  const lues = Array.isArray(liste)
    ? (liste as unknown[]).filter((x): x is { id: number; nom: string } => typeof x === 'object' && x !== null && texte((x as { nom?: unknown }).nom).trim() !== '')
    : [];
  if (lues.length) return lues;
  const seule = a.affectationEnCours;
  return seule && texte(seule.nom).trim() ? [seule] : [];
}

/**
 * « « A » », « « A » et « B » », « « A », « B » et « C » ». Espaces insécables à l'intérieur des guillemets : un
 * guillemet ne reste jamais seul en fin ou en début de ligne quand la phrase passe à la ligne.
 */
function noms(xs: readonly { nom: string }[]): string {
  const q = xs.map((x) => `« ${texte(x.nom).trim()} »`);
  return q.length <= 1 ? q.join('') : `${q.slice(0, -1).join(', ')} et ${q[q.length - 1]}`;
}

/**
 * Ce que la suppression va faire, phrase par phrase, avec les nombres réels de l'aperçu (§ 13.2) :
 * affectation(s) en cours terminée(s), affectations passées effacées, documents et dossiers où la fiche est nommée.
 * Les accords suivent le nombre et le genre (employé : masculin ; machine : féminin).
 */
export function effetsSuppression(kind: Kind, a: Partial<SuppressionApercu>): string[] {
  const out: string[] = [];
  const enCours = enCoursDe(a);
  if (enCours.length) {
    if (kind === 'a') {
      // Employé supprimé : ses affectations en cours prennent fin. Une machine peut rester affectée à d'autres employés :
      // la phrase ne dit donc rien de ce que devient la machine, seulement que l'affectation à cet employé se termine.
      out.push(enCours.length === 1
        ? `L’affectation de la machine ${noms(enCours)} à cet employé prendra fin.`
        : `Les affectations des machines ${noms(enCours)} à cet employé prendront fin.`);
    } else {
      // Machine supprimée : chaque employé à qui elle est affectée (il peut y en avoir plusieurs) la perd.
      out.push(enCours.length === 1
        ? `L’employé ${noms(enCours)} n’aura plus cette machine.`
        : `Les employés ${noms(enCours)} n’auront plus cette machine.`);
    }
  }
  const passees = nombre(a.nbAffectationsPassees);
  if (passees === 1) out.push('Son affectation passée disparaîtra de son historique.');
  else if (passees > 1) out.push(`Ses ${passees} affectations passées disparaîtront de son historique.`);

  const docs = nombre(a.nbDocuments);
  const dossiers = nombre(a.nbDossiers);
  const sujet = accord(kind, 'Cet employé', 'Cette machine');
  const nomme = accord(kind, 'nommé', 'nommée');
  if (docs === 0) {
    out.push(`${sujet} n’est ${nomme} dans aucun document.`);
  } else if (docs === 1) {
    out.push(`${sujet} est ${nomme} dans 1 document. Son nom reste écrit dans ce document, mais il ne mènera plus à sa fiche.`);
  } else {
    const ou = dossiers > 1 ? ` de ${dossiers} dossiers` : dossiers === 1 ? ' d’un même dossier' : '';
    out.push(`${sujet} est ${nomme} dans ${docs} documents${ou}. Son nom reste écrit dans ces ${docs} documents, mais ils ne mèneront plus à sa fiche.`);
  }
  return out;
}

/**
 * Dernier paragraphe de la confirmation. La suggestion d'archiver n'a de sens que pour une fiche active (le bouton
 * « Archiver plutôt » n'apparaît qu'alors).
 */
export function avertissementSuppression(actif: boolean): string {
  const base = 'Son historique sera supprimé. Cette action est irréversible.';
  return actif ? `${base} Pour garder la fiche et son historique, archivez-la plutôt.` : base;
}

/** Message bref après la suppression : « Employé « BENALI Sofia » supprimé. » / « Machine « PC 01 » supprimée. ». */
export function messageFicheSupprimee(e: Pick<Entite, 'kind' | 'libelle' | 'nom'>): string {
  return `${accord(e.kind, 'Employé', 'Machine')} « ${nomAffiche(e)} » ${accord(e.kind, 'supprimé', 'supprimée')}.`;
}

// ---------------------------------------------------------------- dossiers (§ 15)

/** Titre de la fenêtre de confirmation. */
export const TITRE_SUPPRESSION_DOSSIER = 'Supprimer le dossier ?';

/** Nom accessible et infobulle de la corbeille d'un dossier, et libellé du bouton du dossier ouvert. */
export const NOM_CORBEILLE_DOSSIER = 'Supprimer le dossier';

/** Ce qu'il faut savoir d'un dossier pour confirmer sa suppression. */
export type DossierASupprimer = Pick<DossierResume, 'id' | 'nom' | 'theme' | 'annee' | 'statut'>;

/** Nom d'un dossier tel qu'il est écrit dans les textes de suppression. */
const nomDossier = (nom: unknown): string => texte(nom).trim() || 'Dossier sans nom';

/** Ligne d'identité : « Dossier « Dossier 2026-03 » · Support informatique · Année 2026 · En cours ». */
export function identiteSuppressionDossier(d: Pick<DossierResume, 'nom' | 'theme' | 'annee' | 'statut'>): string {
  const parties = [`Dossier « ${nomDossier(d.nom)} »`];
  const theme = texte(d.theme).trim();
  if (theme) parties.push(theme);
  if (typeof d.annee === 'number' && Number.isFinite(d.annee)) parties.push(`Année ${d.annee}`);
  const etat = nomStatut(d.statut);
  if (etat) parties.push(etat);
  return parties.join(' · ');
}

/**
 * Ce que la suppression va faire, phrase par phrase, avec les nombres réels de l'aperçu (§ 15) : contenu (documents et
 * sous-dossiers, ou dossier vide), copies des fichiers importés, fiches nommées (qui ne sont pas supprimées), dossier
 * clôturé. Les accords suivent les nombres.
 */
export function effetsSuppressionDossier(a: Partial<DossierSuppressionApercu>, clos: boolean): string[] {
  const out: string[] = [];
  const docs = nombre(a.nbDocuments);
  const sous = nombre(a.nbSousDossiers);
  const sesDocs = docs === 1 ? 'Son document' : `Ses ${docs} documents`;
  const sesSous = (debut: boolean) => (sous === 1 ? `${debut ? 'Son' : 'son'} sous-dossier` : `${debut ? 'Ses' : 'ses'} ${sous} sous-dossiers`);
  if (docs === 0 && sous === 0) out.push('Ce dossier est vide.');
  else if (sous === 0) out.push(`${sesDocs} ${docs === 1 ? 'sera supprimé' : 'seront supprimés'}.`);
  else if (docs === 0) {
    out.push(sous === 1
      ? 'Son sous-dossier sera supprimé ; il ne contient aucun document.'
      : `${sesSous(true)} seront supprimés ; ils ne contiennent aucun document.`);
  } else out.push(`${sesDocs} et ${sesSous(false)} seront supprimés.`);

  const copies = nombre(a.nbFichiersImportes);
  if (copies === 1) out.push('La copie de son fichier importé sera supprimée.');
  else if (copies > 1) out.push(`Les copies de ses ${copies} fichiers importés seront supprimées.`);

  // Une fiche n'est nommée que dans un document : sans document, rien à dire (aperçu incohérent).
  const fiches = docs > 0 ? nombre(a.nbFichesNommees) : 0;
  const lesDocs = docs > 1 ? 'ces documents disparaîtront' : 'ce document disparaîtra';
  if (fiches === 1) {
    out.push(`1 employé ou machine y est nommé : ${lesDocs} de son profil. Sa fiche n’est pas supprimée.`);
  } else if (fiches > 1) {
    out.push(`${fiches} employés ou machines y sont nommés : ${lesDocs} de leur profil. Leurs fiches ne sont pas supprimées.`);
  }
  if (clos) out.push('Ce dossier est clôturé.');
  return out;
}

/** Dernier paragraphe de la confirmation. */
export const AVERTISSEMENT_SUPPRESSION_DOSSIER = 'Cette action est irréversible.';

/** Message bref après la suppression : « Dossier « Dossier 2026-03 » supprimé. ». */
export const messageDossierSupprime = (d: Pick<DossierResume, 'nom'>): string => `Dossier « ${nomDossier(d.nom)} » supprimé.`;

// ---------------------------------------------------------------- blocs orphelins (§ 13.2, effet 2)

/**
 * Copie d'une fiche supprimée qu'un bloc `employe` / `machine` désignait, si le bloc n'a plus de fiche (entiteId nul)
 * et que la copie est du bon répertoire ; null sinon. Un bloc qui désigne une fiche n'est jamais orphelin, même s'il
 * porte encore une ancienne copie (le back la retire à l'enregistrement).
 */
export function ficheSupprimeeDe(b: BlocDocument, kind: Kind): FicheSupprimee | null {
  const id: unknown = b.entiteId;
  if (typeof id === 'number' && Number.isInteger(id) && id > 0) return null;
  const s: unknown = b.ficheSupprimee;
  if (typeof s !== 'object' || s === null) return null;
  const copie = s as FicheSupprimee;
  if (copie.kind !== kind) return null;
  if (!texte(copie.libelle).trim() && !texte(copie.nom).trim()) return null;
  return copie;
}

/**
 * Bloc `employe` / `machine` après un choix dans l'aide à la saisie : une autre fiche choisie remplace la copie d'une
 * fiche supprimée (le back la retire aussi à l'enregistrement) ; « Retirer » vide seulement le choix.
 */
export function blocAvecFiche(b: BlocDocument, id: number | null): BlocDocument {
  if (id === null) return { ...b, entiteId: null };
  const { ficheSupprimee: _copie, ...reste } = b;
  return { ...reste, entiteId: id };
}

/** Nom d'une fiche supprimée, tel qu'il était affiché (libellé, sinon nom). */
export const nomFicheSupprimee = (s: Pick<FicheSupprimee, 'libelle' | 'nom'>): string => texte(s.libelle).trim() || texte(s.nom).trim();

/** Mention ajoutée au nom d'une fiche supprimée. */
export const MENTION_FICHE_SUPPRIMEE = 'fiche supprimée';

/** Texte d'un bloc orphelin : « BENALI Sofia · EMP-… · fiche supprimée » (« Sans identifiant » s'il n'y en avait pas). */
export function texteFicheSupprimee(s: Pick<FicheSupprimee, 'libelle' | 'nom' | 'code'>): string {
  return `${nomFicheSupprimee(s)} · ${texte(s.code).trim() || 'Sans identifiant'} · ${MENTION_FICHE_SUPPRIMEE}`;
}
