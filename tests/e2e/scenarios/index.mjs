// Ordre d'exécution : les scénarios s'enchaînent sur la même base. Ceux marqués `toujours` sont joués même avec
// --seulement : « premier-lancement » (base vide, § 14) et « donnees-exemple » (données d'exemple chargées depuis
// Paramètres, dont partent les scénarios suivants). « de-zero » se joue entre les deux, sur la base vide.
// Les derniers (`sansApplication`) lancent leurs propres instances sur des dossiers de données à part,
// une fois l'instance principale fermée.

import { affectations } from './affectations.mjs';
import { aideSaisie } from './aide.mjs';
import { basesFabriquees, compatibilite } from './bases.mjs';
import { classement, filtres, structuresTypes } from './classement.mjs';
import { donneesExemple, premierLancement } from './demarrage.mjs';
import { dossiers, importReel } from './dossiers.mjs';
import { employes, machines } from './fiches.mjs';
import { modelesStandards } from './modeles.mjs';
import { securite } from './securite.mjs';
import { studio } from './studio.mjs';
import { affichage, donnees, fenetre, fermeture, persistance } from './systeme.mjs';
import { impression, recherche, toursDesEcrans } from './transverses.mjs';
import { champsObligatoires, dossierLibre, etats, rechercheLongue } from './v13.mjs';
import { importFiches, nominations, rattachement, rechercheProfil, suppressionModele } from './v14.mjs';
import { v15 } from './v15.mjs';
import { deZero } from './v151.mjs';

export const SCENARIOS = [
  premierLancement,
  deZero,
  donneesExemple,
  employes,
  machines,
  affectations,
  aideSaisie,
  dossiers,
  rattachement,
  etats,
  dossierLibre,
  nominations,
  importReel,
  importFiches,
  modelesStandards,
  studio,
  champsObligatoires,
  suppressionModele,
  rechercheProfil,
  filtres,
  classement,
  structuresTypes,
  recherche,
  rechercheLongue,
  impression,
  toursDesEcrans,
  affichage,
  persistance,
  fenetre,
  donnees,
  securite,
  fermeture,
  v15,
  basesFabriquees,
  compatibilite,
];
