import { champsDe, modeleNomDe } from './citations';
import { formatDate, pourComparer, texte } from './format';

/*
 * Recherche dans un profil (spécification § 11.3) : filtrage fait dans l'interface, sur les données déjà chargées.
 * Casse et accents ignorés. Plusieurs mots : chacun doit se retrouver quelque part (« intervention 2026 »).
 * Une date se cherche telle qu'elle est affichée (JJ/MM/AAAA, une partie, ou l'année seule).
 * Tout est lu prudemment : un champ absent ou d'un autre type ne correspond simplement à rien.
 */

/** Mots de la recherche, sans casse ni accents ; aucun mot = pas de filtre. */
export function motsRecherche(q: string): string[] {
  return pourComparer(q).split(/\s+/).filter(Boolean);
}

/** Vrai si chaque mot se retrouve dans au moins un des textes (toujours vrai sans mot). */
export function correspond(textes: readonly string[], mots: readonly string[]): boolean {
  if (mots.length === 0) return true;
  const t = textes.map(pourComparer);
  return mots.every((m) => t.some((s) => s.includes(m)));
}

/** Ce que la recherche lit d'un document où la fiche est nommée (champs de `DocumentLie`, tous facultatifs). */
export interface DocumentCherche {
  nom?: unknown;
  dossierNom?: unknown;
  modeleNom?: unknown;
  origine?: unknown;
  source?: unknown;
  champs?: unknown;
  dateDoc?: unknown;
  depuis?: unknown;
}

/** Textes cherchés : nom du document, modèle, dossier, champs, date du document et date de la nomination. */
export function textesDocument(d: DocumentCherche): string[] {
  return [
    texte(d.nom), modeleNomDe(d), texte(d.dossierNom), ...champsDe(d),
    formatDate(texte(d.dateDoc)), formatDate(texte(d.depuis)),
  ];
}

/**
 * Documents affichés : ceux d'un des modèles retenus (aucun retenu = tous les modèles) qui correspondent à la
 * recherche. L'ordre reçu est conservé.
 */
export function filtrerDocuments<T extends DocumentCherche>(docs: readonly T[], q: string, modeles: ReadonlySet<string>): T[] {
  const mots = motsRecherche(q);
  return docs.filter((d) => (modeles.size === 0 || modeles.has(modeleNomDe(d))) && correspond(textesDocument(d), mots));
}

/** Ce que la recherche lit d'un événement de l'historique (champs de `Evenement`, tous facultatifs sauf le titre). */
export interface EvenementCherche {
  titre?: unknown;
  detail?: unknown;
  date?: unknown;
  champ?: unknown;
  dossierNom?: unknown;
  documentNom?: unknown;
}

/** Textes cherchés : titre, détail, date, et le champ, le dossier et le document cités. */
export function textesEvenement(e: EvenementCherche): string[] {
  return [
    texte(e.titre), texte(e.detail), formatDate(texte(e.date)),
    texte(e.champ), texte(e.dossierNom), texte(e.documentNom),
  ];
}

/** Événements qui correspondent à la recherche, dans l'ordre reçu. */
export function filtrerEvenements<T extends EvenementCherche>(evenements: readonly T[], q: string): T[] {
  const mots = motsRecherche(q);
  if (mots.length === 0) return evenements.slice();
  return evenements.filter((e) => correspond(textesEvenement(e), mots));
}

/** Filtre par modèle après un clic sur son étiquette : ajouté s'il n'y était pas, retiré sinon. */
export function basculerModele(modeles: ReadonlySet<string>, nom: string): Set<string> {
  const out = new Set(modeles);
  if (out.has(nom)) out.delete(nom);
  else out.add(nom);
  return out;
}

/** « 12 documents », ou « 3 sur 12 documents » quand un filtre en masque. */
export function compteAffiches(affiches: number, total: number, unite: { un: string; plusieurs: string }): string {
  const mot = total > 1 ? unite.plusieurs : unite.un;
  return affiches === total ? `${total} ${mot}` : `${affiches} sur ${total} ${mot}`;
}
