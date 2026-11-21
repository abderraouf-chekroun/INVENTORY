import type { Entite, Kind, Statut } from '../api';

/** Complète à deux chiffres : 3 → « 03 ». */
export const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * Date ISO du back (« AAAA-MM-JJ » ou « AAAA-MM-JJ HH:MM:SS ») → « JJ/MM/AAAA ».
 * Valeur absente ou illisible → « — » (comme `fmt()` du prototype).
 */
export function formatDate(iso: string | null | undefined): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}

/** Année d'une date ISO du back (« 2025-03-14 … » → 2025), ou null. */
export function yearOf(iso: string | null | undefined): number | null {
  const m = iso ? /^(\d{4})/.exec(iso) : null;
  return m ? Number(m[1]) : null;
}

/** Date du jour au format ISO « AAAA-MM-JJ » (heure locale). */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Pluriel du prototype : plural(1, 'fichier') → « 1 fichier », plural(3, 'fichier') → « 3 fichiers ». */
export const plural = (n: number, word: string): string => `${n} ${word}${n > 1 ? 's' : ''}`;

/**
 * Libellé de l'identifiant d'une fiche, affiché tel quel ; sans identifiant :
 * « Fiche à compléter » (employé) ou « Sans identifiant » (machine).
 */
export const codeLabel = (code: string | null, kind: Kind = 'b'): string =>
  (code ? code : kind === 'a' ? 'Fiche à compléter' : 'Sans identifiant');

/** Libellés des états de dossier. */
export const STATUT_LABEL: Record<Statut, string> = { cours: 'En cours', piece: 'Pièce manquante', clos: 'Clôturé' };

/**
 * Date et heure d'un horodatage du back (« AAAA-MM-JJ HH:MM:SS ») → « 14/05/2026 à 09:30 » ;
 * sans heure lisible → « 14/05/2026 » ; absente ou illisible → « — ».
 */
export function formatDateHeure(iso: string | null | undefined): string {
  const d = formatDate(iso);
  const h = iso && d !== '—' ? /^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})/.exec(iso) : null;
  return h ? `${d} à ${h[1]}:${h[2]}` : d;
}

/** « Employé » / « Machine », au singulier ou au pluriel. */
export function kindLabel(kind: Kind, pluriel = false): string {
  if (kind === 'a') return pluriel ? 'Employés' : 'Employé';
  return pluriel ? 'Machines' : 'Machine';
}

/** « un employé » / « une machine » (dans une phrase). */
export const kindUn = (kind: Kind): string => (kind === 'a' ? 'un employé' : 'une machine');

/** Nom de la catégorie selon le répertoire : « Structure » (employés) ou « Type de machine » (machines). */
export const categoryLabel = (kind: Kind): 'Structure' | 'Type de machine' => (kind === 'a' ? 'Structure' : 'Type de machine');

/** Garde seulement les chiffres (saisie d'une année). */
export const digitsOnly = (s: string): string => s.replace(/\D/g, '');

/** Texte d'une valeur venue des données : une chaîne, sinon ''. */
export const texte = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Nom affiché d'une fiche : `libelle` (« NOM Prénom » pour un employé), sinon le nom. */
export const nomAffiche = (e: Pick<Entite, 'libelle' | 'nom'>): string => texte(e.libelle).trim() || texte(e.nom);

/** Caractéristiques d'une machine sur une ligne : « Intel Core i5 · 8 Go · SSD 256 Go » (champs vides omis). */
export function caracteristiques(e: Pick<Entite, 'cpu' | 'ram' | 'stockage'>): string {
  return [e.cpu, e.ram, e.stockage].map(texte).map((s) => s.trim()).filter(Boolean).join(' · ');
}

/** Ligne de détail d'une fiche (listes, aide à la saisie) : poste · structure, ou marque · caractéristiques. */
export function detailFiche(e: Entite): string {
  const parts = e.kind === 'a'
    ? [texte(e.poste), texte(e.categorie)]
    : [texte(e.marque), caracteristiques(e), texte(e.categorie)];
  return parts.map((s) => s.trim()).filter(Boolean).join(' · ');
}

/** Libellés des informations d'une fiche montrées par un bloc « Employé » ou « Machine » d'un document (§ 8.5). */
export function libellesFiche(kind: Kind): string[] {
  return kind === 'a'
    ? ['Nom', 'Prénom', 'Poste', 'Structure', 'Identifiant']
    : ['Nom', 'Identifiant', 'Marque et modèle', 'Processeur', 'RAM', 'Stockage'];
}

/** Informations d'une fiche, dans l'ordre de `libellesFiche` ; une information vide vaut « — ». */
export function champsFiche(e: Entite): [string, string][] {
  const v = (s: unknown) => texte(s).trim() || '—';
  const valeurs = e.kind === 'a'
    ? [e.nom, e.prenom, e.poste, e.categorie, e.code ?? 'Fiche à compléter']
    : [e.nom, e.code ?? 'Sans identifiant', e.marque, e.cpu, e.ram, e.stockage];
  return libellesFiche(e.kind).map((l, i): [string, string] => [l, v(valeurs[i])]);
}

/** Informations nécessaires à l'identifiant d'un employé qui manquent encore (dans l'ordre du formulaire). */
export function manquesEmploye(e: { nom: string; prenom: string; dateNaissance: string | null; poste: string }): string[] {
  const out: string[] = [];
  if (!lettres(e.nom)) out.push('le nom');
  if (!lettres(e.prenom)) out.push('le prénom');
  if (!e.dateNaissance || !/^\d{4}-\d{2}-\d{2}$/.test(e.dateNaissance)) out.push('la date de naissance');
  if (!lettres(e.poste)) out.push('le poste');
  return out;
}

/** Lettres A à Z d'un texte, sans accents, en majuscules (comme le calcul de l'identifiant). */
export function lettres(s: string): string {
  return texte(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
}

/** « a, b et c ». */
export function enumeration(xs: readonly string[]): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} et ${xs[xs.length - 1]}`;
}

/** Comparaison sans casse ni accents (recherche, identifiant exact). */
export const pourComparer = (s: string): string =>
  texte(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
