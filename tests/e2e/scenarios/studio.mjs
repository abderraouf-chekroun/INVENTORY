// Studio de Modèles : composer un modèle avec les champs personnalisés (un bloc de chaque type), réglages propres à
// chaque type, réordonner (boutons et glisser-déposer à la vraie souris), aperçu direct, enregistrement automatique ;
// l'utiliser dans un document rempli ; un document créé avant une modification du modèle ne change pas ;
// dupliquer, archiver ; « Restaurer les modèles standards » après en avoir archivé un et renommé un autre.

import {
  attendreTitre, bouton, casePapier, champChoix, champPapier, choixPapier, detailsCarte, echapper, magasinPapier, menu, modale, ouvrirDossier,
  taperDansChoix,
} from '../outils/ui.mjs';
import { attendre, egal, verifier } from '../outils/verifs.mjs';
import { BESOINS, DETAILS_MACHINE, detailsEmploye, IDENTIFICATION, NOM_DOSSIER, ajouterDepuisModele, documentDuBack } from './dossiers.mjs';

export const MODELE = 'Modèle e2e';

/** Types des blocs de l'éditeur, dans l'ordre affiché. */
const typesAffiches = (page) => page.$$eval('.blocks .blk .bh', (hs) => hs.map((h) => h.childNodes[1]?.textContent.trim()));

/** Champ de réglage d'un bloc de l'éditeur (n : rang à partir de 1). */
const blocEditeur = (page, n) => page.locator('.blocks .blk').nth(n - 1);

async function modeleDuBack(app, nom) {
  return (await app.appeler('modeles_lister')).find((m) => m.nom === nom);
}

/** Projection comparable d'un bloc de modèle (clés connues, valeurs définies). */
const projeter = (b) => Object.fromEntries(['t', 'v', 'niveau', 'heure', 'options', 'multiple', 'cols']
  .filter((k) => b[k] !== undefined && b[k] !== null).map((k) => [k, b[k]]));

/** Palette : un bloc de chaque type, dans cet ordre (deux signatures pour les voir côte à côte). */
const PALETTE = ['Titre', 'Texte', 'Champ sur une ligne', 'Zone de texte', 'Date', 'Case à cocher', 'Liste d’options', 'Tableau',
  'Choix du Magasin', 'Information automatique', 'Employé', 'Machine', 'Signature', 'Signature'];

const ATTENDU_V1 = [
  { t: 'titre', v: 'Demande e2e', niveau: 1 },
  { t: 'texte', v: 'Texte e2e v1' },
  { t: 'champ', v: 'Champ e2e' },
  { t: 'zone', v: 'Zone e2e' },
  { t: 'date', v: 'Date e2e', heure: true },
  { t: 'case', v: 'Case e2e' },
  { t: 'choix', v: 'Liste e2e', options: ['Rouge', 'Vert', 'Bleu'], multiple: true },
  { t: 'tableau', v: '', cols: ['Référence', 'Quantité', 'Observation', 'Prix'] },
  { t: 'magasin', v: 'Magasin e2e' },
  { t: 'variable', v: 'Employé · Nom' },
  { t: 'employe', v: 'Demandeur e2e' },
  { t: 'machine', v: 'Poste e2e' },
  { t: 'signature', v: 'Visa e2e 1' },
  { t: 'signature', v: 'Visa e2e 2' },
];

async function ouvrirStudio(page) {
  await menu(page, 'Création');
  await page.locator('.hubcard', { hasText: 'Modèles de document' }).click();
  await attendreTitre(page, 'Modèles de document');
}

/** Bouton d'un modèle dans la liste 5.4, par son nom exact. */
const itemModele = (page, nom) => page.locator('.mitem', { has: page.locator('b', { hasText: new RegExp(`^${echapper(nom)}$`) }) });

