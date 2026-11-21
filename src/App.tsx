import { useEffect } from 'react';
import { applyAppearance } from './lib/appearance';
import { useParametres } from './lib/queries';
import type { Route } from './nav';
import Creation from './pages/Creation';
import Dashboard from './pages/Dashboard';
import Dossier from './pages/Dossier';
import Dossiers from './pages/Dossiers';
import FormDossier from './pages/FormDossier';
import FormEntite from './pages/FormEntite';
import Fiche from './pages/Fiche';
import Magasin from './pages/Magasin';
import Parametres from './pages/Parametres';
import Repertoire from './pages/Repertoire';
import Studio from './pages/Studio';
import { Shell } from './shell/Shell';

/**
 * Registre route → page. Chaque page reçoit sa route typée (`PageProps<'…'>`).
 * `key={seq}` : chaque nouvelle page (go / root / back / replace) est montée à neuf,
 * donc son état local (onglet, formulaire, modale) repart de zéro, comme dans le prototype.
 */
function renderPage(route: Route, seq: number) {
  switch (route.name) {
    case 'dashboard': return <Dashboard key={seq} route={route} />;
    case 'rep': return <Repertoire key={seq} route={route} />;
    case 'fiche': return <Fiche key={seq} route={route} />;
    case 'dossiers': return <Dossiers key={seq} route={route} />;
    case 'dossier': return <Dossier key={seq} route={route} />;
    case 'creation': return <Creation key={seq} route={route} />;
    case 'form-entite': return <FormEntite key={seq} route={route} />;
    case 'form-dossier': return <FormDossier key={seq} route={route} />;
    case 'studio': return <Studio key={seq} route={route} />;
    case 'magasin': return <Magasin key={seq} route={route} />;
    case 'parametres': return <Parametres key={seq} route={route} />;
  }
}

export default function App() {
  // Thème et densité suivent les paramètres (lus au démarrage par main.tsx, puis à chaque modification).
  const parametres = useParametres();
  useEffect(() => {
    if (parametres.data) applyAppearance(parametres.data);
  }, [parametres.data]);

  return <Shell renderPage={renderPage} />;
}
