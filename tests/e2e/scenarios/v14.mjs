// Version 1.4 (spécification § 11) dans l'application réelle :
// - « rattachement » : le rattachement d'un dossier à un employé et à une machine a disparu de tous les écrans (dossier
//   ouvert, formulaire, cartes, arborescence, recherche, tableau de bord, fiches) ;
// - « nominations » : nommer un employé ou une machine dans un document (bloc ou nom écrit) le fait apparaître sur son
//   profil avec le champ et la date ; le retirer l'en fait disparaître ; deux champs du même document ; date stable
//   quand on enregistre une autre saisie, y compris après un redémarrage ; employé créé après coup, renommé ;
//   historique (nomination, champ, liens vers le document, le champ et le dossier ; événements du dossier) ;
// - « import-fiches » : employé et machine concernés par un fichier importé, sur leurs profils, lecture seule si clôturé ;
// - « recherche-profil » : recherche dans les documents d'un profil (nom, modèle, dossier, champ, date), filtres par
//   modèle cumulés avec la recherche, « Tout réafficher », état vide ; recherche dans chaque onglet d'historique ;
// - « suppression-modele » : suppression refusée avec son motif quand un document vient du modèle, acceptée sinon ;
//   modèle standard supprimé puis restauré ; documents existants intacts.

import {
  attendreBadge, attendreTitre, bouton, carteChoisie, champChoix, champPapier, echapper, menu, modale, ouvrirDocument, ouvrirDossier,
  ouvrirFiche, taperDansChoix,
} from '../outils/ui.mjs';
import { attendre, egal, pause, verifier } from '../outils/verifs.mjs';
import { capturePageEntiere } from './affectations.mjs';
import { BESOINS, INTERVENTION, NOM_DOSSIER, ajouterDepuisModele, documentDuBack } from './dossiers.mjs';
import { EMPLOYE, MACHINE } from './fiches.mjs';
import { aujourdhuiIso, creerDossier, documentsCites, redemarrer, sectionDocuments } from './v13.mjs';

/** Dossier des captures de la version 1.4 dans l'application réelle. */
const CAP = 'v14-reel';

/** Date AAAA-MM-JJ… affichée JJ/MM/AAAA. */
const jjmmaaaa = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
/** Texte replié (casse et accents ignorés), comme la recherche des profils. */
const plier = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Fiche par son libellé (et, pour un employé, son identifiant si besoin). */
async function ficheParLibelle(app, kind, libelle) {
  const e = (await app.appeler('entites_lister', { kind })).filter((x) => x.libelle === libelle);
  verifier(e.length === 1, `Une seule fiche « ${libelle} » attendue (${e.length})`);
  return e[0];
}

/** Nominations d'une fiche dans un document (back) : { facons, champs, depuis } ou null. */
async function nominationDans(app, id, documentId) {
  const d = (await app.appeler('entite_fiche', { id })).documents.find((x) => x.id === documentId);
  return d ? { facons: d.facons, champs: d.champs, depuis: d.depuis } : null;
}

/** Attend que la nomination d'une fiche dans un document soit `attendu` (facons et champs ; null = aucune). */
async function attendreNomination(app, id, documentId, attendu, quoi) {
  return attendre(async () => {
    const n = await nominationDans(app, id, documentId);
    if (attendu === null) return n === null ? true : false;
    return n && JSON.stringify([n.facons, n.champs]) === JSON.stringify([attendu.facons, attendu.champs]) ? n : false;
  }, quoi);
}

// ───────────────────────────── rattachement retiré ─────────────────────────────

