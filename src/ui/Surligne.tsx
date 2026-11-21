import { positionSurlignage } from '../lib/aideSaisie';

/** Texte avec la première occurrence de `q` mise en évidence (`<mark>`), sans tenir compte de la casse ni des accents. */
export function Surligne({ texte, q }: { texte: string; q: string }) {
  const p = positionSurlignage(texte, q);
  if (!p) return <>{texte}</>;
  return <>{texte.slice(0, p[0])}<mark>{texte.slice(p[0], p[1])}</mark>{texte.slice(p[1])}</>;
}
