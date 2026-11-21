import { texte } from './format';

/*
 * Historique cliquable (spécification § 9.4) : dans une frise, le nom d'un employé, d'une machine ou d'un dossier
 * cité par un événement devient un lien vers sa fiche ou le dossier.
 * Les noms viennent des données : tout est lu prudemment, et rien n'est jamais interprété comme du HTML.
 */

/** Ce qu'un événement dit des fiches, du dossier et du document qu'il cite (champs de `Evenement`, tous facultatifs). */
export interface CitationsEvenement {
  aId?: number | null;
  bId?: number | null;
  dossierId?: number | null;
  aLibelle?: string | null;
  bLibelle?: string | null;
  dossierNom?: string | null;
  /** § 11.2 : document où la fiche est nommée (événement 'nomination'). */
  documentId?: number | null;
  documentNom?: string | null;
  /** § 11.2 : champ du document où la fiche est nommée (événement 'nomination'). */
  champ?: string | null;
  /** § 13.2 : l'employé (a) ou la machine (b) cité a été supprimé ; son nom reste dans aLibelle / bLibelle, sans id. */
  aSupprime?: boolean | null;
  bSupprime?: boolean | null;
}

/**
 * Un nom cité, et ce qu'il ouvre. `role` : employé ('a'), machine ('b'), dossier, document ou champ d'un document
 * (le document est ouvert dans son dossier : `dossierId` est alors toujours renseigné).
 * `supprimee` (§ 13.2) : fiche supprimée ; le nom est repéré dans le texte mais n'ouvre rien (id 0).
 */
export interface LienEvenement {
  role: 'a' | 'b' | 'dossier' | 'document' | 'champ';
  id: number;
  nom: string;
  dossierId?: number;
  supprimee?: true;
}

/**
 * Morceau de texte : simple, ou porteur d'un lien. `mention` (§ 13.2) : « (supprimé) » / « (supprimée) » à écrire après
 * le nom d'une fiche supprimée, quand le texte de l'événement ne le dit pas déjà.
 */
export type Morceau = { texte: string; lien?: undefined } | { texte: string; lien: LienEvenement; mention?: string };

const idValide = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;

/**
 * Liens possibles pour un événement : chaque fiche et le dossier cités dont l'identifiant ET le nom sont renseignés.
 * La fiche affichée (`ficheCourante`) n'est pas un lien : on y est déjà.
 */
export function liensEvenement(e: CitationsEvenement, ficheCourante?: number): LienEvenement[] {
  const out: LienEvenement[] = [];
  const ajouter = (role: LienEvenement['role'], id: unknown, nom: unknown) => {
    const n = texte(nom).trim();
    if (!idValide(id) || !n) return;
    if (role !== 'dossier' && id === ficheCourante) return;
    out.push({ role, id, nom: n });
  };
  ajouter('a', e.aId, e.aLibelle);
  ajouter('b', e.bId, e.bLibelle);
  ajouter('dossier', e.dossierId, e.dossierNom);
  // Document : un lien seulement si l'on sait aussi dans quel dossier l'ouvrir.
  const doc = texte(e.documentNom).trim();
  if (idValide(e.documentId) && idValide(e.dossierId) && doc) out.push({ role: 'document', id: e.documentId, nom: doc, dossierId: e.dossierId });
  return out;
}

/**
 * § 13.2 : fiches supprimées citées par l'événement (aSupprime / bSupprime), avec le nom qu'elles avaient. Ce ne sont
 * pas des liens : leur nom s'affiche en texte non cliquable, avec la mention « supprimé » / « supprimée ».
 */
export function citationsSupprimees(e: CitationsEvenement): LienEvenement[] {
  const out: LienEvenement[] = [];
  const ajouter = (role: 'a' | 'b', supprime: unknown, nom: unknown) => {
    const n = texte(nom).trim();
    if (supprime === true && n) out.push({ role, id: 0, nom: n, supprimee: true });
  };
  ajouter('a', e.aSupprime, e.aLibelle);
  ajouter('b', e.bSupprime, e.bLibelle);
  return out;
}

/** « supprimé » (employé) / « supprimée » (machine). */
export const mentionSupprime = (role: LienEvenement['role']): string => (role === 'b' ? 'supprimée' : 'supprimé');

