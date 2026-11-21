// Dossiers : création (sans employé ni machine, § 11.1), sous-dossiers, documents depuis les modèles standards (saisie
// enregistrée, blocs Employé / Machine vides puis choisis), pièce manquante, pièce finale, clôture en lecture seule, réouverture,
// renommer / supprimer, options à cocher ; puis import réel d'une image et d'un PDF.

import fs from 'node:fs';
import path from 'node:path';
import { urlLocale } from '../outils/application.mjs';
import { ecrirePdf, ecrirePng } from '../outils/fichiers.mjs';
import {
  attendreBadge, attendreTitre, bouton, carteChoisie, casePapier, champChoix, champPapier, choisirEtat, choixPapier, detailsCarte, listeEtat, menu, modale,
  ouvrirDocument, ouvrirDossier, taperDansChoix, texteErreur,
} from '../outils/ui.mjs';
import { attendre, Echec, egal, verifier } from '../outils/verifs.mjs';
import { EMPLOYE, ID_MACHINE, MACHINE } from './fiches.mjs';

/** État du back par son rôle (« cours », « piece », « clos ») ou par son nom. */
export async function statutDuBack(app, { role, nom }) {
  const s = (await app.appeler('statuts_lister')).find((x) => (role ? x.role === role : x.nom === nom));
  verifier(s, `État ${role ?? nom} introuvable dans le back`);
  return s;
}

export const NOM_DOSSIER = 'Dossier e2e';
export const INTERVENTION = 'Fiche d’intervention informatique';
export const BESOINS = 'État des besoins';
export const IDENTIFICATION = 'Fiche d’identification';
export const FORMATAGE = 'Fiche pour formatage PC';
/** Saisie de « Signalée par » dans Document_01 (relue après clôture et après relance). */
export const SAISIE_DOC1 = 'Valeur e2e';

/** Document du dossier lu dans le back, par son nom. */
export async function documentDuBack(app, dossierId, nom) {
  const d = await app.appeler('dossier_detail', { id: dossierId });
  return d.documents.find((x) => x.nom === nom);
}

/** Bloc d'un document du back par son type et son libellé. */
export const blocDe = (doc, t, v) => doc.blocs.find((b) => b.t === t && b.v === v);

/** Ajoute un document depuis un modèle par la fenêtre « Ajouter » (grand « + »). Renvoie le nom affiché. */
export async function ajouterDepuisModele(page, modele) {
  await page.locator('.folder.add').click();
  await modale(page).locator('.choice', { hasText: 'Un fichier' }).click();
  await modale(page).locator('.opt', { has: page.locator('b', { hasText: new RegExp(`^${modele}$`) }) }).click();
  await attendre(async () => !(await modale(page).count()), 'La fenêtre « Ajouter » ne se ferme pas après le choix du modèle');
  await attendre(async () => (await page.locator('.preview .pv-h small').innerText()).startsWith(modele), `Le document « ${modele} » ne s’affiche pas`);
  return (await page.locator('.preview .pv-h b').innerText()).trim();
}

/** Informations attendues des fiches du dossier e2e dans un bloc Employé / Machine (identifiant propre à la base). */
export const detailsEmploye = (ctx) => ({
  Nom: EMPLOYE.nom, Prénom: EMPLOYE.prenom, Poste: 'Technicienne', Structure: 'Division informatique', Identifiant: ctx.memo.codes.employe,
});
export const DETAILS_MACHINE = {
  Nom: MACHINE, Identifiant: ID_MACHINE, 'Marque et modèle': 'Dell Latitude 5440', Processeur: 'Intel Core i7-1365U', RAM: '32 Go', Stockage: 'SSD 1 To',
};