export const rattachement = {
  id: 'rattachement',
  titre: 'Rattachement retiré (§ 11.1) : dossier ouvert, sous-dossier, formulaire, cartes, arborescence, recherche, tableau de bord, fiches',
  async executer(ctx) {
    const { page, app } = ctx;
    const annee = new Date().getFullYear();
    const nomD = `Dossier ${annee - 1}-01`;
    const d = (await app.appeler('dossiers_lister')).find((x) => x.nom === nomD);
    verifier(d, `Dossier d’exemple « ${nomD} »`);
    const detail = await app.appeler('dossier_detail', { id: d.id });
    const nommes = detail.entitesCitees.map((e) => e.libelle);
    verifier(nommes.includes('BENALI Sofia') && nommes.includes('PC accueil'), `Fiches nommées dans les documents de ${nomD} : ${nommes.join(', ')}`);
    // Toutes les fiches de la base : aucune ne doit être citée par une carte, l'arborescence, la recherche ou le tableau de bord.
    const libelles = [...await app.appeler('entites_lister', { kind: 'a' }), ...await app.appeler('entites_lister', { kind: 'b' })].map((e) => e.libelle);
    const mentions = (t) => [...libelles.filter((l) => t.includes(l)), ...(/sans employ|sans machine|employé et machine/i.exec(t) ?? [])];

    ctx.etape('dossier ouvert : plus de section « Employé et machine », sections renumérotées (racine et sous-dossier)');
    await ouvrirDossier(page, nomD);
    const sections = () => page.locator('.content section.sec > .sec-h h2').evaluateAll((hs) => hs.map((h) => h.textContent.replace(/\s+/g, ' ').trim()));
    egal(await sections(), ['Contenu du dossier', 'Options à cocher', 'Document'], `Sections de ${nomD}`);
    egal(await page.$$eval('.content input[role=combobox]', (els) => els.filter((e) => !e.closest('.paper')).length), 0,
      'Aucune aide à la saisie de fiche hors des documents');
    egal(mentions(await page.locator('.content .ph').innerText()), [], 'L’en-tête du dossier ne nomme aucune fiche');
    await ctx.capture(`${CAP}/01-dossier-ouvert`);
    await page.locator('.folder.sub', { hasText: 'Demandes' }).click();
    await attendreTitre(page, 'Demandes');
    egal(await sections(), ['Contenu du dossier', 'Document'], 'Sections d’un sous-dossier');

    ctx.etape('formulaire de dossier : ni employé, ni machine, ni raccourci');
    await menu(page, 'Dossiers & Archives');
    await bouton(page, 'Créer un dossier').click();
    await attendreTitre(page, 'Créer un dossier');
    const form = page.locator('.content form.form');
    egal(await form.locator('.choix-fiche').count(), 0, 'Aucun choix de fiche dans le formulaire');
    egal(mentions(await page.locator('.content').innerText()), [], 'Le formulaire ne parle ni d’employé ni de machine du dossier');
    verifier(!/\bEmployé\b|\bMachine\b/.test(await form.innerText()), `Libellés du formulaire : ${(await form.innerText()).replace(/\s+/g, ' ')}`);
    await bouton(page, 'Annuler').click();

    ctx.etape('cartes (vue Groupes) et arborescence : aucune fiche citée');
    await menu(page, 'Dossiers & Archives');
    const carte = page.locator('.folders .folder', { has: page.locator('b', { hasText: new RegExp(`^${echapper(nomD)}$`) }) }).first();
    egal(mentions(await carte.innerText()), [], `Carte de ${nomD}`);
    egal(await page.locator('.folders .folder .folder-fiches').count(), 0, 'Plus de ligne « fiches » sur les cartes');
    egal(mentions(await page.locator('.content').innerText()), [], 'Aucune carte de dossier ne cite une fiche');
    await page.locator('.seg button', { hasText: 'Arborescence' }).click();
    await attendre(() => page.locator('.tree').isVisible(), 'L’arborescence s’affiche');
    egal(mentions(await page.locator('.tree').innerText()), [], 'L’arborescence ne cite aucune fiche');
    await page.locator('.seg button', { hasText: 'Groupes' }).click();

    ctx.etape('recherche : un dossier n’est plus trouvé par le nom d’une fiche, et ses résultats n’en citent aucune');
    await page.keyboard.press('Control+k');
    await page.keyboard.type('benali');
    const dd = page.locator('#dd');
    await attendre(async () => (await dd.getAttribute('aria-busy')) === 'false' && (await dd.locator('.res').count()) > 0, 'La recherche « benali » répond');
    egal(await dd.locator('.grp').evaluateAll((gs) => gs.map((g) => g.getAttribute('aria-label').split(' : ')[0])), ['Employés'],
      '« benali » ne trouve que des employés (aucun dossier par son employé)');
    await page.keyboard.press('Control+a');
    await page.keyboard.type(nomD);
    await attendre(async () => (await dd.getAttribute('aria-busy')) === 'false' && (await dd.locator('.res', { hasText: nomD }).count()) === 1, `La recherche trouve ${nomD}`);
    egal(mentions(await dd.innerText()), [], 'Les résultats de dossiers ne citent aucune fiche');
    egal((await dd.locator('.res', { hasText: nomD }).locator('.res-d').innerText()).trim(), `${d.theme} · ${d.annee}`, 'Détail d’un dossier trouvé : catégorie et année');
    await page.keyboard.press('Escape');

    ctx.etape('tableau de bord : les dossiers ouverts ne citent aucune fiche');
    await menu(page, 'Tableau de bord');
    const ouverts = page.locator('.sec', { has: page.locator('h2', { hasText: 'Dossiers ouverts' }) });
    verifier(await ouverts.locator('.files .file').count() > 0, 'Des dossiers ouverts sont listés');
    egal(mentions(await ouverts.innerText()), [], 'Dossiers ouverts du tableau de bord');

    ctx.etape('fiches : plus de « Créer un dossier » ; les dossiers liés sont ceux où la fiche est nommée');
    const benali = (await app.appeler('entites_lister', { kind: 'a' })).find((e) => e.code === ctx.memo.codes['BENALI Sofia']);
    await ouvrirFiche(page, 'a', 'BENALI Sofia', benali.code);
    egal(await bouton(page, 'Créer un dossier').count(), 0, 'Plus de bouton « Créer un dossier » sur la fiche d’un employé');
    const lies = (await app.appeler('entite_fiche', { id: benali.id })).dossiers.map((x) => x.nom);
    verifier(lies.includes(nomD), `${nomD} est un dossier lié de BENALI Sofia (nommée dans ses documents) : ${lies.join(', ')}`);
    await ouvrirFiche(page, 'b', 'PC accueil');
    egal(await bouton(page, 'Créer un dossier').count(), 0, 'Plus de bouton « Créer un dossier » sur la fiche d’une machine');
    await menu(page, 'Tableau de bord');
  },
};

// ───────────────────────────── nominations ─────────────────────────────

const DOSSIER_NOMINATIONS = 'Dossier nominations e2e';
const NOUVEL_EMPLOYE = { nom: 'Ferhat', prenom: 'Inès', libelle: 'FERHAT Inès' };

/** Lit, sur le profil affiché, la ligne d'un document du dossier des nominations. */
async function ligneProfil(page, kind, doc) {
  return (await documentsCites(page, kind)).find((x) => x.doc === doc && x.dossier === DOSSIER_NOMINATIONS) ?? null;
}

