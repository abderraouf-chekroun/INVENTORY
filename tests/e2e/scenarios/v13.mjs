// Version 1.3 (spécification § 10) dans l'application réelle :
// - « etats » : états de dossier (liste « État » de l'en-tête, clôture refusée en « Pièce manquante », états ajoutés dans
//   Paramètres avec leur couleur, filtres, regroupement, tableau de bord, recherche, renommer, suppression refusée
//   puis acceptée, états fournis non modifiables, état conservé après redémarrage) ;
// - « dossier-libre » : modèle avec champs obligatoires (Studio), dossier (ni employé ni machine depuis la 1.4),
//   variables « — », compteur de champs à remplir, employé et machine choisis / changés / retirés dans le document,
//   variables qui suivent en direct, puis nominations sur les profils (bloc, nom écrit, identifiant écrit, champ et
//   moment ; et ce qui ne nomme pas) et dans l'historique ;
// - « recherche-longue » : plus de 4 fiches correspondantes, liste qui défile au clavier et à la molette, 50 sur N ;
// - « champs-obligatoires » : sur chaque formulaire, étoile, mention, envoi à vide refusé, focus sur le premier manquant.

import {
  attendreBadge, attendreTitre, badgeEntete, bouton, carteChoisie, champChoix, champPapier, choisirEtat, echapper, listeEtat, menu, modale,
  ouvrirDocument, ouvrirDossier, ouvrirFiche, taperDansChoix, texteErreur,
} from '../outils/ui.mjs';
import { attendre, egal, pause, verifier } from '../outils/verifs.mjs';
import { capturePageEntiere } from './affectations.mjs';
import { lireCompteurs } from './demarrage.mjs';
import { INTERVENTION, ajouterDepuisModele, documentDuBack, statutDuBack } from './dossiers.mjs';

// ───────────────────────────── outils communs ─────────────────────────────

/** Ferme l'application par la barre de titre, puis la relance sur le même dossier de données. */
export async function redemarrer(ctx) {
  const { page, app } = ctx;
  await page.locator('.titlebar .ctl').getByRole('button', { name: 'Fermer', exact: true }).click({ noWaitAfter: true });
  egal(await app.attendreFin(15_000), 0, 'Code de sortie à la fermeture');
  await app.deconnecter();
  await ctx.lancer();
  await attendreTitre(ctx.page, 'Tableau de bord');
}

/** Ferme le menu, laisse la page au repos (aucune saisie en attente). */
const repos = (page) => page.waitForTimeout(300);

/** Crée un dossier par le formulaire (§ 11.1 : ni employé ni machine). */
export async function creerDossier(ctx, nom) {
  const { page, app } = ctx;
  await menu(page, 'Dossiers & Archives');
  await bouton(page, 'Créer un dossier').click();
  await attendreTitre(page, 'Créer un dossier');
  const champ = page.locator('form.form label', { hasText: /^Nom/ }).locator('input');
  await attendre(async () => /^Dossier \d{4}-\d{2}$/.test(await champ.inputValue()), 'Le nom suggéré ne s’affiche pas');
  await champ.fill(nom);
  await bouton(page, 'Créer le dossier').click();
  await attendreTitre(page, nom);
  const d = (await app.appeler('dossiers_lister')).find((x) => x.nom === nom);
  verifier(d, `Le dossier « ${nom} » doit être créé dans le back`);
  return d;
}

/**
 * Dans le dossier affiché : ajoute un document « Fiche d'intervention informatique » et y nomme un employé par son bloc
 * « Utilisateur » (texte tapé dans l'aide à la saisie, une seule proposition attendue). Renvoie le nom du document.
 */
export async function nommerDansUnDocument(ctx, dossierId, texte) {
  const { page, app } = ctx;
  const doc = await ajouterDepuisModele(page, INTERVENTION);
  const props = await taperDansChoix(page, 'Utilisateur', texte);
  verifier(props.length === 1, `Une seule proposition attendue pour « ${texte} » (${JSON.stringify(props)})`);
  await page.keyboard.press('Enter');
  await attendre(() => carteChoisie(page, 'Utilisateur').isVisible(), 'L’employé choisi ne s’affiche pas');
  await attendre(async () => typeof (await documentDuBack(app, dossierId, doc)).blocs.find((b) => b.t === 'employe').entiteId === 'number',
    'Le choix de l’employé doit être enregistré');
  return doc;
}

/** Variables du papier affiché : [[nom, valeur]]. */
export const variablesPapier = (page) => page.$$eval('.paper .pv-var', (ps) => ps.map((p) => {
  const nom = p.querySelector('small')?.textContent ?? '';
  return [nom.trim(), p.textContent.slice(nom.length).trim()];
}));

/**
 * Documents où la fiche affichée est nommée (§ 10.4, § 11.2) : [{ modele, doc, dossier, date, facons, nomination }] ;
 * `nomination` : « Champ « … » · Nommé le JJ/MM/AAAA à HH:MM » (texte de `.doc-nomme`).
 */
export async function documentsCites(page, kind) {
  const sec = page.locator('section.sec', { has: page.locator('h2', { hasText: kind === 'a' ? 'Documents où figure l’employé' : 'Documents où figure la machine' }) });
  await attendre(() => sec.isVisible(), 'La section des documents où figure la fiche est absente');
  return sec.locator('.files .file').evaluateAll((fs) => fs.map((f) => {
    const small = f.querySelector('small').cloneNode(true);
    const nomme = small.querySelector('.doc-nomme');
    nomme?.remove();
    const [doc, dossier, date] = small.textContent.split(' · ').map((s) => s.trim());
    return {
      modele: f.querySelector('b').textContent.trim(), doc, dossier, date,
      facons: [...f.querySelectorAll('.facon')].map((x) => x.textContent.trim()),
      nomination: nomme?.textContent.trim() ?? '',
    };
  }));
}
export const sectionDocuments = (page, kind) => page.locator('section.sec', {
  has: page.locator('h2', { hasText: kind === 'a' ? 'Documents où figure l’employé' : 'Documents où figure la machine' }),
});

/** Date du jour au format des horodatages du back (AAAA-MM-JJ). */
export function aujourdhuiIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Date du jour au format affiché (JJ/MM/AAAA). */
function aujourdhui() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

// ───────────────────────────── états de dossier ─────────────────────────────

const ETAT_1 = 'En attente de livraison';
const ETAT_1_RENOMME = 'Attente livraison';
const ETAT_2 = 'À valider';
const DOSSIER_ETATS = 'Dossier états e2e';

/** Ligne d'un état dans Paramètres. */
const ligneEtat = (page, nom) => page.locator('.etats .cl-item', {
  has: page.locator('.cl-nom .st-nom', { hasText: new RegExp(`^${echapper(nom)}$`) }),
});
/** Formulaire « Ajouter un état ». */
const formNouvelEtat = (page) => page.locator('.etats form.etat-form:not(.en-place)');

/** États affichés dans Paramètres : [[nom, classe de couleur, détail]]. */
const etatsAffiches = (page) => page.locator('.etats .cl-item .cl-nom').evaluateAll((ns) => ns.map((n) => {
  const b = n.querySelector('.badge');
  return [b.querySelector('.st-nom').textContent.trim(), [...b.classList].find((c) => c.startsWith('st-')), n.querySelector('small').textContent.trim()];
}));

