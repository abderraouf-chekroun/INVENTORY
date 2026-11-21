import type { DocumentFichier, DossierDetail, SousDossier } from '../../api';

/*
 * Lecture de l'arborescence d'un dossier à partir de `DossierDetail` (sous-dossiers et documents à plat).
 * Un emplacement est `null` (racine du dossier) ou l'id d'un sous-dossier.
 */
export type Emplacement = number | null;

export const sousDossiersDe = (d: DossierDetail, lieu: Emplacement): SousDossier[] =>
  d.sousDossiers.filter((s) => s.parentId === lieu);

export const documentsDe = (d: DossierDetail, lieu: Emplacement): DocumentFichier[] =>
  d.documents.filter((f) => f.sousDossierId === lieu);

/**
 * Nombre de documents d'un emplacement, sous-dossiers compris (`nFiles` du prototype).
 * Parcours itératif en temps linéaire : une arborescence très profonde ou un cycle de `parentId`
 * (données piégées) ne fait ni déborder la pile ni boucler sans fin.
 */
export function nbDocuments(d: DossierDetail, lieu: Emplacement): number {
  return compteurDocuments(d)(lieu);
}

/** Même calcul que `nbDocuments`, index construits une seule fois pour plusieurs emplacements. */
export function compteurDocuments(d: DossierDetail): (lieu: Emplacement) => number {
  const enfants = new Map<Emplacement, number[]>();
  for (const s of d.sousDossiers) {
    const l = enfants.get(s.parentId);
    if (l) l.push(s.id);
    else enfants.set(s.parentId, [s.id]);
  }
  const parLieu = new Map<Emplacement, number>();
  for (const f of d.documents) parLieu.set(f.sousDossierId, (parLieu.get(f.sousDossierId) ?? 0) + 1);

  return (lieu) => {
    let n = 0;
    const vus = new Set<Emplacement>();
    const pile: Emplacement[] = [lieu];
    while (pile.length) {
      const cur = pile.pop() as Emplacement;
      if (vus.has(cur)) continue;
      vus.add(cur);
      n += parLieu.get(cur) ?? 0;
      for (const id of enfants.get(cur) ?? []) pile.push(id);
    }
    return n;
  };
}

/**
 * Emplacement affiché : celui de la route ; sans emplacement dans la route mais avec un document (lien venu du profil
 * d'une fiche ou de son historique), celui du document, pour qu'il s'affiche même rangé dans un sous-dossier.
 */
export function lieuAffiche(d: DossierDetail, route: { sousDossierId?: number | null; documentId?: number }): Emplacement {
  if (route.sousDossierId !== undefined) return route.sousDossierId;
  if (route.documentId === undefined) return null;
  return d.documents.find((f) => f.id === route.documentId)?.sousDossierId ?? null;
}

/** Chemin de la racine jusqu'au sous-dossier (inclus) ; vide pour la racine ; null si le sous-dossier n'existe pas. */
export function chemin(d: DossierDetail, lieu: Emplacement): SousDossier[] | null {
  const out: SousDossier[] = [];
  const seen = new Set<number>();
  let cur = lieu;
  while (cur !== null) {
    if (seen.has(cur)) return null;
    seen.add(cur);
    const s = d.sousDossiers.find((x) => x.id === cur);
    if (!s) return null;
    out.unshift(s);
    cur = s.parentId;
  }
  return out;
}
