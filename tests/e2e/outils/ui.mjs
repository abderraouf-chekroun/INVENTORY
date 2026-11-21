// Gestes courants dans l'interface : barre latérale, titres, boutons, fenêtres modales.

import { attendre, egal, pause } from './verifs.mjs';

/** Bouton par son nom accessible exact. */
export const bouton = (zone, nom) => zone.getByRole('button', { name: nom, exact: true });

/** La fenêtre modale ouverte. */
export const modale = (page) => page.locator('.modal[role="dialog"]');

/** Titre (h1) de la page affichée. */
export async function titre(page) {
  return (await page.locator('.content .ph h1').first().innerText()).trim();
}

export async function attendreTitre(page, attendu) {
  await attendre(async () => (await titre(page)) === attendu, `La page « ${attendu} » ne s’affiche pas`);
  await pause(150);
}

/** Entrée de la barre latérale (nav.root). */
export async function menu(page, libelle, titreAttendu = libelle) {
  await page.locator('.side .nav', { hasText: libelle }).click();
  await attendreTitre(page, titreAttendu);
}

/** Ouvre une fiche depuis son répertoire (barre latérale « Employés » / « Machines », puis clic sur la ligne). */
export async function ouvrirFiche(page, kind, nom, code) {
  await menu(page, kind === 'a' ? 'Employés' : 'Machines');
  // Une recherche laissée dans le répertoire par un scénario précédent masquerait la ligne.
  const recherche = page.locator(`#f-${kind}-code`);
  if (await recherche.inputValue()) await recherche.fill('');
  // Deux homonymes complets se distinguent par leur identifiant (2e colonne).
  let ligne = page.locator('.content table tbody tr', { has: page.locator('td.name', { hasText: new RegExp(`^${echapper(nom)}$`) }) });
  if (code !== undefined) ligne = ligne.filter({ has: page.locator('td:nth-child(2)', { hasText: new RegExp(`^${echapper(code)}$`) }) });
  await ligne.click();
  await attendreTitre(page, nom);
}

/**
 * Aide à la saisie (§ 8.4) dont la liste s'appelle « Propositions : {libelle} » : le bloc `.choix-fiche` entier
 * (libellé, champ, liste, puis fiche choisie et boutons Changer / Retirer).
 */
export const choixFiche = (zone, libelle) => zone.locator('.choix-fiche', {
  // Le localisateur passé à `has` doit partir de la page (il est cherché à l'intérieur de .choix-fiche).
  has: (typeof zone.page === 'function' ? zone.page() : zone)
    .getByRole('listbox', { name: `Propositions : ${libelle}`, exact: true, includeHidden: true }),
});

/** Champ de saisie (combobox) d'une aide à la saisie. */
export const champChoix = (zone, libelle) => choixFiche(zone, libelle).getByRole('combobox');

/** Propositions affichées : [{ nom, detail, code, active }]. */
export async function propositions(zone, libelle) {
  const liste = zone.getByRole('listbox', { name: `Propositions : ${libelle}`, exact: true });
  return liste.getByRole('option').evaluateAll((lis) => lis.map((li) => ({
    nom: li.querySelector('b')?.textContent.trim() ?? '',
    detail: li.querySelector('small')?.textContent.trim() ?? '',
    code: li.querySelector(':scope > .mono, :scope > .badge')?.textContent.trim() ?? '',
    active: li.getAttribute('aria-selected') === 'true',
  })));
}

/**
 * Tape `texte` au clavier (lettre par lettre) dans l'aide à la saisie, puis attend que l'annonce
 * « N propositions… » (ou « Aucun… ») corresponde à la saisie complète. Renvoie les propositions.
 */
export async function taperDansChoix(zone, libelle, texte) {
  const champ = champChoix(zone, libelle);
  await champ.click();
  await champ.pressSequentially(texte, { delay: 40 });
  const statut = choixFiche(zone, libelle).locator('[role=status]');
  await attendre(async () => {
    const s = (await statut.textContent()) ?? '';
    return /^\d+ propositions?\./.test(s) || (/^Aucun/.test(s) && s.includes(`« ${texte.trim()} »`));
  }, `L’aide à la saisie « ${libelle} » ne répond pas à « ${texte} »`);
  // Pendant la frappe, la liste montre encore les propositions de la saisie précédente : on attend qu'elle se stabilise.
  let avant = null;
  for (let i = 0; i < 40; i++) {
    await pause(150);
    const maintenant = JSON.stringify([await statut.textContent(), await propositions(zone, libelle)]);
    if (maintenant === avant) break;
    avant = maintenant;
  }
  return propositions(zone, libelle);
}

/** Cadre de la fiche choisie dans une aide à la saisie (groupe nommé par le libellé). */
export const carteChoisie = (zone, libelle) => zone.getByRole('group', { name: libelle, exact: true });