export const dossiers = {
  id: 'dossiers',
  titre: 'Dossiers : créer, sous-dossier, documents, saisie, pièce finale, clôture, options',
  async executer(ctx) {
    const { page, app } = ctx;
    const annee = new Date().getFullYear();
    verifier(ctx.memo.a && ctx.memo.b, 'Ce scénario utilise les fiches créées par les scénarios « employes » et « machines ».');
    const affectationsEnCours = async () => (await app.appeler('entite_fiche', { id: ctx.memo.a })).affectations.filter((x) => x.fin === null).length;
    egal(await affectationsEnCours(), 0, 'Avant le dossier, la machine n’est pas affectée à l’employé');

    ctx.etape('créer un dossier (nom suggéré ; ni employé ni machine, § 11.1)');
    await menu(page, 'Dossiers & Archives');
    await bouton(page, 'Créer un dossier').click();
    await attendreTitre(page, 'Créer un dossier');
    const champ = (libelle) => page.locator('form.form label', { hasText: libelle }).locator('input, select').first();
    await attendre(async () => (await champ('Nom').inputValue()) === `Dossier ${annee}-03`,
      `Le nom suggéré doit être « Dossier ${annee}-03 »`);
    await champ('Année').fill(String(annee - 1));
    await attendre(async () => (await champ('Nom').inputValue()) === `Dossier ${annee - 1}-05`,
      `Le nom suggéré doit suivre l’année (« Dossier ${annee - 1}-05 »)`);
    await champ('Année').fill(String(annee));
    await attendre(async () => (await champ('Nom').inputValue()) === `Dossier ${annee}-03`, 'Le nom suggéré ne revient pas');
    egal(await page.locator('form.form label', { hasText: 'Catégorie' }).locator('select option').allInnerTexts(),
      ['Support informatique', 'Maintenance'], 'Catégories actives proposées');
    // § 10.6 : nom, année et catégorie obligatoires ; nom vidé → refus, focus sur le nom, rien n'est créé.
    const nbDossiers = (await app.appeler('dossiers_lister')).length;
    await champ('Nom').fill('');
    await bouton(page, 'Créer le dossier').click();
    await attendre(async () => (await texteErreur(page)).includes('Remplissez le champ obligatoire « Nom ».'),
      'Un dossier sans nom est refusé avec « Remplissez le champ obligatoire « Nom ». »');
    egal(await page.evaluate(() => document.activeElement?.closest('label')?.querySelector('span')?.firstChild?.textContent), 'Nom',
      'Le focus est sur le champ « Nom »');
    egal((await app.appeler('dossiers_lister')).length, nbDossiers, 'Rien n’est créé');
    // § 11.1 : le formulaire ne propose plus ni employé ni machine (ni raccourci « Machines affectées à … »).
    const form = page.locator('.content form.form');
    egal(await form.locator('.choix-fiche').count(), 0, 'Le formulaire de dossier n’a plus de choix d’employé ni de machine');
    egal(await form.locator('input[role=combobox]').count(), 0, 'Aucune aide à la saisie de fiche dans le formulaire');
    egal(await page.getByRole('group', { name: /^Machines affectées à/ }).count(), 0, 'Plus de raccourci « Machines affectées à … »');
    egal(await form.locator('label > span:first-child').evaluateAll((ss) => ss.map((s) => s.firstChild?.textContent.trim())),
      ['Année', 'Nom', 'Catégorie', 'État'], 'Champs du formulaire de dossier : année, nom, catégorie (§ 16), état');
    await champ('Nom').fill(NOM_DOSSIER);
    await ctx.capture('dossiers/formulaire');
    await bouton(page, 'Créer le dossier').click();
    await attendreTitre(page, NOM_DOSSIER);
    await attendreBadge(page, 'En cours');
    const resume = (await app.appeler('dossiers_lister')).find((d) => d.nom === NOM_DOSSIER);
    ctx.memo.dossier = resume.id;
    egal(resume.theme, 'Support informatique', 'Dossier créé dans le back');
    egal(['aId', 'aNom', 'bId', 'bNom'].filter((k) => k in resume), [], 'Le dossier n’a plus d’employé ni de machine rattachés (back)');
    const detailCree = await app.appeler('dossier_detail', { id: resume.id });
    egal(['a', 'b'].filter((k) => k in detailCree), [], 'Le détail du dossier n’a plus d’employé ni de machine (back)');
    // § 11.1 : plus d'affectation automatique à la création d'un dossier.
    egal(await affectationsEnCours(), 0, 'La création du dossier n’affecte aucune machine');
    egal((await app.appeler('entite_fiche', { id: ctx.memo.a })).dossiers.filter((d) => d.id === resume.id).length, 0,
      'Un dossier sans document n’est lié à aucune fiche');
    // Dossier ouvert : la section « Employé et machine » a disparu (titres sans numéro depuis la 1.8).
    egal(await page.locator('.content section.sec > .sec-h h2').evaluateAll((hs) => hs.map((h) => h.textContent.replace(/\s+/g, ' ').trim())),
      ['Contenu du dossier', 'Options à cocher', 'Document'], 'Sections du dossier ouvert (racine)');
    egal(await page.locator('.content section.sec', { has: page.locator('h2', { hasText: 'Employé et machine' }) }).count(), 0,
      'Plus de section « Employé et machine »');
    egal(await page.locator('.content input[role=combobox]').count(), 0, 'Aucune aide à la saisie de fiche dans le dossier sans document');
    egal(await page.locator('.checks .ckrow span').allInnerTexts(), ['Dossier numérisé', 'Contenu vérifié'], 'Options par défaut');

    ctx.etape('ajouter un sous-dossier');
    await page.locator('.folder.add').click();
    await modale(page).locator('.choice', { hasText: 'Un dossier' }).click();
    await modale(page).locator('input').fill('Sous-dossier e2e');
    await bouton(modale(page), 'Créer le dossier').click();
    await attendre(async () => (await page.locator('.folder.sub b').allInnerTexts()).includes('Sous-dossier e2e'),
      'Le sous-dossier créé n’apparaît pas');

    ctx.etape('les modèles proposés : les quatre modèles standards');
    await page.locator('.folder.add').click();
    await modale(page).locator('.choice', { hasText: 'Un fichier' }).click();
    egal(await modale(page).locator('.opt b').allInnerTexts(),
      [BESOINS, INTERVENTION, IDENTIFICATION, FORMATAGE, 'Créer un nouveau modèle', 'Importer un fichier'], 'Choix de la fenêtre « Ajouter »');
    await page.keyboard.press('Escape');
    await attendre(async () => !(await modale(page).count()), 'Échap doit fermer la fenêtre « Ajouter »');

    ctx.etape(`document depuis « ${INTERVENTION} » : blocs Employé et Machine vides, puis choisis ; champ, case, liste, zone, date`);
    const doc1 = await ajouterDepuisModele(page, INTERVENTION);
    egal(doc1, 'Document_01', 'Nom par défaut du premier document');
    const DETAILS_EMPLOYE = detailsEmploye(ctx);
    // § 11.1 : plus de préremplissage par le dossier ; les blocs Employé / Machine d'un nouveau document sont vides.
    egal(await champChoix(page, 'Utilisateur').inputValue(), '', 'Bloc « Utilisateur » vide dans un nouveau document');
    egal(await champChoix(page, 'Matériel').inputValue(), '', 'Bloc « Matériel » vide dans un nouveau document');
    egal((await documentDuBack(app, ctx.memo.dossier, 'Document_01')).blocs.filter((b) => b.t === 'employe' || b.t === 'machine')
      .map((b) => b.entiteId ?? null), [null, null], 'Aucune fiche dans les blocs du nouveau document (back)');
    egal(await taperDansChoix(page, 'Utilisateur', 'lef'), [], 'Un employé archivé (LEFÈVRE Thomas) n’est pas proposé');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    egal((await taperDansChoix(page, 'Utilisateur', 'zeni')).map((p) => p.nom), [EMPLOYE.libelle], 'Employé proposé pour « zeni »');
    await page.keyboard.press('Enter');
    await attendre(() => carteChoisie(page, 'Utilisateur').isVisible(), 'L’employé choisi ne s’affiche pas');
    egal((await taperDansChoix(page, 'Matériel', 'pc-e2e')).map((p) => [p.nom, p.code]), [[MACHINE, ID_MACHINE]], 'Machine proposée par son identifiant');
    await page.getByRole('option', { name: new RegExp(`^${MACHINE}`) }).click();
    await attendre(() => carteChoisie(page, 'Matériel').isVisible(), 'La machine choisie ne s’affiche pas');
    egal(await detailsCarte(page, 'Utilisateur'), DETAILS_EMPLOYE, 'Bloc « Utilisateur » : l’employé choisi');
    egal(await detailsCarte(page, 'Matériel'), DETAILS_MACHINE, 'Bloc « Matériel » : la machine choisie');
    const papier = page.locator('.paper');
    await champPapier(page, 'Signalée par').fill(SAISIE_DOC1);
    await casePapier(papier, 'Intervention urgente').check();
    const materiel = choixPapier(page, 'Type de matériel');
    await casePapier(materiel, 'Ordinateur portable').check();
    await casePapier(materiel, 'Moniteur').check();
    await champPapier(page, 'Défauts signalés').fill('L’écran reste noir.\nLe voyant clignote.');
    await champPapier(page, 'Début d’intervention').fill(`${annee}-01-15T09:15`);
    await attendre(async () => {
      const d = await documentDuBack(app, ctx.memo.dossier, 'Document_01');
      return blocDe(d, 'champ', 'Signalée par').val === SAISIE_DOC1 && blocDe(d, 'case', 'Intervention urgente').ok === true
        && JSON.stringify(blocDe(d, 'choix', 'Type de matériel').choisis) === JSON.stringify(['Ordinateur portable', 'Moniteur'])
        && blocDe(d, 'zone', 'Défauts signalés').val === 'L’écran reste noir.\nLe voyant clignote.'
        && blocDe(d, 'date', 'Début d’intervention').val === `${annee}-01-15T09:15`
        && blocDe(d, 'employe', 'Utilisateur').entiteId === ctx.memo.a && blocDe(d, 'machine', 'Matériel').entiteId === ctx.memo.b;
    }, 'La saisie (champ, case, liste, zone, date, fiches) doit être enregistrée automatiquement dans le back');
    const dateDoc = `${annee}-01-15`;
    await page.locator('.paper .p-date input').fill(dateDoc);
    await attendre(async () => (await documentDuBack(app, ctx.memo.dossier, 'Document_01')).dateDoc === dateDoc,
      'La date du document doit être enregistrée');
    await attendre(async () => (await page.locator('.files .file', { hasText: 'Document_01' }).locator('small').innerText()).endsWith(`15/01/${annee}`),
      'La liste des fichiers doit suivre la nouvelle date');
    await ctx.capture('dossiers/document-modele');

    ctx.etape(`document depuis « ${BESOINS} » : tableau à 4 colonnes (ajout et retrait de lignes)`);
    const doc2 = await ajouterDepuisModele(page, BESOINS);
    egal(doc2, 'Document_02', 'Nom par défaut du deuxième document');
    egal(await page.locator('.paper .p-table th:not(.no-print)').allTextContents(), ['N°', 'Désignation', 'Qté', 'Observations'], 'En-têtes du tableau');
    await bouton(page, 'Ajouter une ligne').click();
    await bouton(page, 'Ajouter une ligne').click();
    await page.getByLabel('N°, ligne 1').fill('1');
    await page.getByLabel('Désignation, ligne 1').fill('Écran 24 pouces');
    await page.getByLabel('Qté, ligne 1').fill('2');
    await page.getByLabel('Observations, ligne 1').fill('Bureau 12');
    await page.getByLabel('Désignation, ligne 2').fill('À retirer');
    await bouton(page, 'Retirer la ligne 2').click();
    await bouton(page, 'Ajouter une ligne').click();
    await page.getByLabel('Désignation, ligne 2').fill('Clavier');
    await attendre(async () => {
      const d = await documentDuBack(app, ctx.memo.dossier, 'Document_02');
      return JSON.stringify(d.blocs.find((b) => b.t === 'tableau').rows) === JSON.stringify([['1', 'Écran 24 pouces', '2', 'Bureau 12'], ['', 'Clavier', '', '']]);
    }, 'Les lignes du tableau doivent être enregistrées');
    const basDuTableau = await page.locator('.paper tbody tr:last-child td').first().evaluate((td) => getComputedStyle(td).borderBottomWidth);
    verifier(parseFloat(basDuTableau) > 0, 'La dernière ligne du tableau du papier doit garder sa bordure basse');

    ctx.etape('options à cocher : cocher, ajouter, supprimer');
    await page.locator('.ckrow', { hasText: 'Dossier numérisé' }).locator('input').check();
    await attendre(async () => (await page.locator('.ckrow', { hasText: 'Dossier numérisé' }).locator('em').innerText()) === 'Coché',
      'L’option cochée doit afficher « Coché »');
    await attendre(async () => (await page.locator('.sec', { hasText: 'Options à cocher' }).locator('.cnt').innerText()) === '1 sur 2 cochées',
      'Le compteur d’options doit afficher « 1 sur 2 cochées »');
    await page.getByLabel('Nom de la nouvelle option').fill('Option e2e');
    await bouton(page, 'Ajouter l’option').click();
    await attendre(async () => (await page.locator('.checks .ckrow span').allInnerTexts()).includes('Option e2e'), 'L’option ajoutée n’apparaît pas');
    await page.getByRole('button', { name: 'Supprimer l’option Option e2e' }).click();
    await bouton(modale(page), 'Supprimer l’option').click();
    await attendre(async () => !(await page.locator('.checks .ckrow span').allInnerTexts()).includes('Option e2e'), 'L’option supprimée reste affichée');
    const options = (await app.appeler('dossier_detail', { id: ctx.memo.dossier })).options.map((o) => [o.nom, o.ok]);
    egal(options, [['Dossier numérisé', true], ['Contenu vérifié', false]], 'Options enregistrées');

    ctx.etape('état « Pièce manquante » choisi dans la liste « État » : clôture impossible, avec son motif');
    egal(await listeEtat(page).locator('option').allInnerTexts(), ['En cours', 'Pièce manquante'], 'États ouverts proposés dans l’en-tête');
    await choisirEtat(page, 'Pièce manquante');
    verifier(await page.locator('.alert.warn', { hasText: 'Pièce finale manquante' }).isVisible(), 'Alerte « Pièce finale manquante » absente');
    const cloturer = bouton(page, 'Clôturer le dossier');
    egal(await cloturer.getAttribute('aria-disabled'), 'true', '« Clôturer le dossier » est indisponible (aria-disabled) en « Pièce manquante »');
    await cloturer.click({ force: true });
    const motif = page.locator('.etat-motif');
    await attendre(() => motif.isVisible(), 'Le motif doit s’afficher quand on actionne « Clôturer le dossier »');
    verifier((await motif.innerText()).replace(/\s+/g, ' ').trim().startsWith('Clôture impossible.'), `Motif affiché : ${await motif.innerText()}`);
    await attendreBadge(page, 'Pièce manquante');
    const clos = await statutDuBack(app, { role: 'clos' });
    const refus = await app.invoquer('dossier_definir_statut', { id: ctx.memo.dossier, statutId: clos.id });
    verifier(!refus.ok && refus.erreur.code === 'transition_interdite', `Le back doit refuser pièce manquante → clôturé (${JSON.stringify(refus)})`);
    egal((await app.appeler('dossier_detail', { id: ctx.memo.dossier })).dossier.statut.role, 'piece', 'Le dossier reste en « Pièce manquante »');
    await ctx.capture('dossiers/piece-manquante');

    ctx.etape('ajouter la pièce finale : retour en cours');
    await bouton(page, 'Ajouter la pièce finale').click();
    egal((await modale(page).locator('h3').innerText()).trim(), 'Ajouter la pièce finale', 'Titre de la fenêtre de pièce finale');
    verifier(!(await bouton(modale(page), 'Retour').count()), 'Le parcours « pièce finale » n’a pas de bouton Retour');
    await modale(page).locator('.opt', { hasText: IDENTIFICATION }).click();
    await attendreBadge(page, 'En cours');
    egal((await page.locator('.preview .pv-h small').innerText()).trim(), `${IDENTIFICATION} · Pièce finale`, 'Le document est marqué « Pièce finale »');
    const doc3 = (await page.locator('.preview .pv-h b').innerText()).trim();
    egal(doc3, 'Document_03', 'Nom du document de pièce finale');
    egal(await champChoix(page, 'Bénéficiaire').inputValue(), '', 'Bloc « Bénéficiaire » vide (aucun préremplissage, § 11.1)');
    egal(await affectationsEnCours(), 0, 'Nommer l’employé et la machine dans un document n’affecte aucune machine');

    ctx.etape('clôturer : lecture seule partout, refus du back');
    await ouvrirDocument(page, 'Document_01');
    await bouton(page, 'Clôturer le dossier').click();
    await attendreBadge(page, 'Clôturé');
    verifier(await page.locator('.alert.info', { hasText: 'Dossier clôturé' }).isVisible(), 'Alerte « Dossier clôturé » absente');
    verifier(await page.locator('.folder.add').isDisabled(), 'Le grand « + » doit être désactivé');
    egal((await page.locator('.folder.add small').innerText()).trim(), 'Rouvrez le dossier pour le modifier.', 'Texte du « + » en lecture seule');
    for (const b of await page.getByRole('button', { name: 'Renommer', exact: true }).all()) {
      verifier(await b.isDisabled(), '« Renommer » doit être désactivé dans un dossier clôturé');
    }
    verifier(await bouton(page, 'Supprimer').isDisabled(), '« Supprimer » (document) doit être désactivé');
    verifier(await champPapier(page, 'Signalée par').isDisabled(), 'Les champs du document doivent être désactivés');
    verifier(await champPapier(page, 'Défauts signalés').isDisabled(), 'Les zones de texte doivent être désactivées');
    verifier(await champPapier(page, 'Début d’intervention').isDisabled(), 'Les dates doivent être désactivées');
    const cases = await page.locator('.paper input[type=checkbox], .paper input[type=radio]').all();
    verifier(cases.length > 0, 'Le document a des cases');
    for (const c of cases) verifier(await c.isDisabled(), 'Les cases et options du document doivent être désactivées');
    egal(await page.locator('.paper').getByRole('button', { name: /^(Changer|Retirer|Effacer)/ }).count(), 0,
      'Ni « Changer » ni « Retirer » sur un dossier clôturé');
    egal(await detailsCarte(page, 'Utilisateur'), DETAILS_EMPLOYE, 'La fiche choisie reste affichée en lecture seule');
    verifier(await page.locator('.paper .p-date input').isDisabled(), 'La date du document doit être désactivée');
    for (const c of await page.locator('.checks input').all()) verifier(await c.isDisabled(), 'Les options à cocher doivent être désactivées');
    egal(await listeEtat(page).count(), 0, 'La liste « État » n’est pas proposée sur un dossier clôturé');
    const d1 = await documentDuBack(app, ctx.memo.dossier, 'Document_01');
    for (const [cmd, args] of [
      ['document_enregistrer_blocs', { id: d1.id, blocs: d1.blocs }],
      ['document_renommer', { id: d1.id, nom: 'Interdit' }],
      ['sous_dossier_creer', { dossierId: ctx.memo.dossier, parentId: null, nom: 'Interdit' }],
      ['option_cocher', { id: (await app.appeler('dossier_detail', { id: ctx.memo.dossier })).options[1].id, ok: true }],
      ['dossier_renommer', { id: ctx.memo.dossier, nom: 'Interdit' }],
    ]) {
      const r = await app.invoquer(cmd, args);
      verifier(!r.ok && r.erreur.code === 'dossier_clos', `Le back doit refuser ${cmd} sur un dossier clôturé (obtenu ${JSON.stringify(r)})`);
    }
    await ctx.capture('dossiers/cloture');

    ctx.etape('rouvrir');
    await bouton(page, 'Rouvrir le dossier').click();
    await attendreBadge(page, 'En cours');
    verifier(await page.locator('.folder.add').isEnabled(), 'Le grand « + » doit être réactivé');
    verifier(await champPapier(page, 'Signalée par').isEnabled(), 'Les champs doivent être réactivés');
    egal(await champPapier(page, 'Signalée par').inputValue(), SAISIE_DOC1, 'La saisie est conservée après clôture et réouverture');
    verifier(await bouton(page, `Changer Utilisateur (${EMPLOYE.libelle})`).isVisible(), '« Changer » revient après réouverture');

    ctx.etape('renommer puis supprimer un document');
    await ouvrirDocument(page, 'Document_03');
    await page.locator('.preview .pv-h').getByRole('button', { name: 'Renommer', exact: true }).click();
    await modale(page).locator('input').fill('Pièce finale e2e');
    await bouton(modale(page), 'Renommer').click();
    await attendre(async () => (await page.locator('.preview .pv-h b').innerText()).trim() === 'Pièce finale e2e', 'Le document n’est pas renommé');
    verifier((await page.locator('.files .file b').allInnerTexts()).includes('Pièce finale e2e'), 'La liste des fichiers doit suivre le renommage');
    await page.locator('.preview .pv-h').getByRole('button', { name: 'Supprimer', exact: true }).click();
    await bouton(modale(page), 'Supprimer le document').click();
    await attendre(async () => !(await page.locator('.files .file b').allInnerTexts()).includes('Pièce finale e2e'), 'Le document supprimé reste affiché');
    verifier(!(await documentDuBack(app, ctx.memo.dossier, 'Pièce finale e2e')), 'Le document doit être supprimé dans le back');

    ctx.etape('sous-dossiers : imbriquer, renommer, supprimer');
    await page.locator('.folder.sub', { hasText: 'Sous-dossier e2e' }).click();
    await attendreTitre(page, 'Sous-dossier e2e');
    egal(await page.locator('.crumbs').innerText().then((t) => t.replace(/\s+/g, ' ').trim()),
      `Dossiers & Archives ${NOM_DOSSIER} Sous-dossier e2e`, 'Fil d’Ariane du sous-dossier');
    await page.locator('.folder.add').click();
    await modale(page).locator('.choice', { hasText: 'Un dossier' }).click();
    await modale(page).locator('input').fill('Niveau 2');
    await bouton(modale(page), 'Créer le dossier').click();
    await attendre(async () => (await page.locator('.folder.sub b').allInnerTexts()).includes('Niveau 2'), 'Le sous-dossier imbriqué n’apparaît pas');
    await page.locator('.ph-actions').getByRole('button', { name: 'Renommer', exact: true }).click();
    await modale(page).locator('input').fill('Sous-dossier renommé');
    await bouton(modale(page), 'Renommer').click();
    await attendreTitre(page, 'Sous-dossier renommé');
    await page.locator('.folder.sub', { hasText: 'Niveau 2' }).click();
    await attendreTitre(page, 'Niveau 2');
    await ajouterDepuisModele(page, FORMATAGE);
    const nbAvant = (await app.appeler('dossier_detail', { id: ctx.memo.dossier })).documents.length;
    await page.locator('.ph-actions').getByRole('button', { name: 'Supprimer', exact: true }).click();
    verifier((await modale(page).innerText()).includes('1 fichier'), 'La confirmation annonce le contenu supprimé');
    await bouton(modale(page), 'Supprimer le sous-dossier').click();
    await attendreTitre(page, 'Sous-dossier renommé');
    egal(await page.locator('.folder.sub').count(), 0, 'Le sous-dossier supprimé doit disparaître');
    egal((await app.appeler('dossier_detail', { id: ctx.memo.dossier })).documents.length, nbAvant - 1,
      'Supprimer un sous-dossier supprime son contenu');
    await page.locator('.crumbs button', { hasText: NOM_DOSSIER }).click();
    await attendreTitre(page, NOM_DOSSIER);
    const detail = await app.appeler('dossier_detail', { id: ctx.memo.dossier });
    egal(detail.sousDossiers.map((s) => s.nom), ['Sous-dossier renommé'], 'Sous-dossiers dans le back');
  },
};

