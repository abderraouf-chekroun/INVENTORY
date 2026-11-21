import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { avisSurPage, useAvis } from '../lib/avis';
import { useGlobalError } from '../lib/errors';
import { nav, type Route } from '../nav';
import { Alert, ErrorAlert } from '../ui/Alert';
import { LimiteErreur } from '../ui/LimiteErreur';
import { isModalOpen } from '../ui/Modal';
import { useChrome } from './chrome';
import { Sidebar } from './Sidebar';
import { TitleBar } from './TitleBar';
import { TopBar } from './TopBar';

/** Bandeau d'erreur global (écritures `useAction` en échec), collé en haut de la zone de contenu. */
function GlobalErrorBanner() {
  const error = useGlobalError((s) => s.error);
  const clear = useGlobalError((s) => s.clear);
  if (!error) return null;
  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
      <ErrorAlert error={error} onDismiss={clear} />
    </div>
  );
}

/** Message bref après une action qui a changé de page (§ 13.2 : « Employé « … » supprimé. »). */
function AvisBanner() {
  const texte = useAvis((s) => s.texte);
  const effacer = useAvis((s) => s.effacer);
  if (!texte) return null;
  return (
    <div role="status" className="avis-zone">
      <Alert tone="info" icon="check" title={texte}>
        <button type="button" className="btn" onClick={effacer}>Fermer</button>
      </Alert>
    </div>
  );
}

/**
 * Coquille de l'application : barre de titre, barre latérale, barre du haut, zone de contenu.
 * `renderPage(route, seq)` fournit la page courante ; la coquille la place dans `.content > .page`.
 */
export function Shell({ renderPage }: { renderPage: (route: Route, seq: number) => ReactNode }) {
  const { route, seq, module, crumbs } = useChrome();
  const content = useRef<HTMLElement>(null);

  // Nouvelle page : défilement en haut, ancien message d'erreur effacé.
  useLayoutEffect(() => {
    if (content.current) content.current.scrollTop = 0;
    useGlobalError.getState().clear();
    avisSurPage(seq);
  }, [seq]);

  // Alt+← : page précédente.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'ArrowLeft' && !isModalOpen()) {
        e.preventDefault();
        nav.back();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="win">
      <TitleBar />
      <div className="shell">
        <Sidebar current={module} />
        <div className="main">
          <TopBar crumbs={crumbs} />
          <main className="content" id="content" ref={content}>
            <div className="page">
              <GlobalErrorBanner />
              <AvisBanner />
              {/* Une erreur de rendu d'une page laisse la coquille en place (barre de titre, navigation). */}
              <LimiteErreur resetKey={route}>{renderPage(route, seq)}</LimiteErreur>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
