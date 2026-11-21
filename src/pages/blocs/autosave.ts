import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { showError } from '../../lib/errors';

/*
 * Enregistrement automatique après une temporisation (≈ 400 ms sans frappe), sans bouton « Enregistrer ».
 *
 * - La saisie reste dans l'état local de l'éditeur : rien n'est relu pendant la frappe (pas de perte de focus
 *   ni de caractères).
 * - Les envois partent dans l'ordre, l'un après l'autre.
 * - La valeur en attente part immédiatement si l'éditeur disparaît (changement de document, de modèle, de page),
 *   si la fenêtre se ferme (`flushAll()` appelé par main.tsx sur l'événement `fermeture-demandee`, voir
 *   lib/fermeture.ts), ou si une action appelle `flushAll()` (clôturer un dossier, dupliquer un modèle…).
 * - Une erreur s'affiche dans le bandeau global.
 */

const actifs = new Set<() => Promise<void>>();

/** Envoie tout ce qui attend encore, dans tous les éditeurs ouverts, et attend la fin des envois. */
export function flushAll(): Promise<void> {
  return Promise.all(Array.from(actifs, (f) => f())).then(() => undefined);
}

export interface AutosaveOptions<T> {
  /** Appelé tout de suite au moment de l'envoi (mise à jour du cache react-query, par exemple). */
  local?: (value: T) => void;
  /** L'écriture vers le back. */
  send: (value: T) => Promise<unknown>;
  /** Temporisation en millisecondes (400 par défaut). */
  delay?: number;
}

export function useAutosave<T>(options: AutosaveOptions<T>) {
  const opts = useRef(options);
  useLayoutEffect(() => {
    opts.current = options;
  });
  const st = useRef<{ pending: { value: T } | null; timer: number | undefined; chain: Promise<void> }>({
    pending: null,
    timer: undefined,
    chain: Promise.resolve(),
  });

  const flush = useCallback((): Promise<void> => {
    const s = st.current;
    if (s.timer !== undefined) {
      window.clearTimeout(s.timer);
      s.timer = undefined;
    }
    if (s.pending) {
      const { value } = s.pending;
      s.pending = null;
      const { local, send } = opts.current;
      local?.(value);
      s.chain = s.chain.then(() => send(value)).then(
        () => undefined,
        (e: unknown) => showError(e),
      );
    }
    return s.chain;
  }, []);

  const schedule = useCallback((value: T) => {
    const s = st.current;
    s.pending = { value };
    if (s.timer !== undefined) window.clearTimeout(s.timer);
    s.timer = window.setTimeout(() => {
      s.timer = undefined;
      void flush();
    }, opts.current.delay ?? 400);
  }, [flush]);

  useEffect(() => {
    actifs.add(flush);
    const onHide = () => void flush();
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onHide);
    return () => {
      actifs.delete(flush);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('beforeunload', onHide);
      void flush();
    };
  }, [flush]);

  return { schedule, flush };
}
