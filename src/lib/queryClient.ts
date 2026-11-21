import { MutationCache, QueryClient } from '@tanstack/react-query';
import { showError } from './errors';

declare module '@tanstack/react-query' {
  interface Register {
    /** Les erreurs sont normalisées avec `versApiError` au moment de l'affichage (voir ui/ErrorAlert). */
    defaultError: unknown;
    mutationMeta: {
      /** 'global' (défaut) : l'erreur s'affiche dans le bandeau de la coquille. 'local' : la page l'affiche elle-même. */
      errors?: 'global' | 'local';
    };
  }
}

export const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      if (mutation.meta?.errors !== 'local') showError(error);
    },
  }),
  defaultOptions: {
    queries: {
      // Base locale : relire à chaque montage coûte peu et garantit des données fraîches.
      staleTime: 0,
      refetchOnWindowFocus: false,
      // Une erreur du back est déterministe : inutile de réessayer.
      retry: false,
    },
    mutations: { retry: false },
  },
});
