// Affectations (§ 9.3) et historique cliquable (§ 9.4), dans l'application réelle.
// - Affecter une machine à un employé depuis sa fiche, sans aucun dossier pour la paire ; la machine apparaît dans les
//   affectations en cours des deux fiches ; retirer l'affectation : elle passe dans les anciennes, avec ses dates ;
//   réaffecter (nouvelle période) ; retirer une affectation alors qu'un dossier nomme la paire dans ses documents
//   (accepté, le dossier reste lié) ; affecter depuis la fiche d'une machine, au clavier.
// - Historique : depuis la frise d'un employé, le nom d'une machine affectée, puis d'une machine anciennement affectée,
//   ouvre sa fiche et Retour ramène à l'onglet d'historique ; le nom d'un dossier ouvre le dossier ; même chose depuis
//   la fiche d'une machine vers un employé.
// - Aucun « associer », « association », « dissocier » à l'écran (fiches, fenêtres, frises).

import { attendreTitre, bouton, carteChoisie, champChoix, modale, ouvrirFiche, taperDansChoix, texteErreur } from '../outils/ui.mjs';
import { attendre, controleVocabulaire, Echec, egal, pause, verifier } from '../outils/verifs.mjs';
import { EMPLOYE, ID_MACHINE, ID_MACHINE_2, MACHINE, MACHINE_SANS_ID, recap } from './fiches.mjs';

/** Date du jour au format affiché (JJ/MM/AAAA). */
export function aujourdhui() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/** Tableau d'affectations de la fiche affichée (« Affectations en cours » / « Anciennes affectations »). */
export const tableauAffectations = (page, nom) => page.getByRole('table', { name: nom, exact: true });

/** Lignes d'un tableau d'affectations : [{ nom, identifiant, du, au }] (au : colonne « Au », absente des en cours). */
export async function lignesAffectations(page, nom) {
  const t = tableauAffectations(page, nom);
  if (!(await t.count())) return [];
  // textContent : les en-têtes sont affichés en capitales (text-transform), innerText les rendrait ainsi.
  const heads = (await t.locator('thead th').allTextContents()).map((x) => x.trim());
  const iDu = heads.findIndex((h) => h === 'Depuis le' || h === 'Du');
  const iAu = heads.indexOf('Au');
  return t.locator('tbody tr').evaluateAll((trs, [du, au]) => trs.map((tr) => {
    const tds = [...tr.children].map((td) => td.textContent.trim());
    return { nom: tds[0], identifiant: tds[1], du: tds[du], ...(au >= 0 ? { au: tds[au] } : {}) };
  }), [iDu, iAu]);
}

/** Capture de la page entière (fenêtre agrandie à la hauteur du contenu, 3 000 px au plus). */
export async function capturePageEntiere(ctx, nom) {
  const h = await ctx.page.evaluate(() => document.getElementById('content').scrollHeight);
  try {
    await ctx.app.imposerTaille(1280, Math.min(h + 120, 3000));
    await ctx.page.evaluate(() => { document.getElementById('content').scrollTop = 0; });
    await ctx.capture(nom);
  } finally {
    await ctx.app.imposerTaille(0, 0);
  }
}

/** Contrôle du vocabulaire (aucun ancien libellé, aucun « associer » / « dissocier ») sur l'écran affiché. */
async function vocabulaire(page, ou) {
  for (const p of await page.evaluate(controleVocabulaire)) throw new Echec(`${ou} : vocabulaire à proscrire ${p}`);
}

/** Onglet sélectionné de la fiche affichée. */
const ongletChoisi = async (page) => (await page.getByRole('tab', { selected: true }).innerText()).replace(/\s+\d+$/, '').trim();

