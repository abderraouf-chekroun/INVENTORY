// Filtres, tris et navigation (Employés, Machines, Dossiers & Archives, onglets de fiche) ;
// classement (Paramètres 6.2 : catégories, structures, types de machine) et Magasin (5.7) : archiver retire des listes
// de choix sans rien perdre.

import { attendreTitre, bouton, magasinPapier, menu, modale, ouvrirDossier, ouvrirFiche, texteErreur } from '../outils/ui.mjs';
import { attendre, controleVocabulaire, Echec, egal, verifier } from '../outils/verifs.mjs';
import { NOM_DOSSIER, ajouterDepuisModele } from './dossiers.mjs';
import { recap } from './fiches.mjs';
import { MODELE } from './studio.mjs';

const nomsDuTableau = (page) => page.$$eval('.content tbody td.name', (tds) => tds.map((t) => t.textContent.trim()));
const codesDuTableau = (page) => page.$$eval('.content tbody tr', (trs) => trs.map((tr) => tr.children[1].textContent.trim()));
const compteur = async (page) => (await page.locator('.fbar .cnt').innerText()).trim();

export const filtres = {
  id: 'filtres-navigation',
  titre: 'Filtres et tris des répertoires et des dossiers, onglets et fil d’Ariane',
  async executer(ctx) {
    const { page } = ctx;

    ctx.etape('Employés : statut, structure, tri par identifiant, recherche');
    await menu(page, 'Employés');
    await page.selectOption('#f-a-statut', 'archive');
    await attendre(async () => (await compteur(page)) === '1 fiche', 'Filtre « Archivé » : 1 fiche');
    egal(await nomsDuTableau(page), ['LEFÈVRE Thomas'], 'Employés archivés');
    await page.selectOption('#f-a-statut', 'tous');
    await page.selectOption('#f-a-cat', 'Département maintenance');
    egal(await nomsDuTableau(page), ['DJEBBAR Samia', 'KACI Rania', 'OULD ALI Nadia'], 'Employés de la structure « Département maintenance »');
    await page.selectOption('#f-a-cat', '');
    await page.selectOption('#f-a-sort', 'code');
    const parCode = await nomsDuTableau(page);
    egal(parCode.slice(-1), ['DJEBBAR Samia'], 'Tri par identifiant : la fiche à compléter à la fin');
    const ordre = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });
    const codesBack = (await ctx.app.appeler('entites_lister', { kind: 'a' })).map((e) => e.code).filter(Boolean).sort(ordre.compare);
    egal((await codesDuTableau(page)).slice(0, codesBack.length), codesBack, 'Tri par identifiant : du plus petit au plus grand');
    await page.selectOption('#f-a-sort', 'nom');
    egal(await page.locator('#f-a-code').getAttribute('aria-label'), 'Rechercher un employé', 'Nom du champ de recherche');
    await page.fill('#f-a-code', 'tec');
    await attendre(async () => (await compteur(page)) === '4 fiches', 'Recherche « tec » (poste ou identifiant) : 4 fiches');
    await page.fill('#f-a-code', ctx.memo.codes.homonyme);
    egal(await codesDuTableau(page), [ctx.memo.codes.homonyme], 'Recherche par identifiant exact');
    await page.fill('#f-a-code', '');

    ctx.etape('Machines : recherche par identifiant et par marque');
    await menu(page, 'Machines');
    egal(await page.locator('#f-b-code').getAttribute('aria-label'), 'Rechercher une machine', 'Nom du champ de recherche');
    await page.fill('#f-b-code', 'pc-01');
    await attendre(async () => (await compteur(page)) === '3 fiches', 'Recherche « pc-01 » dans l’identifiant : 3 fiches');
    await page.fill('#f-b-code', 'LT-0108');
    egal(await nomsDuTableau(page), ['Portable formation'], 'Recherche par identifiant exact');
    await page.fill('#f-b-code', 'lenovo');
    egal(await nomsDuTableau(page), ['Portable direction', 'Poste laboratoire 02'], 'Recherche par marque');
    await page.fill('#f-b-code', '');
    await page.locator('.chip', { hasText: 'Sans identifiant' }).click();
    egal(await nomsDuTableau(page), ['PC atelier', 'Portable mission 01'], 'Puce « Sans identifiant »');
    await page.locator('.chip', { hasText: 'Sans identifiant' }).click();
    await page.selectOption('#f-b-cat', 'Station de travail');
    egal(await nomsDuTableau(page), ['Station de calcul'], 'Type de machine « Station de travail »');
    await page.selectOption('#f-b-cat', '');

    ctx.etape('Dossiers & Archives : filtres, regroupement');
    await menu(page, 'Dossiers & Archives');
    const fbar = page.locator('.fbar');
    await fbar.locator('label', { hasText: /^État/ }).locator('select').selectOption({ label: 'Clôturé' });
    await attendre(async () => (await compteur(page)) === '3 dossiers', 'Filtre « Clôturé » : 3 dossiers');
    for (const b of await page.locator('.folders .folder .badge').allInnerTexts()) egal(b.trim(), 'Clôturé', 'Badge des dossiers filtrés');
    await fbar.locator('label', { hasText: /^État/ }).locator('select').selectOption('tous');
    await fbar.locator('label', { hasText: /^Regrouper par/ }).locator('select').selectOption('annee');
    const annee = new Date().getFullYear();
    const groupes = await page.$$eval('.content .group-h', (hs) => hs.map((h) => h.firstChild.textContent.trim()));
    egal(groupes, [`Année ${annee - 2}`, `Année ${annee - 1}`, `Année ${annee}`], 'Groupes par année');
    await fbar.locator('label', { hasText: /^Regrouper par/ }).locator('select').selectOption('theme');

    ctx.etape('fiche d’une machine : « Documents où figure la machine » ouvre le document dans son dossier');
    await ouvrirFiche(page, 'b', 'PC accueil');
    const premier = page.locator('.sec', { hasText: 'Documents où figure la machine' }).locator('.files .file').first();
    const [nomDoc, nomDossier] = (await premier.locator('small').innerText()).split(' · ').map((s) => s.trim());
    await premier.click();
    await attendre(async () => (await page.locator('.preview .pv-h b').innerText()).trim() === nomDoc,
      'Le document lié doit s’afficher dans son dossier');
    verifier((await page.locator('.crumbs').innerText()).includes(nomDossier), 'Le fil d’Ariane mène au bon dossier');

    ctx.etape('bouton Retour, puis premier maillon du fil d’Ariane (retour au module, historique vidé)');
    await bouton(page, 'Retour').click();
    await attendreTitre(page, 'PC accueil');
    await page.locator('.crumbs button', { hasText: 'Machines' }).click();
    await attendreTitre(page, 'Machines');
    verifier(await bouton(page, 'Retour').isDisabled(), 'Le maillon du module ouvre le répertoire sans historique');
  },
};