/** Flux NTFS `Zone.Identifier` d'un fichier (marque « venu d'Internet »), '' s'il n'existe pas. */
export function lireZoneIdentifier(chemin) {
  try {
    return fs.readFileSync(`${chemin}:Zone.Identifier`, 'utf8');
  } catch {
    return '';
  }
}

/** Ouvre la fenêtre « Ajouter » du dossier affiché, étape « Un fichier », puis clique « Importer un fichier ». */
async function cliquerImporter(page) {
  await page.locator('.folder.add').click();
  await modale(page).locator('.choice', { hasText: 'Un fichier' }).click();
  await modale(page).locator('.opt', { hasText: 'Importer un fichier' }).click();
}

/**
 * Importe un fichier dans le dossier affiché comme un utilisateur : « + », « Un fichier », « Importer un
 * fichier », puis le VRAI sélecteur de fichier de Windows (chemin tapé au clavier, Entrée).
 * Renvoie le document créé, lu dans le back.
 */
export async function importerParLeSelecteur(ctx, dossierId, chemin) {
  const { page, app } = ctx;
  const avant = new Set((await app.appeler('dossier_detail', { id: dossierId })).documents.map((d) => d.id));
  await cliquerImporter(page);
  await app.choisirFichier(chemin);
  await attendre(async () => !(await modale(page).count()), 'La fenêtre « Ajouter » ne se ferme pas après l’import');
  const nouveaux = (await app.appeler('dossier_detail', { id: dossierId })).documents.filter((d) => !avant.has(d.id));
  egal(nouveaux.length, 1, `Documents créés par l’import de ${path.basename(chemin)}`);
  await attendre(async () => (await page.locator('.preview .pv-h b').innerText()).trim() === nouveaux[0].nom,
    'Le document importé doit s’afficher');
  return nouveaux[0];
}