export const etats = {
  id: 'etats',
  titre: 'États de dossier : liste « État », clôture refusée en « Pièce manquante », états ajoutés, couleurs, filtres, tableau de bord, recherche, renommer, supprimer, redémarrage',
  async executer(ctx) {
    let { page } = ctx;
    const { app } = ctx;

    ctx.etape('Paramètres : les trois états fournis, ni modifiables ni supprimables (interface et back)');
    await menu(page, 'Paramètres');
    verifier(await page.locator('.group-h', { hasText: 'États des dossiers' }).isVisible(), 'Groupe « États des dossiers » dans Paramètres');
    const fournis = (await app.appeler('statuts_lister')).filter((s) => s.role !== 'perso');
    egal(fournis.map((s) => [s.nom, s.role]), [['En cours', 'cours'], ['Pièce manquante', 'piece'], ['Clôturé', 'clos']], 'États fournis dans le back');
    const affiches = await etatsAffiches(page);
    egal(affiches.slice(0, 3).map((e) => [e[0], e[1]]), fournis.map((s) => [s.nom, `st-${s.couleur}`]), 'États fournis affichés avec leur couleur');
    for (const e of affiches.slice(0, 3)) verifier(e[2].includes('fourni avec l’application'), `« ${e[0]} » est signalé comme fourni (${e[2]})`);
    for (const s of fournis) {
      for (const action of ['Modifier', 'Supprimer']) {
        egal(await page.getByRole('button', { name: `${action} ${s.nom}`, exact: true }).getAttribute('aria-disabled'), 'true',
          `« ${action} ${s.nom} » est indisponible (aria-disabled)`);
      }
    }
    await page.getByRole('button', { name: 'Modifier En cours', exact: true }).click({ force: true });
    await attendre(async () => (await ligneEtat(page, 'En cours').locator('.cl-motif').innerText()).replace(/\s+/g, ' ').trim()
      === 'Modification impossible. Cet état est fourni avec l’application : son nom et sa couleur ne changent pas.', 'Motif de « Modifier En cours »');
    await page.getByRole('button', { name: 'Supprimer Clôturé', exact: true }).click({ force: true });
    await attendre(async () => (await ligneEtat(page, 'Clôturé').locator('.cl-motif').innerText()).replace(/\s+/g, ' ').trim()
      === 'Suppression impossible. Cet état est fourni avec l’application : il ne peut pas être supprimé.', 'Motif de « Supprimer Clôturé »');
    egal(await modale(page).count(), 0, 'Aucune confirmation ne s’ouvre pour un état fourni');
    for (const s of fournis) {
      const m = await app.invoquer('statut_modifier', { id: s.id, saisie: { nom: `${s.nom} bis`, couleur: 'gris' } });
      verifier(!m.ok && m.erreur.code === 'statut_fourni', `Le back refuse de modifier « ${s.nom} » (${JSON.stringify(m)})`);
      const r = await app.invoquer('statut_supprimer', { id: s.id });
      verifier(!r.ok && r.erreur.code === 'statut_fourni', `Le back refuse de supprimer « ${s.nom} » (${JSON.stringify(r)})`);
    }

    ctx.etape('ajouter un état : nom obligatoire, couleur choisie, doublon refusé');
    const form = formNouvelEtat(page);
    verifier(await form.locator('.mention-obligatoire').isVisible(), 'Mention « * champ obligatoire » du formulaire d’état');
    verifier(await form.locator('label', { hasText: 'Nom du nouvel état' }).locator('.etoile').isVisible(), 'Étoile du champ « Nom du nouvel état »');
    egal(await form.getByRole('group', { name: 'Couleur' }).getByRole('radio').evaluateAll((rs) => rs.map((r) => r.labels[0].textContent.trim())),
      ['Gris', 'Bleu', 'Turquoise', 'Vert', 'Ambre', 'Orange', 'Rouge', 'Rose', 'Violet'], 'Palette des couleurs');
    await bouton(form, 'Ajouter l’état').click();
    await attendre(async () => (await texteErreur(page)).includes('Remplissez le champ obligatoire « Nom du nouvel état ».'), 'Un état sans nom est refusé');
    egal(await page.evaluate(() => document.activeElement?.placeholder), 'Ex. : En attente de livraison', 'Le focus est sur « Nom du nouvel état »');
    await form.getByLabel('Nom du nouvel état').fill(ETAT_1);
    await form.getByRole('radio', { name: 'Violet', exact: true }).check();
    egal(await form.locator('.etat-apercu .badge').evaluate((b) => [b.textContent.trim(), [...b.classList].find((c) => c.startsWith('st-'))]),
      [ETAT_1, 'st-violet'], 'Aperçu du badge');
    await bouton(form, 'Ajouter l’état').click();
    await attendre(() => ligneEtat(page, ETAT_1).isVisible(), `L’état « ${ETAT_1} » doit apparaître`);
    const s1 = await statutDuBack(app, { nom: ETAT_1 });
    egal([s1.couleur, s1.role, s1.nbDossiers], ['violet', 'perso', 0], 'État ajouté dans le back');
    await form.getByLabel('Nom du nouvel état').fill(ETAT_1.toUpperCase());
    await bouton(form, 'Ajouter l’état').click();
    await attendre(async () => (await texteErreur(page)).length > 0 && !(await texteErreur(page)).includes('Remplissez'), 'Un nom en double (casse ignorée) est refusé');
    egal((await app.appeler('statuts_lister')).filter((s) => s.nom.toLowerCase() === ETAT_1.toLowerCase()).length, 1, 'Pas de doublon dans le back');
    await form.getByLabel('Nom du nouvel état').fill(ETAT_2);
    await form.getByRole('radio', { name: 'Turquoise', exact: true }).check();
    await bouton(form, 'Ajouter l’état').click();
    await attendre(() => ligneEtat(page, ETAT_2).isVisible(), `L’état « ${ETAT_2} » doit apparaître`);
    egal((await etatsAffiches(page)).map((e) => [e[0], e[1]]),
      [['En cours', 'st-ambre'], ['Pièce manquante', 'st-orange'], ['Clôturé', 'st-vert'], [ETAT_1, 'st-violet'], [ETAT_2, 'st-turquoise']],
      'États affichés, chacun avec sa couleur');
    await page.locator('#etats-dossiers').scrollIntoViewIfNeeded();
    await page.evaluate(() => { const c = document.getElementById('content'); c.scrollTop = document.getElementById('etats-dossiers').offsetTop - 20; });
    await ctx.capture('v13-reel/02-parametres-etats-couleurs');

    ctx.etape('dossier : la liste « État » propose les états ouverts, ajoutés compris');
    const d = await creerDossier(ctx, DOSSIER_ETATS);
    ctx.memo.dossierEtats = d.id;
    await attendreBadge(page, 'En cours');
    // § 11.2 : les événements du dossier vont à l'historique des fiches nommées dans ses documents.
    await nommerDansUnDocument(ctx, d.id, 'mansouri');
    egal(await listeEtat(page).locator('option').allInnerTexts(), ['En cours', 'Pièce manquante', ETAT_1, ETAT_2], 'États proposés dans l’en-tête');
    await ctx.capture('v13-reel/01-dossier-liste-etats');

    ctx.etape('« Pièce manquante » : clôture refusée avec son motif ; la quitter à la main ; clôture acceptée ensuite');
    await choisirEtat(page, 'Pièce manquante');
    const cloturer = bouton(page, 'Clôturer le dossier');
    egal(await cloturer.getAttribute('aria-disabled'), 'true', '« Clôturer le dossier » indisponible en « Pièce manquante »');
    verifier((await cloturer.getAttribute('title') ?? '').includes('Pièce manquante'), `Infobulle du bouton : ${await cloturer.getAttribute('title')}`);
    await cloturer.click({ force: true });
    await attendre(() => page.locator('.etat-motif').isVisible(), 'Le motif de la clôture impossible doit s’afficher');
    verifier((await page.locator('.etat-motif').innerText()).replace(/\s+/g, ' ').startsWith('Clôture impossible.'), 'Texte du motif');
    await pause(300);
    await attendreBadge(page, 'Pièce manquante');
    const clos = await statutDuBack(app, { role: 'clos' });
    const refus = await app.invoquer('dossier_definir_statut', { id: d.id, statutId: clos.id });
    verifier(!refus.ok && refus.erreur.code === 'transition_interdite', `Le back refuse la clôture en « Pièce manquante » (${JSON.stringify(refus)})`);
    await choisirEtat(page, 'En cours');
    verifier(!(await page.locator('.alert.warn', { hasText: 'Pièce finale manquante' }).count()), 'L’alerte de pièce manquante disparaît');
    egal(await cloturer.getAttribute('aria-disabled'), null, '« Clôturer le dossier » redevient disponible');
    await cloturer.click();
    await attendreBadge(page, 'Clôturé');
    egal(await listeEtat(page).count(), 0, 'Plus de liste « État » sur un dossier clôturé');
    await bouton(page, 'Rouvrir le dossier').click();
    await attendreBadge(page, 'En cours');

    ctx.etape(`état ajouté « ${ETAT_1} » choisi : couleur, journal de la fiche`);
    await choisirEtat(page, ETAT_1);
    egal(await page.locator('.ph-actions .etat-pastille').evaluate((p) => p.classList.contains('st-violet')), true, 'Pastille de la couleur de l’état');
    await ctx.capture('v13-reel/01b-dossier-etat-ajoute');
    egal((await app.appeler('dossier_detail', { id: d.id })).dossier.statut.nom, ETAT_1, 'État enregistré dans le back');
    verifier(await page.locator('.folder.add').isEnabled(), 'Un dossier dans un état ajouté reste modifiable');
    const mansouri = (await app.appeler('entites_lister', { kind: 'a' })).find((e) => e.libelle === 'MANSOURI Leïla');
    const ev = (await app.appeler('entite_fiche', { id: mansouri.id })).evenements;
    verifier(ev.some((e) => e.type === 'statut_modifie' && e.titre === `${DOSSIER_ETATS} : état « ${ETAT_1} »`),
      `Le changement d’état apparaît dans l’historique de l’employé nommé dans un document du dossier (${JSON.stringify(ev.slice(0, 3).map((e) => e.titre))})`);
    for (const t of ['dossier_ouvert', 'dossier_clos', 'dossier_rouvert']) {
      verifier(ev.some((e) => e.type === t && e.dossierId === d.id), `L’événement « ${t} » du dossier apparaît dans l’historique de l’employé nommé (§ 11.2)`);
    }

    ctx.etape('Dossiers & Archives : filtre et regroupement par état');
    await menu(page, 'Dossiers & Archives');
    const fbar = page.locator('.fbar');
    const filtre = fbar.locator('label', { hasText: /^État/ }).locator('select');
    egal(await filtre.locator('option').allInnerTexts(), ['Tous', 'En cours', 'Pièce manquante', 'Clôturé', ETAT_1, ETAT_2], 'États du filtre');
    await filtre.selectOption({ label: ETAT_1 });
    await attendre(async () => (await page.locator('.fbar .cnt').innerText()).trim() === '1 dossier', `Filtre « ${ETAT_1} » : 1 dossier`);
    egal(await page.locator('.folders .folder').evaluateAll((fs) => fs.map((f) => [f.querySelector('b').textContent.trim(),
      f.querySelector('.badge').textContent.trim(), f.querySelector('.badge').classList.contains('st-violet')])),
    [[DOSSIER_ETATS, ETAT_1, true]], 'Dossier filtré, avec son badge');
    await filtre.selectOption('tous');
    await fbar.locator('label', { hasText: /^Regrouper par/ }).locator('select').selectOption('statut');
    const groupes = await page.$$eval('.content .group-h', (hs) => hs.map((h) => [h.querySelector('.badge')?.textContent.trim(), h.querySelector('.count')?.textContent.trim()]));
    verifier(groupes.some((g) => g[0] === ETAT_1 && g[1] === '1'), `Groupe « ${ETAT_1} » (1 dossier) dans le regroupement par état : ${JSON.stringify(groupes)}`);
    egal(groupes.map((g) => g[0]).filter((x) => x === ETAT_2).length, 0, 'Un état sans dossier ne fait pas de groupe');
    await fbar.locator('label', { hasText: /^Regrouper par/ }).locator('select').selectOption('theme');

    ctx.etape('tableau de bord : répartition, dossiers ouverts ; recherche : badge de l’état');
    await menu(page, 'Tableau de bord');
    const td = await app.appeler('tableau_de_bord');
    const tous = await app.appeler('dossiers_lister');
    egal(td.dossiersOuverts, tous.filter((x) => x.statut.role !== 'clos').length, 'Le back compte comme ouverts tous les dossiers non clôturés');
    egal((await lireCompteurs(page)).find((k) => k.label === 'Dossiers ouverts').valeur, String(td.dossiersOuverts), 'Compteur « Dossiers ouverts »');
    const legende = await page.$$eval('.cols .card', (cs) => [...cs[0].querySelectorAll('.legend li')].map((li) =>
      [...li.childNodes].map((n) => n.textContent.trim()).filter(Boolean).join(' | ')));
    const pct = (n) => `${Math.round((n / tous.length) * 100)} %`;
    verifier(legende.includes(`${ETAT_1} | 1 | ${pct(1)}`), `Légende de la répartition : ${JSON.stringify(legende)}`);
    verifier(legende.includes(`${ETAT_2} | 0 | 0 %`), `Un état sans dossier figure dans la légende : ${JSON.stringify(legende)}`);
    const ouverts = page.locator('.sec', { has: page.locator('h2', { hasText: 'Dossiers ouverts' }) });
    egal(await ouverts.locator('.files .file', { hasText: DOSSIER_ETATS }).locator('.badge').innerText(), ETAT_1, 'Badge du dossier dans « Dossiers ouverts »');
    await page.keyboard.press('Control+k');
    await page.keyboard.type('états e2e');
    await attendre(async () => (await page.locator('#dd .res', { hasText: DOSSIER_ETATS }).count()) === 1, 'La recherche trouve le dossier');
    egal(await page.locator('#dd .res', { hasText: DOSSIER_ETATS }).locator('.badge').evaluate((b) => [b.textContent.trim(), b.classList.contains('st-violet')]),
      [ETAT_1, true], 'Badge de l’état dans la recherche');
    await page.keyboard.press('Escape');

    ctx.etape('renommer l’état et changer sa couleur ; doublon refusé');
    await menu(page, 'Paramètres');
    await page.getByRole('button', { name: `Modifier ${ETAT_1}`, exact: true }).click();
    const edition = page.getByRole('form', { name: `Modifier l’état ${ETAT_1}` });
    await attendre(() => edition.isVisible(), 'Le formulaire de modification de l’état doit s’ouvrir');
    egal(await edition.getByLabel('Nom de l’état').inputValue(), ETAT_1, 'Nom prérempli');
    await edition.getByLabel('Nom de l’état').fill('en cours');
    await bouton(edition, 'Enregistrer').click();
    await attendre(async () => (await texteErreur(edition)).length > 0, 'Renommer en « en cours » (état existant) est refusé');
    await edition.getByLabel('Nom de l’état').fill('');
    await bouton(edition, 'Enregistrer').click();
    await attendre(async () => (await texteErreur(page)).includes('Remplissez le champ obligatoire « Nom de l’état ».'), 'Un nom vide est refusé');
    await edition.getByLabel('Nom de l’état').fill(ETAT_1_RENOMME);
    await edition.getByRole('radio', { name: 'Rose', exact: true }).check();
    await bouton(edition, 'Enregistrer').click();
    await attendre(() => ligneEtat(page, ETAT_1_RENOMME).isVisible(), 'L’état renommé doit s’afficher');
    egal(await ligneEtat(page, ETAT_1_RENOMME).locator('.badge').evaluate((b) => b.classList.contains('st-rose')), true, 'Nouvelle couleur');
    const s1b = await statutDuBack(app, { nom: ETAT_1_RENOMME });
    egal([s1b.id, s1b.couleur, s1b.nbDossiers], [s1.id, 'rose', 1], 'État renommé dans le back (même état, nouvelle couleur, 1 dossier)');
    egal((await ligneEtat(page, ETAT_1_RENOMME).locator('small').innerText()).trim(), '1 dossier', 'Nombre de dossiers de l’état');
    await ouvrirDossier(page, DOSSIER_ETATS);
    await attendreBadge(page, ETAT_1_RENOMME);
    egal(await page.locator('.ph-actions .etat-pastille').evaluate((p) => p.classList.contains('st-rose')), true, 'Le dossier suit la nouvelle couleur');

    ctx.etape('suppression refusée tant qu’un dossier porte l’état, avec le nombre');
    await menu(page, 'Paramètres');
    const supprimer = page.getByRole('button', { name: `Supprimer ${ETAT_1_RENOMME}`, exact: true });
    egal(await supprimer.getAttribute('aria-disabled'), 'true', '« Supprimer » indisponible pour un état porté par un dossier');
    await supprimer.click({ force: true });
    await attendre(async () => (await ligneEtat(page, ETAT_1_RENOMME).locator('.cl-motif').innerText()).replace(/\s+/g, ' ').trim()
      === 'Suppression impossible. 1 dossier est dans cet état. Donnez-lui un autre état avant de le supprimer.', 'Motif de la suppression refusée');
    egal(await modale(page).count(), 0, 'Aucune confirmation ne s’ouvre');
    const refusSuppr = await app.invoquer('statut_supprimer', { id: s1.id });
    verifier(!refusSuppr.ok && refusSuppr.erreur.code === 'statut_utilise' && /\b1\b/.test(refusSuppr.erreur.message),
      `Le back refuse la suppression, avec le nombre de dossiers (${JSON.stringify(refusSuppr)})`);

    ctx.etape('redémarrage : l’état ajouté et l’état du dossier sont conservés');
    await redemarrer(ctx);
    page = ctx.page;
    await ouvrirDossier(page, DOSSIER_ETATS);
    await attendreBadge(page, ETAT_1_RENOMME);
    egal((await ctx.app.appeler('statuts_lister')).map((s) => s.nom), ['En cours', 'Pièce manquante', 'Clôturé', ETAT_1_RENOMME, ETAT_2],
      'États après redémarrage');

    ctx.etape('dossier remis « En cours » : suppression acceptée après confirmation');
    await choisirEtat(page, 'En cours');
    await menu(page, 'Paramètres');
    egal(await page.getByRole('button', { name: `Supprimer ${ETAT_1_RENOMME}`, exact: true }).getAttribute('aria-disabled'), null,
      '« Supprimer » redevient disponible');
    await page.getByRole('button', { name: `Supprimer ${ETAT_1_RENOMME}`, exact: true }).click();
    await attendre(() => modale(page).isVisible(), 'La confirmation de suppression doit s’ouvrir');
    egal(await modale(page).locator('h3').innerText(), 'Supprimer l’état ?', 'Titre de la confirmation');
    await bouton(modale(page), 'Supprimer').click();
    await attendre(async () => !(await ligneEtat(page, ETAT_1_RENOMME).count()), 'L’état supprimé disparaît');
    await page.getByRole('button', { name: `Supprimer ${ETAT_2}`, exact: true }).click();
    await bouton(modale(page), 'Supprimer').click();
    await attendre(async () => !(await ligneEtat(page, ETAT_2).count()), `L’état « ${ETAT_2} » disparaît`);
    egal((await ctx.app.appeler('statuts_lister')).map((s) => s.nom), ['En cours', 'Pièce manquante', 'Clôturé'], 'États après suppression');
    await ouvrirDossier(page, DOSSIER_ETATS);
    egal(await listeEtat(page).locator('option').allInnerTexts(), ['En cours', 'Pièce manquante'], 'Le dossier ne propose plus les états supprimés');
    await repos(page);
  },
};

