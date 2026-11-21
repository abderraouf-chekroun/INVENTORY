// Premier lancement (§ 14, version 1.5.1) : base créée VIDE — aucun employé, aucune machine, aucun dossier ni document,
// seulement les quatre modèles standards —, chaque écran dans son état vide, barre de titre « INVENTORY » sans badge.
// Puis « données-exemple » : les données d'exemple chargées par le bouton de Paramètres (6.4), comme un utilisateur,
// pour les scénarios suivants (tableau de bord cohérent, employés et machines fictifs).

import fs from 'node:fs';
import path from 'node:path';
import { attendreTitre, bouton, menu, modale } from '../outils/ui.mjs';
import { attendre, egal, pause, verifier } from '../outils/verifs.mjs';
import { FORME_ID } from './fiches.mjs';

/** Les quatre modèles standards (§ 8.6), dans l'ordre du Studio. */
export const MODELES_STANDARDS = ['État des besoins', 'Fiche d’intervention informatique', 'Fiche d’identification', 'Fiche pour formatage PC'];

/** Compteurs d'une base vide (§ 14). */
export const COMPTEURS_VIDES = [
  { label: 'Employés actifs', valeur: '0', detail: 'sur 0 fiche' },
  { label: 'Machines actives', valeur: '0', detail: 'sur 0 fiche' },
  { label: 'Dossiers ouverts', valeur: '0', detail: 'dont 0 en attente de pièce finale' },
  { label: 'Fiches à compléter', valeur: '0', detail: '0 employé · 0 machine' },
];

/** Cartes « Répartition » et « Volume » du tableau de bord : { titre, legende } chacune. */
export async function lireCartes(page) {
  return page.$$eval('.cols .card', (els) => els.map((c) => ({
    titre: c.querySelector('h3').textContent.trim(),
    legende: [...c.querySelectorAll('.legend li')].map((li) =>
      [...li.childNodes].map((n) => n.textContent.trim()).filter(Boolean).join(' | ')),
  })));
}

/** Texte de l'état vide (`.empty`) de la section du tableau de bord dont le titre contient `titreSection`. */
export async function videDeSection(page, titreSection) {
  return page.$$eval('.sec', (secs, t) => {
    const s = secs.find((x) => x.querySelector('h2')?.textContent.includes(t));
    return s?.querySelector('.empty')?.textContent.trim() ?? null;
  }, titreSection);
}

/** Barre de titre réduite à son texte (espaces normalisés). */
export const texteBarreDeTitre = async (page) => (await page.locator('.titlebar').innerText()).replace(/\s+/g, ' ').trim();

/** Aucun « NaN », « undefined », « Infinity » ni « null » affiché dans la zone de contenu. */
export async function verifierSansValeurCassee(page, ecran) {
  const texte = await page.locator('.content').innerText();
  const casse = texte.match(/NaN|undefined|Infinity|\bnull\b/);
  verifier(!casse, `${ecran} : valeur cassée affichée (« ${casse?.[0]} »)`);
}

/** Les modèles du Studio : [[nom, détail]]. */
export async function modelesDuStudio(page) {
  return page.$$eval('.mlist .mitem', (xs) => xs.map((x) => [x.querySelector('b').textContent.trim(), x.querySelector('small').textContent.trim()]));
}

/** Compteurs attendus avec les données d'exemple (spécification § 8.7, src-tauri/src/db/exemple.rs). */
export const COMPTEURS_EXEMPLE = [
  { label: 'Employés actifs', valeur: '7', detail: 'sur 8 fiches' },
  { label: 'Machines actives', valeur: '7', detail: 'sur 8 fiches' },
  { label: 'Dossiers ouverts', valeur: '4', detail: 'dont 2 en attente de pièce finale' },
  { label: 'Fiches à compléter', valeur: '4', detail: '2 employés · 2 machines' },
];

/**
 * Employés fictifs des données d'exemple : [nom affiché, fiche complète]. § 10.5 : l'identifiant d'une fiche complète
 * est codé avec une clé propre à chaque base ; seule sa forme est prévisible (EMP-XXXXX-XXXXX).
 */
