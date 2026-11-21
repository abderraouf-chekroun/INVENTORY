import type { Parametres } from '../api';

/*
 * Thème et densité : attributs `data-theme` et `data-density` sur <html>, comme le prototype
 * (thème « system » et densité « eq » = attribut absent).
 * Une copie est gardée dans localStorage pour l'appliquer avant même la première lecture du back
 * (main.tsx), ce qui évite tout éclair de mauvais thème au démarrage.
 */

export type Appearance = Pick<Parametres, 'theme' | 'densite'>;

const STORAGE_KEY = 'apparence';

export function applyAppearance({ theme, densite }: Appearance): void {
  const el = document.documentElement;
  if (theme === 'system') delete el.dataset.theme;
  else el.dataset.theme = theme;
  if (densite === 'eq') delete el.dataset.density;
  else el.dataset.density = densite;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme, densite }));
  } catch {
    /* stockage indisponible : sans conséquence */
  }
}

/** Dernière apparence connue (localStorage), ou null. */
export function readStoredAppearance(): Appearance | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return null;
    const { theme, densite } = v as Record<string, unknown>;
    if ((theme === 'system' || theme === 'light' || theme === 'dark') && (densite === 'eq' || densite === 'compact')) {
      return { theme, densite };
    }
  } catch {
    /* ignoré */
  }
  return null;
}