export const importReel = {
  id: 'import-reel',
  titre: 'Import par le sélecteur de fichier natif (PNG, PDF), annulation, copie, aperçu, suppression',
  async executer(ctx) {
    const { page, app } = ctx;
    verifier(ctx.memo.dossier, 'Ce scénario utilise le dossier créé par le scénario « dossiers ».');
    const png = path.join(ctx.entrees, 'Image e2e.png');
    const pdf = path.join(ctx.entrees, 'Pièce e2e.pdf');
    const dim = ecrirePng(png);
    ecrirePdf(pdf);
    const fichiers = path.join(ctx.donnees, 'fichiers');
    await ouvrirDossier(page, NOM_DOSSIER);

    ctx.etape('annuler le sélecteur natif (Échap) : rien n’est importé, pas d’erreur');
    const nbAvant = (await app.appeler('dossier_detail', { id: ctx.memo.dossier })).documents.length;
    await cliquerImporter(page);
    await app.annulerSelecteur();
    await page.waitForTimeout(500);
    verifier(await modale(page).isVisible(), 'La fenêtre « Ajouter » reste ouverte après l’annulation');
    egal(await texteErreur(modale(page)), '', 'Aucune erreur affichée après l’annulation');
    verifier(await modale(page).locator('.opt', { hasText: 'Importer un fichier' }).isEnabled(), '« Importer un fichier » est de nouveau utilisable');
    egal((await app.appeler('dossier_detail', { id: ctx.memo.dossier })).documents.length, nbAvant, 'Aucun document créé par l’annulation');
    egal(fs.readdirSync(fichiers).length, 0, 'Aucune copie créée par l’annulation');
    await page.keyboard.press('Escape');
    await attendre(async () => !(await modale(page).count()), 'Échap doit fermer la fenêtre « Ajouter »');

    ctx.etape('importer une image puis un PDF par le sélecteur natif (chemin tapé au clavier)');
    const docs = [];
    for (const [source, ext, apercu] of [[png, '.png', 'image'], [pdf, '.pdf', 'pdf']]) {
      const doc = await importerParLeSelecteur(ctx, ctx.memo.dossier, source);
      egal([doc.origine, doc.source, doc.fichierNom], ['import', 'Fichier importé', path.basename(source)], 'Document importé');
      egal([doc.apercu, doc.ouvrable], [apercu, true], `Aperçu et ouverture décidés par le back (${path.basename(source)})`);
      verifier(doc.fichierChemin && path.dirname(doc.fichierChemin) === fichiers, `La copie doit être dans fichiers/ (${doc.fichierChemin})`);
      verifier(doc.fichierChemin.endsWith(ext), `La copie garde l’extension ${ext} (${doc.fichierChemin})`);
      verifier(fs.existsSync(doc.fichierChemin), 'La copie du fichier importé n’existe pas');
      egal(fs.readFileSync(doc.fichierChemin).equals(fs.readFileSync(source)), true, 'La copie est identique à l’original');
      const zone = lireZoneIdentifier(doc.fichierChemin);
      verifier(/^\s*ZoneId=3\s*$/m.test(zone), `La copie porte la marque « venu d’Internet » (Zone.Identifier, ZoneId=3) : ${JSON.stringify(zone)}`);
      docs.push(doc);
    }
    ctx.memo.imports = docs.map((d) => d.nom);

    ctx.etape('aperçu de l’image');
    await ouvrirDossier(page, NOM_DOSSIER, docs[0].nom);
    const img = page.locator('.paper img');
    await attendre(() => img.evaluate((i) => i.complete && i.naturalWidth > 0), 'L’image importée ne se charge pas');
    const mesure = await img.evaluate((i) => ({ nw: i.naturalWidth, nh: i.naturalHeight, w: i.getBoundingClientRect().width, h: i.getBoundingClientRect().height, src: i.src }));
    egal([mesure.nw, mesure.nh], [dim.largeur, dim.hauteur], 'Dimensions naturelles de l’image');
    verifier(mesure.w > 0 && mesure.h > 0, 'L’image affichée a une taille nulle');
    // L'origine du protocole d'aperçu n'est pas codée en dur : elle doit seulement être celle de l'application.
    verifier(urlLocale(mesure.src) && !mesure.src.startsWith('http://tauri.localhost'),
      `L’image doit être servie par le protocole d’aperçu de l’application (${mesure.src})`);
    verifier(await page.locator('.preview .pv-h').getByRole('button', { name: 'Ouvrir avec l’application par défaut' }).isVisible(),
      'Le bouton « Ouvrir avec l’application par défaut » est absent');
    await ctx.capture('dossiers/apercu-image');

    ctx.etape('aperçu du PDF');
    const reponse = page.waitForResponse((x) => x.frame() !== page.mainFrame() && urlLocale(x.url()), { timeout: 10_000 });
    await ouvrirDocument(page, docs[1].nom);
    const cadre = page.locator('.paper iframe');
    const src = await attendre(() => cadre.getAttribute('src'), 'Le PDF doit s’afficher dans un cadre');
    verifier(urlLocale(src) && !src.startsWith('http://tauri.localhost'), `Cadre du PDF servi par le protocole d’aperçu de l’application (${src})`);
    const r = await reponse;
    egal(r.url(), src, 'Adresse chargée par le cadre');
    egal(r.status(), 200, 'Statut du PDF servi par le protocole d’aperçu');
    verifier((r.headers()['content-type'] ?? '').includes('application/pdf'), `Type imposé au PDF servi : ${r.headers()['content-type']}`);
    ctx.memo.urlApercuPdf = { src, id: docs[1].id };
    const boite = await cadre.boundingBox();
    verifier(boite && boite.width > 200 && boite.height > 200, 'Le cadre du PDF a une taille nulle');
    const frame = await attendre(async () => {
      const f = await cadre.elementHandle().then((h) => h.contentFrame());
      return f && f.url() === src ? f : false;
    }, 'Le cadre doit afficher le PDF servi par le protocole d’aperçu');
    // La visionneuse intégrée remplace le document du cadre par un <embed> de type PDF…
    await attendre(() => frame.evaluate(() => {
      const e = document.querySelector('embed');
      return e && e.type === 'application/pdf' ? true : document.contentType;
    }), 'Le cadre ne contient pas la visionneuse PDF');
    // … puis affiche le nombre de pages une fois le document lu (« 1 sur 1 »).
    let texteVu = null;
    await attendre(async () => /\d/.test((texteVu = await app.texteVisionneusePdf()) ?? ''),
      'La visionneuse PDF doit afficher le nombre de pages du document', 15_000).catch(async (e) => {
      const cibles = (await (await fetch(`http://127.0.0.1:${app.port}/json/list`)).json()).map((c) => `${c.type} ${c.url.slice(0, 90)}`);
      throw new Echec(`${e.message} (texte lu : ${JSON.stringify(texteVu)} ; cibles CDP : ${cibles.join(' | ')})`);
    });
    await page.waitForTimeout(1000); // laisse la visionneuse signaler une éventuelle violation de CSP
    await ctx.capture('dossiers/apercu-pdf'); // le rendu de la visionneuse n'apparaît pas dans une capture CDP

    ctx.etape('copies présentes dans fichiers/');
    egal(fs.readdirSync(fichiers).length, 2, 'Nombre de copies dans fichiers/');

    ctx.etape('supprimer un document importé supprime sa copie');
    const jetable = await importerParLeSelecteur(ctx, ctx.memo.dossier, png);
    egal(fs.readdirSync(fichiers).length, 3, 'Copie du troisième import');
    await ouvrirDossier(page, NOM_DOSSIER, jetable.nom);
    await page.locator('.preview .pv-h').getByRole('button', { name: 'Supprimer', exact: true }).click();
    verifier((await modale(page).innerText()).includes('ainsi que sa copie du fichier importé'), 'La confirmation annonce la suppression de la copie');
    await bouton(modale(page), 'Supprimer le document').click();
    await attendre(async () => !(await page.locator('.files .file b').allInnerTexts()).includes(jetable.nom), 'Le document importé supprimé reste affiché');
    verifier(!fs.existsSync(jetable.fichierChemin), 'La copie du document supprimé doit disparaître de fichiers/');
    egal(fs.readdirSync(fichiers).length, 2, 'Copies restantes');
    egal(fs.existsSync(png), true, 'Le fichier d’origine n’est pas touché');
  },
};
