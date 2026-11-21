/*
 * § 17 (1.8) : petite ligne au-dessus du titre d'une page (« bandeau »). Les « Module N » ne s'affichent plus.
 */

const normaliser = (s: string): string => s.replace(/\s+/g, ' ').trim().toLocaleLowerCase('fr');

/**
 * Texte du bandeau à afficher, ou null s'il n'y a pas de bandeau : « Module N · » est retiré ; s'il ne reste rien, ou
 * si ce qui reste répète le titre de la page (« Magasin » au-dessus de « Magasin »), pas de bandeau.
 * Ex. : « Module 4 · Dossier ouvert » → « Dossier ouvert » ; « Module 1 » → null.
 */
export function texteBandeau(eyebrow: string | null | undefined, titre?: unknown): string | null {
  if (eyebrow == null) return null;
  const reste = eyebrow.replace(/^\s*modules?\s+\d+(\s+et\s+\d+)?\s*(·\s*)?/i, '').trim();
  if (!reste) return null;
  if (typeof titre === 'string' && normaliser(titre) === normaliser(reste)) return null;
  return reste;
}
