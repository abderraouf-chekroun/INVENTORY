import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { ErrorAlert } from './Alert';

/**
 * Affiche une lecture : rien pendant le premier chargement (base locale, quasi instantané),
 * l'erreur en `.alert.bad` si la lecture échoue, sinon `children(data)`.
 *
 *   const fiche = useFiche(route.id);
 *   return <QueryView query={fiche}>{(f) => <>…</>}</QueryView>;
 */
export function QueryView<T>({ query, children }: {
  query: UseQueryResult<T, unknown>;
  children: (data: T) => ReactNode;
}) {
  if (query.isError) return <ErrorAlert error={query.error} title="Chargement impossible" />;
  if (query.data === undefined) return null;
  return <>{children(query.data)}</>;
}