export const nominations = {
  id: 'nominations',
  titre: 'Nominations (§ 11.2) : bloc, nom écrit, identifiant écrit, deux champs, retrait, date stable après redémarrage, fiche créée puis renommée, historique',
  async executer(ctx) {
    let { page, app } = ctx;
    const brahimi = await ficheParLibelle(app, 'a', 'BRAHIMI Yacine');
    const secretariat = await ficheParLibelle(app, 'b', 'PC secrétariat');
    const jour = jjmmaaaa(aujourdhuiIso());

    ctx.etape('nouveau dossier, document « Fiche d’intervention informatique »');
    const d = await creerDossier(ctx, DOSSIER_NOMINATIONS);
    ctx.memo.dossierNominations = d.id;
    const doc = await ajouterDepuisModele(page, INTERVENTION);
    const docId = (await documentDuBack(app, d.id, doc)).id;
    egal(await nominationDans(app, brahimi.id, docId), null, 'Avant : BRAHIMI Yacine n’est pas nommé dans le document');

    ctx.etape('employé choisi dans le bloc « Utilisateur » : sur son profil, avec le champ et la date de nomination');
    const avantChoix = new Date();
    await taperDansChoix(page, 'Utilisateur', 'brahimi');
    await page.keyboard.press('Enter');
    const n1 = await attendreNomination(app, brahimi.id, docId, { facons: ['bloc'], champs: ['Utilisateur'] }, 'BRAHIMI Yacine est nommé par le bloc « Utilisateur »');
    verifier(n1.depuis.startsWith(aujourdhuiIso()), `Nomination datée d’aujourd’hui : ${n1.depuis}`);
    const ecart = Math.abs(new Date(n1.depuis.replace(' ', 'T')).getTime() - avantChoix.getTime());
    verifier(ecart < 120_000, `Moment de la nomination proche du choix (${n1.depuis}, écart ${Math.round(ecart / 1000)} s)`);
    verifier((await app.appeler('entite_fiche', { id: brahimi.id })).dossiers.some((x) => x.id === d.id), 'Le dossier devient un dossier lié de l’employé nommé');
    await ouvrirFiche(page, 'a', 'BRAHIMI Yacine');
    const l1 = await attendre(() => ligneProfil(page, 'a', doc), 'Le document figure sur le profil de BRAHIMI Yacine');
    egal([l1.modele, l1.facons, l1.nomination], [INTERVENTION, ['Choisi dans le document'], `Champ « Utilisateur » · Nommé le ${jour} à ${n1.depuis.slice(11, 16)}`],
      'Ligne du profil : modèle, façon, champ et moment de la nomination');

    ctx.etape('une autre saisie enregistrée dans le même document ne change pas la date de nomination');
    await pause(1500);
    await ouvrirDossier(page, DOSSIER_NOMINATIONS, doc);
    await champPapier(page, 'Signalée par').fill('Service du courrier');
    await attendre(async () => (await documentDuBack(app, d.id, doc)).blocs.find((b) => b.v === 'Signalée par').val === 'Service du courrier', 'Saisie enregistrée');
    egal((await nominationDans(app, brahimi.id, docId))?.depuis, n1.depuis, 'Date de nomination inchangée après une autre saisie');

    ctx.etape('machine choisie dans le bloc « Matériel » : sur son profil, « Nommée le … »');
    await taperDansChoix(page, 'Matériel', 'secr');
    await page.keyboard.press('Enter');
    const m1 = await attendreNomination(app, secretariat.id, docId, { facons: ['bloc'], champs: ['Matériel'] }, 'PC secrétariat est nommée par le bloc « Matériel »');

    ctx.etape('redémarrage : dates de nomination conservées, y compris après une nouvelle saisie');
    await redemarrer(ctx);
    ({ page, app } = ctx);
    egal((await nominationDans(app, brahimi.id, docId))?.depuis, n1.depuis, 'Date de nomination de l’employé après redémarrage');
    egal((await nominationDans(app, secretariat.id, docId))?.depuis, m1.depuis, 'Date de nomination de la machine après redémarrage');
    await ouvrirDossier(page, DOSSIER_NOMINATIONS, doc);
    await champPapier(page, 'N° de poste').fill('4410');
    await attendre(async () => (await documentDuBack(app, d.id, doc)).blocs.find((b) => b.v === 'N° de poste').val === '4410', 'Saisie enregistrée après redémarrage');
    egal((await nominationDans(app, brahimi.id, docId))?.depuis, n1.depuis, 'Date inchangée après une saisie faite après le redémarrage');
    await ouvrirFiche(page, 'b', 'PC secrétariat');
    const lm = await attendre(() => ligneProfil(page, 'b', doc), 'Le document figure sur le profil de PC secrétariat');
    egal([lm.facons, lm.nomination], [['Choisie dans le document'], `Champ « Matériel » · Nommée le ${jjmmaaaa(m1.depuis)} à ${m1.depuis.slice(11, 16)}`],
      'Profil de la machine : façon, champ et moment');

    ctx.etape('le même employé nommé dans deux champs du document : les deux champs sont indiqués');
    await ouvrirDossier(page, DOSSIER_NOMINATIONS, doc);
    await champPapier(page, 'Défauts signalés').fill('Yacine Brahimi signale un écran noir.');
    const n2 = await attendreNomination(app, brahimi.id, docId, { facons: ['bloc', 'texte'], champs: ['Utilisateur', 'Défauts signalés'] },
      'BRAHIMI Yacine est nommé dans « Utilisateur » et « Défauts signalés »');
    egal(n2.depuis, n1.depuis, 'Le document garde la date de la première nomination');
    await ouvrirFiche(page, 'a', 'BRAHIMI Yacine');
    const l2 = await attendre(async () => {
      const x = await ligneProfil(page, 'a', doc);
      return x && x.facons.length === 2 ? x : false;
    }, 'Le profil montre les deux façons');
    egal([l2.facons, l2.nomination], [['Choisi dans le document', 'Nom écrit dans le document'],
      `Champs « Utilisateur » et « Défauts signalés » · Nommé le ${jour} à ${n1.depuis.slice(11, 16)}`], 'Deux champs indiqués sur le profil');

    ctx.etape('historique : une nomination par champ, avec liens vers le document, le champ et le dossier');
    const ev = (await app.appeler('entite_fiche', { id: brahimi.id })).evenements.filter((e) => e.type === 'nomination' && e.documentId === docId);
    egal(ev.map((e) => [e.titre, e.detail, e.champ, e.dossierNom]).sort(), [
      [`Nommé dans ${INTERVENTION} : ${doc}`, 'Champ « Défauts signalés »', 'Défauts signalés', DOSSIER_NOMINATIONS],
      [`Nommé dans ${INTERVENTION} : ${doc}`, 'Champ « Utilisateur »', 'Utilisateur', DOSSIER_NOMINATIONS],
    ].sort(), 'Deux événements de nomination dans le back');
    await page.getByRole('tab', { name: 'Journal chronologique' }).click();
    const ligne = (champ) => page.locator('[role=tabpanel] .tl li', { has: page.locator('p', { hasText: `Champ « ${champ} »` }) })
      .filter({ has: page.locator('b', { hasText: `Nommé dans ${INTERVENTION} : ${doc}` }) });
    await attendre(async () => (await ligne('Utilisateur').count()) === 1 && (await ligne('Défauts signalés').count()) === 1,
      'Les deux nominations figurent dans le journal chronologique');
    egal(await ligne('Utilisateur').locator('time').innerText(), jour, 'Date de la nomination dans l’historique');
    await capturePageEntiere(ctx, `${CAP}/03-historique-nominations`);
    await ligne('Défauts signalés').locator('p button.tl-lien', { hasText: 'Défauts signalés' }).click();
    await attendreTitre(page, DOSSIER_NOMINATIONS);
    await attendre(async () => (await page.locator('.preview .pv-h b').innerText()).trim() === doc, 'Le lien du champ ouvre le document');
    await bouton(page, 'Retour').click();
    await attendreTitre(page, 'BRAHIMI Yacine');
    await attendre(async () => (await page.getByRole('tab', { selected: true }).innerText()).startsWith('Journal chronologique'), 'Retour ramène à l’onglet');
    await ligne('Utilisateur').locator('b button.tl-lien', { hasText: doc }).click();
    await attendre(async () => (await page.locator('.preview .pv-h b').innerText().catch(() => '')).trim() === doc, 'Le lien du document ouvre le document');
    await bouton(page, 'Retour').click();
    await attendreTitre(page, 'BRAHIMI Yacine');
    const lienDossier = ligne('Utilisateur').locator('button.tl-lien', { hasText: DOSSIER_NOMINATIONS });
    egal(await lienDossier.getAttribute('title'), 'Ouvrir le dossier', 'Le dossier de la nomination est un lien');
    await lienDossier.click();
    await attendreTitre(page, DOSSIER_NOMINATIONS);
    await bouton(page, 'Retour').click();
    await attendreTitre(page, 'BRAHIMI Yacine');

    ctx.etape('retirer l’employé du bloc : reste nommé par le texte ; effacer le texte : il disparaît du profil');
    await ouvrirDossier(page, DOSSIER_NOMINATIONS, doc);
    await bouton(page, 'Retirer Utilisateur (BRAHIMI Yacine)').click();
    await attendreNomination(app, brahimi.id, docId, { facons: ['texte'], champs: ['Défauts signalés'] }, 'Après le retrait du bloc, seul le nom écrit nomme l’employé');
    await champPapier(page, 'Défauts signalés').fill('Écran noir au démarrage.');
    await attendreNomination(app, brahimi.id, docId, null, 'Plus nommé : le document quitte le profil de l’employé');
    verifier(!(await app.appeler('entite_fiche', { id: brahimi.id })).dossiers.some((x) => x.id === d.id), 'Le dossier n’est plus un dossier lié de l’employé');
    await ouvrirFiche(page, 'a', 'BRAHIMI Yacine');
    await pause(300);
    egal(await ligneProfil(page, 'a', doc), null, 'Le document n’est plus sur le profil de l’employé');

    ctx.etape('machine : retirée du bloc, puis nommée par son identifiant écrit, puis effacée');
    await ouvrirDossier(page, DOSSIER_NOMINATIONS, doc);
    await bouton(page, 'Retirer Matériel (PC secrétariat)').click();
    await attendreNomination(app, secretariat.id, docId, null, 'Machine retirée du bloc : plus nommée');
    await champPapier(page, 'N° de série').fill('Poste PC-0106, à reformater');
    const m2 = await attendreNomination(app, secretariat.id, docId, { facons: ['texte'], champs: ['N° de série'] }, 'PC secrétariat est nommée par son identifiant écrit');
    verifier(m2.depuis > m1.depuis || m2.depuis === m1.depuis, `Nouvelle nomination datée de maintenant (${m2.depuis})`);
    await ouvrirFiche(page, 'b', 'PC secrétariat');
    const lm2 = await attendre(() => ligneProfil(page, 'b', doc), 'Le document revient sur le profil de la machine');
    egal(lm2.facons, ['Identifiant écrit dans le document'], 'Façon : identifiant écrit');
    await ouvrirDossier(page, DOSSIER_NOMINATIONS, doc);
    await champPapier(page, 'N° de série').fill('SN-0001');
    await attendreNomination(app, secretariat.id, docId, null, 'Identifiant effacé : la machine n’est plus nommée');

    ctx.etape('nom et prénom écrits à la main AVANT que l’employé existe : nommé dès sa création');
    await champPapier(page, 'Signalée par').fill(`Mme ${NOUVEL_EMPLOYE.prenom} ${NOUVEL_EMPLOYE.nom}`);
    await attendre(async () => (await documentDuBack(app, d.id, doc)).blocs.find((b) => b.v === 'Signalée par').val.includes(NOUVEL_EMPLOYE.nom), 'Saisie enregistrée');
    await menu(page, 'Employés');
    await bouton(page, 'Créer un employé').click();
    await attendreTitre(page, 'Créer un employé');
    await page.fill('#n-nom', NOUVEL_EMPLOYE.nom);
    await page.fill('#n-prenom', NOUVEL_EMPLOYE.prenom);
    await page.fill('#n-naissance', '1991-04-12');
    await page.fill('#n-poste', 'Secrétaire');
    await page.selectOption('#n-cat', { label: 'Division informatique' });
    await bouton(page, 'Enregistrer la fiche').click();
    await attendreTitre(page, NOUVEL_EMPLOYE.libelle);
    const ferhat = await ficheParLibelle(app, 'a', NOUVEL_EMPLOYE.libelle);
    const f1 = await attendreNomination(app, ferhat.id, docId, { facons: ['texte'], champs: ['Signalée par'] }, 'L’employé créé après coup est nommé dans le document');
    const lf = await attendre(() => ligneProfil(page, 'a', doc), 'Le document figure sur le profil du nouvel employé');
    egal([lf.facons, lf.nomination], [['Nom écrit dans le document'], `Champ « Signalée par » · Nommé le ${jour} à ${f1.depuis.slice(11, 16)}`],
      'Profil du nouvel employé');

    ctx.etape('renommer l’employé met à jour ses nominations par le texte');
    await bouton(page, 'Modifier la fiche').click();
    await attendreTitre(page, 'Modifier la fiche');
    await page.fill('#n-nom', 'Ferhati');
    await bouton(page, 'Enregistrer les modifications').click();
    await attendreTitre(page, 'FERHATI Inès');
    await attendreNomination(app, ferhat.id, docId, null, 'Renommé « Ferhati » : le nom écrit ne le nomme plus');
    await attendre(async () => (await sectionDocuments(page, 'a').innerText()).includes('n’est nommé dans aucun document'), 'Le profil renommé n’a plus de document');
    await bouton(page, 'Modifier la fiche').click();
    await attendreTitre(page, 'Modifier la fiche');
    await page.fill('#n-nom', NOUVEL_EMPLOYE.nom);
    await bouton(page, 'Enregistrer les modifications').click();
    await attendreTitre(page, NOUVEL_EMPLOYE.libelle);
    await attendreNomination(app, ferhat.id, docId, { facons: ['texte'], champs: ['Signalée par'] }, 'Nom rétabli : de nouveau nommé');
    await attendre(() => ligneProfil(page, 'a', doc), 'Le document revient sur le profil');

    ctx.etape('nom écrit dans une cellule de tableau : le champ est la colonne ; supprimer le document retire la nomination');
    await ouvrirDossier(page, DOSSIER_NOMINATIONS);
    const docTableau = await ajouterDepuisModele(page, BESOINS);
    const docTableauId = (await documentDuBack(app, d.id, docTableau)).id;
    await bouton(page, 'Ajouter une ligne').click();
    await page.getByLabel('Désignation, ligne 1', { exact: true }).fill(`Poste pour ${NOUVEL_EMPLOYE.prenom} ${NOUVEL_EMPLOYE.nom}`);
    await attendreNomination(app, ferhat.id, docTableauId, { facons: ['texte'], champs: ['Désignation'] }, 'Nommé dans la colonne « Désignation » du tableau');
    await page.locator('.preview .pv-h').getByRole('button', { name: 'Supprimer', exact: true }).click();
    await bouton(modale(page), 'Supprimer le document').click();
    await attendre(async () => !(await page.locator('.files .file b').allInnerTexts()).includes(docTableau), 'Le document supprimé disparaît');
    await attendreNomination(app, ferhat.id, docTableauId, null, 'Le document supprimé n’est plus sur le profil');
    egal((await app.appeler('entite_fiche', { id: ferhat.id })).evenements.filter((e) => e.documentId === docTableauId).length, 0,
      'Ni dans l’historique');

    ctx.etape('les événements du dossier apparaissent dans l’historique des fiches nommées');
    await ouvrirDossier(page, DOSSIER_NOMINATIONS);
    await bouton(page, 'Clôturer le dossier').click();
    await attendreBadge(page, 'Clôturé');
    const evF = (await app.appeler('entite_fiche', { id: ferhat.id })).evenements;
    for (const t of ['dossier_ouvert', 'dossier_clos']) {
      verifier(evF.some((e) => e.type === t && e.dossierId === d.id), `L’événement « ${t} » du dossier figure dans l’historique de ${NOUVEL_EMPLOYE.libelle}`);
    }
    verifier(!(await app.appeler('entite_fiche', { id: brahimi.id })).evenements.some((e) => e.dossierId === d.id && e.type === 'dossier_clos'),
      'Une fiche qui n’est plus nommée ne reçoit pas les événements du dossier');
    await bouton(page, 'Rouvrir le dossier').click();
    await attendreBadge(page, 'En cours');
    await menu(page, 'Tableau de bord');
  },
};

