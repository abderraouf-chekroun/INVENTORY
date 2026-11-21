import { BLOCS_DE_SAISIE, BLOCS_FICHIER_IMPORTE, BORNES_BLOCS, VARIABLES, VARIABLES_ANCIENNES, type BlocDocument, type BlocModele, type Classement, type Entite, type TypeBloc } from '../../api';
import { codeLabel, formatDate, texte, todayIso } from '../../lib/format';
import type { IconName } from '../../ui';

/*
 * Blocs des modèles et des documents (spécification § 8.5).
 * Partagé par l'éditeur du Studio, l'aperçu direct du Studio et le papier d'un document.
 * Les blocs viennent des données : type inconnu, clé absente ou de mauvais type ne doivent jamais faire planter
 * le rendu. Toute lecture passe donc par les fonctions ci-dessous.
 */

/** Libellés des types de bloc (palette du Studio, en-tête d'un bloc). */
export const BLOC_LABEL: Record<TypeBloc, string> = {
  titre: 'Titre',
  texte: 'Texte',
  champ: 'Champ sur une ligne',
  zone: 'Zone de texte',
  date: 'Date',
  case: 'Case à cocher',
  choix: 'Liste d’options',
  tableau: 'Tableau',
  magasin: 'Choix du Magasin',
  variable: 'Information automatique',
  employe: 'Employé',
  machine: 'Machine',
  signature: 'Signature',
};

/** Ce que fait chaque type de bloc (aide de la palette). */
export const BLOC_AIDE: Record<TypeBloc, string> = {
  titre: 'Titre centré ou intertitre de section',
  texte: 'Paragraphe : consigne, remarque…',
  champ: 'Une réponse courte à écrire',
  zone: 'Une réponse longue, sur plusieurs lignes',
  date: 'Une date, avec l’heure si besoin',
  case: 'Une seule case à cocher',
  choix: 'Plusieurs options : une seule réponse ou plusieurs',
  tableau: 'Colonnes à nommer, lignes ajoutées en remplissant',
  magasin: 'Un mot-clé du Magasin',
  variable: 'Nom, poste, identifiant… repris du premier bloc Employé ou Machine',
  employe: 'Choisir un employé : ses informations s’affichent',
  machine: 'Choisir une machine : ses caractéristiques s’affichent',
  signature: 'Case « Signé » à cocher, datée automatiquement',
};

/** Palette du Studio, par familles. */
export const PALETTE: readonly { titre: string; types: readonly TypeBloc[] }[] = [
  { titre: 'Mise en page', types: ['titre', 'texte', 'signature'] },
  { titre: 'Champs à remplir', types: ['champ', 'zone', 'date', 'case', 'choix', 'tableau'] },
  { titre: 'Fiches et listes', types: ['employe', 'machine', 'magasin', 'variable'] },
];

export const TYPES_BLOC = Object.keys(BLOC_LABEL) as TypeBloc[];

/** Vrai pour un type de bloc connu de cette version (jamais pour « constructor », « __proto__ »…). */
export function estTypeBloc(t: unknown): t is TypeBloc {
  return typeof t === 'string' && Object.prototype.hasOwnProperty.call(BLOC_LABEL, t);
}

export const libelleBloc = (t: unknown): string => (estTypeBloc(t) ? BLOC_LABEL[t] : 'Bloc non reconnu');
export const iconeBloc = (t: unknown): IconName => (estTypeBloc(t) ? t : 'inconnu');

export { VARIABLES };
export type NomVariable = (typeof VARIABLES)[number];

/** Nom actuel d'une variable : un ancien nom (« Entité A · Code »…) donne son équivalent, sinon le nom tel quel. */
export function variableCanonique(nom: unknown): string {
  const n = texte(nom);
  return Object.prototype.hasOwnProperty.call(VARIABLES_ANCIENNES, n) ? VARIABLES_ANCIENNES[n] : n;
}

export const estVariable = (nom: string): nom is NomVariable => (VARIABLES as readonly string[]).includes(nom);

