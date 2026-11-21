// Version 1.5.1 (§ 14) : partir de zéro. Sur la base vide du premier lancement, un utilisateur crée sans aide son premier
// employé (en créant sa structure sur place), sa première machine (en créant son type), son premier dossier, puis un
// document depuis chacun des quatre modèles standards ; après fermeture et relance, tout est toujours là.
// Dépendance : « premier-lancement » (base vide). Le scénario suivant, « donnees-exemple », remplace ces données.

import fs from 'node:fs';
import path from 'node:path';
import { attendreTitre, bouton, carteChoisie, champPapier, menu, ouvrirDossier, taperDansChoix, texteErreur } from '../outils/ui.mjs';
import { attendre, egal, verifier } from '../outils/verifs.mjs';
import { MODELES_STANDARDS, lireCompteurs, texteBarreDeTitre, verifierSansValeurCassee } from './demarrage.mjs';
import { ajouterDepuisModele, documentDuBack } from './dossiers.mjs';
import { FORME_ID, recap } from './fiches.mjs';
import { PLANS } from './modeles.mjs';

const EMPLOYE = { nom: 'Saidi', prenom: 'Meriem', naissance: '1991-04-12', poste: 'Technicienne', libelle: 'SAIDI Meriem' };
const STRUCTURE = 'Service informatique';
const MACHINE = { nom: 'PC accueil', code: 'PC-0001' };
const TYPE = 'PC de bureau';
const SAISIE = 'Saisi en partant de zéro';

/** Libellé de l'option choisie d'une liste. */
const choisie = (page, sel) => page.locator(sel).evaluate((s) => s.selectedOptions[0]?.textContent.trim() ?? '');

/** Un document lu dans le back : modèle d'origine, fiches choisies dans ses blocs, premier champ saisi. */
const resumeDocument = (d, plan) => {
  const champ = plan.saisie.find((s) => s.t === 'champ');
  return {
    source: d.source,
    fiches: d.blocs.filter((b) => b.t === 'employe' || b.t === 'machine').map((b) => [b.t, b.v, b.entiteId ?? null]),
    champ: champ ? d.blocs.find((b) => b.t === 'champ' && b.v === champ.v)?.val ?? null : null,
  };
};