// ─────────────────────── dossier libre, champs obligatoires du Studio, citations ───────────────────────

export const MODELE_LIBRE = 'Modèle libre e2e';
const DOSSIER_LIBRE = 'Dossier libre e2e';
/** Blocs du modèle : [libellé de la palette, réglage]. */
const BLOCS_LIBRES = ['Information automatique', 'Information automatique', 'Employé', 'Machine', 'Champ sur une ligne', 'Zone de texte'];

/** Bloc n (à partir de 1) de l'éditeur du Studio. */
const blocEditeur = (page, n) => page.locator('.blocks .blk').nth(n - 1);

/** Zone « Employé et machine » du dossier ouvert. */
const zoneFiches = (page) => page.locator('section.sec', { has: page.locator('h2', { hasText: 'Employé et machine' }) });

/** Choisit une fiche dans une aide à la saisie (une seule proposition attendue), puis attend son cadre. */
async function choisirFiche(zone, libelle, texte, nom) {
  const props = await taperDansChoix(zone, libelle, texte);
  egal(props.map((p) => p.nom), [nom], `Proposition pour « ${texte} » (${libelle})`);
  await (typeof zone.page === 'function' ? zone.page() : zone).keyboard.press('Enter');
  const plie = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  await attendre(async () => plie(await carteChoisie(zone, libelle).innerText()).includes(plie(texte)), `${nom} doit être choisi (${libelle})`);
}