/** Informations d'une fiche choisie dans un bloc Employé / Machine d'un document : { libellé: valeur }. */
export async function detailsCarte(zone, libelle) {
  return carteChoisie(zone, libelle).locator('dl.cf-details > div').evaluateAll((ds) => Object.fromEntries(ds.map((d) => [
    d.querySelector('dt').textContent.trim(), d.querySelector('dd').textContent.trim(),
  ])));
}

/** Ouvre un dossier depuis Dossiers & Archives (vue Groupes), puis éventuellement un document. */
export async function ouvrirDossier(page, nom, document) {
  await menu(page, 'Dossiers & Archives');
  const vueGroupes = page.locator('.seg button', { hasText: 'Groupes' });
  if ((await vueGroupes.getAttribute('aria-pressed')) !== 'true') await vueGroupes.click();
  await page.locator('.folders .folder', { has: page.locator('b', { hasText: new RegExp(`^${echapper(nom)}$`) }) }).first().click();
  await attendreTitre(page, nom);
  if (document) await ouvrirDocument(page, document);
}

/** Affiche un document du dossier courant dans la section « Document ». */
export async function ouvrirDocument(page, nom) {
  await page.locator('.files .file', { has: page.locator('b', { hasText: new RegExp(`^${echapper(nom)}$`) }) }).click();
  await attendre(async () => (await page.locator('.preview .pv-h b').innerText()).trim() === nom, `Le document « ${nom} » ne s’affiche pas`);
}

/** Textes des alertes rouges visibles, séparés par « / » (ou ''). */
export async function texteErreur(zone) {
  const textes = await zone.locator('.alert.bad').allInnerTexts();
  return textes.map((t) => t.replace(/\s+/g, ' ').trim()).join(' / ');
}

/** Liste « État » de l'en-tête d'un dossier ouvert (§ 10.1) ; absente sur un dossier clôturé. */
export const listeEtat = (page) => page.locator('.ph .ph-actions label.etat-choix', { hasText: /^État/ }).locator('select');

/**
 * État affiché dans l'en-tête du dossier : l'option choisie de la liste « État » (dossier ouvert), sinon le badge
 * (dossier clôturé).
 */
export async function badgeEntete(page) {
  // Lecture en une fois dans la page : la liste disparaît à la clôture, entre deux lectures séparées elle pourrait ne
  // plus exister (attente de 30 s de Playwright au lieu d'une nouvelle tentative).
  return page.locator('.ph .ph-actions').first().evaluate((el) => {
    const liste = [...el.querySelectorAll('label.etat-choix')].find((l) => l.textContent.trim().startsWith('État'))?.querySelector('select');
    if (liste) return (liste.selectedOptions[0]?.textContent ?? '').trim();
    return (el.querySelector('.badge')?.textContent ?? '').trim();
  }, null, { timeout: 2000 });
}

export async function attendreBadge(page, attendu) {
  await attendre(async () => (await badgeEntete(page)) === attendu, `L’état du dossier devrait être « ${attendu} »`);
}

/** Choisit un état dans la liste « État » de l'en-tête et attend qu'il soit enregistré (liste réactivée sur cet état). */
export async function choisirEtat(page, nom) {
  await listeEtat(page).selectOption({ label: nom });
  await attendre(async () => (await badgeEntete(page)) === nom && (await listeEtat(page).isEnabled()), `L’état « ${nom} » doit être choisi`);
}

/**
 * Champ du papier par son libellé exact (bloc « Champ sur une ligne », « Zone de texte » ou « Date ») : le champ
 * du <label class="df"> dont le premier <span> porte exactement ce libellé.
 */
export const champPapier = (page, libelle) => page.locator('.paper label.df > span:first-child')
  // § 10.6 : un bloc obligatoire porte l'étoile après son libellé.
  .filter({ hasText: new RegExp(`^${echapper(libelle)}\\s*\\*?$`) }).locator('xpath=..')
  .locator('input:not([type=checkbox]):not([type=radio]), textarea');

/** Liste « Choix du Magasin » du papier, par son libellé. */
export const magasinPapier = (page, libelle) => page.locator('.paper label.df').filter({ has: page.locator('select') })
  .filter({ hasText: new RegExp(`^${echapper(libelle)}`) }).locator('select');

/** Case à cocher du papier (bloc « Case à cocher » ou option d'une liste), par son nom. */
export const casePapier = (zone, nom) => zone.getByRole('checkbox', { name: nom, exact: true });

/** Bloc « Liste d'options » du papier (fieldset nommé par sa légende ; le nom accessible porte aussi l'indication du type). */
export const choixPapier = (page, libelle) => page.locator('.paper fieldset.p-choix', {
  has: page.locator('legend', { hasText: new RegExp(`^${echapper(libelle)}\\s*\\(`) }),
});

export async function verifierAttributs(page, attendu, quoi) {
  const obtenu = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme ?? null,
    densite: document.documentElement.dataset.density ?? null,
  }));
  egal(obtenu, attendu, quoi);
}

export function echapper(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
