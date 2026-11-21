// Aide à la saisie (§ 8.4) : on tape les premières lettres, la liste propose les fiches actives (8 au plus, homonymes
// distingués par leur identifiant), ↑ ↓ Entrée Échap et clic ; dans les blocs Employé / Machine d'un document (le
// formulaire de dossier n'en a plus depuis la 1.4 ; la fenêtre d'affectation est couverte par le scénario « affectations »).
// Une fiche archivée n'est jamais proposée.

import {
  attendreTitre, bouton, carteChoisie, champChoix, choixFiche, detailsCarte, modale, ouvrirDocument, ouvrirDossier, propositions,
  taperDansChoix,
} from '../outils/ui.mjs';
import { attendre, egal, verifier } from '../outils/verifs.mjs';
import { INTERVENTION, ajouterDepuisModele } from './dossiers.mjs';
import { EMPLOYE, MACHINE, MACHINE_SANS_ID } from './fiches.mjs';

/** Élément actif : son nom accessible (aria-label ou texte). */
const focus = (page) => page.evaluate(() => {
  const e = document.activeElement;
  return e?.getAttribute('aria-label') ?? e?.textContent?.trim() ?? '';
});

/** Vide la saisie d'une aide à la saisie (sélection puis effacement au clavier). */
async function vider(zone, libelle) {
  await champChoix(zone, libelle).click();
  await champChoix(zone, libelle).press('Control+a');
  await champChoix(zone, libelle).press('Backspace');
}

/** Blocs Employé / Machine d'un document, lus dans le back. */
async function blocsFiches(app, dossierId, nom) {
  const d = (await app.appeler('dossier_detail', { id: dossierId })).documents.find((x) => x.nom === nom);
  return d.blocs.filter((b) => b.t === 'employe' || b.t === 'machine').map((b) => [b.v, b.entiteId ?? null]);
}