export const EMPLOYES_EXEMPLE = [
  ['BENALI Sofia', true],
  ['BRAHIMI Yacine', true],
  ['CHERIF Amine', false],
  ['DJEBBAR Samia', false],
  ['HADDAD Karim', true],
  ['LEFÈVRE Thomas', true], // archivé
  ['MANSOURI Leïla', true],
  ['OULD ALI Nadia', true],
];
export const MACHINES_EXEMPLE = [
  ['PC accueil', 'PC-0101'],
  ['PC atelier', null],
  ['PC secrétariat', 'PC-0106'],
  ['Portable direction', 'LT-0105'],
  ['Portable formation', 'LT-0108'],
  ['Portable mission 01', null],
  ['Poste laboratoire 02', 'PC-0103'],
  ['Station de calcul', 'ST-0001'], // archivée
];

export async function lireCompteurs(page) {
  await page.waitForSelector('.kpis .kpi');
  return page.$$eval('.kpis .kpi', (els) => els.map((e) => ({
    label: e.querySelector('small').textContent.trim(),
    valeur: e.querySelector('strong').textContent.trim(),
    detail: e.querySelector('em').textContent.trim(),
  })));
}

/** Lignes de l'inventaire à compléter (section 1.3) : [nom, badge, bouton]. */
export async function lireInventaire(page) {
  return page.$$eval('.sec', (secs) => {
    const s = secs.find((x) => x.querySelector('h2')?.textContent.includes('Inventaire à compléter'));
    return [...s.querySelectorAll('.files .file')].map((f) => [
      f.querySelector('b').textContent.trim(),
      f.querySelector('.badge')?.textContent.trim() ?? '',
      f.querySelector('.btn')?.textContent.trim() ?? '',
    ]);
  });
}

