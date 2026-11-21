// Paramètres (affichage, données), persistance après fermeture et relance, fenêtre et instance unique.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { processusEnCours } from '../outils/application.mjs';
import { lire } from '../outils/bases.mjs';
import { attendreTitre, bouton, casePapier, champPapier, magasinPapier, menu, modale, ouvrirDossier, verifierAttributs } from '../outils/ui.mjs';
import { attendre, egal, pause, verifier } from '../outils/verifs.mjs';
import { COMPTEURS_EXEMPLE, lireCompteurs } from './demarrage.mjs';
import { NOM_DOSSIER } from './dossiers.mjs';
import { EMPLOYE } from './fiches.mjs';
import { MODELE } from './studio.mjs';
import { choisirAffichage } from './transverses.mjs';

const DERNIERE_SAISIE = 'Dernière saisie avant fermeture';

/** Clique sur un bouton de la barre de titre. La page peut disparaître pendant le clic (Fermer). */
async function barreDeTitre(page, nom) {
  await page.locator('.titlebar .ctl').getByRole('button', { name: nom, exact: true }).click({ timeout: 5000, noWaitAfter: true });
}

export const affichage = {
  id: 'parametres-affichage',
  titre: 'Paramètres 6.1 : thème et densité appliqués et enregistrés',
  async executer(ctx) {
    const { page, app } = ctx;
    ctx.etape('Sombre');
    await choisirAffichage(page, { theme: 'Sombre' });
    await verifierAttributs(page, { theme: 'dark', densite: null }, 'Attributs après « Sombre »');
    const fond = await page.evaluate(() => getComputedStyle(document.querySelector('.main')).backgroundColor);
    ctx.etape('Système puis Clair');
    await choisirAffichage(page, { theme: 'Système' });
    await verifierAttributs(page, { theme: null, densite: null }, 'Attributs après « Système »');
    await choisirAffichage(page, { theme: 'Clair' });
    await verifierAttributs(page, { theme: 'light', densite: null }, 'Attributs après « Clair »');
    verifier(fond !== await page.evaluate(() => getComputedStyle(document.querySelector('.main')).backgroundColor),
      'Le fond de la zone principale doit changer entre Sombre et Clair');

    ctx.etape('densité Compacte : lignes de tableau plus basses');
    await menu(page, 'Employés');
    const hauteurEq = await page.locator('.content tbody tr').first().evaluate((tr) => tr.getBoundingClientRect().height);
    await choisirAffichage(page, { densite: 'Compacte' });
    await verifierAttributs(page, { theme: 'light', densite: 'compact' }, 'Attributs après « Compacte »');
    await menu(page, 'Employés');
    const hauteurCompacte = await page.locator('.content tbody tr').first().evaluate((tr) => tr.getBoundingClientRect().height);
    verifier(hauteurCompacte < hauteurEq, `La densité compacte doit réduire la hauteur des lignes (${hauteurEq} → ${hauteurCompacte})`);
    await ctx.capture('parametres/densite-compacte');

    ctx.etape('Sombre + Compacte, enregistrés dans le back (vérifiés après relance)');
    await choisirAffichage(page, { theme: 'Sombre' });
    egal(await app.appeler('parametres_lire'), { theme: 'dark', densite: 'compact', donneesExemple: true }, 'Paramètres enregistrés');
  },
};