export const aideSaisie = {
  id: 'aide-saisie',
  titre: 'Aide à la saisie : propositions, clavier, souris, homonymes, fiches archivées exclues (dossier, document)',
  async executer(ctx) {
    const { page, app } = ctx;
    verifier(ctx.memo.a && ctx.memo.b && ctx.memo.homonyme, 'Ce scénario utilise les fiches des scénarios « employes » et « machines ».');
    const { homonyme: HOMONYME, employe: ID_EMPLOYE_MODIFIE } = ctx.memo.codes;
    const codeBenali = ctx.memo.codes['BENALI Sofia'];
    const codeHaddad = ctx.memo.codes['HADDAD Karim'];
    const ids = {
      haddad: (await app.appeler('entites_lister', { kind: 'a' })).find((e) => e.code === codeHaddad).id,
      formation: (await app.appeler('entites_lister', { kind: 'b' })).find((e) => e.libelle === 'Portable formation').id,
    };

    // § 11.1 : le formulaire de dossier n'a plus d'employé ni de machine ; l'aide à la saisie se contrôle dans les blocs
    // Employé / Machine d'un nouveau document (vides), ajouté à un dossier d'exemple puis supprimé.
    const annee = new Date().getFullYear() - 1;
    const dossier = (await app.appeler('dossiers_lister')).find((d) => d.nom === `Dossier ${annee}-01`);
    ctx.etape('nouveau document (blocs Employé / Machine vides) : « ben » propose les deux homonymes, distingués par leur identifiant');
    await ouvrirDossier(page, dossier.nom);
    const docEssai = await ajouterDepuisModele(page, INTERVENTION);
    egal(await champChoix(page, 'Utilisateur').inputValue(), '', 'Bloc « Utilisateur » vide dans un nouveau document');
    const props = await taperDansChoix(page, 'Utilisateur', 'ben');
    egal(props.map((p) => [p.nom, p.code]), [['BENALI Sofia', codeBenali], ['BENALI Sofia', HOMONYME]], 'Propositions pour « ben »');
    egal(props.map((p) => p.detail), ['Technicienne · Division informatique', 'Technicienne · Division administrative'],
      'Poste et structure de chaque proposition');
    egal(props.map((p) => p.active), [true, false], 'La première proposition est active');
    const statut = choixFiche(page, 'Utilisateur').locator('[role=status]');
    egal(await statut.textContent(), '2 propositions. Flèches pour parcourir, Entrée pour choisir.', 'Annonce du nombre de propositions');
    egal(await champChoix(page, 'Utilisateur').getAttribute('aria-expanded'), 'true', 'Liste ouverte (aria-expanded)');
    await ctx.capture('aide-saisie/document-homonymes');

    ctx.etape('clavier : ↓ ↓ revient en tête (en boucle), ↑ va à la dernière, Entrée choisit');
    await page.keyboard.press('ArrowDown');
    egal((await propositions(page, 'Utilisateur')).map((p) => p.active), [false, true], 'Après ↓');
    const activeId = await champChoix(page, 'Utilisateur').getAttribute('aria-activedescendant');
    egal(await page.locator(`[id="${activeId}"]`).getAttribute('aria-selected'), 'true', 'aria-activedescendant désigne la proposition active');
    await page.keyboard.press('ArrowDown');
    egal((await propositions(page, 'Utilisateur')).map((p) => p.active), [true, false], 'Après ↓ ↓ (retour en tête)');
    await page.keyboard.press('ArrowUp');
    egal((await propositions(page, 'Utilisateur')).map((p) => p.active), [false, true], 'Après ↑');
    await page.keyboard.press('Enter');
    await attendre(() => carteChoisie(page, 'Utilisateur').isVisible(), 'L’employé choisi au clavier doit s’afficher');
    verifier((await carteChoisie(page, 'Utilisateur').innerText()).includes(HOMONYME), 'Le cadre montre l’homonyme choisi (identifiant -2)');
    egal(await focus(page), 'Changer Utilisateur (BENALI Sofia)', 'Le focus passe sur « Changer »');
    egal(await page.locator('.content .alert.bad').count(), 0, 'Entrée choisit sans erreur');

    ctx.etape('Changer : une fiche archivée n’est pas proposée ; Échap ferme, efface, puis annule');
    await bouton(page, 'Changer Utilisateur (BENALI Sofia)').click();
    verifier(await bouton(choixFiche(page, 'Utilisateur'), 'Annuler').isVisible(), '« Annuler » est proposé pendant le changement');
    egal(await taperDansChoix(page, 'Utilisateur', 'lef'), [], 'LEFÈVRE Thomas (archivé) n’est pas proposé');
    egal(await choixFiche(page, 'Utilisateur').locator('.cf-vide').innerText(), 'Aucun employé actif ne correspond à « lef ».', 'Message sans proposition');
    await page.keyboard.press('Escape');
    egal(await champChoix(page, 'Utilisateur').getAttribute('aria-expanded'), 'false', 'Échap ferme la liste');
    egal(await champChoix(page, 'Utilisateur').inputValue(), 'lef', 'La saisie reste après la première Échap');
    await page.keyboard.press('Escape');
    egal(await champChoix(page, 'Utilisateur').inputValue(), '', 'La deuxième Échap efface la saisie');
    await page.keyboard.press('Escape');
    await attendre(() => carteChoisie(page, 'Utilisateur').isVisible(), 'La troisième Échap annule le changement');
    verifier((await carteChoisie(page, 'Utilisateur').innerText()).includes(HOMONYME), 'Le choix précédent est gardé');

    ctx.etape('sans accents, par prénom et par identifiant ; choix à la souris');
    await bouton(page, 'Changer Utilisateur (BENALI Sofia)').click();
    egal((await taperDansChoix(page, 'Utilisateur', 'leila')).map((p) => p.nom), ['MANSOURI Leïla'], 'Saisie sans accent');
    await vider(page, 'Utilisateur');
    egal((await taperDansChoix(page, 'Utilisateur', 'amel')).map((p) => p.nom), [EMPLOYE.libelle], 'Recherche par prénom');
    await vider(page, 'Utilisateur');
    egal((await taperDansChoix(page, 'Utilisateur', codeHaddad.toLowerCase())).map((p) => [p.nom, p.code]), [['HADDAD Karim', codeHaddad]],
      'Recherche par identifiant (casse ignorée)');
    await page.getByRole('option', { name: /HADDAD Karim/ }).click();
    await attendre(() => carteChoisie(page, 'Utilisateur').isVisible(), 'L’employé choisi à la souris doit s’afficher');
    egal((await detailsCarte(page, 'Utilisateur')).Identifiant, codeHaddad, 'HADDAD Karim est choisi');
    egal(await page.getByRole('group', { name: /^Machines affectées à/ }).count(), 0, 'Plus de raccourci « Machines affectées à … » (§ 11.1)');

    ctx.etape('machine : 8 propositions au plus, fiche archivée exclue, liste ouverte capturée');
    const p = await taperDansChoix(page, 'Matériel', 'p');
    egal(p.length, 8, 'Au plus 8 propositions');
    verifier(!p.some((x) => x.nom === 'Station de calcul'), 'Une machine archivée n’est jamais proposée');
    await vider(page, 'Matériel');
    egal(await taperDansChoix(page, 'Matériel', 'stat'), [], 'Station de calcul (archivée) n’est pas proposée');
    await vider(page, 'Matériel');
    const portables = await taperDansChoix(page, 'Matériel', 'port');
    egal(portables.map((x) => x.nom).sort(), ['Portable direction', 'Portable formation', 'Portable mission 01', MACHINE_SANS_ID].sort(),
      'Propositions pour « port »');
    const formation = portables.find((x) => x.nom === 'Portable formation');
    egal([formation.code, formation.detail], ['LT-0108', 'Asus ExpertBook B1 · Intel Core i5-1235U · 8 Go · SSD 512 Go · Ordinateur portable'],
      'Identifiant, marque et caractéristiques d’une proposition');
    await ctx.capture('aide-saisie/liste-ouverte');
    await page.getByRole('option', { name: /Portable formation/ }).hover();
    egal((await propositions(page, 'Matériel')).find((x) => x.nom === 'Portable formation').active, true, 'Le survol rend la proposition active');
    await page.getByRole('option', { name: /Portable formation/ }).click();
    await attendre(() => carteChoisie(page, 'Matériel').isVisible(), 'La machine choisie à la souris doit s’afficher');
    verifier((await carteChoisie(page, 'Matériel').innerText()).includes('LT-0108'), 'Portable formation est choisie');
    await attendre(async () => JSON.stringify(await blocsFiches(app, dossier.id, docEssai))
      === JSON.stringify([['Utilisateur', ids.haddad], ['Matériel', ids.formation]]), 'Les choix sont enregistrés dans le document');
    ctx.etape('le document d’essai est supprimé');
    await page.locator('.preview .pv-h').getByRole('button', { name: 'Supprimer', exact: true }).click();
    await bouton(modale(page), 'Supprimer le document').click();
    await attendre(async () => !(await page.locator('.files .file b').allInnerTexts()).includes(docEssai), 'Le document d’essai est supprimé');

    ctx.etape('document : bloc Employé rempli, changé au clavier, retiré, puis rechoisi');
    await page.locator('.folder.sub', { hasText: 'Demandes' }).click();
    await attendreTitre(page, 'Demandes');
    await ouvrirDocument(page, 'Document_01');
    const avant = await blocsFiches(app, dossier.id, 'Document_01');
    egal(await detailsCarte(page, 'Utilisateur'),
      { Nom: 'Benali', Prénom: 'Sofia', Poste: 'Technicienne', Structure: 'Division informatique', Identifiant: codeBenali },
      'Informations de l’employé affichées par le bloc « Utilisateur »');
    await bouton(page, 'Changer Utilisateur (BENALI Sofia)').click();
    verifier(await page.evaluate(() => document.activeElement?.getAttribute('role') === 'combobox'), 'Le curseur passe dans l’aide à la saisie');
    egal((await taperDansChoix(page, 'Utilisateur', 'zeni')).map((x) => x.nom), [EMPLOYE.libelle], 'Propositions dans le document');
    await ctx.capture('aide-saisie/document');
    await page.keyboard.press('Enter');
    await attendre(async () => (await detailsCarte(page, 'Utilisateur')).Identifiant === ID_EMPLOYE_MODIFIE, 'L’employé choisi doit s’afficher');
    egal(await detailsCarte(page, 'Utilisateur'),
      { Nom: EMPLOYE.nom, Prénom: EMPLOYE.prenom, Poste: 'Technicienne', Structure: 'Division informatique', Identifiant: ID_EMPLOYE_MODIFIE },
      'Informations de l’employé choisi');
    await attendre(async () => (await blocsFiches(app, dossier.id, 'Document_01')).find((b) => b[0] === 'Utilisateur')[1] === ctx.memo.a,
      'Le choix doit être enregistré dans le document');
    await bouton(page, `Retirer Utilisateur (${EMPLOYE.libelle})`).click();
    await attendre(() => champChoix(page, 'Utilisateur').isVisible(), 'Après « Retirer », l’aide à la saisie revient');
    await attendre(async () => (await blocsFiches(app, dossier.id, 'Document_01')).find((b) => b[0] === 'Utilisateur')[1] === null,
      'Le choix retiré doit être enregistré (aucune fiche)');
    egal((await taperDansChoix(page, 'Utilisateur', 'lef')), [], 'Pas d’employé archivé dans le document');
    await vider(page, 'Utilisateur');
    await taperDansChoix(page, 'Utilisateur', 'benali');
    await page.getByRole('option', { name: new RegExp(`${codeBenali}$`) }).click();
    await attendre(async () => (await detailsCarte(page, 'Utilisateur')).Identifiant === codeBenali, 'BENALI Sofia est rechoisie');
    await attendre(async () => JSON.stringify(await blocsFiches(app, dossier.id, 'Document_01')) === JSON.stringify(avant),
      'Le document retrouve ses fiches d’origine');

    ctx.etape('document : bloc Machine, une machine archivée n’est pas proposée');
    await bouton(page, 'Changer Matériel (PC accueil)').click();
    egal(await taperDansChoix(page, 'Matériel', 'station'), [], 'Station de calcul (archivée) n’est pas proposée');
    await vider(page, 'Matériel');
    egal((await taperDansChoix(page, 'Matériel', 'e2e')).map((x) => x.nom).sort(), [MACHINE, MACHINE_SANS_ID].sort(), 'Machines proposées pour « e2e »');
    await bouton(choixFiche(page, 'Matériel'), 'Annuler').click();
    await attendre(async () => (await detailsCarte(page, 'Matériel')).Nom === 'PC accueil', 'Annuler garde la machine du document');
  },
};
