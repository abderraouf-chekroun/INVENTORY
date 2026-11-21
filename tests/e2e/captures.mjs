// Captures d'écran de la documentation (docs/images/*.png), prises sur l'exécutable de production avec les données
// d'exemple (fictives), dans un dossier de données temporaire : les vraies données ne sont jamais ouvertes.
//
//   node tests/e2e/captures.mjs                 exécutable src-tauri/target/release/inventory.exe
//   node tests/e2e/captures.mjs --exe <chemin>  autre exécutable
//
// Thème clair, rendu de 1280 × 800 pixels CSS. Comme la suite de bout en bout, le script pilote l'application par
// le port de débogage de WebView2 : aucune autre instance d'INVENTORY ne doit être ouverte.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Application, processusEnCours } from './outils/application.mjs';
import { attendreTitre, menu, ouvrirDocument, ouvrirDossier, ouvrirFiche } from './outils/ui.mjs';
import { attendre, pause } from './outils/verifs.mjs';
import { fermerWindows } from './outils/windows.mjs';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const exe = args[0] === '--exe' ? path.resolve(args[1]) : path.join(racine, 'src-tauri', 'target', 'release', 'inventory.exe');
const sortie = path.join(racine, 'docs', 'images');

async function lancer(donnees, profil) {
  const app = new Application({ exe, donnees, profil });
  await app.demarrer();
  await app.imposerTaille(1280, 800);
  return app;
}

/** Capture de la fenêtre entière, après vérification qu'aucune erreur n'est affichée. */
async function capturer(app, nom) {
  const page = app.page;
  await page.mouse.move(1279, 799);
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await pause(600);
  const erreurs = await page.locator('.alert.bad:visible').count();
  if (erreurs) throw new Error(`${nom} : ${erreurs} alerte(s) d'erreur affichée(s)`);
  if (await page.locator('.modal[role="dialog"]:visible').count()) throw new Error(`${nom} : une fenêtre de dialogue est ouverte`);
  const fichier = path.join(sortie, `${nom}.png`);
  await page.screenshot({ path: fichier, scale: 'css' });
  console.log(`  ${fichier}`);
}

async function principal() {
  if (!fs.existsSync(exe)) throw new Error(`Exécutable introuvable : ${exe}`);
  if (processusEnCours(exe) > 0) throw new Error('INVENTORY est déjà ouvert : fermez-le (instance unique).');
  fs.mkdirSync(sortie, { recursive: true });
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'entites-dossiers-captures-'));
  const donnees = path.join(travail, 'donnees');
  const profil = path.join(travail, 'webview2');
  let app = null;
  try {
    // 1. Données d'exemple et thème clair, puis relance : l'interface part d'un état neuf.
    app = await lancer(donnees, profil);
    await app.appeler('donnees_reinitialiser', { mode: 'exemple' });
    await app.appeler('parametre_definir', { cle: 'theme', valeur: 'light' });
    await app.appeler('parametre_definir', { cle: 'densite', valeur: 'eq' });
    await app.tuer();
    app = await lancer(donnees, profil);
    const page = app.page;
    if (app.journal.some((j) => j.type !== 'requete')) throw new Error(`Journal inattendu : ${JSON.stringify(app.journal.slice(0, 5))}`);

    // Fiche d'employé la plus fournie (affectations et documents).
    const employes = (await app.appeler('entites_lister', { kind: 'a' })).filter((e) => e.actif);
    let meilleure = null;
    for (const e of employes) {
      const f = await app.appeler('entite_fiche', { id: e.id });
      const score = f.affectations.length > 0 && f.documents.length > 0 ? f.affectations.length + f.documents.length : 0;
      if (score && (!meilleure || score > meilleure.score)) meilleure = { e, score };
    }
    if (!meilleure) throw new Error('Aucun employé d’exemple avec affectations et documents.');

    // Dossier « En cours » le plus récent, avec un document issu d'un modèle (à la racine ou dans un sous-dossier).
    const dossiers = (await app.appeler('dossiers_lister')).filter((d) => d.statut.role === 'cours');
    let dossier = null;
    for (const d of dossiers) {
      const detail = await app.appeler('dossier_detail', { id: d.id });
      const doc = detail.documents.find((x) => x.origine === 'modele');
      if (doc && !dossier) {
        const sous = detail.sousDossiers.find((s) => s.id === doc.sousDossierId);
        dossier = { nom: d.nom, doc: doc.nom, sous: sous?.nom ?? null };
      }
    }
    if (!dossier) throw new Error('Aucun dossier d’exemple ouvert avec un document issu d’un modèle.');
    const standard = (await app.appeler('modeles_lister')).find((m) => m.standard && m.actif);

    console.log('Captures :');
    await menu(page, 'Tableau de bord');
    await capturer(app, 'dashboard');

    await ouvrirFiche(page, 'a', meilleure.e.libelle);
    await capturer(app, 'employee');

    await ouvrirDossier(page, dossier.nom);
    if (dossier.sous) {
      await page.locator('.folder.sub', { hasText: dossier.sous }).click();
      await attendreTitre(page, dossier.sous);
    }
    await ouvrirDocument(page, dossier.doc);
    await capturer(app, 'dossier');

    await menu(page, 'Création');
    await page.locator('.hubcard', { hasText: 'Modèles de document' }).click();
    await attendreTitre(page, 'Modèles de document');
    await page.locator('.mitem', { has: page.locator('b', { hasText: standard.nom }) }).first().click();
    await attendre(async () => (await page.inputValue('#m-nom')) === standard.nom, 'Le modèle standard doit s’ouvrir dans le Studio');
    await capturer(app, 'studio');

    await menu(page, 'Dossiers & Archives');
    const vueGroupes = page.locator('.seg button', { hasText: 'Groupes' });
    if ((await vueGroupes.getAttribute('aria-pressed')) !== 'true') await vueGroupes.click();
    await capturer(app, 'archives');

    await menu(page, 'Paramètres');
    // Seule la zone de contenu défile (jamais la fenêtre : la barre de titre et la barre latérale restent en place).
    await page.getByText('Catégories, états, structures et types de machine', { exact: true }).first().evaluate((el) => {
      const cible = el.closest('section') ?? el;
      let zone = cible.parentElement;
      while (zone && !(zone.scrollHeight > zone.clientHeight && /(auto|scroll)/.test(getComputedStyle(zone).overflowY))) {
        zone = zone.parentElement;
      }
      if (zone) zone.scrollTop += cible.getBoundingClientRect().top - zone.getBoundingClientRect().top - 24;
      window.scrollTo(0, 0);
    });
    await capturer(app, 'settings');

    const problemes = app.journal.filter((j) => j.type !== 'requete');
    if (problemes.length) throw new Error(`Messages relevés pendant les captures : ${JSON.stringify(problemes.slice(0, 5))}`);
  } finally {
    if (app) await app.tuer();
    fermerWindows();
    await pause(1000);
    fs.rmSync(travail, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
}

principal().catch((e) => {
  console.error(e?.stack ?? e);
  process.exitCode = 1;
});