/** Valeur par défaut d'un bloc ajouté depuis la palette. */
export function nouveauBloc(t: TypeBloc): BlocModele {
  switch (t) {
    case 'titre': return { t, v: 'Titre', niveau: 1 };
    case 'texte': return { t, v: 'Texte libre du modèle.' };
    case 'champ': return { t, v: 'Libellé du champ' };
    case 'zone': return { t, v: 'Observations' };
    case 'date': return { t, v: 'Date', heure: false };
    case 'case': return { t, v: 'Option à cocher' };
    case 'choix': return { t, v: 'Choix', options: ['Option 1', 'Option 2'], multiple: false };
    case 'tableau': return { t, v: '', cols: colonnesParDefaut() };
    case 'magasin': return { t, v: 'Choix dans le Magasin' };
    case 'variable': return { t, v: VARIABLES[0] };
    case 'employe': return { t, v: 'Employé' };
    case 'machine': return { t, v: 'Machine' };
    case 'signature': return { t, v: 'Visa' };
  }
}

const borner = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export const colonnesParDefaut = (): string[] =>
  Array.from({ length: BORNES_BLOCS.colonnesParDefaut }, (_, i) => `Colonne ${i + 1}`);

/** Nombre de colonnes d'un tableau : celui des en-têtes, borné à 1..8 ; 3 sans en-têtes. */
export function nbColonnes(b: BlocModele): number {
  const cols: unknown = b.cols;
  if (!Array.isArray(cols) || cols.length === 0) return BORNES_BLOCS.colonnesParDefaut;
  return borner(cols.length, BORNES_BLOCS.colonnesMin, BORNES_BLOCS.colonnesMax);
}

/** En-têtes saisis (vides compris), au nombre de `nbColonnes`. */
export function colonnesBrutes(b: BlocModele): string[] {
  const cols: unknown = b.cols;
  const arr: unknown[] = Array.isArray(cols) ? cols : [];
  return Array.from({ length: nbColonnes(b) }, (_, i) => texte(arr[i]));
}

/** En-têtes tels qu'affichés : un en-tête vide reprend « Colonne n » (comme le back). */
export function colonnes(b: BlocModele): string[] {
  return colonnesBrutes(b).map((c, i) => c.trim() || `Colonne ${i + 1}`);
}

/** Colonne à garder étroite (« N° », « Qté »…) : un en-tête de 4 caractères au plus. */
export const colonneEtroite = (entete: string): boolean => entete.trim().length <= 4;

/**
 * Index du premier titre principal (niveau 1), ou le nombre de blocs s'il n'y en a pas.
 * Les textes qui le précèdent sont l'en-tête du formulaire (organisme, division…).
 */
export function indexTitrePrincipal(blocs: readonly unknown[]): number {
  const i = blocs.findIndex((b) => typeof b === 'object' && b !== null && (b as BlocModele).t === 'titre' && niveauTitre(b as BlocModele) === 1);
  return i < 0 ? blocs.length : i;
}

/** Lignes d'un tableau, chacune ramenée au nombre de colonnes, cellules en texte. */
export function lignesDe(b: BlocDocument): string[][] {
  const rows: unknown = b.rows;
  if (!Array.isArray(rows)) return [];
  const n = nbColonnes(b);
  return rows.map((r: unknown) => {
    const cells: unknown[] = Array.isArray(r) ? r : [];
    return Array.from({ length: n }, (_, i) => texte(cells[i]));
  });
}

/** Options d'un bloc « Liste d'options » : textes non vides, 12 au plus, sans doublon. */
export function optionsDe(b: BlocModele): string[] {
  const opts: unknown = b.options;
  if (!Array.isArray(opts)) return [];
  const out: string[] = [];
  for (const o of opts) {
    const s = texte(o);
    if (s.trim() && !out.includes(s)) out.push(s);
    if (out.length >= BORNES_BLOCS.optionsMax) break;
  }
  return out;
}

