import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { flushAll } from './pages/blocs/autosave';
import { api, EVENEMENT_FERMETURE, type Parametres } from './api';
import App from './App';
import { applyAppearance, readStoredAppearance } from './lib/appearance';
import { installerBlocageDepot } from './lib/depot';
import { creerFermeture } from './lib/fermeture';
import { queryClient } from './lib/queryClient';
import { qk } from './lib/queryKeys';
import './styles/index.css';

/*
 * Démarrage sans éclair de thème :
 * 1. la dernière apparence connue (localStorage) est appliquée avant tout rendu ;
 * 2. les paramètres sont lus dans le back (attente bornée), appliqués et mis en cache ;
 * 3. l'application est rendue seulement ensuite.
 */
const stored = readStoredAppearance();
if (stored) applyAppearance(stored);

// Un fichier déposé sur la fenêtre ne doit pas remplacer l'application (lib/depot.ts).
installerBlocageDepot(window);

/** Fermeture : le back émet `fermeture-demandee` ; on envoie la saisie en attente puis on détruit la fenêtre. */
function ecouterFermeture() {
  const fenetre = getCurrentWindow();
  const fermer = creerFermeture(flushAll, () => fenetre.destroy());
  listen(EVENEMENT_FERMETURE, () => void fermer()).catch(() => {
    /* écoute impossible : le back fermera la fenêtre seul après son délai */
  });
}

async function readParametres(): Promise<Parametres | null> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500));
  try {
    return await Promise.race([api.parametresLire(), timeout]);
  } catch {
    return null; // hors de Tauri ou back indisponible : l'application s'affiche quand même
  }
}

async function start() {
  if (isTauri()) ecouterFermeture();
  const parametres = await readParametres();
  if (parametres) {
    applyAppearance(parametres);
    queryClient.setQueryData(qk.parametres, parametres);
  }
  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  );
}

void start();