export const premierLancement = {
  id: 'premier-lancement',
  titre: 'Base créée vide (seulement les 4 modèles standards) : écrans vides, barre de titre sans badge',
  // Joué même avec --seulement : les autres scénarios partent de cette instance.
  toujours: true,
  async executer(ctx) {
    const { page, app } = ctx;
    ctx.etape('base et dossier des fichiers créés dans le dossier de données');
    verifier(fs.existsSync(path.join(ctx.donnees, 'donnees.sqlite')), 'La base donnees.sqlite n’a pas été créée.');
    verifier(fs.statSync(path.join(ctx.donnees, 'fichiers')).isDirectory(), 'Le dossier fichiers/ n’a pas été créé.');
    egal(fs.readdirSync(path.join(ctx.donnees, 'fichiers')), [], 'Aucun fichier importé dans une base neuve');
    verifier(!fs.existsSync(path.join(ctx.donnees, 'sauvegardes')), 'Une base neuve n’a rien à sauvegarder avant migration.');

    ctx.etape('le back : aucune donnée, seulement les modèles standards et leur thème');
    egal(await app.appeler('parametres_lire'), { theme: 'system', densite: 'eq', donneesExemple: false }, 'Paramètres d’une base neuve');
    egal(await app.appeler('entites_lister', { kind: 'a' }), [], 'Aucun employé');
    egal(await app.appeler('entites_lister', { kind: 'b' }), [], 'Aucune machine');
    egal(await app.appeler('dossiers_lister'), [], 'Aucun dossier');
    egal(await app.appeler('categories_lister', { kind: 'a' }), [], 'Aucune structure');
    egal(await app.appeler('categories_lister', { kind: 'b' }), [], 'Aucun type de machine');
    egal(await app.appeler('magasin_lister'), [], 'Aucun mot-clé du Magasin');
    egal((await app.appeler('themes_lister')).map((t) => [t.nom, t.actif]), [['Support informatique', true]], 'Une seule catégorie : celle des modèles standards');
    egal((await app.appeler('statuts_lister')).map((s) => [s.nom, s.role, s.nbDossiers]),
      [['En cours', 'cours', 0], ['Pièce manquante', 'piece', 0], ['Clôturé', 'clos', 0]], 'Les trois états fournis, sans dossier');
    egal((await app.appeler('modeles_lister')).map((m) => [m.nom, m.standard, m.actif, m.theme, m.nbDocuments]),
      MODELES_STANDARDS.map((n) => [n, true, true, 'Support informatique', 0]), 'Les quatre modèles standards, et eux seuls');

    ctx.etape('barre de titre : « INVENTORY », sans « Données d’exemple »');
    await attendreTitre(page, 'Tableau de bord');
    // Le badge dépend des paramètres lus au démarrage : la barre est relue pendant une seconde.
    for (let i = 0; i < 5; i++) {
      egal(await texteBarreDeTitre(page), 'INVENTORY', 'Texte de la barre de titre');
      await pause(200);
    }
    egal(await page.locator('.titlebar .demo').count(), 0, 'Aucun badge « Données d’exemple »');

    ctx.etape('barre latérale : Employés et Machines');
    egal(await page.$$eval('.side .nav', (bs) => bs.map((b) => b.title)),
      ['Tableau de bord', 'Employés', 'Machines', 'Dossiers & Archives', 'Création', 'Paramètres'], 'Entrées de la barre latérale');

    ctx.etape('tableau de bord vide : compteurs à zéro, graphiques sans valeur cassée, textes qui disent quoi faire');
    egal(await lireCompteurs(page), COMPTEURS_VIDES, 'Compteurs du tableau de bord');
    egal(await page.locator('.kpi.att').count(), 0, 'Aucun compteur en alerte : rien à compléter');
    const cartes = await lireCartes(page);
    egal(cartes[0], {
      titre: 'Répartition des dossiers par état0 dossier',
      legende: ['En cours | 0 | 0 %', 'Pièce manquante | 0 | 0 %', 'Clôturé | 0 | 0 %'],
    }, 'Carte « Répartition des dossiers par état » vide');
    egal(await page.locator('.stack i').evaluateAll((is) => is.map((i) => i.title)), ['Aucun dossier'], 'Barre de répartition vide : une seule zone « Aucun dossier »');
    const barres = await page.$$eval('.bars .plot i', (els) => els.map((i) => ({ titre: i.title, hauteur: i.style.height })));
    egal(barres.length, 12, 'Nombre de barres du volume mensuel');
    egal(barres.map((b) => [Number(b.titre.split(' : ')[1]), b.hauteur]), barres.map(() => [0, '0%']), 'Volume mensuel : douze barres à zéro');
    egal(await page.$$eval('.bars .y span', (s) => s.map((x) => x.textContent.trim())), ['3', '2', '1', '0'], 'Graduations du volume sur base vide');
    egal(await videDeSection(page, 'Inventaire à compléter'),
      'Aucun employé pour l’instant. Créez le premier depuis Employés, avec « Créer un employé ».', 'Inventaire à compléter (employés) vide');
    await page.locator('.seg button', { hasText: 'Machines' }).click();
    await attendre(async () => (await videDeSection(page, 'Inventaire à compléter'))?.startsWith('Aucune machine'), 'L’inventaire des machines ne s’affiche pas');
    egal(await videDeSection(page, 'Inventaire à compléter'),
      'Aucune machine pour l’instant. Créez la première depuis Machines, avec « Créer une machine ».', 'Inventaire à compléter (machines) vide');
    await page.locator('.seg button', { hasText: 'Employés' }).click();
    egal(await videDeSection(page, 'Dossiers ouverts'),
      'Aucun dossier pour l’instant. Créez le premier depuis Dossiers & Archives, avec « Créer un dossier ».', 'Dossiers ouverts vide');
    await verifierSansValeurCassee(page, 'Tableau de bord');
    await ctx.capture('01-tableau-de-bord-premier-lancement');

    ctx.etape('Employés et Machines : répertoires vides, avec le bouton de création');
    for (const [rep, vide, creer] of [
      ['Employés', 'Aucun employé pour l’instant. Créez le premier avec « Créer un employé ».', 'Créer un employé'],
      ['Machines', 'Aucune machine pour l’instant. Créez la première avec « Créer une machine ».', 'Créer une machine'],
    ]) {
      await menu(page, rep);
      egal(await page.locator('.content .empty').allInnerTexts(), [vide], `${rep} : état vide`);
      egal(await page.locator('.content table').count(), 0, `${rep} : aucun tableau`);
      egal((await page.locator('.fbar .cnt').innerText()).trim(), '0 fiche', `${rep} : compteur de fiches`);
      verifier(await bouton(page, creer).isVisible(), `${rep} : bouton « ${creer} »`);
      await verifierSansValeurCassee(page, rep);
      await ctx.capture(`premier-lancement/${rep === 'Employés' ? '02-employes' : '03-machines'}-vides`);
    }

    ctx.etape('Dossiers & Archives : vide, « Créer un dossier »');
    await menu(page, 'Dossiers & Archives');
    egal(await page.locator('.content .empty').allInnerTexts(), ['Aucun dossier pour l’instant. Cliquez sur « Créer un dossier » pour commencer.'],
      'Dossiers & Archives : état vide');
    verifier(await bouton(page, 'Créer un dossier').isVisible(), 'Bouton « Créer un dossier »');
    await verifierSansValeurCassee(page, 'Dossiers & Archives');
    await ctx.capture('premier-lancement/04-dossiers-archives-vide');

    ctx.etape('Création, puis Modèles de document : les quatre modèles standards');
    await menu(page, 'Création');
    await page.locator('.hubcard', { hasText: 'Modèles de document' }).click();
    await attendreTitre(page, 'Modèles de document');
    egal(await modelesDuStudio(page), MODELES_STANDARDS.map((n) => [n, 'Support informatiqueStandard · Actif']), 'Modèles du Studio sur une base neuve');
    await verifierSansValeurCassee(page, 'Modèles de document');
    await ctx.capture('premier-lancement/05-creation-modeles-standards');

    ctx.etape('recherche globale : aucun résultat, texte qui dit quoi chercher');
    await page.keyboard.press('Control+k');
    await page.keyboard.type('Benali');
    const info = page.locator('#dd .info');
    await attendre(async () => (await info.isVisible()) && (await page.locator('#dd').getAttribute('aria-busy')) === 'false'
      && (await info.innerText()).startsWith('Aucun résultat'), 'La recherche globale ne répond pas');
    egal((await info.innerText()).trim(), 'Aucun résultat pour « Benali ». Essayez un nom, un prénom, une marque ou un identifiant.',
      'Recherche globale sur base vide');
    await page.keyboard.press('Escape');
    await page.locator('#q').fill('');
    await page.keyboard.press('Escape');
    await menu(page, 'Tableau de bord');
    egal(await page.locator('.titlebar .demo').count(), 0, 'Toujours aucun badge « Données d’exemple »');
  },
};