// ───────────────────────────── fichier importé ─────────────────────────────

export const importFiches = {
  id: 'import-fiches',
  titre: 'Fichier importé (§ 11.1) : employé et machine concernés, au-dessus de l’aperçu, sur leurs profils, lecture seule dans un dossier clôturé',
  async executer(ctx) {
    const { page, app } = ctx;
    verifier(ctx.memo.dossier && ctx.memo.imports?.length, 'Ce scénario utilise les fichiers importés par le scénario « import-reel ».');
    const nomImport = ctx.memo.imports[0];
    const docId = (await documentDuBack(app, ctx.memo.dossier, nomImport)).id;
    const blocs = async () => (await documentDuBack(app, ctx.memo.dossier, nomImport)).blocs.map((b) => [b.t, b.v, b.entiteId ?? null]);

    ctx.etape('le fichier importé porte « Employé concerné » et « Machine concernée », vides, au-dessus de l’aperçu');
    await ouvrirDossier(page, NOM_DOSSIER, nomImport);
    const groupe = page.getByRole('group', { name: 'Employé et machine concernés par ce fichier', exact: true });
    await attendre(() => groupe.isVisible(), 'Le groupe « Employé et machine concernés par ce fichier » s’affiche');
    egal(await blocs(), [['employe', 'Employé concerné', null], ['machine', 'Machine concernée', null]], 'Les deux blocs du fichier importé (back)');
    egal([await champChoix(page, 'Employé concerné').inputValue(), await champChoix(page, 'Machine concernée').inputValue()], ['', ''], 'Champs vides');
    const img = page.locator('.paper img');
    await attendre(() => img.evaluate((i) => i.complete && i.naturalWidth > 0), 'L’aperçu de l’image se charge');
    verifier((await groupe.boundingBox()).y < (await img.boundingBox()).y, 'Les deux champs sont au-dessus de l’aperçu');

    ctx.etape('choisir l’employé et la machine concernés (aide à la saisie)');
    egal((await taperDansChoix(page, 'Employé concerné', 'zeni')).map((p) => p.nom), [EMPLOYE.libelle], 'Employé proposé');
    await page.keyboard.press('Enter');
    egal((await taperDansChoix(page, 'Machine concernée', 'pc-e2e')).map((p) => p.nom), [MACHINE], 'Machine proposée');
    await page.keyboard.press('Enter');
    await attendre(async () => JSON.stringify(await blocs()) === JSON.stringify([['employe', 'Employé concerné', ctx.memo.a], ['machine', 'Machine concernée', ctx.memo.b]]),
      'Les choix sont enregistrés dans les blocs du fichier importé');
    await pause(300);
    await ctx.capture(`${CAP}/05-fichier-importe-employe-machine`);

    ctx.etape('sur les profils : « Fichier importé », champ « Employé concerné » / « Machine concernée »');
    for (const [kind, libelle, id, champ, facon] of [['a', EMPLOYE.libelle, ctx.memo.a, 'Employé concerné', 'Choisi dans le document'],
      ['b', MACHINE, ctx.memo.b, 'Machine concernée', 'Choisie dans le document']]) {
      await attendreNomination(app, id, docId, { facons: ['bloc'], champs: [champ] }, `${libelle} est nommé(e) dans le fichier importé`);
      await ouvrirFiche(page, kind, libelle);
      const l = await attendre(async () => (await documentsCites(page, kind)).find((x) => x.doc === nomImport && x.dossier === NOM_DOSSIER), `Le fichier importé figure sur le profil de ${libelle}`);
      egal([l.modele, l.facons, l.nomination.startsWith(`Champ « ${champ} » · `)], ['Fichier importé', [facon], true], `Ligne du profil de ${libelle}`);
    }

    ctx.etape('dossier clôturé : employé et machine du fichier en lecture seule, refus du back');
    await ouvrirDossier(page, NOM_DOSSIER, nomImport);
    await bouton(page, 'Clôturer le dossier').click();
    await attendreBadge(page, 'Clôturé');
    await ouvrirDocument(page, nomImport);
    egal(await groupe.getByRole('combobox').count(), 0, 'Aucune aide à la saisie dans un dossier clôturé');
    egal(await groupe.getByRole('button', { name: /^(Changer|Retirer)/ }).count(), 0, 'Ni « Changer » ni « Retirer »');
    verifier(await carteChoisie(page, 'Employé concerné').isVisible() && await carteChoisie(page, 'Machine concernée').isVisible(),
      'Les fiches choisies restent affichées');
    const doc = await documentDuBack(app, ctx.memo.dossier, nomImport);
    const r = await app.invoquer('document_enregistrer_blocs', { id: doc.id, blocs: doc.blocs.map((b) => ({ ...b, entiteId: null })) });
    verifier(!r.ok && r.erreur.code === 'dossier_clos', `Le back refuse de modifier le fichier importé d’un dossier clôturé (${JSON.stringify(r)})`);
    await bouton(page, 'Rouvrir le dossier').click();
    await attendreBadge(page, 'En cours');
  },
};