export const dossierLibre = {
  id: 'dossier-libre',
  titre: 'Dossier sans rattachement : champs obligatoires du Studio, variables « — » puis suivant les blocs du document, fiches choisies, changées, retirées ; nominations sur les profils et dans l’historique',
  async executer(ctx) {
    const { page, app } = ctx;
    const ids = Object.fromEntries((await app.appeler('entites_lister', { kind: 'a' })).concat(await app.appeler('entites_lister', { kind: 'b' }))
      .map((e) => [e.libelle, e.id]));

    ctx.etape('Studio : un modèle avec deux blocs marqués « Champ obligatoire »');
    await menu(page, 'Création');
    await page.locator('.hubcard', { hasText: 'Modèles de document' }).click();
    await attendreTitre(page, 'Modèles de document');
    await bouton(page, 'Nouveau modèle').click();
    await attendre(async () => /^Modèle \d{2}$/.test(await page.inputValue('#m-nom')), 'Le nouveau modèle doit s’ouvrir');
    verifier(await page.locator('label[for="m-nom"] .etoile').isVisible(), 'Étoile du nom du modèle');
    await page.fill('#m-nom', MODELE_LIBRE);
    const palette = page.getByRole('group', { name: /^Champs personnalisés/ });
    for (const l of BLOCS_LIBRES) await palette.getByRole('button', { name: `Ajouter : ${l}`, exact: true }).click();
    await blocEditeur(page, 1).getByLabel('Information automatique', { exact: true }).selectOption('Employé · Nom');
    await blocEditeur(page, 2).getByLabel('Information automatique', { exact: true }).selectOption('Machine · Identifiant');
    await blocEditeur(page, 3).getByLabel('Libellé du choix de l’employé', { exact: true }).fill('Demandeur');
    await blocEditeur(page, 4).getByLabel('Libellé du choix de la machine', { exact: true }).fill('Poste');
    await blocEditeur(page, 5).getByLabel('Libellé du champ', { exact: true }).fill('Objet');
    await blocEditeur(page, 6).getByLabel('Libellé de la zone de texte', { exact: true }).fill('Observations');
    egal(await blocEditeur(page, 1).getByRole('checkbox', { name: /^Champ obligatoire/ }).count(), 0, 'Une information automatique ne peut pas être obligatoire');
    const caseOblig = (n) => page.getByRole('checkbox', { name: new RegExp(`^Champ obligatoire : bloc ${n} \\(`) });
    await caseOblig(3).check();
    await caseOblig(5).check();
    verifier(await blocEditeur(page, 5).locator('.blk-oblig .etoile').isVisible(), 'Le bloc marqué obligatoire porte l’étoile dans l’éditeur');
    await attendre(async () => (await page.locator('.paper .df', { hasText: 'Objet' }).locator('.etoile').count()) === 1,
      'L’aperçu du Studio montre l’étoile du champ obligatoire');
    const modele = await attendre(async () => {
      const m = (await app.appeler('modeles_lister')).find((x) => x.nom === MODELE_LIBRE);
      return m && JSON.stringify(m.blocs.map((b) => [b.t, b.v, b.obligatoire ?? false])) === JSON.stringify([
        ['variable', 'Employé · Nom', false], ['variable', 'Machine · Identifiant', false], ['employe', 'Demandeur', true],
        ['machine', 'Poste', false], ['champ', 'Objet', true], ['zone', 'Observations', false]]) ? m : false;
    }, 'Le modèle et ses blocs obligatoires doivent être enregistrés');
    ctx.memo.modeleLibre = modele.id;

    ctx.etape('créer un dossier (ni employé ni machine, § 11.1)');
    const d = await creerDossier(ctx, DOSSIER_LIBRE);
    ctx.memo.dossierLibre = d.id;
    egal([d.statut.role, 'aId' in d, 'bId' in d], ['cours', false, false], 'Dossier « En cours », sans fiches rattachées, dans le back');
    egal(await zoneFiches(page).count(), 0, 'Plus de section « Employé et machine » dans le dossier ouvert');

    ctx.etape('document : variables « — », blocs non préremplis, champs obligatoires à remplir');
    const doc1 = await ajouterDepuisModele(page, MODELE_LIBRE);
    egal(await variablesPapier(page), [['Employé · Nom', '—'], ['Machine · Identifiant', '—']], 'Variables d’un document sans employé ni machine');
    const papier = page.locator('.paper');
    verifier(await champChoix(papier, 'Demandeur').isVisible() && await champChoix(papier, 'Poste').isVisible(), 'Blocs Employé et Machine non préremplis');
    const blocsDoc1 = (await documentDuBack(app, d.id, doc1)).blocs;
    egal(blocsDoc1.filter((b) => b.t === 'employe' || b.t === 'machine').map((b) => b.entiteId ?? null), [null, null], 'Aucune fiche dans les blocs (back)');
    const bilan = page.locator('.p-oblig [role=status]');
    egal(await bilan.innerText(), '2 champs obligatoires restent à remplir.', 'Compteur des champs obligatoires');
    egal(await page.locator('.paper .p-manque-tag').allInnerTexts(), ['Obligatoire, à remplir', 'Obligatoire, à remplir'], 'Repères des champs à remplir');
    verifier(await papier.locator('label.df', { hasText: 'Objet' }).locator('.etoile').isVisible(), 'Étoile du champ « Objet » dans le document');
    verifier(await papier.locator('.choix-fiche', { hasText: 'Demandeur' }).locator('.etoile').isVisible(), 'Étoile du bloc « Demandeur »');
    egal(await champChoix(papier, 'Demandeur').getAttribute('aria-required'), 'true', 'Bloc Demandeur : aria-required');
    egal(await champPapier(page, 'Objet').getAttribute('required'), '', 'Champ Objet : required');
    verifier(await page.locator('.p-oblig .mention-obligatoire').isVisible(), 'Mention « * champ obligatoire » dans le document');
    await bouton(page, 'Aller au premier champ à remplir').click();
    await attendre(() => page.evaluate(() => document.activeElement?.getAttribute('role') === 'combobox'
      && document.activeElement.closest('.choix-fiche')?.textContent.includes('Demandeur')), '« Aller au premier champ à remplir » place le curseur dans « Demandeur »');
    await ctx.capture('v13-reel/07-document-champs-obligatoires');
    await champPapier(page, 'Objet').fill('Demande de matériel');
    await attendre(async () => (await bilan.innerText()) === '1 champ obligatoire reste à remplir.', 'Le compteur baisse quand on remplit un champ obligatoire');
    egal(await page.locator('.paper .p-manque-tag').count(), 1, 'Un seul repère « à remplir »');

    // § 11.1 : les variables se lisent dans le document lui-même (premier bloc Employé / Machine qui désigne une fiche),
    // en direct, sans attendre l'enregistrement.
    ctx.etape('employé choisi dans le bloc du document : la variable suit en direct ; changer ; retirer');
    const blocDoc1 = async (t) => (await documentDuBack(app, d.id, doc1)).blocs.find((b) => b.t === t).entiteId ?? null;
    await choisirFiche(papier, 'Demandeur', 'brahimi', 'BRAHIMI Yacine');
    egal(JSON.stringify(await variablesPapier(page)), JSON.stringify([['Employé · Nom', 'Brahimi'], ['Machine · Identifiant', '—']]),
      'La variable « Employé · Nom » suit aussitôt l’employé choisi dans le bloc');
    await attendre(async () => (await blocDoc1('employe')) === ids['BRAHIMI Yacine'], 'Le choix de l’employé est enregistré');
    await bouton(papier, 'Changer Demandeur (BRAHIMI Yacine)').click();
    await choisirFiche(papier, 'Demandeur', 'mansouri', 'MANSOURI Leïla');
    egal((await variablesPapier(page))[0][1], 'Mansouri', 'La variable suit aussitôt le changement d’employé');
    await attendre(async () => (await blocDoc1('employe')) === ids['MANSOURI Leïla'], 'L’employé changé est enregistré');
    await bouton(papier, 'Retirer Demandeur (MANSOURI Leïla)').click();
    await attendre(async () => (await variablesPapier(page))[0][1] === '—', 'Sans employé, la variable revient à « — »');
    await attendre(async () => (await blocDoc1('employe')) === null, 'L’employé retiré est enregistré (aucun)');
    for (const nom of ['BRAHIMI Yacine', 'MANSOURI Leïla']) {
      const f = await app.appeler('entite_fiche', { id: ids[nom] });
      verifier(!f.documents.some((x) => x.dossierId === d.id) && !f.dossiers.some((x) => x.id === d.id),
        `${nom}, retiré du document, n’y est plus nommé ni lié au dossier`);
    }

    ctx.etape('employé et machine ensemble : aucune affectation (§ 11.1) ; puis tous deux retirés');
    const enCours = async (a, b) => (await app.appeler('entite_fiche', { id: a })).affectations.some((x) => x.fin === null && x.entite.id === b);
    verifier(!(await enCours(ids['BRAHIMI Yacine'], ids['PC secrétariat'])), 'Avant : PC secrétariat n’est pas affecté à BRAHIMI Yacine');
    await choisirFiche(papier, 'Poste', 'secr', 'PC secrétariat');
    egal((await variablesPapier(page))[1][1], 'PC-0106', 'La variable « Machine · Identifiant » suit aussitôt la machine choisie');
    await choisirFiche(papier, 'Demandeur', 'brahimi', 'BRAHIMI Yacine');
    await attendre(async () => (await blocDoc1('employe')) === ids['BRAHIMI Yacine'] && (await blocDoc1('machine')) === ids['PC secrétariat'],
      'Employé et machine enregistrés dans le document');
    verifier(!(await enCours(ids['BRAHIMI Yacine'], ids['PC secrétariat'])), 'Employé et machine nommés dans un document : aucune affectation');
    await bouton(papier, 'Retirer Demandeur (BRAHIMI Yacine)').click();
    await bouton(papier, 'Retirer Poste (PC secrétariat)').click();
    await attendre(async () => JSON.stringify(await variablesPapier(page)) === JSON.stringify([['Employé · Nom', '—'], ['Machine · Identifiant', '—']]),
      'Variables revenues à « — »');
    await attendre(async () => (await blocDoc1('employe')) === null && (await blocDoc1('machine')) === null, 'Employé et machine retirés du document');

    ctx.etape('dossier clôturé : blocs Employé et Machine en lecture seule, plus de commande de rattachement');
    await bouton(page, 'Clôturer le dossier').click();
    await attendreBadge(page, 'Clôturé');
    egal(await papier.getByRole('combobox').count(), 0, 'Aucune aide à la saisie dans un dossier clôturé');
    const r = await app.invoquer('dossier_definir_fiches', { id: d.id, aId: ids['HADDAD Karim'], bId: null });
    verifier(!r.ok, `La commande de rattachement d’un dossier n’existe plus (§ 11.6) : ${JSON.stringify(r)}`);
    await bouton(page, 'Rouvrir le dossier').click();
    await attendreBadge(page, 'En cours');
    await ctx.capture('v13-reel/04-dossier-sans-employe-ni-machine');

    ctx.etape('citations : bloc Employé et bloc Machine choisis dans le document (dossier sans fiches)');
    await ouvrirDocument(page, doc1);
    await choisirFiche(page.locator('.paper'), 'Demandeur', 'haddad', 'HADDAD Karim');
    await choisirFiche(page.locator('.paper'), 'Poste', 'laboratoire', 'Poste laboratoire 02');
    await attendre(async () => (await bilan.innerText()) === 'Tous les champs obligatoires sont remplis.', 'Plus aucun champ obligatoire à remplir');
    await attendre(async () => {
      const b = (await documentDuBack(app, d.id, doc1)).blocs;
      return b.find((x) => x.t === 'employe').entiteId === ids['HADDAD Karim'] && b.find((x) => x.t === 'machine').entiteId === ids['Poste laboratoire 02'];
    }, 'Les fiches choisies dans le document sont enregistrées');

    ctx.etape('citations : nom et prénom, identifiant de machine écrits dans un document ; et ce qui ne cite pas');
    const doc2 = await ajouterDepuisModele(page, INTERVENTION);
    await champPapier(page, 'Signalée par').fill('Mme Nadia OULD ALI');
    await champPapier(page, 'Défauts signalés').fill('Écran du poste lt-0108 à changer.');
    const doc3 = await ajouterDepuisModele(page, INTERVENTION);
    await champPapier(page, 'Signalée par').fill('Mansouri');
    await champPapier(page, 'Défauts signalés').fill('Voir avec Leïla Mansour ; postes PC-0106-B et PC-01060.');
    await attendre(async () => (await documentDuBack(app, d.id, doc3)).blocs.find((b) => b.v === 'Défauts signalés').val?.startsWith('Voir avec')
      && (await documentDuBack(app, d.id, doc2)).blocs.find((b) => b.v === 'Défauts signalés').val?.startsWith('Écran'), 'Saisies enregistrées');
    const date = aujourdhui();

    // § 11.2 : pour chaque document, le champ où la fiche est nommée et le moment de la nomination.
    const verifierCitation = async (kind, libelle, attendu, absent) => {
      const fiche = await app.appeler('entite_fiche', { id: ids[libelle] });
      const ici = fiche.documents.filter((x) => x.dossierId === d.id).map((x) => [x.nom, x.modeleNom, x.facons, x.champs]);
      egal(ici, attendu.map((a) => [a.doc, a.modele, a.facons, a.champs]), `Documents du dossier libre où figure ${libelle} (back)`);
      for (const x of fiche.documents.filter((y) => y.dossierId === d.id)) {
        verifier(x.depuis.startsWith(aujourdhuiIso()), `Nomination datée d’aujourd’hui (${libelle}, ${x.nom}) : ${x.depuis}`);
      }
      if (attendu.length) verifier(fiche.dossiers.some((x) => x.id === d.id), `Le dossier libre est un dossier lié de ${libelle}`);
      else verifier(!fiche.dossiers.some((x) => x.id === d.id), `Le dossier libre n’est pas un dossier lié de ${libelle}`);
      await ouvrirFiche(page, kind, libelle);
      const affiches = (await documentsCites(page, kind)).filter((x) => x.dossier === DOSSIER_LIBRE);
      egal(affiches.map(({ nomination, ...x }) => x), attendu.map((a) => ({ modele: a.modele, doc: a.doc, dossier: DOSSIER_LIBRE, date, facons: a.libelles })),
        `Documents où figure ${libelle} (profil)`);
      for (const [i, a] of attendu.entries()) {
        const motif = new RegExp(`^Champ « ${echapper(a.champs[0])} » · ${kind === 'a' ? 'Nommé' : 'Nommée'} le ${echapper(date)} à \\d{2}:\\d{2}$`);
        verifier(motif.test(affiches[i].nomination), `Champ et moment de la nomination de ${libelle} dans ${a.doc} : « ${affiches[i].nomination} »`);
      }
      for (const nomDoc of absent) verifier(!affiches.some((x) => x.doc === nomDoc), `${nomDoc} ne doit pas figurer sur le profil de ${libelle}`);
    };
    await verifierCitation('a', 'HADDAD Karim', [{ doc: doc1, modele: MODELE_LIBRE, facons: ['bloc'], champs: ['Demandeur'], libelles: ['Choisi dans le document'] }], [doc2, doc3]);
    await capturePageEntiere(ctx, 'v13-reel/05-profil-employe-documents');
    verifier(await sectionDocuments(page, 'a').getByRole('group', { name: 'Filtrer par modèle de document' })
      .getByRole('button', { name: new RegExp(`^${echapper(MODELE_LIBRE)} \\d+ documents?$`) }).isVisible(), 'Étiquette du modèle sur le profil');
    await sectionDocuments(page, 'a').locator('.files .file', { hasText: `${doc1} · ${DOSSIER_LIBRE}` }).click();
    await attendreTitre(page, DOSSIER_LIBRE);
    await attendre(async () => (await page.locator('.preview .pv-h b').innerText()).trim() === doc1, 'Un clic ouvre le document dans son dossier');
    await bouton(page, 'Retour').click();
    await attendreTitre(page, 'HADDAD Karim');

    ctx.etape('historique : la nomination est datée, intitulée, avec son champ ; document, champ et dossier sont des liens');
    await page.getByRole('tab', { name: 'Journal chronologique' }).click();
    const ligne = page.locator('[role=tabpanel] .tl li', { has: page.locator('b', { hasText: `Nommé dans ${MODELE_LIBRE} : ${doc1}` }) });
    await attendre(() => ligne.isVisible(), `La nomination « Nommé dans ${MODELE_LIBRE} : ${doc1} » doit figurer dans l’historique`);
    egal(await ligne.locator('time').innerText(), date, 'Date de la nomination (aujourd’hui)');
    const lienDoc = ligne.locator('b button.tl-lien', { hasText: doc1 });
    egal(await lienDoc.getAttribute('title'), 'Ouvrir le document dans son dossier', 'Le nom du document, dans le titre, est un lien');
    egal((await ligne.locator('p').first().innerText()).trim(), 'Champ « Demandeur »', 'Le détail donne le champ');
    egal(await ligne.locator('p').first().locator('button.tl-lien').getAttribute('title'), 'Ouvrir le document dans son dossier', 'Le champ est un lien');
    egal(await ligne.locator('button.tl-lien', { hasText: DOSSIER_LIBRE }).getAttribute('title'), 'Ouvrir le dossier', 'Le dossier est un lien');
    await lienDoc.click();
    await attendreTitre(page, DOSSIER_LIBRE);
    await attendre(async () => (await page.locator('.preview .pv-h b').innerText()).trim() === doc1, 'Le lien de l’historique ouvre le document');
    await bouton(page, 'Retour').click();
    await attendreTitre(page, 'HADDAD Karim');
    await attendre(async () => (await page.getByRole('tab', { selected: true }).innerText()).startsWith('Journal chronologique'), 'Retour ramène à l’onglet d’historique');
    await page.getByRole('tab', { name: /Dossiers liés/ }).click();
    verifier(await page.locator('[role=tabpanel] .folders .folder', { hasText: DOSSIER_LIBRE }).isVisible(), 'Le dossier libre est dans « Dossiers liés »');

    await verifierCitation('a', 'OULD ALI Nadia', [{ doc: doc2, modele: INTERVENTION, facons: ['texte'], champs: ['Signalée par'], libelles: ['Nom écrit dans le document'] }], [doc1, doc3]);
    await sectionDocuments(page, 'a').locator('.files .file', { hasText: `${doc2} · ${DOSSIER_LIBRE}` }).click();
    await attendre(async () => (await page.locator('.preview .pv-h b').innerText()).trim() === doc2, 'Le document où le nom est écrit s’ouvre');
    await verifierCitation('a', 'MANSOURI Leïla', [], [doc3]);
    await verifierCitation('b', 'Poste laboratoire 02', [{ doc: doc1, modele: MODELE_LIBRE, facons: ['bloc'], champs: ['Poste'], libelles: ['Choisie dans le document'] }], [doc2, doc3]);
    await page.getByRole('tab', { name: 'Journal des opérations' }).click();
    const lienMachine = page.locator('[role=tabpanel] .tl li', { has: page.locator('b', { hasText: `${MODELE_LIBRE} : ${doc1}` }) }).locator('button.tl-lien', { hasText: doc1 });
    await attendre(() => lienMachine.isVisible(), 'La citation est un lien dans le journal de la machine');
    await lienMachine.click();
    await attendre(async () => (await page.locator('.preview .pv-h b').innerText()).trim() === doc1, 'Le lien du journal de la machine ouvre le document');
    await verifierCitation('b', 'Portable formation', [{ doc: doc2, modele: INTERVENTION, facons: ['texte'], champs: ['Défauts signalés'], libelles: ['Identifiant écrit dans le document'] }], [doc1, doc3]);
    await verifierCitation('b', 'PC secrétariat', [], [doc3]);
    await repos(page);
  },
};