export const deZero = {
  id: 'de-zero',
  titre: 'Partir de zéro : première structure et premier employé, premier type et première machine, premier dossier, un document par modèle, relance',
  async executer(ctx) {
    let { page, app } = ctx;
    const an = new Date().getFullYear();
    verifier((await app.appeler('entites_lister', { kind: 'a' })).length === 0 && !(await app.appeler('parametres_lire')).donneesExemple,
      'Ce scénario part de la base vide du premier lancement.');

    ctx.etape('premier employé : aucune structure, le formulaire le dit et propose de la créer sur place');
    await menu(page, 'Employés');
    await bouton(page, 'Créer un employé').click();
    await attendreTitre(page, 'Créer un employé');
    const alerte = page.locator('.content .alert.warn', { hasText: 'Aucune structure pour l’instant' });
    verifier(await alerte.isVisible(), 'Le formulaire doit afficher « Aucune structure pour l’instant »');
    egal((await alerte.locator(':scope > div > p').innerText()).trim(),
      'Chaque employé appartient à une structure (division, service…). Créez-la ici : elle sera choisie pour cet employé.', 'Texte de l’alerte');
    egal(await page.locator('#n-cat').isDisabled(), true, 'Liste des structures inactive tant qu’il n’y en a aucune');
    egal(await choisie(page, '#n-cat'), 'Aucune structure pour l’instant', 'Liste des structures vide');
    egal(await bouton(page, 'Enregistrer la fiche').isDisabled(), true, '« Enregistrer la fiche » inactif sans structure');
    await verifierSansValeurCassee(page, 'Créer un employé');
    await ctx.capture('de-zero/01-premier-employe-aucune-structure');

    ctx.etape('la fiche est remplie d’abord, puis la structure créée sans quitter le formulaire');
    await page.fill('#n-nom', EMPLOYE.nom);
    await page.fill('#n-prenom', EMPLOYE.prenom);
    await page.fill('#n-naissance', EMPLOYE.naissance);
    await page.fill('#n-poste', EMPLOYE.poste);
    await bouton(alerte, 'Créer la structure').click();
    await attendre(async () => (await texteErreur(page)).includes('« Nom de la nouvelle structure »'),
      'Un nom de structure vide doit être refusé en nommant le champ');
    egal(await app.appeler('categories_lister', { kind: 'a' }), [], 'Rien n’est créé sans nom');
    await page.fill('#n-cat-nouvelle', STRUCTURE);
    await bouton(alerte, 'Créer la structure').click();
    await attendre(async () => !(await alerte.count()) && (await page.locator('#n-cat').isEnabled()), 'La structure créée doit être proposée aussitôt');
    egal(await choisie(page, '#n-cat'), STRUCTURE, 'La nouvelle structure est choisie pour l’employé');
    egal([await page.inputValue('#n-nom'), await page.inputValue('#n-prenom'), await page.inputValue('#n-naissance'), await page.inputValue('#n-poste')],
      [EMPLOYE.nom, EMPLOYE.prenom, EMPLOYE.naissance, EMPLOYE.poste], 'Ce qui était saisi est conservé');
    egal(await texteErreur(page), '', 'Plus aucun message d’erreur');
    await ctx.capture('de-zero/02-premier-employe-structure-creee');
    await bouton(page, 'Enregistrer la fiche').click();
    await attendreTitre(page, EMPLOYE.libelle);
    const r = await recap(page);
    verifier(FORME_ID.test(r.Identifiant), `Identifiant attribué au premier employé (${r.Identifiant})`);
    egal([r.Nom, r.Prénom, r.Poste, r.Structure], [EMPLOYE.nom, EMPLOYE.prenom, EMPLOYE.poste, STRUCTURE], 'Récapitulatif du premier employé');
    egal((await app.appeler('categories_lister', { kind: 'a' })).map((c) => [c.nom, c.actif]), [[STRUCTURE, true]], 'Une structure, active');

    ctx.etape('première machine : aucun type, créé sur place');
    await menu(page, 'Machines');
    await bouton(page, 'Créer une machine').click();
    await attendreTitre(page, 'Créer une machine');
    const alerteB = page.locator('.content .alert.warn', { hasText: 'Aucun type de machine pour l’instant' });
    verifier(await alerteB.isVisible(), 'Le formulaire doit afficher « Aucun type de machine pour l’instant »');
    egal(await bouton(page, 'Enregistrer la fiche').isDisabled(), true, '« Enregistrer la fiche » inactif sans type');
    await page.fill('#n-nom', MACHINE.nom);
    await page.fill('#n-code', MACHINE.code);
    await page.fill('#n-cat-nouvelle', TYPE);
    await page.keyboard.press('Enter'); // Entrée dans le champ : crée le type, sans enregistrer la machine
    await attendre(async () => !(await alerteB.count()) && (await page.locator('#n-cat').isEnabled()), 'Le type créé doit être proposé aussitôt');
    egal(await choisie(page, '#n-cat'), TYPE, 'Le nouveau type est choisi pour la machine');
    egal(await app.appeler('entites_lister', { kind: 'b' }), [], 'Créer le type n’enregistre pas encore la machine');
    await bouton(page, 'Enregistrer la fiche').click();
    await attendreTitre(page, MACHINE.nom);
    const rb = await recap(page);
    egal([rb.Identifiant, rb['Type de machine']], [MACHINE.code, TYPE], 'Récapitulatif de la première machine');

    ctx.etape('premier dossier : catégorie des modèles standards, état « En cours »');
    await menu(page, 'Dossiers & Archives');
    await bouton(page, 'Créer un dossier').click();
    await attendreTitre(page, 'Créer un dossier');
    egal(await page.locator('.content form .alert').count(), 0, 'Formulaire de dossier : aucune alerte');
    const champ = (libelle) => page.locator('form.form label', { hasText: libelle }).locator('input, select').first();
    await attendre(async () => (await champ('Nom').inputValue()) === `Dossier ${an}-01`, `Le nom suggéré doit être « Dossier ${an}-01 »`);
    egal(await champ('Catégorie').evaluate((s) => s.selectedOptions[0]?.textContent.trim()), 'Support informatique', 'Catégorie proposée (§ 16)');
    await bouton(page, 'Créer le dossier').click();
    const nomDossier = `Dossier ${an}-01`;
    await attendreTitre(page, nomDossier);
    const [dossier] = await app.appeler('dossiers_lister');
    egal([dossier.nom, dossier.theme, dossier.statut.nom], [nomDossier, 'Support informatique', 'En cours'], 'Premier dossier');

    const ids = { a: (await app.appeler('entites_lister', { kind: 'a' }))[0].id, b: (await app.appeler('entites_lister', { kind: 'b' }))[0].id };
    const attendus = {};
    for (const [i, plan] of PLANS.entries()) {
      ctx.etape(`document depuis « ${plan.modele} » : fiches choisies, un champ saisi`);
      if (i > 0) await ouvrirDossier(page, nomDossier);
      const nom = await ajouterDepuisModele(page, plan.modele);
      egal(await page.locator('.paper .p-titre').allInnerTexts(), plan.titres, `Titre du papier (${plan.modele})`);
      for (const s of plan.saisie.filter((x) => x.t === 'employe' || x.t === 'machine')) {
        const [texte, fiche] = s.t === 'employe' ? ['saidi', EMPLOYE.libelle] : ['pc acc', MACHINE.nom];
        egal((await taperDansChoix(page, s.v, texte)).map((p) => p.nom), [fiche], `Proposition pour « ${texte} » (${s.v})`);
        await page.keyboard.press('Enter');
        await attendre(() => carteChoisie(page, s.v).isVisible(), `La fiche choisie dans « ${s.v} » ne s’affiche pas`);
      }
      const premierChamp = plan.saisie.find((s) => s.t === 'champ');
      if (premierChamp) await champPapier(page, premierChamp.v).fill(SAISIE);
      const blocsModele = (await app.appeler('modeles_lister')).find((m) => m.nom === plan.modele).blocs;
      attendus[nom] = {
        source: plan.modele,
        fiches: blocsModele.filter((b) => b.t === 'employe' || b.t === 'machine').map((b) => [b.t, b.v, b.t === 'employe' ? ids.a : ids.b]),
        champ: premierChamp ? SAISIE : null,
      };
      await attendre(async () => JSON.stringify(resumeDocument(await documentDuBack(app, dossier.id, nom), plan)) === JSON.stringify(attendus[nom]),
        `La saisie de « ${plan.modele} » doit être enregistrée dans le back`);
      if (i === 1) await ctx.capture('de-zero/03-document-intervention');
    }
    egal((await app.appeler('dossier_detail', { id: dossier.id })).documents.map((d) => d.source).sort(), [...MODELES_STANDARDS].sort(),
      'Un document par modèle standard');
    egal((await app.appeler('entite_fiche', { id: ids.a })).documents.length, 3, 'Documents qui nomment l’employé (l’état des besoins n’a pas de bloc Employé)');

    ctx.etape('tableau de bord : une fiche de chaque, un dossier ouvert, quatre documents ce mois-ci');
    await menu(page, 'Tableau de bord');
    egal(await lireCompteurs(page), [
      { label: 'Employés actifs', valeur: '1', detail: 'sur 1 fiche' },
      { label: 'Machines actives', valeur: '1', detail: 'sur 1 fiche' },
      { label: 'Dossiers ouverts', valeur: '1', detail: 'dont 0 en attente de pièce finale' },
      { label: 'Fiches à compléter', valeur: '0', detail: '0 employé · 0 machine' },
    ], 'Compteurs après les premières saisies');
    egal((await app.appeler('tableau_de_bord')).volume.mois[new Date().getMonth()], 4, 'Volume du mois en cours');
    await verifierSansValeurCassee(page, 'Tableau de bord');
    await ctx.capture('de-zero/04-tableau-de-bord');

    ctx.etape('fermer, relancer : tout est toujours là, toujours sans données d’exemple');
    await page.locator('.titlebar .ctl').getByRole('button', { name: 'Fermer', exact: true }).click({ noWaitAfter: true });
    egal(await app.attendreFin(15_000), 0, 'Code de sortie à la fermeture');
    await app.deconnecter();
    app = await ctx.lancer();
    page = app.page;
    await attendreTitre(page, 'Tableau de bord');
    egal(await texteBarreDeTitre(page), 'INVENTORY', 'Barre de titre après relance');
    egal((await app.appeler('parametres_lire')).donneesExemple, false, 'donnees_exemple = 0 après relance');
    egal((await app.appeler('entites_lister', { kind: 'a' })).map((e) => [e.libelle, e.categorie, FORME_ID.test(e.code)]),
      [[EMPLOYE.libelle, STRUCTURE, true]], 'Employé après relance');
    egal((await app.appeler('entites_lister', { kind: 'b' })).map((e) => [e.libelle, e.code, e.categorie]),
      [[MACHINE.nom, MACHINE.code, TYPE]], 'Machine après relance');
    egal((await app.appeler('dossiers_lister')).map((d) => [d.nom, d.statut.nom]), [[nomDossier, 'En cours']], 'Dossier après relance');
    const detail = await app.appeler('dossier_detail', { id: dossier.id });
    for (const [nom, attendu] of Object.entries(attendus)) {
      const plan = PLANS.find((p) => p.modele === attendu.source);
      egal(resumeDocument(detail.documents.find((d) => d.nom === nom), plan), attendu, `Document « ${nom} » après relance`);
    }
    egal((await app.appeler('modeles_lister')).map((m) => [m.nom, m.nbDocuments]), MODELES_STANDARDS.map((n) => [n, 1]), 'Modèles après relance');
    await ouvrirDossier(page, nomDossier, Object.keys(attendus)[1]);
    await attendre(() => carteChoisie(page, 'Utilisateur').isVisible(), 'Après relance, l’employé choisi s’affiche dans le document');
    verifier(!fs.existsSync(path.join(ctx.donnees, 'sauvegardes')), 'Aucune sauvegarde : rien n’a été effacé ni rechargé');
    await menu(page, 'Tableau de bord');
  },
};