export const persistance = {
  id: 'persistance',
  titre: 'Fermer puis relancer : données, dernière saisie, thème et densité conservés',
  async executer(ctx) {
    let { page, app } = ctx;
    verifier(ctx.memo.docModele, 'Ce scénario utilise le document créé par le scénario « studio ».');
    ctx.etape('saisie dans un document, puis fermeture immédiate par la barre de titre');
    await ouvrirDossier(page, NOM_DOSSIER, ctx.memo.docModele);
    const champ = champPapier(page, 'Champ e2e');
    await champ.fill(DERNIERE_SAISIE);
    await barreDeTitre(page, 'Fermer'); // moins de 400 ms après la frappe : la saisie est encore en attente
    const code = await app.attendreFin(15_000);
    verifier(code !== null, 'Le bouton « Fermer » doit terminer le processus');
    egal(code, 0, 'Code de sortie à la fermeture');
    await app.deconnecter();

    ctx.etape('relance sur le même dossier de données');
    app = await ctx.lancer();
    page = app.page;
    await verifierAttributs(page, { theme: 'dark', densite: 'compact' }, 'Thème et densité après relance');
    egal(await app.appeler('parametres_lire'), { theme: 'dark', densite: 'compact', donneesExemple: true }, 'Paramètres après relance');
    await attendreTitre(page, 'Tableau de bord');

    ctx.etape('la dernière saisie est là');
    await ouvrirDossier(page, NOM_DOSSIER, ctx.memo.docModele);
    egal(await champPapier(page, 'Champ e2e').inputValue(), DERNIERE_SAISIE, 'Champ saisi juste avant la fermeture');
    egal(await casePapier(page.locator('.paper'), 'Case e2e').isChecked(), true, 'Case cochée');
    egal(await magasinPapier(page, 'Magasin e2e').inputValue(), 'RAM', 'Choix du Magasin');

    ctx.etape('fiches, dossiers, modèles et fichiers importés toujours là');
    const a = await app.appeler('entites_lister', { kind: 'a' });
    verifier(a.some((x) => x.libelle === EMPLOYE.libelle && x.code === ctx.memo.codes.employe), 'L’employé créé doit être conservé avec son identifiant');
    verifier((await app.appeler('modeles_lister')).some((m) => m.nom === MODELE), 'Le modèle créé doit être conservé');
    const detail = await app.appeler('dossier_detail', { id: ctx.memo.dossier });
    egal(detail.documents.filter((d) => d.origine === 'import' && fs.existsSync(d.fichierChemin)).length, 2, 'Fichiers importés conservés');
    if (ctx.memo.imports?.[0]) {
      await page.locator('.files .file', { hasText: ctx.memo.imports[0] }).click();
      await attendre(() => page.locator('.paper img').evaluate((i) => i.complete && i.naturalWidth > 0), 'L’image importée s’affiche après relance');
    }
    await choisirAffichage(page, { theme: 'Clair', densite: 'Équilibrée' });
    await verifierAttributs(page, { theme: 'light', densite: null }, 'Retour à Clair / Équilibrée');
  },
};

export const fenetre = {
  id: 'fenetre',
  titre: 'Fenêtre : agrandir / restaurer, double clic, réduire, instance unique',
  async executer(ctx) {
    const { page, app } = ctx;
    // L'état de la fenêtre est lu par Windows : la page n'a plus le droit de le demander à Tauri.
    const agrandie = async () => (await app.etatFenetre()).agrandie;
    await menu(page, 'Tableau de bord');
    egal(await agrandie(), false, 'Fenêtre non agrandie au départ');

    ctx.etape('taille et position à l’ouverture');
    const etat = await app.etatFenetre();
    const echelle = etat.dpi / 96;
    const logique = { l: Math.round(etat.client.l / echelle), h: Math.round(etat.client.h / echelle) };
    const ecranLogique = { l: etat.ecran.l / echelle, h: etat.ecran.h / echelle };
    ctx.etape(`fenêtre ${logique.l} × ${logique.h} (écran ${ecranLogique.l} × ${ecranLogique.h}, échelle ${echelle})`);
    if (ecranLogique.l >= 1280) egal(logique.l, 1280, 'Largeur à l’ouverture');
    verifier(logique.h <= 800 && logique.h >= Math.min(640, ecranLogique.h - 80), `Hauteur à l’ouverture (${logique.h})`);
    verifier(etat.exterieur.y >= etat.ecran.y && etat.exterieur.x >= etat.ecran.x - 8,
      `La barre de titre doit être à l’écran (position ${etat.exterieur.x}, ${etat.exterieur.y})`);

    ctx.etape('agrandir puis restaurer par le bouton');
    await barreDeTitre(page, 'Agrandir');
    await attendre(agrandie, '« Agrandir » doit agrandir la fenêtre');
    await attendre(async () => (await page.locator('.titlebar .ctl button').nth(1).getAttribute('aria-label')) === 'Restaurer',
      'Le bouton doit devenir « Restaurer »');
    await ctx.capture('fenetre/agrandie');
    await barreDeTitre(page, 'Restaurer');
    await attendre(async () => !(await agrandie()), '« Restaurer » doit restaurer la fenêtre');
    await attendre(async () => (await page.locator('.titlebar .ctl button').nth(1).getAttribute('aria-label')) === 'Agrandir',
      'Le bouton doit redevenir « Agrandir »');

    ctx.etape('double clic sur la barre de titre');
    const barre = await page.locator('.titlebar').boundingBox();
    await page.mouse.dblclick(barre.x + barre.width / 2, barre.y + barre.height / 2);
    await attendre(agrandie, 'Le double clic sur la barre de titre doit agrandir la fenêtre');
    await page.mouse.dblclick(barre.x + barre.width / 2, barre.y + barre.height / 2);
    await attendre(async () => !(await agrandie()), 'Un second double clic doit restaurer la fenêtre');

    ctx.etape('réduire');
    await barreDeTitre(page, 'Réduire');
    await attendre(async () => (await app.etatFenetre()).reduite, '« Réduire » doit réduire la fenêtre');

    ctx.etape('second lancement : pas de seconde instance, la fenêtre revient');
    const second = spawn(app.exe, [], { env: app.env(), stdio: 'ignore' });
    const codeSecond = await Promise.race([
      new Promise((r) => second.once('exit', (c) => r(c))),
      pause(20_000).then(() => 'délai'),
    ]);
    if (codeSecond === 'délai') second.kill();
    egal(codeSecond, 0, 'Le second lancement doit se terminer aussitôt (code 0)');
    await attendre(async () => {
      const e = await app.etatFenetre();
      return !e.reduite && e.visible;
    }, 'Le second lancement doit ramener la fenêtre existante');
    egal(processusEnCours(app.exe), 1, 'Une seule instance de l’application');
    egal(app.termine, null, 'La première instance tourne toujours');
    egal(app.browser.contexts()[0].pages().length, 1, 'Une seule fenêtre');
  },
};