export const donneesExemple = {
  id: 'donnees-exemple',
  titre: 'Paramètres 6.4 : données d’exemple chargées à la demande, tableau de bord cohérent et barre de titre',
  // Joué même avec --seulement : les scénarios suivants partent des données d'exemple.
  toujours: true,
  async executer(ctx) {
    const { page, app } = ctx;
    const sauvegardes = path.join(ctx.donnees, 'sauvegardes');
    const avant = fs.existsSync(sauvegardes) ? fs.readdirSync(sauvegardes) : [];

    ctx.etape('Paramètres : « Recharger les données d’exemple », confirmé');
    await menu(page, 'Paramètres');
    await bouton(page, 'Recharger les données d’exemple').click();
    await attendre(() => modale(page).isVisible(), 'La confirmation ne s’ouvre pas');
    await bouton(modale(page), 'Recharger les données d’exemple').click();
    await attendre(async () => !(await modale(page).count()), 'La confirmation ne se ferme pas');

    ctx.etape('barre de titre');
    await attendre(async () => (await page.locator('.titlebar').innerText()).includes('Données d’exemple'),
      'La barre de titre doit afficher « Données d’exemple »');
    egal(await texteBarreDeTitre(page), 'INVENTORY Données d’exemple', 'Texte de la barre de titre');
    egal((await app.appeler('parametres_lire')).donneesExemple, true, 'donnees_exemple = 1');

    ctx.etape('le chargement est précédé d’une sauvegarde de la base d’avant');
    const apres = fs.readdirSync(sauvegardes);
    egal(apres.filter((n) => !avant.includes(n)).length, 1, `Une nouvelle sauvegarde avant le chargement (${apres.join(', ')})`);
    ctx.memo.sauvegardeChargement = apres.find((n) => !avant.includes(n));

    ctx.etape('données d’exemple : employés et machines fictifs');
    const lister = async (kind) => (await app.appeler('entites_lister', { kind }))
      .map((e) => [e.libelle, e.code]).sort((x, y) => x[0].localeCompare(y[0], 'fr'));
    const employes = await lister('a');
    egal(employes.map(([l, c]) => [l, c !== null]), EMPLOYES_EXEMPLE, 'Employés d’exemple (nom affiché, identifiant attribué ou non)');
    for (const [l, c] of employes) verifier(c === null || FORME_ID.test(c), `Identifiant de ${l} de la forme EMP-XXXXX-XXXXX (obtenu ${c})`);
    const codes = employes.map(([, c]) => c).filter(Boolean);
    egal(new Set(codes).size, codes.length, 'Identifiants des employés d’exemple distincts');
    // Identifiants de cette base, pour les scénarios suivants (ils changent d'une base à l'autre).
    ctx.memo.codes = Object.fromEntries(employes.filter(([, c]) => c));
    egal(await lister('b'), MACHINES_EXEMPLE, 'Machines d’exemple (nom, identifiant)');
    egal((await app.appeler('modeles_lister')).map((m) => m.nom), MODELES_STANDARDS, 'Modèles : les quatre standards, sans doublon');

    ctx.etape('compteurs 1.1');
    await menu(page, 'Tableau de bord');
    egal(await lireCompteurs(page), COMPTEURS_EXEMPLE, 'Compteurs du tableau de bord');
    egal(await page.locator('.kpi.att').evaluateAll((ks) => ks.map((k) => k.querySelector('small').textContent.trim())),
      ['Fiches à compléter'], 'Compteur en alerte : « Fiches à compléter » (4 fiches)');

    ctx.etape('répartition et volume 1.2');
    const cartes = await lireCartes(page);
    egal(cartes[0], {
      titre: 'Répartition des dossiers par état7 dossiers',
      legende: ['En cours | 2 | 29 %', 'Pièce manquante | 2 | 29 %', 'Clôturé | 3 | 43 %'],
    }, 'Carte « Répartition des dossiers par état »');
    const td = await app.appeler('tableau_de_bord');
    const barres = await page.$$eval('.bars .plot i', (els) => els.map((i) => ({ titre: i.title, courant: i.classList.contains('m') })));
    egal(barres.length, 12, 'Nombre de barres du volume mensuel');
    egal(barres.map((b) => Number(b.titre.split(' : ')[1])), td.volume.mois, 'Valeurs des barres (documents par mois)');
    verifier(td.volume.mois.reduce((s, n) => s + n, 0) > 0, 'Les données d’exemple doivent placer des documents sur l’année en cours.');
    const mois = new Date().getMonth();
    egal(barres.map((b) => b.courant), barres.map((_, i) => i === mois), 'Seul le mois en cours porte la couleur « période en cours »');
    egal(td.volume.annee, new Date().getFullYear(), 'Année du volume');

    ctx.etape('inventaire à compléter 1.3 et dossiers ouverts 1.4');
    const inventaire = () => lireInventaire(page);
    egal(await inventaire(), [['CHERIF Amine', 'Fiche à compléter', 'Compléter'], ['DJEBBAR Samia', 'Fiche à compléter', 'Compléter']],
      'Inventaire à compléter (employés)');
    await page.locator('.seg button', { hasText: 'Machines' }).click();
    await attendre(async () => (await inventaire()).some((l) => l[0] === 'PC atelier'), 'L’inventaire des machines ne s’affiche pas');
    egal((await inventaire()).sort(), [['PC atelier', 'Sans identifiant', 'Saisir'], ['Portable mission 01', 'Sans identifiant', 'Saisir']],
      'Inventaire à compléter (machines)');
    await page.locator('.seg button', { hasText: 'Employés' }).click();
    const enCours = await page.$$eval('.sec', (secs) => {
      const s = secs.find((x) => x.querySelector('h2')?.textContent.includes('Dossiers ouverts'));
      return [...s.querySelectorAll('.files .file')].map((f) => f.querySelector('.badge').textContent.trim());
    });
    egal(enCours.sort(), ['En cours', 'En cours', 'Pièce manquante', 'Pièce manquante'], 'Dossiers ouverts (états)');
    await ctx.capture('01-tableau-de-bord-donnees-exemple');

    ctx.etape('le compteur « Fiches à compléter » ouvre Employés filtré');
    await page.locator('.kpi', { hasText: 'Fiches à compléter' }).click();
    await attendreTitre(page, 'Employés');
    const puce = page.locator('.chip', { hasText: 'Fiche à compléter' });
    egal(await puce.getAttribute('aria-pressed'), 'true', 'Filtre « Fiche à compléter » activé');
    egal(await page.$$eval('.content tbody td.name', (tds) => tds.map((t) => t.textContent.trim())), ['CHERIF Amine', 'DJEBBAR Samia'],
      'Fiches listées avec le filtre « Fiche à compléter »');
    await puce.click();
    await attendre(async () => (await page.locator('.content tbody tr').count()) === 8, 'Le filtre ne se désactive pas');
    await menu(page, 'Tableau de bord');
  },
};