// ───────────────────────────── recherche dans les profils ─────────────────────────────

/** Ce que la recherche lit d'un document du profil (§ 11.3). */
const textesDocument = (d) => [d.nom, d.modeleNom || (d.origine === 'import' ? 'Fichier importé' : d.source), d.dossierNom, ...(d.champs ?? []),
  jjmmaaaa(d.dateDoc), jjmmaaaa(d.depuis)];
const textesEvenement = (e) => [e.titre, e.detail, jjmmaaaa(e.date), e.champ ?? '', e.dossierNom ?? '', e.documentNom ?? ''];
const correspond = (textes, q) => {
  const mots = plier(q).split(/\s+/).filter(Boolean);
  const t = textes.map(plier);
  return mots.every((m) => t.some((s) => s.includes(m)));
};
const compte = (n, total, un, plusieurs) => (n === total ? `${total} ${total > 1 ? plusieurs : un}` : `${n} sur ${total} ${total > 1 ? plusieurs : un}`);

/** Documents affichés par le profil : [[document, dossier]]. */
const affichesProfil = async (page, kind) => (await documentsCites(page, kind)).map((x) => [x.doc, x.dossier]);

export const rechercheProfil = {
  id: 'recherche-profil',
  titre: 'Recherche dans les profils (§ 11.3) : document, modèle, dossier, champ, date ; filtres par modèle cumulés ; « Tout réafficher » ; état vide ; historique',
  async executer(ctx) {
    const { page, app } = ctx;
    const haddad = (await app.appeler('entites_lister', { kind: 'a' })).find((e) => e.code === ctx.memo.codes['HADDAD Karim']);
    const fiche = await app.appeler('entite_fiche', { id: haddad.id });
    const docs = fiche.documents;
    const modeles = [...new Set(docs.map((x) => x.modeleNom))];
    verifier(docs.length >= 4 && modeles.length >= 2, `HADDAD Karim est nommé dans au moins 4 documents de 2 modèles (${docs.length}, ${modeles.join(', ')})`);
    await ouvrirFiche(page, 'a', 'HADDAD Karim', haddad.code);
    const sec = sectionDocuments(page, 'a');
    const champ = sec.getByRole('searchbox', { name: 'Rechercher dans les documents', exact: true });
    const statut = sec.locator('.recherche-barre [role=status]');
    const filtres = sec.getByRole('group', { name: 'Filtrer par modèle de document', exact: true });
    const tous = filtres.getByRole('button', { name: 'Tous les modèles', exact: true });
    const toutReafficher = sec.locator('.recherche-barre').getByRole('button', { name: 'Tout réafficher', exact: true });
    const attendu = (q, ms = []) => docs.filter((x) => (!ms.length || ms.includes(x.modeleNom)) && correspond(textesDocument(x), q)).map((x) => [x.nom, x.dossierNom]);
    const verifierListe = async (q, ms, quoi) => {
      const att = attendu(q, ms);
      await attendre(async () => JSON.stringify(await affichesProfil(page, 'a')) === JSON.stringify(att)
        && (await statut.innerText()).trim() === compte(att.length, docs.length, 'document', 'documents'), `${quoi} : ${att.length} document(s) attendu(s)`);
      return att.length;
    };

    ctx.etape(`sans filtre : ${docs.length} documents, « Tous les modèles » enfoncé, une étiquette par modèle`);
    egal((await statut.innerText()).trim(), `${docs.length} documents`, 'Compte des documents');
    egal(await tous.getAttribute('aria-pressed'), 'true', '« Tous les modèles » enfoncé');
    for (const m of modeles) {
      const n = docs.filter((x) => x.modeleNom === m).length;
      egal(await filtres.getByRole('button', { name: `${m} ${n} document${n > 1 ? 's' : ''}`, exact: true }).getAttribute('aria-pressed'), 'false', `Étiquette « ${m} »`);
    }
    egal(await toutReafficher.count(), 0, 'Pas de « Tout réafficher » sans filtre');
    await capturePageEntiere(ctx, `${CAP}/02a-profil-recherche-sans-filtre`);

    const premier = docs[0];
    const avecChamp = docs.find((x) => x.champs.length) ?? premier;
    const recherches = [
      [premier.nom.toLowerCase(), 'nom du document'],
      ['intervention', 'modèle (« intervention »)'],
      [premier.dossierNom, 'dossier'],
      [avecChamp.champs[0], 'champ'],
      [jjmmaaaa(premier.dateDoc), 'date JJ/MM/AAAA'],
      [premier.dateDoc.slice(0, 4), 'année'],
      [plier(premier.modeleNom).toUpperCase(), 'modèle sans accents, en capitales'],
    ];
    for (const [q, quoi] of recherches) {
      ctx.etape(`recherche par ${quoi} : « ${q} »`);
      await champ.fill(q);
      const n = await verifierListe(q, [], `Recherche par ${quoi}`);
      verifier(n > 0, `La recherche par ${quoi} trouve au moins un document`);
      if (n < docs.length) verifier(await toutReafficher.isVisible(), '« Tout réafficher » est proposé quand un filtre masque des documents');
    }

    ctx.etape('filtres par modèle : un, puis deux (cumulés), puis avec la recherche ; « Tous les modèles »');
    await champ.fill('');
    const [m1, m2] = modeles;
    const etiquette = (m) => filtres.getByRole('button', { name: new RegExp(`^${echapper(m)} \\d+ documents?$`) });
    await etiquette(m1).click();
    egal([await etiquette(m1).getAttribute('aria-pressed'), await tous.getAttribute('aria-pressed')], ['true', 'false'], 'Étiquette enfoncée');
    await verifierListe('', [m1], `Filtre « ${m1} »`);
    await etiquette(m2).click();
    await verifierListe('', [m1, m2], `Filtres « ${m1} » et « ${m2} »`);
    await etiquette(m2).click();
    const q = premier.dateDoc.slice(0, 4);
    await champ.fill(q);
    await verifierListe(q, [m1], `Filtre « ${m1} » et recherche « ${q} »`);
    await capturePageEntiere(ctx, `${CAP}/02c-profil-recherche-filtree`);
    await tous.click();
    egal(await tous.getAttribute('aria-pressed'), 'true', '« Tous les modèles » enfoncé de nouveau');
    await verifierListe(q, [], `« Tous les modèles » et recherche « ${q} »`);

    ctx.etape('« Tout réafficher » vide la recherche et les filtres');
    await etiquette(m1).click();
    await toutReafficher.click();
    egal(await champ.inputValue(), '', 'Recherche vidée');
    egal(await tous.getAttribute('aria-pressed'), 'true', 'Filtres retirés');
    await verifierListe('', [], 'Après « Tout réafficher »');

    ctx.etape('état vide : aucun document ne correspond');
    await champ.fill('zzzz');
    const vide = sec.locator('.filtre-vide');
    await attendre(async () => (await vide.locator('p').innerText()).trim() === 'Aucun document ne correspond à « zzzz ».', 'État vide de la recherche');
    egal((await statut.innerText()).trim(), `0 sur ${docs.length} documents`, 'Compte de l’état vide');
    await capturePageEntiere(ctx, `${CAP}/02b-profil-recherche-vide`);
    await etiquette(m1).click();
    await attendre(async () => (await vide.locator('p').innerText()).trim() === 'Aucun document ne correspond à « zzzz » dans le modèle choisi.',
      'État vide avec un modèle choisi');
    await bouton(vide, 'Tout réafficher').click();
    await verifierListe('', [], '« Tout réafficher » depuis l’état vide');

    ctx.etape('recherche dans chaque onglet d’historique (employé, puis machine)');
    const ASSOC = ['association', 'dissociation'];
    const DOSSIER = ['dossier_ouvert', 'dossier_rouvert', 'piece_manquante', 'piece_ajoutee', 'dossier_clos', 'statut_modifie', 'dossier_fiches', 'nomination'];
    const machine = (await app.appeler('entites_lister', { kind: 'b' })).find((e) => e.libelle === 'PC accueil');
    const evM = (await app.appeler('entite_fiche', { id: machine.id })).evenements;
    const onglets = [
      ['a', 'HADDAD Karim', haddad.code, 'Journal chronologique', fiche.evenements.filter((e) => ASSOC.includes(e.type) || DOSSIER.includes(e.type))],
      ['a', 'HADDAD Karim', haddad.code, 'Historique complet', fiche.evenements],
      ['b', 'PC accueil', undefined, 'Historique des affectations', evM.filter((e) => ASSOC.includes(e.type))],
      ['b', 'PC accueil', undefined, 'Journal des opérations', evM.filter((e) => !ASSOC.includes(e.type))],
    ];
    for (const [kind, libelle, code, onglet, evs] of onglets) {
      await ouvrirFiche(page, kind, libelle, code);
      await page.getByRole('tab', { name: new RegExp(`^${echapper(onglet)}`) }).click();
      const panneau = page.locator('[role=tabpanel]');
      const recherche = panneau.getByRole('searchbox', { name: 'Rechercher dans l’historique', exact: true });
      const st = panneau.locator('.recherche-barre [role=status]');
      await attendre(async () => (await st.innerText()).trim() === compte(evs.length, evs.length, 'événement', 'événements'), `${libelle}, ${onglet} : ${evs.length} événements`);
      const motsCles = [evs.find((e) => e.type === 'nomination') ? 'nommé' : evs[0].titre.split(' ')[0], jjmmaaaa(evs[evs.length - 1].date)];
      for (const mot of motsCles) {
        await recherche.fill(mot);
        const n = evs.filter((e) => correspond(textesEvenement(e), mot)).length;
        await attendre(async () => (await st.innerText()).trim() === compte(n, evs.length, 'événement', 'événements')
          && (await panneau.locator('.tl li').count()) === Math.min(n, 200), `${libelle}, ${onglet}, « ${mot} » : ${n} événement(s)`);
      }
      if (kind === 'a' && onglet === 'Journal chronologique') {
        await recherche.fill('nommé');
        await capturePageEntiere(ctx, `${CAP}/04-historique-recherche`);
      }
      await recherche.fill('zzzz');
      await attendre(async () => (await panneau.locator('.filtre-vide p').innerText()).trim() === 'Aucun événement ne correspond à « zzzz ».', `${onglet} : état vide`);
      await bouton(panneau.locator('.filtre-vide'), 'Tout réafficher').click();
      egal(await recherche.inputValue(), '', `${onglet} : recherche vidée`);
    }
    await menu(page, 'Tableau de bord');
  },
};