export const classement = {
  id: 'classement-magasin',
  titre: 'Paramètres 6.2 (catégories, structures, types) et Magasin 5.7 : ajouter, archiver, réactiver',
  async executer(ctx) {
    const { page, app } = ctx;
    const sectionDe = (titre) => page.locator('.set').filter({ has: page.locator('.line b', { hasText: titre }) });

    ctx.etape('ajouter une structure, archiver une structure : listes de choix à jour');
    await menu(page, 'Paramètres');
    for (const g of ['Catégories', 'Structures des employés', 'Types de machine']) {
      verifier(await page.locator('.group-h', { hasText: g }).isVisible(), `Groupe « ${g} » dans Paramètres 6.2`);
    }
    await page.getByLabel('Nom de la nouvelle structure').fill('Structure e2e');
    await bouton(page, 'Ajouter la structure').click();
    await attendre(async () => (await sectionDe('Division informatique').locator('.line b').allInnerTexts()).includes('Structure e2e'),
      'La structure ajoutée n’apparaît pas');
    await page.getByLabel('Nom de la nouvelle structure').fill('Division informatique');
    await bouton(page, 'Ajouter la structure').click();
    await attendre(async () => (await sectionDe('Division informatique').locator('.alert.bad').count()) > 0,
      'Une structure en double doit être refusée avec un message');
    await page.getByRole('button', { name: 'Archiver Département maintenance' }).click();
    await attendre(() => page.getByRole('button', { name: 'Réactiver Département maintenance' }).isVisible(),
      'La structure archivée doit proposer « Réactiver »');
    await page.getByLabel('Nom du nouveau type de machine').fill('Tablette');
    await bouton(page, 'Ajouter le type').click();
    await attendre(async () => (await sectionDe('PC de bureau').locator('.line b').allInnerTexts()).includes('Tablette'), 'Le type ajouté n’apparaît pas');
    await menu(page, 'Création');
    await page.locator('.hubcard', { hasText: 'Créer un employé' }).click();
    await attendreTitre(page, 'Créer un employé');
    const structures = await page.locator('#n-cat option').allInnerTexts();
    verifier(structures.includes('Structure e2e') && !structures.some((g) => g.startsWith('Département maintenance')),
      `Structures proposées : ${structures.join(', ')}`);
    await menu(page, 'Création');
    await page.locator('.hubcard', { hasText: 'Créer une machine' }).click();
    await attendreTitre(page, 'Créer une machine');
    verifier((await page.locator('#n-cat option').allInnerTexts()).includes('Tablette'), 'Le nouveau type est proposé');
    await ouvrirFiche(page, 'a', 'DJEBBAR Samia');
    egal((await recap(page)).Structure, 'Département maintenance', 'Une fiche garde sa structure archivée');
    await menu(page, 'Paramètres');
    await page.getByRole('button', { name: 'Réactiver Département maintenance' }).click();
    await attendre(() => page.getByRole('button', { name: 'Archiver Département maintenance' }).isVisible(), 'La structure doit être réactivée');

    ctx.etape('archiver une catégorie : plus proposée à la création d’un dossier');
    await page.getByRole('button', { name: 'Archiver Maintenance' }).click();
    await attendre(() => page.getByRole('button', { name: 'Réactiver Maintenance' }).isVisible(), 'La catégorie doit être archivée');
    await menu(page, 'Dossiers & Archives');
    await bouton(page, 'Créer un dossier').click();
    await attendreTitre(page, 'Créer un dossier');
    const themes = await page.locator('form.form label', { hasText: 'Catégorie' }).locator('select option').allInnerTexts();
    egal(themes, ['Support informatique'], 'Catégories proposées');
    await menu(page, 'Paramètres');
    await page.getByRole('button', { name: 'Réactiver Maintenance' }).click();
    await attendre(() => page.getByRole('button', { name: 'Archiver Maintenance' }).isVisible(), 'La catégorie doit être réactivée');

    ctx.etape('Magasin : ajouter un mot-clé, archiver un mot-clé déjà choisi');
    await menu(page, 'Création');
    await page.locator('.hubcard', { hasText: 'Magasin' }).click();
    await attendreTitre(page, 'Magasin');
    await page.getByLabel('Nouveau mot-clé').fill('Clavier');
    await bouton(page, 'Ajouter au Magasin').click();
    await attendre(async () => (await page.locator('.sec .cnt').innerText()) === '4 mots-clés actifs', 'Compteur après ajout');
    await page.getByRole('button', { name: 'Archiver RAM' }).click();
    await attendre(async () => (await page.locator('.sec .cnt').innerText()) === '3 mots-clés actifs', 'Compteur après archivage');
    verifier(ctx.memo.docModele, 'Ce contrôle utilise le document créé par le scénario « studio ».');
    await ouvrirDossier(page, NOM_DOSSIER, ctx.memo.docModele);
    const choix = magasinPapier(page, 'Magasin e2e');
    egal(await choix.inputValue(), 'RAM', 'La valeur déjà choisie reste affichée');
    egal(await choix.locator('option').allInnerTexts(), ['Choisir dans le Magasin…', 'RAM', 'Stockage', 'Écran', 'Clavier'],
      'Mots-clés proposés : les actifs, plus la valeur archivée déjà choisie (ordre du Magasin)');
    // Ailleurs (nouveau document, sans choix), le mot-clé archivé n'est plus proposé.
    await ajouterDepuisModele(page, MODELE);
    const autre = magasinPapier(page, 'Magasin e2e');
    egal(await autre.inputValue(), '', 'Nouveau document sans choix');
    egal(await autre.locator('option').allInnerTexts(), ['Choisir dans le Magasin…', 'Stockage', 'Écran', 'Clavier'], 'Mots-clés proposés ailleurs');

    ctx.etape('réactiver le mot-clé (le scénario « structures-types » poursuit avec la structure et le type ajoutés)');
    await menu(page, 'Création');
    await page.locator('.hubcard', { hasText: 'Magasin' }).click();
    await page.getByRole('button', { name: 'Réactiver RAM' }).click();
    await attendre(async () => (await page.locator('.sec .cnt').innerText()) === '4 mots-clés actifs', 'Compteur après réactivation');
    verifier((await app.appeler('magasin_lister')).every((m) => m.actif), 'Tous les mots-clés sont actifs');
  },
};