/** Options en cours d'édition dans le Studio (vides comprises), 12 au plus. */
export function optionsBrutes(b: BlocModele): string[] {
  const opts: unknown = b.options;
  return Array.isArray(opts) ? opts.slice(0, BORNES_BLOCS.optionsMax).map(texte) : [];
}

/** Options retenues dans un document, parmi les options du bloc (une seule si le choix est unique). */
export function choisisDe(b: BlocDocument): string[] {
  const ch: unknown = b.choisis;
  if (!Array.isArray(ch)) return [];
  const opts = optionsDe(b);
  const out = opts.filter((o) => ch.includes(o));
  return b.multiple === true ? out : out.slice(0, 1);
}

/** Nouvelle liste d'options retenues après un clic sur `option`. */
export function basculerChoix(b: BlocDocument, option: string, coche: boolean): string[] {
  const actuels = choisisDe(b);
  if (b.multiple !== true) return coche ? [option] : [];
  const set = new Set(actuels);
  if (coche) set.add(option);
  else set.delete(option);
  return optionsDe(b).filter((o) => set.has(o));
}

/** Niveau d'un titre : 2 (intertitre) seulement si demandé, sinon 1. */
export const niveauTitre = (b: BlocModele): 1 | 2 => (b.niveau === 2 ? 2 : 1);

/** Identifiant de fiche d'un bloc « Employé » / « Machine », ou null. */
export function entiteIdDe(b: BlocDocument): number | null {
  const id: unknown = b.entiteId;
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null;
}

/** Valeur d'un bloc date, si elle est au bon format : `AAAA-MM-JJ`, ou `AAAA-MM-JJTHH:MM` avec l'heure. */
export function valeurDate(b: BlocDocument): string {
  const v = texte(b.val);
  if (b.heure === true) return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? v : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
}

/** Saisie complète d'un champ date (une année en cours de frappe donne « 0002-… »). */
export function dateSaisieComplete(v: string, heure: boolean): boolean {
  const re = heure ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/ : /^\d{4}-\d{2}-\d{2}$/;
  return re.test(v) && Number(v.slice(0, 4)) >= 1900;
}

/** « 14/05/2026 » ou « 14/05/2026 à 09:30 » ; vide si absente. */
export function formatDateBloc(val: string): string {
  if (!val) return '';
  const d = formatDate(val);
  const h = /T(\d{2}):(\d{2})$/.exec(val);
  return h ? `${d} à ${h[1]}:${h[2]}` : d;
}

/*
 * Signature (§ 9.2) : une case « Signé ». `ok` : signé ou non ; `val` : la date à laquelle la case a été cochée,
 * posée par le back quand `ok` passe à vrai et effacée quand la case est décochée.
 */

/** Vrai si la signature est cochée. */
export const estSigne = (b: BlocDocument): boolean => b.ok === true;

/** « Signé le JJ/MM/AAAA », « Signé » (date illisible) ou « Non signé ». */
export function etatSignature(b: BlocDocument): string {
  if (!estSigne(b)) return 'Non signé';
  const d = formatDate(texte(b.val));
  return d === '—' ? 'Signé' : `Signé le ${d}`;
}

/**
 * Bloc après un clic sur la case. Cochée : la date du jour est montrée tout de suite (le back pose la sienne à
 * l'enregistrement) ; décochée : plus de date.
 */
export function signer(b: BlocDocument, ok: boolean, aujourdhui: string): BlocDocument {
  const { val: _val, ...reste } = b;
  return ok ? { ...reste, ok: true, val: estSigne(b) && formatDate(texte(b.val)) !== '—' ? texte(b.val) : aujourdhui } : { ...reste, ok: false };
}

/** Une variable vide s'affiche « — ». */
const ou = (s: unknown) => texte(s).trim() || '—';

/** Blocs lisibles d'un document (des objets) : un élément illisible venu des données est écarté. */
export function blocsLisibles(blocs: unknown): BlocDocument[] {
  return Array.isArray(blocs) ? blocs.filter((x): x is BlocDocument => typeof x === 'object' && x !== null) : [];
}