// ───────────────────────────── recherche : longues listes ─────────────────────────────

const SERIE = 'Série';
const NB_SERIE = 68;

/** Résultat actif de la recherche, entièrement visible dans la liste qui défile ? */
const actifVisible = (page) => page.evaluate(() => {
  const liste = document.querySelector('#dd .dd-liste');
  const on = liste?.querySelector('.res.on');
  if (!liste || !on) return false;
  const l = liste.getBoundingClientRect();
  const r = on.getBoundingClientRect();
  return r.top >= l.top - 1 && r.bottom <= l.bottom + 1;
});

export const rechercheLongue = {
  id: 'recherche-longue',
  titre: 'Recherche : plus de 4 résultats, liste qui défile au clavier et à la molette, 50 sur 68',
  async executer(ctx) {
    const { page, app } = ctx;
    ctx.etape(`${NB_SERIE} machines « ${SERIE} NN » créées par le back`);
    const type = (await app.appeler('categories_lister', { kind: 'b' })).find((c) => c.actif);
    for (let i = 1; i <= NB_SERIE; i++) {
      const n = String(i).padStart(2, '0');
      await app.appeler('entite_creer', { saisie: { kind: 'b', nom: `${SERIE} ${n}`, code: `SR-${n}`, marque: '', cpu: '', ram: '', stockage: '', categorieId: type.id } });
    }
    await menu(page, 'Tableau de bord');

    ctx.etape('« serie 1 » : 10 résultats, tous atteints au clavier, l’élément choisi reste visible');
    await page.keyboard.press('Control+k');
    await page.keyboard.type('serie 1');
    const liste = page.locator('#dd');
    await attendre(async () => (await liste.getAttribute('aria-busy')) === 'false' && (await liste.locator('.res').count()) === 10,
      'La recherche « serie 1 » doit donner 10 résultats');
    egal(await liste.locator('.grp h4').allTextContents(), ['Machines · 10'], 'Titre du groupe');
    egal(await liste.locator('.grp').getAttribute('aria-label'), 'Machines : 10 résultats', 'Nom accessible du groupe');
    const attendus = Array.from({ length: 10 }, (_, i) => `${SERIE} ${10 + i}`);
    egal(await liste.locator('.res b').allInnerTexts(), attendus, 'Les 10 machines trouvées');
    const vus = [];
    for (let i = 0; i < 10; i++) {
      if (i) await page.keyboard.press('ArrowDown');
      await attendre(() => actifVisible(page), `Le résultat ${i + 1} doit être visible une fois choisi au clavier`);
      vus.push((await liste.locator('.res.on b').innerText()).trim());
      egal(await page.locator('#q').getAttribute('aria-activedescendant'), await liste.locator('.res.on').getAttribute('id'), 'aria-activedescendant suit le choix');
    }
    egal(vus, attendus, 'Chaque résultat atteint au clavier');
    await page.keyboard.press('Enter');
    await attendreTitre(page, `${SERIE} 19`);
    await page.keyboard.press('Alt+ArrowLeft');
    await attendreTitre(page, 'Tableau de bord');

    ctx.etape(`« ${SERIE.toLowerCase()} » : 50 sur ${NB_SERIE}, la liste défile au clavier (↓, Page suiv., Fin de liste)`);
    await page.keyboard.press('Control+k');
    await page.keyboard.press('Control+a');
    await page.keyboard.type(SERIE.toLowerCase());
    await attendre(async () => (await liste.getAttribute('aria-busy')) === 'false' && (await liste.locator('.res').count()) === 50,
      `La recherche « ${SERIE.toLowerCase()} » doit afficher 50 résultats`);
    egal(await liste.locator('.grp h4').allTextContents(), [`Machines · 50 sur ${NB_SERIE}`], 'Titre du groupe : 50 sur 68');
    egal(await liste.locator('.grp').getAttribute('aria-label'), `Machines : 50 résultats affichés sur ${NB_SERIE}`, 'Nom accessible du groupe');
    egal((await liste.locator('.dd-plus').innerText()).trim(), `${NB_SERIE - 50} autres : précisez la recherche pour les voir.`, 'Note sous le groupe');
    const defile = await liste.locator('.dd-liste').evaluate((l) => ({ h: l.scrollHeight, c: l.clientHeight }));
    verifier(defile.h > defile.c, `La liste a une hauteur maximale et défile (${defile.h} px pour ${defile.c} px)`);
    for (let i = 1; i < 50; i++) {
      await page.keyboard.press('ArrowDown');
      await attendre(() => actifVisible(page), `Le résultat ${i + 1} doit rester visible pendant le défilement au clavier`);
    }
    egal((await liste.locator('.res.on b').innerText()).trim(), `${SERIE} 50`, '↓ atteint le 50e résultat');
    await ctx.capture('v13-reel/03-recherche-longue-liste');
    await page.keyboard.press('PageUp');
    await attendre(() => actifVisible(page), 'Page préc. : l’élément choisi reste visible');
    egal((await liste.locator('.res.on b').innerText()).trim(), `${SERIE} 42`, 'Page préc. remonte de 8');
    for (let i = 0; i < 8; i++) await page.keyboard.press('PageUp');
    await attendre(() => actifVisible(page), 'Retour en tête : l’élément choisi reste visible');
    egal((await liste.locator('.res.on b').innerText()).trim(), `${SERIE} 01`, 'Page préc. jusqu’au premier résultat');
    egal(await liste.locator('.dd-liste').evaluate((l) => l.scrollTop <= 40), true, 'La liste est revenue en haut');

    ctx.etape('à la molette : le bas de la liste devient visible, un clic ouvre le dernier résultat');
    const dernier = liste.locator('.res').last();
    const boite = await liste.locator('.dd-liste').boundingBox();
    await page.mouse.move(boite.x + boite.width / 2, boite.y + boite.height / 2);
    const visibleDansListe = () => dernier.evaluate((el) => {
      const l = el.closest('.dd-liste').getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return r.top >= l.top - 1 && r.bottom <= l.bottom + 1;
    });
    verifier(!(await visibleDansListe()), 'Le dernier résultat est d’abord hors de vue');
    for (let i = 0; i < 60 && !(await visibleDansListe()); i++) {
      await page.mouse.wheel(0, 120);
      await pause(60);
    }
    verifier(await visibleDansListe(), 'La molette fait défiler la liste jusqu’au dernier résultat');
    verifier(await liste.isVisible(), 'La liste reste ouverte pendant le défilement');
    await dernier.click();
    await attendreTitre(page, `${SERIE} 50`);
    await page.keyboard.press('Alt+ArrowLeft');
    await attendreTitre(page, 'Tableau de bord');
  },
};