/** Nombre de fiches affiché sous le nom d'une catégorie (§ 9.1). */
const libelleFiches = (kind, n) => {
  if (n <= 0) return kind === 'a' ? 'Aucun employé' : 'Aucune machine';
  return `${n} ${kind === 'a' ? 'employé' : 'machine'}${n > 1 ? 's' : ''}`;
};

/** Catégories affichées dans Paramètres 6.2 pour un répertoire : [[nom, nombre de fiches affiché]]. */
async function categoriesAffichees(page, kind) {
  const groupe = kind === 'a' ? 'Structures des employés' : 'Types de machine';
  const set = page.locator('.group-h', { hasText: groupe }).locator('xpath=following-sibling::div[contains(@class, "set")][1]');
  return set.locator('.cl-item .line').evaluateAll((ls) => ls.map((l) => [
    l.querySelector('.cl-nom b')?.textContent.trim() ?? '', l.querySelector('.cl-nom small')?.textContent.trim() ?? '',
  ]));
}

/** Renomme une catégorie en place (bouton « Renommer {nom} », champ « Nouveau nom de {nom} », « Enregistrer »). */
async function renommer(page, ancien, nouveau) {
  await page.getByRole('button', { name: `Renommer ${ancien}`, exact: true }).click();
  const champ = page.getByRole('textbox', { name: `Nouveau nom de ${ancien}`, exact: true });
  await attendre(() => champ.isVisible(), `Le champ « Nouveau nom de ${ancien} » doit s’afficher`);
  egal(await champ.inputValue(), ancien, 'Le champ est prérempli avec le nom actuel');
  verifier(await champ.evaluate((el) => document.activeElement === el && el.selectionStart === 0 && el.selectionEnd === el.value.length),
    'Le champ a le focus, nom sélectionné');
  await champ.fill(nouveau);
  await bouton(page.locator('.cl-item', { has: champ }), 'Enregistrer').click();
  return champ;
}

