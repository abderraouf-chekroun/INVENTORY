import { useMutation, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';

/**
 * Ce qu'une écriture invalide une fois réussie :
 * - 'all' (défaut) : tout le cache. C'est la règle à suivre sauf raison précise.
 * - 'none' : rien (ex. enregistrement automatique d'un document pendant la saisie, pour ne pas relire l'éditeur).
 * - une liste de clés `qk.…` : seulement ces domaines.
 */
export type Invalidation = 'all' | 'none' | readonly QueryKey[];

export async function invalidate(qc: QueryClient, what: Invalidation = 'all'): Promise<void> {
  if (what === 'none') return;
  if (what === 'all') {
    await qc.invalidateQueries();
    return;
  }
  await Promise.all(what.map((queryKey) => qc.invalidateQueries({ queryKey })));
}

export interface ActionOptions<TVars, TData> {
  /** Voir `Invalidation`. Défaut : 'all'. */
  invalidate?: Invalidation;
  /**
   * 'global' (défaut) : en cas d'échec, le message du back s'affiche dans le bandeau rouge de la coquille.
   * 'local' : rien n'est affiché automatiquement ; affichez `<ErrorAlert error={action.error} />` près du formulaire.
   */
  errors?: 'global' | 'local';
  /** Appelé après l'invalidation (les données affichées sont déjà relues). */
  onSuccess?: (data: TData, vars: TVars) => void;
  onError?: (error: unknown, vars: TVars) => void;
}

/**
 * Toute écriture vers le back passe par ce hook : appel, invalidation du cache, affichage de l'erreur.
 *
 *   const archiver = useAction((id: number) => api.entiteBasculer(id));
 *   <button className="btn" disabled={archiver.isPending} onClick={() => archiver.mutate(x.id)}>Archiver</button>
 *
 * Utilisez `mutate` (pas `mutateAsync`, qui rejette et oblige à attraper l'erreur vous-même).
 */
export function useAction<TVars = void, TData = unknown>(
  fn: (vars: TVars) => Promise<TData>,
  options: ActionOptions<TVars, TData> = {},
) {
  const qc = useQueryClient();
  return useMutation<TData, unknown, TVars>({
    mutationFn: fn,
    meta: { errors: options.errors ?? 'global' },
    onSuccess: async (data, vars) => {
      await invalidate(qc, options.invalidate ?? 'all');
      options.onSuccess?.(data, vars);
    },
    onError: (error, vars) => options.onError?.(error, vars),
  });
}
