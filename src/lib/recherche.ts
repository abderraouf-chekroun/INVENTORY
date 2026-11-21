/*
 * Recherche globale (spécification § 10.2) : chaque groupe renvoie jusqu'à 50 résultats et indique s'il y en a davantage.
 */

/** Total annoncé par le back, lu prudemment : jamais moins que le nombre de résultats reçus. */
export function totalGroupe(recus: number, total: unknown): number {
  return typeof total === 'number' && Number.isInteger(total) && total > recus ? total : recus;
}

/** Titre d'un groupe : « Employés · 12 », ou « Employés · 50 sur 134 » quand tous ne sont pas affichés. */
export function titreGroupe(label: string, recus: number, total: number): string {
  return total > recus ? `${label} · ${recus} sur ${total}` : `${label} · ${recus}`;
}

/** Nom accessible d'un groupe : « Employés : 12 résultats », « Employés : 50 résultats affichés sur 134 ». */
export function nomGroupe(label: string, recus: number, total: number): string {
  const r = `${recus} résultat${recus > 1 ? 's' : ''}`;
  return total > recus ? `${label} : ${r} affichés sur ${total}` : `${label} : ${r}`;
}

/** Note sous un groupe incomplet : « 84 autres : précisez la recherche pour les voir. », sinon null. */
export function noteGroupe(recus: number, total: number): string | null {
  const reste = total - recus;
  if (reste <= 0) return null;
  return `${reste} autre${reste > 1 ? 's' : ''} : précisez la recherche pour ${reste > 1 ? 'les' : 'le'} voir.`;
}
