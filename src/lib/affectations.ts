import type { Affectation, Entite, Kind } from '../api';
import { nomAffiche } from './format';

/*
 * Affectations (spécification § 9.3) : une machine affectée à un employé pendant une période.
 * Sur la fiche d'un employé, `entite` est la machine ; sur celle d'une machine, l'employé.
 */

/** Affectations en cours (fin absente) et terminées, chacune de la plus récente à la plus ancienne. */
export function repartirAffectations(affectations: unknown): { enCours: Affectation[]; terminees: Affectation[] } {
  const toutes = Array.isArray(affectations)
    ? (affectations as unknown[]).filter((x): x is Affectation =>
      typeof x === 'object' && x !== null && typeof (x as Affectation).entite === 'object' && (x as Affectation).entite !== null)
    : [];
  const desc = (k: (x: Affectation) => string) => (x: Affectation, y: Affectation) => k(y).localeCompare(k(x));
  const debut = (x: Affectation) => (typeof x.debut === 'string' ? x.debut : '');
  const fin = (x: Affectation) => (typeof x.fin === 'string' ? x.fin : '');
  return {
    enCours: toutes.filter((x) => !fin(x)).sort(desc(debut)),
    terminees: toutes.filter((x) => fin(x)).sort(desc(fin)),
  };
}

/** (aId, bId) de la paire formée par la fiche affichée et la fiche de l'autre côté. */
export const paireAffectation = (x: Pick<Entite, 'id' | 'kind'>, y: Pick<Entite, 'id'>): [number, number] =>
  (x.kind === 'a' ? [x.id, y.id] : [y.id, x.id]);

/** Répertoire de l'autre côté d'une affectation. */
export const autreKind = (k: Kind): Kind => (k === 'a' ? 'b' : 'a');

/** Bouton d'affectation d'une fiche : « Affecter une machine » (employé) ou « Affecter à un employé » (machine). */
export const libelleAffecter = (k: Kind): string => (k === 'a' ? 'Affecter une machine' : 'Affecter à un employé');

/** Message de confirmation de « Retirer l'affectation », la machine nommée en premier. */
export function messageRetrait(x: Entite, y: Entite): string {
  const [employe, machine] = x.kind === 'a' ? [x, y] : [y, x];
  return `L’affectation de ${nomAffiche(machine)} à ${nomAffiche(employe)} prend fin aujourd’hui. `
    + 'Elle reste visible dans les anciennes affectations des deux fiches. Les documents et les dossiers où ces deux fiches sont nommées ne changent pas.';
}
