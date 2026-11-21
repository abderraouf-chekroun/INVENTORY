/*
 * Fonctions pures de l'aide à la saisie (liste de propositions) et de la recherche globale.
 */

/** Sans accents, en minuscules, caractère par caractère (la longueur est gardée quand c'est possible). */
function plier(s: string): string {
  let out = '';
  for (const c of s) {
    const b = c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    out += b.length === c.length ? b : c;
  }
  return out;
}

/**
 * Position de la première occurrence de `q` dans `s`, sans tenir compte de la casse ni des accents
 * (« bén » trouve « BENALI »). null si absente ou si `q` est vide.
 */
export function positionSurlignage(s: string, q: string): [number, number] | null {
  const t = q.trim();
  if (!t || typeof s !== 'string') return null;
  const ps = plier(s);
  const pq = plier(t);
  if (ps.length !== s.length) return null;
  const i = ps.indexOf(pq);
  return i < 0 ? null : [i, i + pq.length];
}

export type ToucheListe = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End';

/**
 * Proposition active après une flèche : ↓ et ↑ bouclent, Début / Fin vont aux extrémités.
 * `actif` = -1 quand aucune proposition n'est active ; renvoie -1 s'il n'y a aucune proposition.
 */
export function prochainIndex(actif: number, n: number, touche: ToucheListe): number {
  if (n <= 0) return -1;
  switch (touche) {
    case 'ArrowDown':
      return actif < 0 || actif >= n - 1 ? 0 : actif + 1;
    case 'ArrowUp':
      return actif <= 0 ? n - 1 : actif - 1;
    case 'Home':
      return 0;
    case 'End':
      return n - 1;
  }
}

/** Identifiant tapé pour la recherche : sans « # » ni espaces autour, sans casse ni accents. */
export function identifiantTape(q: string): string {
  return plier(q.trim().replace(/^#/, '').trim());
}

/** Index du premier élément dont l'identifiant est exactement la saisie (casse et accents ignorés), sinon -1. */
export function indexIdentifiantExact(codes: readonly (string | null)[], q: string): number {
  const t = identifiantTape(q);
  if (!t) return -1;
  return codes.findIndex((c) => typeof c === 'string' && c !== '' && plier(c.trim()) === t);
}