export const structuresTypes = {
  id: 'structures-types',
  titre: 'Paramètres 6.2 (§ 9.1) : structures et types renommés, nombre de fiches, suppression refusée avec motif ou acceptée, doublon refusé',
  async executer(ctx) {
    const { page, app } = ctx;
    const rangee = (nom) => page.locator('.cl-item', { has: page.locator('.cl-nom b', { hasText: new RegExp(`^${nom}$`) }) });

    ctx.etape('nombre de fiches de chaque structure et de chaque type (actives et archivées), comme dans le back');
    await menu(page, 'Paramètres');
    for (const kind of ['a', 'b']) {
      const back = await app.appeler('categories_lister', { kind });
      const fiches = await app.appeler('entites_lister', { kind });
      for (const c of back) {
        egal(c.nbFiches, fiches.filter((e) => e.categorieId === c.id).length, `nbFiches de « ${c.nom} » (fiches actives et archivées)`);
      }
      egal((await categoriesAffichees(page, kind)).sort(), back.map((c) => [c.nom, libelleFiches(kind, c.nbFiches)]).sort(),
        `Catégories affichées (${kind === 'a' ? 'structures' : 'types de machine'})`);
    }
    egal((await categoriesAffichees(page, 'a')).find((c) => c[0] === 'Structure e2e'), ['Structure e2e', 'Aucun employé'], 'Structure vide');
    egal((await categoriesAffichees(page, 'b')).find((c) => c[0] === 'Tablette'), ['Tablette', 'Aucune machine'], 'Type vide');
    egal((await categoriesAffichees(page, 'a')).find((c) => c[0] === 'Département maintenance'), ['Département maintenance', '3 employés'],
      'Structure « Département maintenance »');

    ctx.etape('renommer une structure : le nouveau nom partout (fiche, répertoire, formulaire)');
    await renommer(page, 'Département maintenance', 'Département de la maintenance');
    await attendre(async () => (await categoriesAffichees(page, 'a')).some((c) => c[0] === 'Département de la maintenance'),
      'La structure renommée doit s’afficher sous son nouveau nom');
    verifier(!(await categoriesAffichees(page, 'a')).some((c) => c[0] === 'Département maintenance'), 'L’ancien nom a disparu');
    await attendre(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Renommer Département de la maintenance'),
      'Après l’enregistrement, le focus revient sur « Renommer »');
    await ouvrirFiche(page, 'a', 'DJEBBAR Samia');
    egal((await recap(page)).Structure, 'Département de la maintenance', 'La fiche affiche la structure renommée');
    await menu(page, 'Employés');
    verifier((await page.locator('#f-a-cat option').allInnerTexts()).includes('Département de la maintenance'), 'Filtre du répertoire');
    egal(await page.locator('.content tbody tr', { hasText: 'OULD ALI Nadia' }).locator('td').nth(3).innerText(), 'Département de la maintenance',
      'Colonne « Structure » du répertoire');
    await bouton(page, 'Créer un employé').click();
    await attendreTitre(page, 'Créer un employé');
    verifier((await page.locator('#n-cat option').allInnerTexts()).includes('Département de la maintenance'), 'Structure proposée dans le formulaire');

    ctx.etape('renommer un type de machine : le nouveau nom sur la fiche et dans le répertoire');
    await menu(page, 'Paramètres');
    await renommer(page, 'PC de bureau', 'Ordinateur de bureau');
    await attendre(async () => (await categoriesAffichees(page, 'b')).some((c) => c[0] === 'Ordinateur de bureau'), 'Le type renommé doit s’afficher');
    await ouvrirFiche(page, 'b', 'PC accueil');
    egal((await recap(page))['Type de machine'], 'Ordinateur de bureau', 'La fiche affiche le type renommé');
    await menu(page, 'Machines');
    egal(await page.locator('.content tbody tr', { hasText: 'PC secrétariat' }).locator('td').nth(3).innerText(), 'Ordinateur de bureau',
      'Colonne « Type de machine » du répertoire');

    ctx.etape('doublon de nom refusé (casse ignorée), pour une structure et pour un type');
    await menu(page, 'Paramètres');
    const champ = await renommer(page, 'Structure e2e', 'division INFORMATIQUE');
    const ligne = page.locator('.cl-item', { has: champ });
    await attendre(async () => (await texteErreur(ligne)).includes('Cette structure existe déjà.'), 'Le doublon de structure doit être refusé avec son message');
    await bouton(ligne, 'Annuler').click();
    await attendre(() => page.getByRole('button', { name: 'Renommer Structure e2e', exact: true }).isVisible(), 'Annuler garde l’ancien nom');
    const champType = await renommer(page, 'Tablette', 'ordinateur PORTABLE');
    const ligneType = page.locator('.cl-item', { has: champType });
    await attendre(async () => (await texteErreur(ligneType)).includes('Ce type de machine existe déjà.'), 'Le doublon de type doit être refusé avec son message');
    await champType.press('Escape');
    await attendre(() => page.getByRole('button', { name: 'Renommer Tablette', exact: true }).isVisible(), 'Échap annule le renommage');
    const doublon = await app.invoquer('categorie_creer', { kind: 'a', nom: 'Département de la maintenance' });
    verifier(!doublon.ok, 'Le back refuse une nouvelle structure portant un nom existant');

    ctx.etape('suppression refusée avec son motif tant qu’il reste des fiches (archivées comprises)');
    const supprimerDM = page.getByRole('button', { name: 'Supprimer Département de la maintenance', exact: true });
    egal(await supprimerDM.getAttribute('aria-disabled'), 'true', '« Supprimer » est indisponible (aria-disabled) pour une structure non vide');
    // Playwright tient un bouton aria-disabled pour inactif : le clic (vraie position de la souris) est forcé ;
    // le second motif est demandé au clavier (Tab jusqu'au bouton, puis Entrée).
    await supprimerDM.click({ force: true });
    const motif = rangee('Département de la maintenance').locator('.cl-motif');
    await attendre(() => motif.isVisible(), 'Le motif doit s’afficher quand on actionne « Supprimer »');
    egal((await motif.innerText()).replace(/\s+/g, ' ').trim(),
      'Suppression impossible. Cette structure contient encore 3 employés. Déplacez-les dans une autre structure avant de la supprimer.', 'Motif');
    egal(await modale(page).count(), 0, 'Aucune confirmation ne s’ouvre');
    // Type ne contenant qu'une machine archivée : la suppression reste refusée.
    egal((await categoriesAffichees(page, 'b')).find((c) => c[0] === 'Station de travail'), ['Station de travail', '1 machine'],
      'Type « Station de travail » : une machine (archivée)');
    await page.getByRole('button', { name: 'Archiver Station de travail', exact: true }).focus();
    await page.keyboard.press('Tab');
    egal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Supprimer Station de travail', '« Supprimer » reste atteignable au clavier');
    await page.keyboard.press('Enter');
    await attendre(async () => ((await rangee('Station de travail').locator('.cl-motif').innerText()) || '').includes(
      'Ce type de machine contient encore 1 machine. Déplacez-la dans un autre type de machine avant de le supprimer.'),
    'Le motif d’un type qui ne contient qu’une machine archivée');
    const refus = await app.invoquer('categorie_supprimer', { id: (await app.appeler('categories_lister', { kind: 'b' })).find((c) => c.nom === 'Station de travail').id });
    verifier(!refus.ok && JSON.stringify(refus.erreur).includes('contient encore 1 machine'), `Le back refuse la suppression : ${JSON.stringify(refus.erreur)}`);
    await ctx.app.imposerTaille(1280, Math.min(await page.evaluate(() => document.getElementById('content').scrollHeight) + 120, 3000));
    await page.locator('.group-h', { hasText: 'Catégories' }).scrollIntoViewIfNeeded();
    await ctx.capture('v12-reel/05-parametres-structures-types');
    await ctx.app.imposerTaille(0, 0);

    ctx.etape('suppression acceptée d’une structure vide et d’un type vide, après confirmation');
    await page.getByRole('button', { name: 'Supprimer Structure e2e', exact: true }).click();
    await attendre(() => modale(page).isVisible(), 'La confirmation de suppression doit s’ouvrir');
    egal(await modale(page).locator('h3').innerText(), 'Supprimer la structure ?', 'Titre de la confirmation');
    await bouton(modale(page), 'Supprimer').click();
    await attendre(async () => !(await modale(page).count()), 'La confirmation doit se fermer');
    await attendre(async () => !(await categoriesAffichees(page, 'a')).some((c) => c[0] === 'Structure e2e'), 'La structure supprimée disparaît');
    verifier(!(await app.appeler('categories_lister', { kind: 'a' })).some((c) => c.nom === 'Structure e2e'), 'La structure est supprimée du back');
    await page.getByRole('button', { name: 'Supprimer Tablette', exact: true }).click();
    egal(await modale(page).locator('h3').innerText(), 'Supprimer le type de machine ?', 'Titre de la confirmation (type)');
    await bouton(modale(page), 'Supprimer').click();
    await attendre(async () => !(await categoriesAffichees(page, 'b')).some((c) => c[0] === 'Tablette'), 'Le type supprimé disparaît');
    for (const p of await page.evaluate(controleVocabulaire)) throw new Echec(`Paramètres : vocabulaire à proscrire ${p}`);
  },
};