// ───────────────────────────── suppression d'un modèle ─────────────────────────────

const MODELE_A_SUPPRIMER = 'Modèle à supprimer e2e';

async function ouvrirModele(page, nom) {
  await menu(page, 'Création');
  await page.locator('.hubcard', { hasText: 'Modèles de document' }).click();
  await attendreTitre(page, 'Modèles de document');
  await page.locator('.mitem', { has: page.locator('b', { hasText: new RegExp(`^${echapper(nom)}$`) }) }).first().click();
  await attendre(async () => (await page.inputValue('#m-nom')) === nom, `Le modèle « ${nom} » ne s’ouvre pas`);
}

/** Tous les documents de la base : [id, dossier, nom, source, modèle, blocs]. */
async function tousLesDocuments(app) {
  const out = [];
  for (const d of await app.appeler('dossiers_lister')) {
    for (const x of (await app.appeler('dossier_detail', { id: d.id })).documents) out.push(JSON.stringify([x.id, x.dossierId, x.nom, x.source, x.modeleId, x.blocs]));
  }
  return out.sort();
}

export const suppressionModele = {
  id: 'suppression-modele',
  titre: 'Suppression d’un modèle (§ 11.4) : refusée avec son motif s’il a servi, acceptée sinon ; modèle standard supprimé puis restauré ; documents intacts',
  async executer(ctx) {
    const { page, app } = ctx;
    const supprimer = bouton(page, 'Supprimer');
    const documentsAvant = await tousLesDocuments(app);

    ctx.etape(`« ${INTERVENTION} » a servi : « Supprimer » indisponible, avec le motif et le nombre de documents`);
    const utilise = (await app.appeler('modeles_lister')).find((m) => m.nom === INTERVENTION && m.standard);
    verifier(utilise.nbDocuments > 0, `Des documents viennent de « ${INTERVENTION} » (${utilise.nbDocuments})`);
    await ouvrirModele(page, INTERVENTION);
    const n = utilise.nbDocuments;
    egal((await page.locator('.studio-nbdocs').innerText()).trim(), `${n} document${n > 1 ? 's' : ''} créé${n > 1 ? 's' : ''} à partir de ce modèle`, 'Nombre de documents du modèle');
    egal(await supprimer.getAttribute('aria-disabled'), 'true', '« Supprimer » indisponible (aria-disabled)');
    await supprimer.click({ force: true });
    const motif = page.locator('.studio .cl-motif');
    await attendre(() => motif.isVisible(), 'Le motif s’affiche quand on actionne « Supprimer »');
    egal((await motif.innerText()).replace(/\s+/g, ' ').trim(),
      `Suppression impossible. ${n} document${n > 1 ? 's ont' : ' a'} été créé${n > 1 ? 's' : ''} à partir de ce modèle. Archivez-le si vous ne voulez plus l’utiliser.`,
      'Motif de la suppression impossible');
    egal(await modale(page).count(), 0, 'Aucune confirmation ne s’ouvre');
    await ctx.capture(`${CAP}/06b-studio-suppression-indisponible`);
    const refus = await app.invoquer('modele_supprimer', { id: utilise.id });
    verifier(!refus.ok && refus.erreur.code === 'modele_utilise' && refus.erreur.message.includes(String(n)),
      `Le back refuse la suppression, avec le nombre de documents (${JSON.stringify(refus)})`);

    ctx.etape('un modèle sans document : suppression confirmée, le Studio affiche un autre modèle');
    await bouton(page, 'Nouveau modèle').click();
    await attendre(async () => /^Modèle \d{2}$/.test(await page.inputValue('#m-nom')), 'Le nouveau modèle doit s’ouvrir');
    await page.fill('#m-nom', MODELE_A_SUPPRIMER);
    await attendre(async () => (await app.appeler('modeles_lister')).some((m) => m.nom === MODELE_A_SUPPRIMER), 'Le nouveau modèle est enregistré');
    egal((await page.locator('.studio-nbdocs').innerText()).trim(), 'Aucun document créé à partir de ce modèle', 'Modèle sans document');
    egal(await supprimer.getAttribute('aria-disabled'), null, '« Supprimer » disponible');
    await ctx.capture(`${CAP}/06a-studio-suppression-disponible`);
    await supprimer.click();
    await attendre(() => modale(page).isVisible(), 'La confirmation s’ouvre');
    egal((await modale(page).locator('h3').innerText()).trim(), 'Supprimer le modèle ?', 'Titre de la confirmation');
    verifier((await modale(page).innerText()).includes(`Le modèle « ${MODELE_A_SUPPRIMER} » sera définitivement supprimé.`), 'La confirmation nomme le modèle');
    await bouton(modale(page), 'Supprimer le modèle').click();
    await attendre(async () => !(await modale(page).count()), 'La confirmation se ferme');
    await attendre(async () => !(await app.appeler('modeles_lister')).some((m) => m.nom === MODELE_A_SUPPRIMER), 'Le modèle est supprimé dans le back');
    await attendre(async () => !(await page.locator('.mlist .mitem b').allInnerTexts()).includes(MODELE_A_SUPPRIMER), 'Le modèle disparaît de la liste');
    const affiche = await page.inputValue('#m-nom');
    verifier(affiche && affiche !== MODELE_A_SUPPRIMER, `Le Studio affiche un autre modèle (« ${affiche} »)`);

    ctx.etape('un modèle standard sans document : supprimé, puis recréé par « Restaurer les modèles standards »');
    const standardLibre = (await app.appeler('modeles_lister')).find((m) => m.standard && m.nbDocuments === 0);
    verifier(standardLibre, 'Un modèle standard sans document (recréé par le scénario « studio »)');
    await ouvrirModele(page, standardLibre.nom);
    await supprimer.click();
    verifier((await modale(page).innerText()).includes('« Restaurer les modèles standards » pourra le recréer.'), 'La confirmation dit qu’un modèle standard peut être recréé');
    await bouton(modale(page), 'Supprimer le modèle').click();
    await attendre(async () => !(await app.appeler('modeles_lister')).some((m) => m.id === standardLibre.id), 'Le modèle standard est supprimé');
    egal((await app.appeler('modeles_lister')).filter((m) => m.standard).length, 3, 'Trois modèles standards restent');
    await bouton(page, 'Restaurer les modèles standards').click();
    await attendre(async () => (await page.locator('.studio-note').innerText()) === `1 modèle recréé : ${standardLibre.nom}.`, 'La restauration recrée le modèle supprimé');
    const recree = (await app.appeler('modeles_lister')).filter((m) => m.nom === standardLibre.nom && m.standard);
    egal(recree.map((m) => [m.actif, m.nbDocuments, JSON.stringify(m.blocs) === JSON.stringify(standardLibre.blocs)]), [[true, 0, true]],
      'Modèle standard recréé, actif, sans document, avec ses blocs');

    ctx.etape('les documents existants ne sont pas touchés');
    egal(await tousLesDocuments(app), documentsAvant, 'Documents (nom, source, modèle, blocs) identiques avant et après les suppressions');
    await menu(page, 'Tableau de bord');
  },
};
