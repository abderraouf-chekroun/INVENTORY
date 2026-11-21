import type { FaconDeFigurer, Kind } from '../api';
import { enumeration, formatDateHeure, texte } from './format';

/*
 * Nominations (spécification § 10.4, § 11.1 et § 11.2) : les documents où un employé ou une machine est nommé,
 * montrés sur son profil avec le ou les champs et le moment de la nomination.
 * Ce que le back envoie est lu prudemment (façons inconnues ignorées, noms absents remplacés).
 */

/** Façons dont une fiche peut être nommée : un bloc Employé / Machine la désigne, ou son nom est écrit. */
export type Facon = Extract<FaconDeFigurer, 'bloc' | 'texte'>;
const FACONS: readonly Facon[] = ['bloc', 'texte'];

/** Comment la fiche est nommée dans le document, en mots simples. */
export function libelleFacon(f: Facon, kind: Kind): string {
  const a = kind === 'a';
  switch (f) {
    case 'bloc': return a ? 'Choisi dans le document' : 'Choisie dans le document';
    case 'texte': return a ? 'Nom écrit dans le document' : 'Identifiant écrit dans le document';
  }
}

/** Façons connues, sans doublon, dans l'ordre 'bloc', 'texte'. */
export function faconsDe(facons: unknown): Facon[] {
  if (!Array.isArray(facons)) return [];
  return FACONS.filter((f) => facons.includes(f));
}

/**
 * Champs où la fiche est nommée : textes sans doublon, dans l'ordre reçu. Un champ sans libellé est renvoyé par le
 * back comme '' : il est gardé (une fois). Les valeurs qui ne sont pas des textes sont ignorées.
 */
export function champsDe(d: { champs?: unknown }): string[] {
  const c: unknown = d.champs;
  if (!Array.isArray(c)) return [];
  const out: string[] = [];
  for (const x of c) {
    if (typeof x !== 'string') continue;
    const s = x.trim();
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * « Champ « Utilisateur » », « Champs « Utilisateur » et « Observations » », « Champ sans libellé », ou '' sans champ.
 * Un champ sans libellé parmi d'autres : « Champ « Utilisateur » et un champ sans libellé ».
 */
export function libelleChamps(champs: readonly string[]): string {
  const nommes = champs.filter((c) => c !== '');
  const sansLibelle = nommes.length < champs.length;
  if (nommes.length === 0) return sansLibelle ? 'Champ sans libellé' : '';
  const base = `${nommes.length > 1 ? 'Champs' : 'Champ'} ${enumeration(nommes.map((c) => `« ${c} »`))}`;
  return sansLibelle ? `${base} et un champ sans libellé` : base;
}

/** « Nommé le 14/05/2026 à 09:30 » (employé), « Nommée le … » (machine), ou '' si le moment est illisible. */
export function libelleNomination(kind: Kind, depuis: unknown): string {
  const d = formatDateHeure(texte(depuis));
  if (d === '—') return '';
  return `${kind === 'a' ? 'Nommé' : 'Nommée'} le ${d}`;
}

/** Nom du modèle d'un document : « Fiche d'intervention informatique », « Fichier importé »… */
export function modeleNomDe(d: { modeleNom?: unknown; origine?: unknown; source?: unknown }): string {
  const m = texte(d.modeleNom).trim();
  if (m) return m;
  if (d.origine === 'import') return 'Fichier importé';
  return texte(d.source).trim() || 'Document';
}

/**
 * Résumé par modèle, pour comprendre d'un coup d'œil : [{ nom: 'Fiche d’intervention informatique', n: 2 }, …],
 * du plus fréquent au moins fréquent, puis par ordre alphabétique.
 */
export function resumeParModele(docs: readonly { modeleNom?: unknown; origine?: unknown; source?: unknown }[]): { nom: string; n: number }[] {
  const compte = new Map<string, number>();
  for (const d of docs) {
    const nom = modeleNomDe(d);
    compte.set(nom, (compte.get(nom) ?? 0) + 1);
  }
  return Array.from(compte, ([nom, n]) => ({ nom, n }))
    .sort((x, y) => y.n - x.n || x.nom.localeCompare(y.nom, 'fr'));
}