// ───────────────────────────── champs obligatoires, formulaire par formulaire ─────────────────────────────

/**
 * Contrôle d'un formulaire (§ 10.6) : mention « * champ obligatoire », étoile sur chaque champ obligatoire (et sur eux
 * seuls parmi `facultatifs`), envoi refusé avec le message qui nomme `premier` et le focus sur ce champ.
 */
async function controlerFormulaire(page, { form, envoyer, premier, facultatifs = [], quoi }) {
  await attendre(() => form.isVisible(), `${quoi} : le formulaire ne s’affiche pas`);
  const etat = await form.evaluate((f, fac) => {
    const nom = (el) => {
      const lab = el.labels?.[0];
      if (lab) {
        const c = lab.cloneNode(true);
        c.querySelectorAll('small, input, select, textarea, .etoile, .sr-only').forEach((x) => x.remove());
        const t = c.textContent.replace(/\*/g, '').replace(/\s+/g, ' ').trim();
        if (t) return t;
      }
      return (el.getAttribute('aria-label') ?? '').trim();
    };
    const etoile = (el) => !!(el.labels?.[0]?.querySelector('.etoile') || el.closest('label')?.querySelector('.etoile')
      || [...(el.parentElement?.children ?? [])].some((x) => x !== el && x.querySelector?.('.etoile') && !x.classList.contains('mention-obligatoire')));
    const champs = [...f.querySelectorAll('input, select, textarea')].filter((el) => !['checkbox', 'radio', 'hidden'].includes(el.type));
    const requis = champs.filter((el) => el.required || el.getAttribute('aria-required') === 'true');
    return {
      mention: !!f.querySelector('.mention-obligatoire') || !!f.parentElement?.querySelector('.mention-obligatoire'),
      requis: requis.map(nom),
      sansEtoile: requis.filter((el) => !etoile(el)).map(nom),
      facultatifsEtoiles: champs.filter((el) => fac.includes(nom(el)) && (el.labels?.[0]?.querySelector('.etoile'))).map(nom),
    };
  }, facultatifs);
  verifier(etat.mention, `${quoi} : mention « * champ obligatoire » absente`);
  verifier(etat.requis.length > 0, `${quoi} : aucun champ marqué obligatoire (required / aria-required)`);
  egal(etat.sansEtoile, [], `${quoi} : champs obligatoires sans étoile`);
  egal(etat.facultatifsEtoiles, [], `${quoi} : champs facultatifs marqués d’une étoile`);
  await envoyer.click();
  await attendre(async () => (await texteErreur(page)).includes(`Remplissez le champ obligatoire « ${premier} ».`),
    `${quoi} : l’envoi à vide doit être refusé avec « Remplissez le champ obligatoire « ${premier} ». »`);
  const focus = await page.evaluate(() => {
    const el = document.activeElement;
    const lab = el?.labels?.[0];
    let n = '';
    if (lab) {
      const c = lab.cloneNode(true);
      c.querySelectorAll('small, input, select, textarea, .etoile, .sr-only').forEach((x) => x.remove());
      n = c.textContent.replace(/\*/g, '').replace(/\s+/g, ' ').trim();
    }
    return { nom: n || el?.getAttribute('aria-label') || '', requis: !!(el?.required || el?.getAttribute('aria-required') === 'true') };
  });
  verifier(focus.requis, `${quoi} : le focus doit être sur un champ obligatoire (${JSON.stringify(focus)})`);
  verifier(focus.nom === premier || focus.nom.endsWith(premier), `${quoi} : le focus doit être sur « ${premier} » (obtenu « ${focus.nom} »)`);
}