export const studio = {
  id: 'studio',
  titre: 'Studio : champs personnalisés, réglages, réordonner, document rempli, instantané, dupliquer, archiver, restaurer',
  async executer(ctx) {
    const { page, app } = ctx;
    verifier(ctx.memo.dossier, 'Ce scénario utilise le dossier créé par le scénario « dossiers ».');

    ctx.etape('ouvrir le Studio et créer un modèle');
    await ouvrirStudio(page);
    await bouton(page, 'Nouveau modèle').click();
    await attendre(async () => /^Modèle \d{2}$/.test(await page.inputValue('#m-nom')), 'Le nouveau modèle doit s’appeler « Modèle NN »');
    const nomInitial = await page.inputValue('#m-nom');
    egal(await page.locator('.mitem[aria-pressed=true] b').innerText(), nomInitial, 'Le nouveau modèle est sélectionné');
    verifier(await page.locator('.blocks .empty').isVisible(), 'Un nouveau modèle est vide');
    await page.fill('#m-nom', MODELE);
    await attendre(async () => (await page.locator('.mitem[aria-pressed=true] b').innerText()) === MODELE, 'La liste suit le nom en direct');

    ctx.etape('champs personnalisés : un bloc de chaque type');
    const groupe = page.getByRole('group', { name: /^Champs personnalisés/ });
    verifier(await groupe.isVisible(), 'Le groupe « Champs personnalisés » est absent');
    egal((await groupe.getByRole('button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')))).length, 13, 'Treize types de bloc dans la palette');
    for (const libelle of PALETTE) await groupe.getByRole('button', { name: `Ajouter : ${libelle}`, exact: true }).click();
    egal(await typesAffiches(page), PALETTE, 'Blocs ajoutés depuis la palette');

    ctx.etape('réglages de chaque bloc');
    await blocEditeur(page, 1).getByLabel('Texte du titre', { exact: true }).fill('Demande e2e');
    await page.getByRole('group', { name: 'Niveau du titre 1' }).getByRole('button', { name: 'Intertitre de section' }).click();
    await attendre(async () => (await page.locator('.paper .p-intertitre').allInnerTexts()).includes('DEMANDE E2E'), 'Intertitre dans l’aperçu');
    await page.getByRole('group', { name: 'Niveau du titre 1' }).getByRole('button', { name: 'Titre principal' }).click();
    await attendre(async () => (await page.locator('.paper .p-titre').allInnerTexts()).includes('DEMANDE E2E'), 'Titre principal dans l’aperçu');
    await blocEditeur(page, 2).getByLabel('Texte du bloc', { exact: true }).fill('Texte e2e v1');
    await blocEditeur(page, 3).getByLabel('Libellé du champ', { exact: true }).fill('Champ e2e');
    await blocEditeur(page, 4).getByLabel('Libellé de la zone de texte', { exact: true }).fill('Zone e2e');
    await blocEditeur(page, 5).getByLabel('Libellé de la date', { exact: true }).fill('Date e2e');
    await blocEditeur(page, 5).getByLabel('Demander aussi l’heure').check();
    // 1.2 (§ 9.2) : plus de pointillés « …/…/…… à …:… » ; l'aperçu montre le champ date et heure (inerte).
    await attendre(async () => (await page.locator('.paper input[aria-label="Date e2e"]').getAttribute('type')) === 'datetime-local',
      'L’aperçu de la date montre l’heure (champ date et heure)');
    verifier(!/…\/…|\.{4,}|_{4,}/.test(await page.locator('.paper').innerText()), 'Aucun pointillé dans l’aperçu du Studio');
    await blocEditeur(page, 6).getByLabel('Nom de l’option à cocher', { exact: true }).fill('Case e2e');
    const liste = blocEditeur(page, 7);
    await liste.getByLabel('Libellé de la liste d’options', { exact: true }).fill('Liste e2e');
    await page.getByRole('group', { name: 'Réponses du bloc 7' }).getByRole('button', { name: 'Plusieurs réponses' }).click();
    await liste.getByLabel('Option 1', { exact: true }).fill('Rouge');
    await liste.getByLabel('Option 2', { exact: true }).fill('Vert');
    verifier(await liste.getByRole('button', { name: 'Retirer l’option 1' }).isDisabled(), 'Une liste garde au moins 2 options');
    await liste.getByRole('button', { name: 'Ajouter une option' }).click();
    await liste.getByLabel('Option 3', { exact: true }).fill('Bleu');
    const tableau = blocEditeur(page, 8);
    await tableau.getByRole('button', { name: 'Ajouter une colonne' }).click();
    await tableau.getByRole('button', { name: 'Ajouter une colonne' }).click();
    egal(await tableau.locator('b.num').innerText(), '5 colonnes', 'Nombre de colonnes');
    await tableau.getByRole('button', { name: 'Retirer une colonne' }).click();
    for (const [i, c] of ['Référence', 'Quantité', 'Observation', 'Prix'].entries()) {
      await tableau.getByLabel(`En-tête de la colonne ${i + 1}`).fill(c);
    }
    egal(await page.locator('.paper th').allTextContents(), ['Référence', 'Quantité', 'Observation', 'Prix'], 'En-têtes dans l’aperçu direct');
    await blocEditeur(page, 9).getByLabel('Libellé du choix', { exact: true }).fill('Magasin e2e');
    await blocEditeur(page, 10).getByLabel('Information automatique', { exact: true }).selectOption('Employé · Nom');
    await blocEditeur(page, 11).getByLabel('Libellé du choix de l’employé', { exact: true }).fill('Demandeur e2e');
    await blocEditeur(page, 12).getByLabel('Libellé du choix de la machine', { exact: true }).fill('Poste e2e');
    await blocEditeur(page, 13).getByLabel('Libellé de la signature', { exact: true }).fill('Visa e2e 1');
    await blocEditeur(page, 14).getByLabel('Libellé de la signature', { exact: true }).fill('Visa e2e 2');
    egal(await page.locator('.paper .p-sigs').evaluateAll((gs) => gs.map((g) => [...g.querySelectorAll('.p-sig .p-sig-lib')].map((s) => s.textContent.trim()))),
      [['Visa e2e 1', 'Visa e2e 2']], 'Deux signatures qui se suivent : côte à côte dans l’aperçu');
    const apercu = await page.locator('.paper').innerText();
    for (const t of ['Champ e2e', 'Zone e2e', 'Case e2e', 'Liste e2e', 'Rouge', 'Bleu', 'Magasin e2e', 'Employé · Nom', 'Demandeur e2e', 'Poste e2e']) {
      verifier(apercu.includes(t), `L’aperçu direct doit montrer « ${t} »`);
    }

    ctx.etape('réordonner avec les boutons');
    await page.getByRole('button', { name: 'Monter le bloc 2 (Texte)' }).click();
    egal((await typesAffiches(page)).slice(0, 3), ['Texte', 'Titre', 'Champ sur une ligne'], 'Ordre après « Monter »');
    await page.getByRole('button', { name: 'Descendre le bloc 1 (Texte)' }).click();
    egal(await typesAffiches(page), PALETTE, 'Ordre après « Descendre »');
    verifier(await page.getByRole('button', { name: 'Monter le bloc 1 (Titre)' }).isDisabled(), 'Le premier bloc ne monte pas');
    verifier(await page.getByRole('button', { name: 'Descendre le bloc 14 (Signature)' }).isDisabled(), 'Le dernier bloc ne descend pas');

    ctx.etape('réordonner par glisser-déposer (poignée, vraie souris)');
    // Le glisser-déposer HTML5 de WebView2 passe par celui de Windows : la souris simulée par CDP ne le
    // déclenche pas (elle sélectionne du texte). Le geste est donc fait avec la vraie souris : le 3e bloc
    // est déposé sur la moitié haute du 1er.
    await page.evaluate(() => {
      const c = document.getElementById('content');
      const premier = document.querySelector('.blocks .blk').getBoundingClientRect().top;
      c.scrollTop += premier - c.getBoundingClientRect().top - 8;
    });
    const pb = await page.locator('.blocks .blk').nth(2).locator('[title="Glisser pour déplacer le bloc"]').boundingBox();
    const cb = await page.locator('.blocks .blk').nth(0).boundingBox();
    verifier(pb && cb && pb.y + pb.height < (await page.evaluate(() => innerHeight)), 'La poignée du 3e bloc doit être visible');
    await app.glisserALaSouris({ x: pb.x + pb.width / 2, y: pb.y + pb.height / 2 }, { x: cb.x + cb.width / 2, y: cb.y + 6 });
    await attendre(async () => (await typesAffiches(page))[0] === 'Champ sur une ligne', 'Le glisser-déposer doit placer « Champ sur une ligne » en tête');
    egal((await typesAffiches(page)).slice(0, 4), ['Champ sur une ligne', 'Titre', 'Texte', 'Zone de texte'], 'Ordre après glisser-déposer');
    verifier(await page.evaluate(() => getSelection().isCollapsed), 'Le geste ne doit pas sélectionner de texte');
    await ctx.capture('studio/editeur');
    await page.getByRole('button', { name: 'Descendre le bloc 1 (Champ sur une ligne)' }).click();
    await page.getByRole('button', { name: 'Descendre le bloc 2 (Champ sur une ligne)' }).click();
    egal(await typesAffiches(page), PALETTE, 'Ordre rétabli au clavier');

    ctx.etape('enregistrement automatique (nom, blocs, ordre, réglages)');
    const m = await attendre(async () => {
      const x = await modeleDuBack(app, MODELE);
      return x && JSON.stringify(x.blocs.map(projeter)) === JSON.stringify(ATTENDU_V1) ? x : false;
    }, 'Le modèle (nom, blocs, ordre, réglages) doit être enregistré automatiquement');
    ctx.memo.modele = m.id;
    await ctx.capture('studio/apercu-direct');

    ctx.etape('utiliser le modèle dans un document : chaque type de champ rempli');
    await ouvrirDossier(page, NOM_DOSSIER);
    const docNom = await ajouterDepuisModele(page, MODELE);
    // § 11.1 : blocs Employé / Machine vides, variable « — » tant qu'aucun employé n'est choisi dans le document.
    egal(await champChoix(page, 'Demandeur e2e').inputValue(), '', 'Bloc Employé vide dans un nouveau document');
    egal((await page.locator('.paper .pv-var').innerText()).replace(/\s+/g, ' '), 'Employé · Nom —', 'Information automatique « Employé · Nom » sans employé');
    await taperDansChoix(page, 'Demandeur e2e', 'zeni');
    await page.keyboard.press('Enter');
    await taperDansChoix(page, 'Poste e2e', 'pc-e2e');
    await page.keyboard.press('Enter');
    await attendre(async () => JSON.stringify(await detailsCarte(page, 'Poste e2e')) === JSON.stringify(DETAILS_MACHINE), 'La machine choisie s’affiche');
    egal(await detailsCarte(page, 'Demandeur e2e'), detailsEmploye(ctx), 'Bloc Employé : l’employé choisi');
    egal((await page.locator('.paper .pv-var').innerText()).replace(/\s+/g, ' '), 'Employé · Nom Zenith', 'Information automatique « Employé · Nom » : l’employé du bloc');
    await champPapier(page, 'Champ e2e').fill('Réponse e2e');
    await champPapier(page, 'Zone e2e').fill('Ligne 1\nLigne 2');
    await champPapier(page, 'Date e2e').fill(`${new Date().getFullYear()}-03-04T14:05`);
    await casePapier(page.locator('.paper'), 'Case e2e').check();
    await choixPapier(page, 'Liste e2e').getByRole('checkbox', { name: 'Rouge', exact: true }).check();
    await choixPapier(page, 'Liste e2e').getByRole('checkbox', { name: 'Bleu', exact: true }).check();
    await bouton(page, 'Ajouter une ligne').click();
    await page.getByLabel('Référence, ligne 1', { exact: true }).fill('R-01');
    await page.getByLabel('Prix, ligne 1', { exact: true }).fill('1200');
    egal(await magasinPapier(page, 'Magasin e2e').locator('option').allInnerTexts(), ['Choisir dans le Magasin…', 'RAM', 'Stockage', 'Écran'],
      'Mots-clés du Magasin proposés');
    await magasinPapier(page, 'Magasin e2e').selectOption('RAM');
    const doc = await attendre(async () => {
      const d = await documentDuBack(app, ctx.memo.dossier, docNom);
      const v = (t) => d.blocs.find((b) => b.t === t);
      return v('champ').val === 'Réponse e2e' && v('zone').val === 'Ligne 1\nLigne 2' && v('date').val?.endsWith('-03-04T14:05')
        && v('case').ok === true && JSON.stringify(v('choix').choisis) === '["Rouge","Bleu"]'
        && JSON.stringify(v('tableau').rows) === '[["R-01","","","1200"]]' && v('magasin').val === 'RAM'
        && v('employe').entiteId === ctx.memo.a && v('machine').entiteId === ctx.memo.b ? d : false;
    }, 'La saisie du document (chaque type de champ) doit être enregistrée');
    egal(doc.source, MODELE, 'Source du document');
    ctx.memo.docModele = docNom;
    await ctx.capture('studio/document-du-modele');

    ctx.etape('un document créé avant la modification du modèle ne change pas');
    await ouvrirStudio(page);
    await itemModele(page, MODELE).click();
    await attendre(async () => (await page.inputValue('#m-nom')) === MODELE, 'Le modèle choisi ne s’ouvre pas');
    await blocEditeur(page, 2).getByLabel('Texte du bloc', { exact: true }).fill('Texte e2e v2');
    await blocEditeur(page, 8).getByLabel('En-tête de la colonne 1').fill('Réf. modifiée');
    await page.getByRole('button', { name: 'Retirer le bloc 14 (Signature)' }).click();
    await attendre(async () => {
      const x = await modeleDuBack(app, MODELE);
      return x.blocs.length === 13 && x.blocs.some((b) => b.v === 'Texte e2e v2');
    }, 'La modification du modèle doit être enregistrée');
    const relu = await documentDuBack(app, ctx.memo.dossier, docNom);
    egal(relu.blocs.map(projeter), ATTENDU_V1, 'Les blocs du document créé avant la modification');
    await ouvrirDossier(page, NOM_DOSSIER, docNom);
    const papier = await page.locator('.paper').innerText();
    verifier(papier.includes('Texte e2e v1') && !papier.includes('Texte e2e v2'), 'Le papier du document doit garder le texte d’origine');
    egal(await page.locator('.paper th:not(.no-print)').allTextContents(), ['Référence', 'Quantité', 'Observation', 'Prix'], 'En-têtes du document inchangés');
    egal(await champPapier(page, 'Champ e2e').inputValue(), 'Réponse e2e', 'La saisie du document reste');

    ctx.etape('dupliquer');
    await ouvrirStudio(page);
    await itemModele(page, MODELE).click();
    await attendre(async () => (await page.inputValue('#m-nom')) === MODELE, 'Le modèle choisi ne s’ouvre pas');
    await bouton(page, 'Dupliquer').click();
    await attendre(async () => (await page.inputValue('#m-nom')) === `${MODELE} (copie)`, 'La copie doit s’ouvrir sous le nom « … (copie) »');
    egal(await typesAffiches(page), PALETTE.slice(0, 13), 'Blocs de la copie');

    ctx.etape('archiver');
    await bouton(page, 'Archiver').click();
    await attendre(async () => (await page.locator('.mitem[aria-pressed=true] small').first().innerText()).includes('Archivé'),
      'Le modèle archivé doit porter « Archivé »');
    verifier(await bouton(page, 'Réactiver').isVisible(), 'Le bouton devient « Réactiver »');
    egal((await modeleDuBack(app, `${MODELE} (copie)`)).actif, false, 'Modèle archivé dans le back');
    await ctx.capture('studio/archive');
    await ouvrirDossier(page, NOM_DOSSIER);
    await page.locator('.folder.add').click();
    await modale(page).locator('.choice', { hasText: 'Un fichier' }).click();
    const proposes = await modale(page).locator('.opt b').allInnerTexts();
    verifier(proposes.includes(MODELE) && !proposes.includes(`${MODELE} (copie)`),
      `Seuls les modèles actifs sont proposés (obtenu : ${proposes.join(', ')})`);
    await page.keyboard.press('Escape');
    await attendre(async () => !(await modale(page).count()), 'Échap doit fermer la fenêtre « Ajouter »');
    const refus = await app.invoquer('document_creer_depuis_modele', {
      dossierId: ctx.memo.dossier, sousDossierId: null, modeleId: (await modeleDuBack(app, `${MODELE} (copie)`)).id, pieceFinale: false,
    });
    verifier(!refus.ok && refus.erreur.code === 'modele_archive', 'Le back refuse un document depuis un modèle archivé');

    ctx.etape('restaurer les modèles standards après en avoir archivé un et renommé un autre');
    await ouvrirStudio(page);
    const note = page.locator('.studio-note');
    await bouton(page, 'Restaurer les modèles standards').click();
    await attendre(async () => (await note.innerText()) === 'Les modèles standards sont déjà tous présents. Rien n’a été modifié.',
      'Sans modèle manquant, la restauration ne fait rien et le dit');
    egal(await note.getAttribute('role'), 'status', 'Le message est annoncé (role=status)');
    await itemModele(page, IDENTIFICATION).click();
    await attendre(async () => (await page.inputValue('#m-nom')) === IDENTIFICATION, 'Le modèle standard ne s’ouvre pas');
    await bouton(page, 'Archiver').click();
    await attendre(async () => (await itemModele(page, IDENTIFICATION).locator('small').first().innerText()).includes('Archivé'), 'Le modèle standard est archivé');
    await itemModele(page, BESOINS).click();
    await attendre(async () => (await page.inputValue('#m-nom')) === BESOINS, 'Le modèle standard ne s’ouvre pas');
    const blocsBesoins = (await modeleDuBack(app, BESOINS)).blocs;
    await page.fill('#m-nom', `${BESOINS} (service)`);
    await attendre(async () => !!(await modeleDuBack(app, `${BESOINS} (service)`)), 'Le renommage doit être enregistré');
    await bouton(page, 'Restaurer les modèles standards').click();
    await attendre(async () => (await note.innerText()) === `2 modèles recréés : ${BESOINS}, ${IDENTIFICATION}.`,
      'La restauration doit recréer le modèle archivé et le modèle renommé, et le dire');
    await ctx.capture('studio/restaurer');
    const tous = await app.appeler('modeles_lister');
    const parNom = (n) => tous.filter((x) => x.nom === n);
    egal(parNom(BESOINS).map((x) => [x.actif, x.standard]), [[true, true]], `« ${BESOINS} » recréé, actif et standard`);
    egal(parNom(IDENTIFICATION).map((x) => [x.actif, x.standard]).sort(), [[false, false], [true, true]],
      `« ${IDENTIFICATION} » : l’archivé est gardé, un neuf est recréé`);
    const renomme = parNom(`${BESOINS} (service)`)[0];
    egal([renomme.actif, renomme.standard, JSON.stringify(renomme.blocs) === JSON.stringify(blocsBesoins)], [true, false, true],
      'Le modèle renommé garde son nom et ses blocs');
    egal(parNom(BESOINS)[0].blocs.map(projeter), blocsBesoins.map(projeter), 'Le modèle recréé reprend les blocs d’origine');
    await attendre(async () => (await itemModele(page, BESOINS).locator('small').first().innerText()).includes('Standard · Actif'),
      'La liste montre le modèle recréé');
    await bouton(page, 'Restaurer les modèles standards').click();
    await attendre(async () => (await note.innerText()) === 'Les modèles standards sont déjà tous présents. Rien n’a été modifié.',
      'Une seconde restauration ne recrée rien');
    egal((await app.appeler('modeles_lister')).filter((x) => x.standard).length, 4, 'Toujours quatre modèles standards');
    await ouvrirDossier(page, NOM_DOSSIER, 'Document_01');
  },
};