/** Champ où la fiche est nommée : un lien qui ouvre le document, seulement si l'on sait où l'ouvrir. */
export function lienChamp(e: CitationsEvenement): LienEvenement | null {
  const champ = texte(e.champ).trim();
  if (!champ || !idValide(e.documentId) || !idValide(e.dossierId)) return null;
  return { role: 'champ', id: e.documentId, nom: champ, dossierId: e.dossierId };
}

/** Lettre ou chiffre (toutes langues) : un nom n'est reconnu que s'il n'est pas collé à un autre mot. */
const MOT = /[\p{L}\p{N}]/u;

/** Position de la première occurrence de `nom` dans `t` à partir de `debut`, entourée de séparateurs ; -1 sinon. */
function trouver(t: string, nom: string, debut = 0): number {
  let i = t.indexOf(nom, debut);
  while (i >= 0) {
    const avant = i > 0 ? t[i - 1] : '';
    const apres = t[i + nom.length] ?? '';
    if (!MOT.test(avant) && !MOT.test(apres)) return i;
    i = t.indexOf(nom, i + 1);
  }
  return -1;
}

/**
 * Découpe `t` en morceaux, en faisant un lien de la première occurrence de chaque nom de `liens` encore disponible.
 * Les noms les plus longs passent d'abord (« PC Accueil 01 » avant « PC »), sans chevauchement.
 * Renvoie les morceaux et les liens qui n'ont pas été trouvés dans le texte.
 */
export function decouper(t: string, liens: readonly LienEvenement[]): { morceaux: Morceau[]; restants: LienEvenement[] } {
  const src = texte(t);
  const places: { debut: number; fin: number; lien: LienEvenement }[] = [];
  const restants: LienEvenement[] = [];
  const ordre = [...liens].sort((x, y) => y.nom.length - x.nom.length);
  for (const lien of ordre) {
    let i = trouver(src, lien.nom);
    while (i >= 0 && places.some((p) => i < p.fin && i + lien.nom.length > p.debut)) i = trouver(src, lien.nom, i + 1);
    if (i < 0) restants.push(lien);
    else places.push({ debut: i, fin: i + lien.nom.length, lien });
  }
  places.sort((x, y) => x.debut - y.debut);
  const morceaux: Morceau[] = [];
  let pos = 0;
  for (const p of places) {
    if (p.debut > pos) morceaux.push({ texte: src.slice(pos, p.debut) });
    morceaux.push({ texte: src.slice(p.debut, p.fin), lien: p.lien });
    pos = p.fin;
  }
  if (pos < src.length) morceaux.push({ texte: src.slice(pos) });
  // Ordre d'origine des liens restants (employé, machine, dossier).
  return { morceaux, restants: liens.filter((l) => restants.includes(l)) };
}

/**
 * Titre et détail d'un événement découpés en morceaux. Chaque nom n'est un lien qu'une fois : dans le titre s'il y
 * figure, sinon dans le détail. Le champ d'une nomination n'est cherché que dans le détail (« Champ « Utilisateur » »),
 * où il est écrit. `autres` : les liens cités par l'événement mais absents des deux textes (nom changé depuis, par
 * exemple), à proposer à part.
 * § 13.2 : le nom d'une fiche supprimée est repéré de la même façon, sans lien (`lien.supprimee`) ; s'il n'est écrit
 * nulle part que la fiche est supprimée, le morceau porte la mention à ajouter.
 */
export function morceauxEvenement(
  e: CitationsEvenement & { titre: string; detail: string },
  ficheCourante?: number,
): { titre: Morceau[]; detail: Morceau[]; autres: LienEvenement[] } {
  const liens = [...liensEvenement(e, ficheCourante), ...citationsSupprimees(e)];
  const t = decouper(e.titre, liens);
  const champ = lienChamp(e);
  const d = decouper(e.detail, champ ? [...t.restants, champ] : t.restants);
  const dejaDit = /supprim/i.test(`${texte(e.titre)} ${texte(e.detail)}`);
  const mentionner = (ms: Morceau[]): Morceau[] => (dejaDit ? ms : ms.map((m) =>
    (m.lien?.supprimee ? { ...m, mention: ` (${mentionSupprime(m.lien.role)})` } : m)));
  return { titre: mentionner(t.morceaux), detail: mentionner(d.morceaux), autres: d.restants };
}

/** « Employé », « Machine », « Dossier », « Document » ou « Champ » : devant un lien proposé à part. */
export const ROLE_LIEN: Record<LienEvenement['role'], string> = {
  a: 'Employé', b: 'Machine', dossier: 'Dossier', document: 'Document', champ: 'Champ',
};