export const champsObligatoires = {
  id: 'champs-obligatoires',
  titre: 'Champs obligatoires : étoile, mention, envoi à vide refusé et focus, sur chaque formulaire',
  async executer(ctx) {
    const { page, app } = ctx;
    const nbAvant = {
      a: (await app.appeler('entites_lister', { kind: 'a' })).length,
      b: (await app.appeler('entites_lister', { kind: 'b' })).length,
      d: (await app.appeler('dossiers_lister')).length,
      t: (await app.appeler('themes_lister')).length,
      m: (await app.appeler('magasin_lister')).length,
      s: (await app.appeler('statuts_lister')).length,
    };

    ctx.etape('Créer un employé');
    await menu(page, 'Employés');
    await bouton(page, 'Créer un employé').click();
    await attendreTitre(page, 'Créer un employé');
    const formA = page.locator('.content form.form');
    await controlerFormulaire(page, { form: formA, envoyer: bouton(page, 'Enregistrer la fiche'), premier: 'Nom', quoi: 'Créer un employé' });
    egal(await formA.locator('label .etoile').count(), 5, 'Créer un employé : cinq étoiles (nom, prénom, date de naissance, poste, structure)');
    await page.fill('#n-nom', 'Essai');
    await page.fill('#n-prenom', 'Obligatoire');
    await page.fill('#n-naissance', '1999-01-01');
    await bouton(page, 'Enregistrer la fiche').click();
    await attendre(async () => (await texteErreur(page)).includes('« Poste »'), 'Il manque le poste');
    egal(await page.evaluate(() => document.activeElement?.id), 'n-poste', 'Focus sur « Poste »');
    await bouton(page, 'Annuler').click();

    ctx.etape('Modifier un employé');
    const haddadAvant = (await app.appeler('entites_lister', { kind: 'a' })).find((e) => e.libelle === 'HADDAD Karim');
    await ouvrirFiche(page, 'a', 'HADDAD Karim');
    await bouton(page, 'Modifier la fiche').click();
    await attendreTitre(page, 'Modifier la fiche');
    await attendre(() => page.locator('#n-nom').isVisible(), 'Le formulaire de modification ne s’affiche pas');
    await page.fill('#n-prenom', '');
    await page.fill('#n-poste', '   ');
    await controlerFormulaire(page, { form: page.locator('.content form.form'), envoyer: bouton(page, 'Enregistrer les modifications'), premier: 'Prénom', quoi: 'Modifier un employé' });
    await bouton(page, 'Annuler').click();
    await attendreTitre(page, 'HADDAD Karim');
    egal((await app.appeler('entites_lister', { kind: 'a' })).find((e) => e.libelle === 'HADDAD Karim'), haddadAvant, 'La fiche n’est pas modifiée');

    ctx.etape('Créer une machine (identifiant facultatif, sans étoile)');
    await menu(page, 'Machines');
    await bouton(page, 'Créer une machine').click();
    await attendreTitre(page, 'Créer une machine');
    await controlerFormulaire(page, {
      form: page.locator('.content form.form'), envoyer: bouton(page, 'Enregistrer la fiche'), premier: 'Nom',
      facultatifs: ['Identifiant', 'Marque et modèle', 'Processeur', 'RAM', 'Stockage'], quoi: 'Créer une machine',
    });
    egal(await page.locator('.content form.form label .etoile').count(), 2, 'Créer une machine : deux étoiles (nom, type de machine)');
    await bouton(page, 'Annuler').click();

    ctx.etape('Identifiant d’une machine qui n’en a pas');
    await ouvrirFiche(page, 'b', 'PC atelier');
    await controlerFormulaire(page, { form: page.locator('form.saisie-code'), envoyer: bouton(page, 'Enregistrer l’identifiant'), premier: 'Identifiant de la machine', quoi: 'Identifiant de la machine' });

    ctx.etape('Créer un dossier');
    await menu(page, 'Dossiers & Archives');
    await bouton(page, 'Créer un dossier').click();
    await attendreTitre(page, 'Créer un dossier');
    const formD = page.locator('.content form.form');
    await attendre(async () => (await formD.locator('label', { hasText: /^Nom/ }).locator('input').inputValue()) !== '', 'Nom suggéré');
    await formD.locator('label', { hasText: /^Année/ }).locator('input').fill('');
    await formD.locator('label', { hasText: /^Nom/ }).locator('input').fill('');
    await controlerFormulaire(page, { form: formD, envoyer: bouton(page, 'Créer le dossier'), premier: 'Année', facultatifs: ['État'], quoi: 'Créer un dossier' });
    egal(await formD.locator('label .etoile').count(), 3, 'Créer un dossier : trois étoiles (année, nom, thème)');
    egal(await formD.locator('.choix-fiche').count(), 0, 'Créer un dossier : ni employé ni machine (§ 11.1)');
    await bouton(page, 'Annuler').click();

    ctx.etape('Dossier ouvert : nouveau sous-dossier, renommer, nouvelle option');
    await ouvrirDossier(page, DOSSIER_LIBRE);
    await page.locator('.folder.add').click();
    await modale(page).locator('.choice', { hasText: 'Un dossier' }).click();
    await controlerFormulaire(page, { form: modale(page).locator('form'), envoyer: bouton(modale(page), 'Créer le dossier'), premier: 'Nom du dossier', quoi: 'Nouveau sous-dossier' });
    await page.keyboard.press('Escape');
    await attendre(async () => !(await modale(page).count()), 'La fenêtre se ferme');
    await page.locator('.ph-actions').getByRole('button', { name: 'Renommer', exact: true }).click();
    await modale(page).locator('input').fill('');
    await controlerFormulaire(page, { form: modale(page).locator('form'), envoyer: bouton(modale(page), 'Renommer'), premier: 'Nom du dossier', quoi: 'Renommer le dossier' });
    await bouton(modale(page), 'Annuler').click();
    await page.locator('.preview .pv-h').getByRole('button', { name: 'Renommer', exact: true }).click();
    await modale(page).locator('input').fill(' ');
    await controlerFormulaire(page, { form: modale(page).locator('form'), envoyer: bouton(modale(page), 'Renommer'), premier: 'Nom du document', quoi: 'Renommer le document' });
    await bouton(modale(page), 'Annuler').click();
    await controlerFormulaire(page, { form: page.locator('.checks form'), envoyer: bouton(page, 'Ajouter l’option'), premier: 'Nom de la nouvelle option', quoi: 'Nouvelle option' });
    verifier(await page.locator('.p-date .etoile').isVisible(), 'Date du document : étoile');

    ctx.etape('Fiche : fenêtre « Affecter une machine » (choix obligatoire)');
    await ouvrirFiche(page, 'a', 'HADDAD Karim');
    await bouton(page, 'Affecter une machine').click();
    await attendre(() => modale(page).isVisible(), 'La fenêtre d’affectation ne s’ouvre pas');
    verifier(await modale(page).locator('.mention-obligatoire').isVisible(), 'Affecter : mention « * champ obligatoire »');
    verifier(await modale(page).locator('.cf-label .etoile').isVisible(), 'Affecter : étoile du choix de la machine');
    egal(await modale(page).getByRole('combobox').getAttribute('aria-required'), 'true', 'Affecter : aria-required');
    await page.keyboard.press('Escape');
    await attendre(async () => !(await modale(page).count()), 'La fenêtre se ferme');

    ctx.etape('Paramètres : catégorie, structure, type, état (ajout) ; renommer une structure');
    await menu(page, 'Paramètres');
    for (const [label, envoi] of [['Nom de la nouvelle catégorie', 'Ajouter la catégorie'], ['Nom de la nouvelle structure', 'Ajouter la structure'],
      ['Nom du nouveau type de machine', 'Ajouter le type']]) {
      const f = page.locator('form', { has: page.getByLabel(label) });
      await controlerFormulaire(page, { form: f, envoyer: bouton(f, envoi), premier: label, quoi: label });
      await page.getByLabel(label).fill('x');
      await page.getByLabel(label).fill('');
    }
    await controlerFormulaire(page, { form: formNouvelEtat(page), envoyer: bouton(formNouvelEtat(page), 'Ajouter l’état'), premier: 'Nom du nouvel état', quoi: 'Ajouter un état' });
    await page.getByRole('button', { name: 'Renommer Division informatique', exact: true }).click();
    const champRen = page.getByRole('textbox', { name: 'Nouveau nom de Division informatique', exact: true });
    await champRen.fill('');
    await controlerFormulaire(page, { form: page.locator('form.cl-renommer'), envoyer: bouton(page.locator('form.cl-renommer'), 'Enregistrer'), premier: 'Nouveau nom de Division informatique', quoi: 'Renommer une structure' });
    await champRen.press('Escape');

    ctx.etape('Magasin');
    await menu(page, 'Création');
    await page.locator('.hubcard', { hasText: 'Magasin' }).click();
    await attendreTitre(page, 'Magasin');
    await controlerFormulaire(page, { form: page.locator('.content form.inline'), envoyer: bouton(page, 'Ajouter au Magasin'), premier: 'Nouveau mot-clé', quoi: 'Magasin' });

    ctx.etape('Studio : nom du modèle');
    await menu(page, 'Création');
    await page.locator('.hubcard', { hasText: 'Modèles de document' }).click();
    await attendreTitre(page, 'Modèles de document');
    await page.locator('.mitem', { has: page.locator('b', { hasText: new RegExp(`^${echapper(MODELE_LIBRE)}$`) }) }).click();
    await attendre(async () => (await page.inputValue('#m-nom')) === MODELE_LIBRE, 'Le modèle ne s’ouvre pas');
    verifier(await page.locator('label[for="m-nom"] .etoile').isVisible() && await page.locator('label[for="m-theme"] .etoile').isVisible(),
      'Studio : étoiles du nom et du thème');
    egal(await page.locator('#m-nom').getAttribute('required'), '', 'Studio : nom du modèle « required »');
    await page.fill('#m-nom', '');
    await attendre(() => page.locator('#m-nom-vide').isVisible(), 'Studio : un nom vide est signalé');
    await pause(1200);
    egal((await app.appeler('modeles_lister')).filter((m) => m.nom === MODELE_LIBRE).length, 1, 'Studio : un nom vide n’est pas enregistré');
    await page.fill('#m-nom', MODELE_LIBRE);

    ctx.etape('aucun envoi refusé n’a rien créé');
    await pause(500);
    egal({
      a: (await app.appeler('entites_lister', { kind: 'a' })).length,
      b: (await app.appeler('entites_lister', { kind: 'b' })).length,
      d: (await app.appeler('dossiers_lister')).length,
      t: (await app.appeler('themes_lister')).length,
      m: (await app.appeler('magasin_lister')).length,
      s: (await app.appeler('statuts_lister')).length,
    }, nbAvant, 'Comptes inchangés');
    await menu(page, 'Tableau de bord');
  },
};