/** Clique un nom de la frise (bouton « Ouvrir la fiche » / « Ouvrir le dossier ») et renvoie son nom. */
async function cliquerLien(page, nom, title) {
  const lien = page.locator('[role=tabpanel] .tl button.tl-lien', { hasText: nom }).filter({ hasText: new RegExp(`^${nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).first();
  await attendre(() => lien.isVisible(), `Le nom « ${nom} » doit être un lien dans la frise`);
  egal(await lien.getAttribute('title'), title, `Infobulle du lien « ${nom} »`);
  await lien.click();
}

/** Retour : la fiche revient sur le même onglet d'historique. */
async function retourHistorique(page, titreFiche, onglet) {
  await bouton(page, 'Retour').click();
  await attendreTitre(page, titreFiche);
  await attendre(async () => (await ongletChoisi(page)) === onglet, `Retour doit ramener à l’onglet « ${onglet} »`);
  verifier(await page.locator('[role=tabpanel] .tl').first().isVisible(), `La frise de l’onglet « ${onglet} » est affichée après Retour`);
}

export const affectations = {
  id: 'affectations',
  titre: 'Affectations : affecter sans dossier, retirer, réaffecter, retirer malgré un dossier ; historique cliquable',
  async executer(ctx) {
    const { page, app } = ctx;
    verifier(ctx.memo.a && ctx.memo.b, 'Ce scénario utilise les fiches des scénarios « employes » et « machines ».');
    const jour = aujourdhui();
    const ficheBack = (id) => app.appeler('entite_fiche', { id });
    const enCoursBack = async (id) => (await ficheBack(id)).affectations.filter((x) => x.fin === null).map((x) => x.entite.id);

    ctx.etape('fiche de l’employé : « Affecter une machine » visible dès l’ouverture, section « Affectations » vide');
    // § 11.1 : un dossier n'est lié à une fiche que si elle est nommée dans l'un de ses documents.
    const dossiersCommuns = async () => {
      const da = (await ficheBack(ctx.memo.a)).dossiers.map((d) => d.id);
      return (await ficheBack(ctx.memo.b)).dossiers.filter((d) => da.includes(d.id)).length;
    };
    egal(await dossiersCommuns(), 0, 'Aucun dossier ne nomme encore l’employé et la machine');
    const nbDossiers = (await app.appeler('dossiers_lister')).length;
    await ouvrirFiche(page, 'a', EMPLOYE.libelle);
    const affecter = page.locator('.ph .ph-actions').getByRole('button', { name: 'Affecter une machine', exact: true });
    verifier(await affecter.isVisible() && await affecter.isEnabled(), 'Le bouton « Affecter une machine » est dans l’en-tête de la fiche');
    verifier(await affecter.evaluate((b) => b.classList.contains('primary')), '« Affecter une machine » est l’action principale de la fiche');
    verifier(await affecter.evaluate((b) => { const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }),
      '« Affecter une machine » est visible sans faire défiler la page');
    verifier(!(await page.getByRole('tab', { name: /associ/i }).count()), 'Plus d’onglet « Machines associées »');
    verifier(await page.locator('.sec', { hasText: 'Affectations en cours' }).first().isVisible(), 'La section « Affectations » est affichée');
    const vide = page.locator('.empty', { hasText: 'Aucune machine n’est affectée à cet employé.' });
    verifier(await vide.isVisible(), 'Message « Aucune machine n’est affectée à cet employé. »');
    verifier((await vide.innerText()).includes('Utilisez « Affecter une machine » en haut de la fiche.'), 'Le message vide dit comment affecter');
    await vocabulaire(page, 'Fiche de l’employé');

    ctx.etape('fenêtre « Affecter une machine » : aide à la saisie à la souris');
    await affecter.click();
    await attendre(() => modale(page).isVisible(), 'La fenêtre d’affectation ne s’ouvre pas');
    egal(await modale(page).locator('h3').innerText(), 'Affecter une machine', 'Titre de la fenêtre');
    verifier(await page.evaluate(() => document.activeElement?.getAttribute('role') === 'combobox'), 'Le curseur est dans l’aide à la saisie');
    const props = await taperDansChoix(modale(page), 'Machine à affecter', 'e2e');
    egal(props.map((p) => [p.nom, p.code]), [[MACHINE, ID_MACHINE], [MACHINE_SANS_ID, ID_MACHINE_2]], 'Machines proposées pour « e2e »');
    verifier(props[0].detail.includes('Dell Latitude 5440') && props[0].detail.includes('32 Go'), `Détail d’une proposition : ${props[0].detail}`);
    // § 10.6 : le choix est obligatoire ; « Affecter » sans machine choisie est refusé, le curseur revient dans la saisie.
    // (Échap ferme d'abord la liste des propositions, qui recouvre le bouton.)
    await page.keyboard.press('Escape');
    await attendre(async () => (await champChoix(modale(page), 'Machine à affecter').getAttribute('aria-expanded')) === 'false', 'Échap ferme la liste');
    egal(await modale(page).count(), 1, 'La fenêtre reste ouverte');
    await bouton(modale(page), 'Affecter').click();
    await attendre(async () => (await texteErreur(modale(page))).includes('Remplissez le champ obligatoire « Machine à affecter ».'),
      '« Affecter » sans machine choisie doit être refusé avec son message');
    verifier(await page.evaluate(() => document.activeElement?.getAttribute('role') === 'combobox'), 'Le curseur revient dans l’aide à la saisie');
    egal(await enCoursBack(ctx.memo.a), [], 'Rien n’est affecté');
    await attendre(async () => (await modale(page).getByRole('option').count()) === 2, 'Les propositions reviennent avec le curseur');
    await vocabulaire(page, 'Fenêtre « Affecter une machine »');
    await ctx.capture('fiches/affecter');
    await ctx.capture('v12-reel/02-fenetre-affecter-une-machine');
    await modale(page).getByRole('option', { name: new RegExp(`^${MACHINE}`) }).click();
    await attendre(() => carteChoisie(modale(page), 'Machine à affecter').isVisible(), 'La machine choisie doit s’afficher');
    verifier((await carteChoisie(modale(page), 'Machine à affecter').innerText()).includes(ID_MACHINE), 'Le cadre montre l’identifiant');
    await bouton(modale(page), 'Affecter').click();
    await attendre(async () => !(await modale(page).count()), 'La fenêtre d’affectation ne se ferme pas');

    ctx.etape('la machine est dans les affectations en cours des deux fiches, depuis aujourd’hui');
    await attendre(async () => (await lignesAffectations(page, 'Affectations en cours')).some((l) => l.nom === MACHINE),
      'La machine affectée doit apparaître dans « Affectations en cours »');
    egal(await lignesAffectations(page, 'Affectations en cours'), [{ nom: MACHINE, identifiant: ID_MACHINE, du: jour }], 'Affectations en cours de l’employé');
    egal(await lignesAffectations(page, 'Anciennes affectations'), [], 'Aucune ancienne affectation');
    egal(await enCoursBack(ctx.memo.a), [ctx.memo.b], 'Affectation en cours de l’employé dans le back');
    egal(await enCoursBack(ctx.memo.b), [ctx.memo.a], 'Affectation en cours de la machine dans le back');
    egal((await app.appeler('dossiers_lister')).length, nbDossiers, 'Affecter ne crée aucun dossier');
    egal(await dossiersCommuns(), 0, 'Affecter ne lie aucun dossier aux deux fiches');
    await ouvrirFiche(page, 'b', MACHINE);
    await attendre(async () => (await lignesAffectations(page, 'Affectations en cours')).some((l) => l.nom === EMPLOYE.libelle),
      'L’employé doit apparaître dans les affectations en cours de la machine');
    verifier(await page.locator('.ph .ph-actions').getByRole('button', { name: 'Affecter à un employé', exact: true }).isVisible(),
      'La fiche d’une machine propose « Affecter à un employé »');
    await vocabulaire(page, 'Fiche de la machine');

    ctx.etape('une machine déjà affectée n’est plus proposée ; Échap ferme la fenêtre');
    await ouvrirFiche(page, 'a', EMPLOYE.libelle);
    await bouton(page, 'Affecter une machine').click();
    egal((await taperDansChoix(modale(page), 'Machine à affecter', 'e2e')).map((p) => p.nom), [MACHINE_SANS_ID], 'Machines proposées après affectation');
    await page.keyboard.press('Escape'); // ferme la liste
    await page.keyboard.press('Escape'); // efface la saisie
    await page.keyboard.press('Escape'); // ferme la fenêtre
    await attendre(async () => !(await modale(page).count()), 'Échap doit fermer la fenêtre d’affectation');

    ctx.etape('retirer l’affectation : elle passe dans les anciennes, avec ses dates');
    await page.getByRole('button', { name: `Retirer l’affectation de ${MACHINE}`, exact: true }).click();
    await attendre(() => modale(page).isVisible(), 'La confirmation du retrait ne s’ouvre pas');
    egal(await modale(page).locator('h3').innerText(), 'Retirer l’affectation ?', 'Titre de la confirmation');
    verifier((await modale(page).innerText()).includes(`L’affectation de ${MACHINE} à ${EMPLOYE.libelle} prend fin aujourd’hui.`),
      'La confirmation nomme la machine et l’employé');
    await vocabulaire(page, 'Confirmation du retrait');
    await bouton(modale(page), 'Retirer l’affectation').click();
    await attendre(async () => !(await modale(page).count()), 'La confirmation doit se fermer');
    await attendre(async () => (await lignesAffectations(page, 'Anciennes affectations')).some((l) => l.nom === MACHINE),
      'La machine doit passer dans « Anciennes affectations »');
    egal(await lignesAffectations(page, 'Affectations en cours'), [], 'Plus d’affectation en cours');
    verifier(await vide.isVisible(), 'Message vide des affectations en cours après le retrait');
    egal(await lignesAffectations(page, 'Anciennes affectations'), [{ nom: MACHINE, identifiant: ID_MACHINE, du: jour, au: jour }],
      'Ancienne affectation, avec ses dates');
    egal(await enCoursBack(ctx.memo.b), [], 'Plus d’affectation en cours côté machine');

    ctx.etape('réaffecter la même machine (clavier) : nouvelle période, l’ancienne reste');
    await bouton(page, 'Affecter une machine').click();
    await taperDansChoix(modale(page), 'Machine à affecter', 'pc e2e');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await attendre(() => carteChoisie(modale(page), 'Machine à affecter').isVisible(), 'La machine choisie au clavier doit s’afficher');
    await bouton(modale(page), 'Affecter').click();
    await attendre(async () => !(await modale(page).count()), 'La fenêtre d’affectation ne se ferme pas');
    await attendre(async () => (await lignesAffectations(page, 'Affectations en cours')).some((l) => l.nom === MACHINE),
      'La machine réaffectée doit revenir dans « Affectations en cours »');
    egal(await lignesAffectations(page, 'Anciennes affectations'), [{ nom: MACHINE, identifiant: ID_MACHINE, du: jour, au: jour }],
      'L’ancienne période reste dans les anciennes affectations');
    const periodes = (await ficheBack(ctx.memo.a)).affectations.filter((x) => x.entite.id === ctx.memo.b);
    egal(periodes.map((x) => x.fin === null), [true, false], 'Deux périodes pour la paire dans le back : en cours, puis terminée');
    await capturePageEntiere(ctx, 'v12-reel/01-fiche-employe-affectations');
    await page.getByRole('tab', { name: 'Historique complet' }).click();
    const journal = await page.locator('[role=tabpanel]').innerText();
    for (const t of [`Affectation de ${MACHINE}`, `Fin de l’affectation de ${MACHINE}`, `Début de l’affectation (identifiant ${ID_MACHINE}).`]) {
      verifier(journal.includes(t), `Le journal de l’employé doit contenir « ${t} »`);
    }
    await vocabulaire(page, 'Historique complet de l’employé');

    ctx.etape('retirer une affectation alors qu’un dossier nomme la paire : accepté, le dossier reste lié');
    const annee = new Date().getFullYear() - 1;
    const dossierPaire = `Dossier ${annee}-01`;
    const codeBenali = ctx.memo.codes['BENALI Sofia'];
    const idBenali = (await app.appeler('entites_lister', { kind: 'a' })).find((e) => e.code === codeBenali).id;
    const idPcAccueil = (await app.appeler('entites_lister', { kind: 'b' })).find((e) => e.libelle === 'PC accueil').id;
    // § 11.1 : les deux fiches sont nommées dans les documents du dossier (données d'exemple) : c'est le dossier qui les lie.
    const nommesDansPaire = () => Promise.all([idBenali, idPcAccueil].map(async (id) => (await ficheBack(id)).dossiers.some((d) => d.nom === dossierPaire)));
    egal(await nommesDansPaire(), [true, true], `Le dossier ${dossierPaire} nomme BENALI Sofia et PC accueil`);
    await ouvrirFiche(page, 'a', 'BENALI Sofia', codeBenali);
    const benali = (await recap(page)).Identifiant;
    egal(benali, codeBenali, `Fiche de BENALI Sofia (${codeBenali})`);
    const enCoursAvant = await lignesAffectations(page, 'Affectations en cours');
    verifier(enCoursAvant.some((l) => l.nom === 'PC accueil'), `PC accueil est affecté à BENALI Sofia (${JSON.stringify(enCoursAvant)})`);
    await page.getByRole('button', { name: 'Retirer l’affectation de PC accueil', exact: true }).click();
    await attendre(() => modale(page).isVisible(), 'La confirmation du retrait ne s’ouvre pas');
    verifier((await modale(page).innerText()).includes('Les documents et les dossiers où ces deux fiches sont nommées ne changent pas.'),
      'La confirmation dit que les documents et les dossiers ne changent pas');
    await bouton(modale(page), 'Retirer l’affectation').click();
    await attendre(async () => !(await modale(page).count()) || (await texteErreur(modale(page))) !== '',
      'La confirmation doit se fermer');
    verifier(!(await modale(page).count()), `Le retrait doit être accepté malgré le dossier (message : ${await texteErreur(page)})`);
    await attendre(async () => (await lignesAffectations(page, 'Anciennes affectations')).some((l) => l.nom === 'PC accueil' && l.au === jour),
      'PC accueil doit passer dans les anciennes affectations, terminée aujourd’hui');
    verifier(!(await lignesAffectations(page, 'Affectations en cours')).some((l) => l.nom === 'PC accueil'), 'PC accueil n’est plus en cours');
    await ctx.capture('fiches/retrait-avec-dossier');
    egal(await nommesDansPaire(), [true, true], 'Le dossier reste lié aux deux fiches');
    await page.getByRole('tab', { name: /Dossiers liés/ }).click();
    verifier(await page.locator('[role=tabpanel] .folders .folder', { hasText: dossierPaire }).isVisible(), `Le dossier ${dossierPaire} reste dans « Dossiers liés »`);

    ctx.etape('historique de l’employé : machine affectée, machine anciennement affectée, dossier');
    const fb = await ficheBack((await app.appeler('entites_lister', { kind: 'a' })).find((e) => e.code === codeBenali).id);
    const machineEnCours = fb.affectations.find((x) => x.fin === null && x.entite.actif)?.entite.libelle;
    verifier(machineEnCours, 'BENALI Sofia doit avoir une machine affectée en ce moment');
    await page.getByRole('tab', { name: 'Journal chronologique' }).click();
    await attendre(async () => (await ongletChoisi(page)) === 'Journal chronologique', 'Onglet « Journal chronologique »');
    egal(await page.locator('[role=tabpanel] .tl button.tl-lien', { hasText: 'BENALI Sofia' }).count(), 0, 'Le nom de la fiche affichée n’est pas un lien');
    await capturePageEntiere(ctx, 'v12-reel/03-historique-employe-liens');
    await vocabulaire(page, 'Journal chronologique de l’employé');
    await cliquerLien(page, machineEnCours, 'Ouvrir la fiche');
    await attendreTitre(page, machineEnCours);
    verifier((await lignesAffectations(page, 'Affectations en cours')).some((l) => l.nom === 'BENALI Sofia'),
      `La fiche de ${machineEnCours} (affectée) est ouverte`);
    await retourHistorique(page, 'BENALI Sofia', 'Journal chronologique');
    await cliquerLien(page, 'PC accueil', 'Ouvrir la fiche');
    await attendreTitre(page, 'PC accueil');
    verifier((await lignesAffectations(page, 'Anciennes affectations')).some((l) => l.nom === 'BENALI Sofia'),
      'La fiche de PC accueil (anciennement affecté) est ouverte, BENALI Sofia dans ses anciennes affectations');
    await retourHistorique(page, 'BENALI Sofia', 'Journal chronologique');
    egal((await recap(page)).Identifiant, codeBenali, 'Retour ramène à la bonne homonyme');
    await cliquerLien(page, dossierPaire, 'Ouvrir le dossier');
    await attendreTitre(page, dossierPaire);
    await retourHistorique(page, 'BENALI Sofia', 'Journal chronologique');

    ctx.etape('historique d’une machine : employé (affectation terminée), puis dossier');
    await ouvrirFiche(page, 'b', 'PC accueil');
    egal(await ongletChoisi(page), 'Historique des affectations', 'Premier onglet de la fiche d’une machine');
    verifier(!(await page.getByRole('tab', { name: /associ/i }).count()), 'Plus d’onglet « Employés associés »');
    const tl = await page.locator('[role=tabpanel]').innerText();
    verifier(tl.includes('Fin de l’affectation de BENALI Sofia') && tl.includes('Affectation de BENALI Sofia'),
      `Historique des affectations de PC accueil : ${tl.slice(0, 300)}`);
    await capturePageEntiere(ctx, 'v12-reel/04-fiche-machine');
    await vocabulaire(page, 'Historique des affectations de la machine');
    await cliquerLien(page, 'BENALI Sofia', 'Ouvrir la fiche');
    await attendreTitre(page, 'BENALI Sofia');
    egal((await recap(page)).Identifiant, codeBenali, 'Le lien ouvre la bonne fiche (homonymes)');
    await retourHistorique(page, 'PC accueil', 'Historique des affectations');
    await page.getByRole('tab', { name: 'Journal des opérations' }).click();
    await attendre(async () => (await ongletChoisi(page)) === 'Journal des opérations', 'Onglet « Journal des opérations »');
    await cliquerLien(page, dossierPaire, 'Ouvrir le dossier');
    await attendreTitre(page, dossierPaire);
    await retourHistorique(page, 'PC accueil', 'Journal des opérations');

    ctx.etape('affecter depuis la fiche d’une machine, au clavier');
    await ouvrirFiche(page, 'b', MACHINE_SANS_ID);
    await bouton(page, 'Affecter à un employé').click();
    await attendre(() => modale(page).isVisible(), 'La fenêtre « Affecter à un employé » ne s’ouvre pas');
    egal(await modale(page).locator('h3').innerText(), 'Affecter à un employé', 'Titre de la fenêtre');
    const employesProposes = await taperDansChoix(modale(page), 'Employé', 'kac');
    egal(employesProposes.map((p) => [p.nom, p.code]), [['KACI Rania', ctx.memo.codes.kaci]], 'Employés proposés pour « kac »');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await attendre(() => carteChoisie(modale(page), 'Employé').isVisible(), 'L’employé choisi au clavier doit s’afficher');
    await vocabulaire(page, 'Fenêtre « Affecter à un employé »');
    await bouton(modale(page), 'Affecter').click();
    await attendre(async () => (await lignesAffectations(page, 'Affectations en cours')).some((l) => l.nom === 'KACI Rania' && l.du === jour),
      'L’employé affecté doit apparaître sur la fiche de la machine');

    ctx.etape(`fin de la seconde période de ${MACHINE} (le scénario « dossiers » vérifie qu’un dossier n’affecte plus rien, § 11.1)`);
    await ouvrirFiche(page, 'a', EMPLOYE.libelle);
    await page.getByRole('button', { name: `Retirer l’affectation de ${MACHINE}`, exact: true }).click();
    await bouton(modale(page), 'Retirer l’affectation').click();
    await attendre(async () => (await lignesAffectations(page, 'Anciennes affectations')).length === 2, 'Deux anciennes affectations');
    egal(await enCoursBack(ctx.memo.a), [], 'Plus aucune affectation en cours pour l’employé');
    await pause(100);
  },
};