/**
 * Blocs d'un fichier importé (§ 11.1) : ceux reçus (le back en donne toujours deux), plus les blocs « Employé
 * concerné » et « Machine concernée » s'ils manquent (ajoutés à la fin, vides). `a` et `b` : index du premier bloc
 * Employé et du premier bloc Machine.
 */
export function blocsFichierImporte(blocs: unknown): { blocs: BlocDocument[]; a: number; b: number } {
  const out = blocsLisibles(blocs);
  const index = (t: 'employe' | 'machine') => {
    const i = out.findIndex((x) => x.t === t);
    if (i >= 0) return i;
    out.push({ t, v: BLOCS_FICHIER_IMPORTE[t], entiteId: null });
    return out.length - 1;
  };
  const a = index('employe');
  const b = index('machine');
  return { blocs: out, a, b };
}

/**
 * Valeurs des variables pour un document : employé et machine dont il tire ses variables (§ 11.1, voir
 * `fichesDesVariables` dans src/api), date du document. Sans fiche, les variables correspondantes valent « — ».
 */
export function valeursVariables(a: Entite | null, b: Entite | null, dateDoc: string): Record<NomVariable, string> {
  return {
    'Employé · Nom': a ? ou(a.nom) : '—',
    'Employé · Prénom': a ? ou(a.prenom) : '—',
    'Employé · Poste': a ? ou(a.poste) : '—',
    'Employé · Structure': a ? ou(a.categorie) : '—',
    'Employé · Identifiant': a ? codeLabel(a.code, 'a') : '—',
    'Machine · Nom': b ? ou(b.nom) : '—',
    'Machine · Identifiant': b ? codeLabel(b.code, 'b') : '—',
    'Machine · Marque et modèle': b ? ou(b.marque) : '—',
    'Machine · Processeur': b ? ou(b.cpu) : '—',
    'Machine · RAM': b ? ou(b.ram) : '—',
    'Machine · Stockage': b ? ou(b.stockage) : '—',
    'Date du jour': formatDate(dateDoc),
  };
}

/**
 * Valeur affichée pour une variable : seulement une clé PROPRE de `variables` dont la valeur est un texte,
 * sinon « — ». Un nom venu des données (« __proto__ », « constructor »…) ne remonte jamais au prototype.
 * Les anciens noms (version 1.0) sont reconnus.
 */
export function valeurVariable(variables: Record<string, string>, nom: string): string {
  const n = variableCanonique(nom);
  if (!Object.prototype.hasOwnProperty.call(variables, n)) return '—';
  const v: unknown = variables[n];
  return typeof v === 'string' ? v : '—';
}

/** Valeurs d'exemple de l'aperçu direct du Studio (fiches fictives). */
export function valeursExemple(): Record<NomVariable, string> {
  return {
    'Employé · Nom': 'BENALI',
    'Employé · Prénom': 'Sofia',
    'Employé · Poste': 'Technicienne',
    'Employé · Structure': 'Division informatique',
    'Employé · Identifiant': 'EMP-7K3QX-9RT4M',
    'Machine · Nom': 'PC Accueil 01',
    'Machine · Identifiant': 'PC-0412',
    'Machine · Marque et modèle': 'Dell OptiPlex 7090',
    'Machine · Processeur': 'Intel Core i5',
    'Machine · RAM': '16 Go',
    'Machine · Stockage': 'SSD 512 Go',
    'Date du jour': formatDate(todayIso()),
  };
}

/** Mots-clés proposés dans un bloc « Choix du Magasin » : les actifs, plus la valeur déjà choisie. */
export function motsClesProposes(magasin: readonly Classement[], val: string): string[] {
  const noms = magasin.filter((m) => m.actif || m.nom === val).map((m) => m.nom);
  if (val && !noms.includes(val)) noms.push(val);
  return noms;
}