export const donnees = {
  id: 'parametres-donnees',
  titre: 'Paramètres 6.3 / 6.4 : informations, effacer toutes les données, recharger l’exemple',
  async executer(ctx) {
    const { page, app } = ctx;
    await menu(page, 'Paramètres');

    ctx.etape('informations système et emplacement réels');
    const infos = await page.locator('.sec', { hasText: 'Informations système' }).innerText();
    verifier(infos.includes('1.8.2'), 'Version de l’application affichée (1.8.2)');
    const emplacement = await page.locator('.sec', { hasText: 'Données' }).last().innerText();
    verifier(emplacement.includes(ctx.donnees), `Emplacement des données affiché (${ctx.donnees})`);
    verifier(emplacement.includes(path.join(ctx.donnees, 'donnees.sqlite')), 'Chemin de la base affiché');

    ctx.etape('effacer toutes les données');
    const sauvegardes = path.join(ctx.donnees, 'sauvegardes');
    const copiesAvant = fs.readdirSync(path.join(ctx.donnees, 'fichiers')).sort();
    verifier(copiesAvant.length > 0, 'Des copies de fichiers importés doivent exister avant l’effacement (scénario « import-reel »)');
    // § 14 : la seule sauvegarde existante est celle du chargement des données d'exemple (scénario « donnees-exemple »).
    const initiales = fs.existsSync(sauvegardes) ? fs.readdirSync(sauvegardes) : [];
    egal(initiales, ctx.memo.sauvegardeChargement ? [ctx.memo.sauvegardeChargement] : [],
      'Seule la sauvegarde du chargement des données d’exemple existe avant le premier effacement');
    await bouton(page, 'Effacer toutes les données').click();
    await attendre(() => modale(page).isVisible(), 'La confirmation ne s’ouvre pas');
    await ctx.capture('parametres/confirmation-effacer');
    await bouton(modale(page), 'Effacer toutes les données').click();
    await attendre(async () => !(await modale(page).count()), 'La confirmation ne se ferme pas');
    await attendre(async () => !(await page.locator('.titlebar').innerText()).includes('Données d’exemple'),
      'La barre de titre ne doit plus afficher « Données d’exemple »');
    egal(fs.readdirSync(path.join(ctx.donnees, 'fichiers')).length, 0, 'Les copies de fichiers importés sont supprimées');

    ctx.etape('sauvegarde automatique créée avant l’effacement');
    const dossiersSauvegarde = (fs.existsSync(sauvegardes) ? fs.readdirSync(sauvegardes) : []).filter((n) => !initiales.includes(n));
    egal(dossiersSauvegarde.length, 1, 'Nouvelles sauvegardes dans sauvegardes/');
    verifier(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(-\d+)?$/.test(dossiersSauvegarde[0]),
      `Nom de la sauvegarde (AAAA-MM-JJ_HH-MM-SS) : ${dossiersSauvegarde[0]}`);
    const sauvegarde = path.join(sauvegardes, dossiersSauvegarde[0]);
    egal(fs.readdirSync(path.join(sauvegarde, 'fichiers')).sort(), copiesAvant, 'Copies de fichiers importés dans la sauvegarde');
    const sauve = lire(path.join(sauvegarde, 'donnees.sqlite'), (db) => ({
      dossier: db.prepare('SELECT COUNT(*) AS n FROM dossiers WHERE nom = ?').get(NOM_DOSSIER).n,
      fiches: db.prepare('SELECT COUNT(*) AS n FROM entites').get().n,
    }));
    egal(sauve.dossier, 1, `La base sauvegardée contient « ${NOM_DOSSIER} »`);
    verifier(sauve.fiches > 0, 'La base sauvegardée contient les fiches');
    await menu(page, 'Tableau de bord');
    egal((await lireCompteurs(page)).map((k) => k.valeur), ['0', '0', '0', '0'], 'Compteurs après effacement');
    await ctx.capture('parametres/base-vide');
    await menu(page, 'Employés');
    verifier(await page.locator('.content .empty', { hasText: 'Aucun employé pour l’instant' }).isVisible(), 'Le répertoire vide affiche son message');
    ctx.etape('les modèles standards survivent à l’effacement');
    egal((await app.appeler('modeles_lister')).map((m) => [m.nom, m.standard, m.actif, m.theme]),
      ['État des besoins', 'Fiche d’intervention informatique', 'Fiche d’identification', 'Fiche pour formatage PC']
        .map((n) => [n, true, true, 'Support informatique']), 'Modèles après effacement');
    await menu(page, 'Dossiers & Archives');
    await bouton(page, 'Créer un dossier').click();
    await attendreTitre(page, 'Créer un dossier');
    // § 11.1 : un dossier n'a ni employé ni machine ; sur une base vide, rien ne bloque la création d'un dossier.
    egal(await page.locator('.content form .alert').count(), 0, 'Formulaire de dossier sur base vide : aucune alerte');
    egal(await page.locator('.content form .choix-fiche').count(), 0, 'Le formulaire de dossier ne propose ni employé ni machine');
    await ctx.capture('parametres/formulaire-dossier-base-vide');
    await bouton(page, 'Créer le dossier').click();
    await attendre(async () => /^Dossier \d{4}-\d{2}$/.test(await page.locator('.content .ph h1').first().innerText()),
      'Un dossier doit pouvoir être créé sur une base vide');
    egal((await app.appeler('dossiers_lister')).map((d) => [d.statut.role, 'aId' in d || 'bId' in d]), [['cours', false]], 'Dossier créé « En cours », sans fiches rattachées');
    egal((await app.appeler('parametres_lire')).donneesExemple, false, 'donnees_exemple = 0');

    ctx.etape('recharger les données d’exemple');
    await menu(page, 'Paramètres');
    await bouton(page, 'Recharger les données d’exemple').click();
    await bouton(modale(page), 'Recharger les données d’exemple').click();
    await attendre(async () => (await page.locator('.titlebar').innerText()).includes('Données d’exemple'),
      'La barre de titre doit afficher à nouveau « Données d’exemple »');
    await menu(page, 'Tableau de bord');
    egal(await lireCompteurs(page), COMPTEURS_EXEMPLE, 'Compteurs après rechargement');
    egal((await app.appeler('parametres_lire')).theme, 'light', 'Les préférences d’affichage sont conservées');
    egal(fs.readdirSync(sauvegardes).length, initiales.length + 2, 'Le rechargement est lui aussi précédé d’une sauvegarde');

    ctx.etape('4 réinitialisations : la première sauvegarde (moins de 7 jours) est conservée');
    for (let i = 0; i < 2; i++) {
      await pause(1100); // une seconde d'écart : noms de sauvegarde distincts sans suffixe
      await app.appeler('donnees_reinitialiser', { mode: 'exemple' });
    }
    const apres = fs.readdirSync(sauvegardes).sort();
    egal(apres.length, initiales.length + 4, `Sauvegardes après 4 réinitialisations (${apres.join(', ')})`);
    verifier(apres.includes(dossiersSauvegarde[0]), `La première sauvegarde (${dossiersSauvegarde[0]}) existe toujours`);
    for (const n of initiales) verifier(apres.includes(n), `La sauvegarde du chargement des données d’exemple (${n}) existe toujours`);
    verifier(fs.existsSync(path.join(sauvegarde, 'donnees.sqlite')), 'La base de la première sauvegarde existe toujours');
    await menu(page, 'Tableau de bord');
    egal(await lireCompteurs(page), COMPTEURS_EXEMPLE, 'Compteurs après les réinitialisations');
  },
};

export const fermeture = {
  id: 'fermeture',
  titre: 'Fermer termine le processus',
  async executer(ctx) {
    const { page, app } = ctx;
    await barreDeTitre(page, 'Fermer');
    const code = await app.attendreFin(15_000);
    verifier(code !== null, 'Le processus doit se terminer après « Fermer »');
    egal(code, 0, 'Code de sortie');
    await app.deconnecter();
    await attendre(() => processusEnCours(app.exe) === 0, 'Aucun processus de l’application ne doit subsister', 10_000);
  },
};