/** Morceau du papier : un bloc seul, ou une suite de blocs « Signature » affichés côte à côte. */
export type Segment = { t: 'seul'; i: number } | { t: 'signatures'; indices: number[] };

/** Regroupe les blocs « Signature » qui se suivent (index dans `blocs`). */
export function grouperBlocs(blocs: readonly { t: unknown }[]): Segment[] {
  const out: Segment[] = [];
  blocs.forEach((b: unknown, i) => {
    const prec = out[out.length - 1];
    if (typeof b === 'object' && b !== null && (b as { t?: unknown }).t === 'signature') {
      if (prec && prec.t === 'signatures') prec.indices.push(i);
      else out.push({ t: 'signatures', indices: [i] });
    } else {
      out.push({ t: 'seul', i });
    }
  });
  return out;
}

/** Vrai pour un bloc de saisie, qui peut être marqué « Champ obligatoire » (§ 10.6). */
export const estBlocDeSaisie = (t: unknown): boolean =>
  typeof t === 'string' && (BLOCS_DE_SAISIE as readonly string[]).includes(t);

/** Bloc marqué obligatoire : seulement un bloc de saisie dont `obligatoire` vaut exactement true. */
export const estObligatoire = (b: { t?: unknown; obligatoire?: unknown } | null | undefined): boolean =>
  !!b && b.obligatoire === true && estBlocDeSaisie(b.t);

/** Bloc après un clic sur « Champ obligatoire » dans le Studio : la propriété n'existe que si elle vaut true. */
export function marquerObligatoire(b: BlocModele, oui: boolean): BlocModele {
  const { obligatoire: _o, ...reste } = b;
  return oui && estBlocDeSaisie(b.t) ? { ...reste, obligatoire: true } : reste;
}

/**
 * Bloc de document rempli (§ 10.6) : texte non vide (champ, zone, Magasin), date complète, case cochée, au moins une
 * option retenue, au moins une cellule de tableau écrite, une fiche choisie, une signature cochée.
 */
export function blocRempli(b: BlocDocument): boolean {
  switch (b.t) {
    case 'champ':
    case 'zone':
    case 'magasin':
      return texte(b.val).trim() !== '';
    case 'date':
      return valeurDate(b) !== '';
    case 'case':
    case 'signature':
      return b.ok === true;
    case 'choix':
      return choisisDe(b).length > 0;
    case 'tableau':
      return lignesDe(b).some((r) => r.some((c) => c.trim() !== ''));
    case 'employe':
    case 'machine':
      return entiteIdDe(b) !== null;
    default:
      return true;
  }
}

/** Index des blocs obligatoires encore vides d'un document, dans l'ordre. Un bloc illisible est ignoré. */
export function obligatoiresManquants(blocs: readonly unknown[]): number[] {
  const out: number[] = [];
  blocs.forEach((b, i) => {
    if (typeof b === 'object' && b !== null && estObligatoire(b as BlocDocument) && !blocRempli(b as BlocDocument)) out.push(i);
  });
  return out;
}

/** « 2 champs obligatoires restent à remplir », « 1 champ obligatoire reste à remplir », « Tous les champs obligatoires sont remplis ». */
export function messageObligatoires(manquants: number): string {
  if (manquants <= 0) return 'Tous les champs obligatoires sont remplis.';
  return manquants > 1
    ? `${manquants} champs obligatoires restent à remplir.`
    : '1 champ obligatoire reste à remplir.';
}

/**
 * Bloc d'un modèle tel qu'envoyé au back : les options laissées vides d'une liste ne sont pas enregistrées
 * (elles restent à l'écran pendant la saisie) ; `obligatoire` n'est gardé que s'il vaut true sur un bloc de saisie.
 */
export function pourEnregistrer(b: BlocModele): BlocModele {
  const c = 'obligatoire' in b && !estObligatoire(b) ? marquerObligatoire(b, false) : b;
  if (c.t === 'choix') return { ...c, options: optionsBrutes(c).filter((o) => o.trim() !== '') };
  return c;
}
