// Employés (§ 8.2, § 10.5, § 10.6) : création champ par champ avec l'identifiant codé calculé en direct (forme
// EMP-XXXXX-XXXXX, rien de lisible dedans), formulaire incomplet refusé, homonyme complet (collision gérée : autre
// identifiant), fiche reprise « à compléter » complétée depuis l'inventaire, modification qui change (ou garde)
// l'identifiant, archivage.
// Machines (§ 8.3) : identifiant saisi à la main, doublon refusé (sans tenir compte de la casse), caractéristiques,
// identifiant saisi depuis l'inventaire. Les affectations (§ 9.3) sont couvertes par le scénario « affectations ».

import { attendreTitre, bouton, menu, ouvrirFiche, texteErreur } from '../outils/ui.mjs';
import { attendre, egal, verifier } from '../outils/verifs.mjs';
import { lireInventaire } from './demarrage.mjs';

export const EMPLOYE = { nom: 'Zenith', prenom: 'Amel', naissance: '1993-02-07', poste: 'Ingénieure', libelle: 'ZENITH Amel' };
/** § 10.5 : identifiant d'un employé, dix caractères d'un alphabet sans I, L, O, U. */
export const FORME_ID = /^EMP-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/;
export const MACHINE = 'PC e2e';
export const ID_MACHINE = 'PC-E2E-01';
export const MACHINE_SANS_ID = 'Portable e2e';
export const ID_MACHINE_2 = 'LT-E2E-02';

/** Fiche lue dans le back par son nom affiché (et son identifiant, pour départager deux homonymes). */
export async function ficheDuBack(app, kind, libelle, code) {
  const liste = await app.appeler('entites_lister', { kind });
  const x = liste.find((e) => e.libelle === libelle && (code === undefined || e.code === code));
  verifier(x, `Fiche « ${libelle} »${code ? ` (${code})` : ''} introuvable dans le back`);
  return x;
}

/** Identifiant actuel d'une fiche d'exemple, lu dans le back (le seul employé de ce nom, ou `filtre` pour départager). */
export async function codeDe(app, kind, libelle, filtre = () => true) {
  const x = (await app.appeler('entites_lister', { kind })).filter((e) => e.libelle === libelle && filtre(e));
  verifier(x.length === 1, `Une seule fiche « ${libelle} » attendue dans le back (obtenu ${x.length})`);
  return x[0].code;
}

/**
 * § 10.5 : forme EMP-XXXXX-XXXXX, et rien de lisible : ni les trois premières lettres du nom, du prénom ou du poste,
 * ni la date de naissance (JJMMAA, AAAA, JJMM, MMAA).
 */
export function verifierIdentifiant(id, { nom, prenom, naissance, poste }, quoi) {
  verifier(FORME_ID.test(id ?? ''), `${quoi} : identifiant de la forme EMP-XXXXX-XXXXX attendu, obtenu ${JSON.stringify(id)}`);
  const corps = id.slice(4).replace('-', '');
  const lettres = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
  for (const mot of [nom, prenom, poste]) {
    const debut = lettres(mot).slice(0, 3);
    verifier(debut.length < 3 || !corps.includes(debut), `${quoi} : l’identifiant ${id} contient « ${debut} » (lettres de « ${mot} »)`);
  }
  const [aaaa, mm, jj] = naissance.split('-');
  for (const morceau of [`${jj}${mm}${aaaa.slice(2)}`, aaaa, `${jj}${mm}`, `${mm}${aaaa.slice(2)}`]) {
    verifier(!corps.includes(morceau), `${quoi} : l’identifiant ${id} contient « ${morceau} » (date de naissance ${naissance})`);
  }
}

/** Valeurs de l'en-tête récapitulatif d'une fiche. */
export async function recap(page) {
  return page.$$eval('.recap dl > div', (ds) => Object.fromEntries(ds.map((d) => [
    d.querySelector('dt').textContent.trim(), d.querySelector('dd').textContent.trim(),
  ])));
}

/** Cadre « Identifiant qui sera attribué » : { valeur, note }. */
async function apercu(page) {
  const cadre = page.getByRole('status').filter({ hasText: 'Identifiant qui sera attribué' });
  return {
    valeur: (await cadre.locator('b').innerText()).trim(),
    note: (await cadre.locator('small').innerText()).trim(),
  };
}

async function attendreApercu(page, valeur, quoi) {
  await attendre(async () => (await apercu(page)).valeur === valeur, `${quoi} : l’aperçu de l’identifiant doit afficher « ${valeur} »`);
}

/** Saisit un champ texte au clavier, lettre par lettre (comme un utilisateur). */
async function taper(page, selecteur, texte) {
  await page.locator(selecteur).click();
  await page.locator(selecteur).pressSequentially(texte, { delay: 25 });
}

export const employes = {
  id: 'employes',
  titre: 'Employés : identifiant en direct, homonyme, fiche à compléter puis complétée, modification, archivage',
  async executer(ctx) {
    const { page, app } = ctx;

    ctx.etape('formulaire vide envoyé : refusé, focus sur le premier champ obligatoire, rien n’est créé');
    await menu(page, 'Employés');
    const nbAvant = (await app.appeler('entites_lister', { kind: 'a' })).length;
    await bouton(page, 'Créer un employé').click();
    await attendreTitre(page, 'Créer un employé');
    verifier((await page.locator('.crumbs').innerText()).replace(/\s+/g, ' ').trim().endsWith('Créer un employé'), 'Fil d’Ariane « … Créer un employé »');
    await bouton(page, 'Enregistrer la fiche').click();
    await attendre(async () => (await texteErreur(page)).includes('Remplissez le champ obligatoire « Nom ».'),
      'Un formulaire vide doit être refusé avec « Remplissez le champ obligatoire « Nom ». »');
    egal(await page.evaluate(() => document.activeElement?.id), 'n-nom', 'Le focus est sur le premier champ manquant (Nom)');

    ctx.etape('créer un employé champ par champ : l’identifiant s’affiche pendant la saisie');
    egal((await apercu(page)).valeur, 'À venir', 'Aperçu avant toute saisie');
    await taper(page, '#n-nom', EMPLOYE.nom);
    await attendre(async () => (await apercu(page)).note.includes('le prénom, la date de naissance et le poste'),
      'L’aperçu doit dire ce qui manque après le nom');
    egal((await apercu(page)).valeur, 'À venir', 'Aperçu après le nom seul');
    await taper(page, '#n-prenom', EMPLOYE.prenom);
    await attendre(async () => (await apercu(page)).note.includes('la date de naissance et le poste'), 'Aperçu après le prénom');
    await page.fill('#n-naissance', EMPLOYE.naissance);
    await attendre(async () => /dès que le poste sera rempli/.test((await apercu(page)).note), 'Aperçu après la date de naissance');
    await taper(page, '#n-poste', 'Ing');
    const idPartiel = await attendre(async () => {
      const v = (await apercu(page)).valeur;
      return FORME_ID.test(v) ? v : false;
    }, 'Poste en cours de frappe (« Ing ») : l’aperçu doit montrer un identifiant EMP-XXXXX-XXXXX');
    await taper(page, '#n-poste', 'énieure');
    const idEmploye = await attendre(async () => {
      const v = (await apercu(page)).valeur;
      return FORME_ID.test(v) && v !== idPartiel ? v : false;
    }, 'Poste complet : l’aperçu doit changer avec le poste');
    verifierIdentifiant(idEmploye, EMPLOYE, 'Aperçu de l’identifiant');
    egal((await apercu(page)).note, 'Attribué automatiquement à l’enregistrement de la fiche.', 'Note de l’aperçu (sans décrire la composition)');
    egal(await page.locator('#n-cat option').allInnerTexts(),
      ['Département maintenance', 'Division administrative', 'Division informatique'], 'Structures proposées');
    await page.selectOption('#n-cat', { label: 'Division informatique' });
    await ctx.capture('fiches/employe-formulaire');
    await ctx.capture('v13-reel/06-formulaire-employe-etoiles-identifiant');
    await bouton(page, 'Enregistrer la fiche').click();
    await attendreTitre(page, EMPLOYE.libelle);
    const r = await recap(page);
    egal([r.Identifiant, r.Nom, r.Prénom, r['Date de naissance'], r.Poste, r.Structure, r.Statut],
      [idEmploye, EMPLOYE.nom, EMPLOYE.prenom, '07/02/1993', EMPLOYE.poste, 'Division informatique', 'Actif'], 'Récapitulatif de l’employé créé');
    verifier(!(await page.locator('.alert', { hasText: 'Fiche à compléter' }).count()), 'Une fiche complète n’est pas « à compléter »');
    ctx.memo.a = (await ficheDuBack(app, 'a', EMPLOYE.libelle)).id;
    egal((await app.appeler('entites_lister', { kind: 'a' })).length, nbAvant + 1, 'Le formulaire refusé n’a rien créé');
    await bouton(page, 'Retour').click();
    await attendreTitre(page, 'Employés');

    ctx.etape('homonyme complet (mêmes informations) : collision gérée, autre identifiant de même forme');
    const benali = { nom: 'Benali', prenom: 'Sofia', naissance: '1990-05-14', poste: 'Technicienne' };
    const idBenali = await codeDe(app, 'a', 'BENALI Sofia');
    await bouton(page, 'Créer un employé').click();
    await attendreTitre(page, 'Créer un employé');
    await taper(page, '#n-nom', benali.nom);
    await taper(page, '#n-prenom', benali.prenom);
    await page.fill('#n-naissance', benali.naissance);
    await taper(page, '#n-poste', benali.poste);
    const homonyme = await attendre(async () => {
      const v = (await apercu(page)).valeur;
      return FORME_ID.test(v) ? v : false;
    }, 'Homonyme de BENALI Sofia : aperçu de l’identifiant');
    verifier(homonyme !== idBenali, `L’homonyme reçoit un autre identifiant que BENALI Sofia (${idBenali})`);
    verifierIdentifiant(homonyme, benali, 'Identifiant de l’homonyme');
    await page.selectOption('#n-cat', { label: 'Département maintenance' });
    await bouton(page, 'Enregistrer la fiche').click();
    await attendreTitre(page, 'BENALI Sofia');
    egal((await recap(page)).Identifiant, homonyme, 'Identifiant attribué à l’homonyme (celui de l’aperçu)');
    const homonymes = (await app.appeler('entites_lister', { kind: 'a' })).filter((e) => e.libelle === 'BENALI Sofia').map((e) => e.code).sort();
    egal(homonymes, [idBenali, homonyme].sort(), 'Les deux homonymes dans le back, identifiants distincts');
    egal(await codeDe(app, 'a', 'BENALI Sofia', (e) => e.code === idBenali), idBenali, 'L’identifiant de la première BENALI Sofia ne change pas');
    ctx.memo.homonyme = (await ficheDuBack(app, 'a', 'BENALI Sofia', homonyme)).id;
    ctx.memo.codes = { ...ctx.memo.codes, homonyme };

    ctx.etape('modifier l’homonyme sans toucher aux quatre informations : identifiant conservé');
    await bouton(page, 'Modifier la fiche').click();
    await attendreTitre(page, 'Modifier la fiche');
    await attendreApercu(page, homonyme, 'Aperçu en modification');
    egal((await apercu(page)).note, 'Identifiant actuel, conservé.', 'Note quand l’identifiant ne change pas');
    await page.selectOption('#n-cat', { label: 'Division administrative' });
    await bouton(page, 'Enregistrer les modifications').click();
    await attendreTitre(page, 'BENALI Sofia');
    egal([(await recap(page)).Identifiant, (await recap(page)).Structure], [homonyme, 'Division administrative'],
      'Changer la structure garde l’identifiant');

    ctx.etape('employé incomplet : refusé à l’envoi, le premier champ manquant reçoit le focus');
    await menu(page, 'Employés');
    await bouton(page, 'Créer un employé').click();
    await attendreTitre(page, 'Créer un employé');
    await taper(page, '#n-nom', 'Kaci');
    await taper(page, '#n-prenom', 'Rania');
    await attendre(async () => (await apercu(page)).note.includes('la date de naissance et le poste'), 'Aperçu d’une fiche incomplète');
    await bouton(page, 'Enregistrer la fiche').click();
    await attendre(async () => (await texteErreur(page)).includes('Remplissez le champ obligatoire « Date de naissance ».'),
      'La fiche sans date de naissance doit être refusée');
    egal(await page.evaluate(() => document.activeElement?.id), 'n-naissance', 'Le focus est sur « Date de naissance »');
    await page.fill('#n-naissance', '2000-09-01');
    await bouton(page, 'Enregistrer la fiche').click();
    await attendre(async () => (await texteErreur(page)).includes('Remplissez le champ obligatoire « Poste ».'),
      'La fiche sans poste doit être refusée');
    egal(await page.evaluate(() => document.activeElement?.id), 'n-poste', 'Le focus est sur « Poste »');
    await taper(page, '#n-poste', 'Secrétaire');
    await attendre(async () => FORME_ID.test((await apercu(page)).valeur), 'Fiche complète : identifiant affiché');
    await attendre(async () => (await texteErreur(page)) === '', 'L’alerte disparaît une fois les champs remplis');
    await bouton(page, 'Enregistrer la fiche').click();
    await attendreTitre(page, 'KACI Rania');
    const idKaci = (await recap(page)).Identifiant;
    verifierIdentifiant(idKaci, { nom: 'Kaci', prenom: 'Rania', naissance: '2000-09-01', poste: 'Secrétaire' }, 'KACI Rania');
    ctx.memo.codes = { ...ctx.memo.codes, kaci: idKaci };
    egal((await app.appeler('entites_lister', { kind: 'a' })).filter((e) => e.libelle === 'KACI Rania').length, 1,
      'Les envois refusés n’ont rien créé');

    ctx.etape('fiche reprise « à compléter » (CHERIF Amine) : complétée depuis l’inventaire du tableau de bord');
    await ouvrirFiche(page, 'a', 'CHERIF Amine');
    egal((await recap(page)).Identifiant, 'Fiche à compléter', 'Identifiant d’une fiche incomplète');
    const alerte = page.locator('.alert', { hasText: 'Fiche à compléter' });
    verifier(await alerte.isVisible(), 'L’alerte « Fiche à compléter » est absente');
    verifier((await alerte.innerText()).includes('Il manque la date de naissance et le poste'), `Texte de l’alerte : ${await alerte.innerText()}`);
    verifier(await bouton(page, 'Compléter la fiche').isVisible(), 'Le bouton « Compléter la fiche » est absent');
    await ctx.capture('fiches/employe-a-completer');
    await menu(page, 'Tableau de bord');
    egal((await lireInventaire(page)).find((l) => l[0] === 'CHERIF Amine'), ['CHERIF Amine', 'Fiche à compléter', 'Compléter'],
      'La fiche incomplète est dans l’inventaire à compléter');
    await page.locator('.files .file', { hasText: 'CHERIF Amine' }).click();
    await attendreTitre(page, 'Modifier la fiche');
    egal([await page.inputValue('#n-nom'), await page.inputValue('#n-prenom'), await page.inputValue('#n-naissance')],
      ['Cherif', 'Amine', ''], 'Formulaire prérempli');
    await bouton(page, 'Enregistrer les modifications').click();
    await attendre(async () => (await texteErreur(page)).includes('Remplissez le champ obligatoire « Date de naissance ».'),
      'La modification d’une fiche reprise reste soumise aux champs obligatoires');
    egal(await page.evaluate(() => document.activeElement?.id), 'n-naissance', 'Focus sur « Date de naissance » en modification');
    await page.fill('#n-naissance', '1987-03-21');
    await taper(page, '#n-poste', 'Comptable');
    const idCherif = await attendre(async () => {
      const v = (await apercu(page)).valeur;
      return FORME_ID.test(v) ? v : false;
    }, 'Fiche complétée : aperçu de l’identifiant');
    await bouton(page, 'Enregistrer les modifications').click();
    await attendreTitre(page, 'CHERIF Amine');
    egal((await recap(page)).Identifiant, idCherif, 'Identifiant attribué une fois la fiche complétée');
    verifierIdentifiant(idCherif, { nom: 'Cherif', prenom: 'Amine', naissance: '1987-03-21', poste: 'Comptable' }, 'CHERIF Amine');
    verifier(!(await page.locator('.alert', { hasText: 'Fiche à compléter' }).count()), 'L’alerte « Fiche à compléter » doit disparaître');
    await menu(page, 'Tableau de bord');
    verifier(!(await lireInventaire(page)).some((l) => l[0] === 'CHERIF Amine'), 'La fiche complétée sort de l’inventaire');
    const tous = (await app.appeler('entites_lister', { kind: 'a' })).map((e) => e.code).filter(Boolean);
    egal(new Set(tous).size, tous.length, 'Tous les identifiants d’employés sont distincts');

    ctx.etape('modifier le poste : l’identifiant change');
    await ouvrirFiche(page, 'a', EMPLOYE.libelle);
    await bouton(page, 'Modifier la fiche').click();
    await attendreTitre(page, 'Modifier la fiche');
    egal([await page.inputValue('#n-nom'), await page.inputValue('#n-prenom'), await page.inputValue('#n-naissance'), await page.inputValue('#n-poste')],
      [EMPLOYE.nom, EMPLOYE.prenom, EMPLOYE.naissance, EMPLOYE.poste], 'Formulaire de modification prérempli');
    await page.fill('#n-poste', '');
    await attendreApercu(page, 'À venir', 'Poste vidé');
    await taper(page, '#n-poste', 'Technicienne');
    const idModifie = await attendre(async () => {
      const v = (await apercu(page)).valeur;
      return FORME_ID.test(v) && v !== idEmploye ? v : false;
    }, 'Nouveau poste : l’aperçu doit montrer un autre identifiant');
    verifierIdentifiant(idModifie, { ...EMPLOYE, poste: 'Technicienne' }, 'Identifiant après modification');
    await bouton(page, 'Enregistrer les modifications').click();
    await attendreTitre(page, EMPLOYE.libelle);
    egal([(await recap(page)).Identifiant, (await recap(page)).Poste], [idModifie, 'Technicienne'], 'Identifiant recalculé après modification');
    ctx.memo.codes = { ...ctx.memo.codes, employe: idModifie };
    await bouton(page, 'Retour').click(); // la modification ne s'empile pas
    await attendreTitre(page, 'Employés');
    await ouvrirFiche(page, 'a', EMPLOYE.libelle);

    ctx.etape('archiver puis réactiver');
    await bouton(page, 'Archiver la fiche').click();
    await attendre(async () => (await recap(page)).Statut === 'Archivé', 'La fiche archivée doit porter le badge « Archivé »');
    verifier(await page.locator('.alert', { hasText: 'Fiche archivée' }).isVisible(), 'L’alerte « Fiche archivée » est absente');
    verifier(await bouton(page, 'Affecter une machine').isDisabled(), 'Une fiche archivée ne peut pas recevoir d’affectation');
    egal((await app.appeler('entites_lister', { kind: 'a' })).length, 11, 'Archiver ne supprime rien');
    await bouton(page, 'Réactiver la fiche').click();
    await attendre(async () => (await recap(page)).Statut === 'Actif', 'La fiche réactivée doit porter le badge « Actif »');
    await page.getByRole('tab', { name: 'Historique complet' }).click();
    const journal = await page.locator('[role=tabpanel]').innerText();
    for (const t of ['Fiche créée', 'Fiche modifiée', 'Identifiant attribué', 'Fiche archivée', 'Fiche réactivée']) {
      verifier(journal.includes(t), `Le journal de l’employé doit contenir « ${t} »`);
    }
  },
};

export const machines = {
  id: 'machines',
  titre: 'Machines : identifiant saisi, doublon refusé, caractéristiques, inventaire, modification',
  async executer(ctx) {
    const { page, app } = ctx;
    verifier(ctx.memo.a, 'Ce scénario utilise l’employé créé par le scénario « employes ».');

    ctx.etape('créer une machine : identifiant en doublon refusé (casse ignorée), puis accepté');
    await menu(page, 'Machines');
    await bouton(page, 'Créer une machine').click();
    await attendreTitre(page, 'Créer une machine');
    verifier((await page.locator('.crumbs').innerText()).replace(/\s+/g, ' ').trim().endsWith('Créer une machine'), 'Fil d’Ariane « … Créer une machine »');
    await taper(page, '#n-nom', MACHINE);
    await taper(page, '#n-code', 'PC-0101');
    await taper(page, '#n-marque', 'Dell Latitude 5440');
    await taper(page, '#n-cpu', 'Intel Core i7-1365U');
    await taper(page, '#n-ram', '32 Go');
    await taper(page, '#n-stockage', 'SSD 1 To');
    egal(await page.locator('#n-cat option').allInnerTexts(), ['Ordinateur portable', 'PC de bureau', 'Station de travail'], 'Types proposés');
    await page.selectOption('#n-cat', { label: 'Ordinateur portable' });
    await bouton(page, 'Enregistrer la fiche').click();
    await attendre(async () => (await texteErreur(page)).includes('Cet identifiant est déjà utilisé par PC accueil.'),
      'Le doublon doit afficher « Cet identifiant est déjà utilisé par PC accueil. »');
    egal(await texteErreur(page), 'Enregistrement impossible Cet identifiant est déjà utilisé par PC accueil.', 'Message du doublon');
    await ctx.capture('fiches/identifiant-en-doublon');
    await page.fill('#n-code', 'pc-0101');
    const marque = app.marque();
    await bouton(page, 'Enregistrer la fiche').click();
    // L'erreur précédente est la même : on attend la réponse du back à ce second envoi (requête IPC terminée).
    await attendre(() => app.depuis(marque).some((j) => j.type === 'requete' && j.texte.includes('entite_creer')), 'Le second envoi doit partir');
    await attendre(async () => (await bouton(page, 'Enregistrer la fiche').isEnabled())
      && (await texteErreur(page)) === 'Enregistrement impossible Cet identifiant est déjà utilisé par PC accueil.'
      && (await page.inputValue('#n-code')) === 'pc-0101', 'Le doublon en minuscules doit aussi être refusé');
    await page.waitForTimeout(300);
    egal((await app.appeler('entites_lister', { kind: 'b' })).filter((e) => e.libelle === MACHINE).length, 0, 'Rien n’est créé en cas de doublon');
    await page.fill('#n-code', '');
    await taper(page, '#n-code', 'X'.repeat(45));
    egal((await page.inputValue('#n-code')).length, 40, 'L’identifiant est limité à 40 caractères');
    await page.fill('#n-code', ID_MACHINE);
    await bouton(page, 'Enregistrer la fiche').click();
    await attendreTitre(page, MACHINE);
    const r = await recap(page);
    egal([r.Identifiant, r['Marque et modèle'], r.Processeur, r.RAM, r.Stockage, r['Type de machine'], r.Statut],
      [ID_MACHINE, 'Dell Latitude 5440', 'Intel Core i7-1365U', '32 Go', 'SSD 1 To', 'Ordinateur portable', 'Actif'],
      'Caractéristiques affichées sur la fiche');
    ctx.memo.b = (await ficheDuBack(app, 'b', MACHINE)).id;
    await ctx.capture('fiches/machine');

    ctx.etape('répertoire des machines : colonnes et caractéristiques');
    await menu(page, 'Machines');
    egal(await page.$$eval('.content thead th', (ths) => ths.map((t) => t.textContent.trim()).filter(Boolean)),
      ['Nom', 'Identifiant', 'Marque et configuration', 'Type de machine', 'Statut', 'Mise à jour'], 'Colonnes du répertoire');
    const ligne = await page.locator('.content tbody tr', { hasText: MACHINE }).locator('td').allInnerTexts();
    egal(ligne.slice(0, 4).map((t) => t.trim()), [MACHINE, ID_MACHINE, 'Dell Latitude 5440\nIntel Core i7-1365U · 32 Go · SSD 1 To', 'Ordinateur portable'],
      'Ligne de la machine dans le répertoire (caractéristiques sous la marque)');

    ctx.etape('machine sans identifiant, saisi ensuite depuis l’inventaire');
    await bouton(page, 'Créer une machine').click();
    await attendreTitre(page, 'Créer une machine');
    await taper(page, '#n-nom', MACHINE_SANS_ID);
    await taper(page, '#n-marque', 'HP EliteBook 840');
    await bouton(page, 'Enregistrer la fiche').click();
    await attendreTitre(page, MACHINE_SANS_ID);
    egal((await recap(page)).Identifiant, 'Sans identifiant', 'Identifiant d’une machine créée sans identifiant');
    verifier(await page.locator('.alert', { hasText: 'Identifiant manquant' }).isVisible(), 'L’alerte « Identifiant manquant » est absente');
    await menu(page, 'Tableau de bord');
    await page.locator('.seg button', { hasText: 'Machines' }).click();
    await attendre(async () => (await lireInventaire(page)).some((l) => l[0] === MACHINE_SANS_ID), 'La machine sans identifiant est dans l’inventaire');
    egal((await lireInventaire(page)).find((l) => l[0] === MACHINE_SANS_ID), [MACHINE_SANS_ID, 'Sans identifiant', 'Saisir'], 'Ligne de l’inventaire');
    await page.locator('.files .file', { hasText: MACHINE_SANS_ID }).click();
    await attendreTitre(page, MACHINE_SANS_ID);
    await attendre(() => page.evaluate(() => document.activeElement?.id === 'code-input'),
      'Le champ de l’identifiant doit avoir le focus en arrivant depuis l’inventaire');
    egal((await page.locator('label[for="code-input"]').innerText()).replace(/\*/g, '').trim(), 'Identifiant de la machine', 'Libellé du champ');
    await bouton(page, 'Enregistrer l’identifiant').click();
    await attendre(async () => (await texteErreur(page)).includes('Remplissez le champ obligatoire « Identifiant de la machine ».'),
      'Un identifiant vide est refusé');
    egal(await page.evaluate(() => document.activeElement?.id), 'code-input', 'Le focus reste sur l’identifiant');
    await page.keyboard.type('LT-0105');
    await bouton(page, 'Enregistrer l’identifiant').click();
    await attendre(async () => (await texteErreur(page)).includes('Cet identifiant est déjà utilisé par Portable direction.'),
      'Le doublon saisi depuis l’inventaire doit être refusé');
    await page.fill('#code-input', ID_MACHINE_2);
    await bouton(page, 'Enregistrer l’identifiant').click();
    await attendre(async () => (await recap(page)).Identifiant === ID_MACHINE_2, 'L’identifiant saisi ne s’affiche pas');
    verifier(!(await page.locator('.alert', { hasText: 'Identifiant manquant' }).count()), 'L’alerte « Identifiant manquant » doit disparaître');
    await page.getByRole('tab', { name: 'Journal des opérations' }).click();
    verifier((await page.locator('[role=tabpanel]').innerText()).includes('Identifiant saisi'), 'Le journal de la machine contient « Identifiant saisi »');

    ctx.etape('modifier la machine : formulaire prérempli');
    await bouton(page, 'Modifier la fiche').click();
    await attendreTitre(page, 'Modifier la fiche');
    egal([await page.inputValue('#n-nom'), await page.inputValue('#n-code'), await page.inputValue('#n-marque')],
      [MACHINE_SANS_ID, ID_MACHINE_2, 'HP EliteBook 840'], 'Formulaire de la machine prérempli');
    await taper(page, '#n-ram', '16 Go');
    await page.fill('#n-code', 'pc-e2e-01');
    await bouton(page, 'Enregistrer les modifications').click();
    await attendre(async () => (await texteErreur(page)).includes(`Cet identifiant est déjà utilisé par ${MACHINE}.`),
      'La modification vers un identifiant en doublon doit être refusée');
    await page.fill('#n-code', ID_MACHINE_2);
    await bouton(page, 'Enregistrer les modifications').click();
    await attendreTitre(page, MACHINE_SANS_ID);
    egal([(await recap(page)).RAM, (await recap(page)).Identifiant], ['16 Go', ID_MACHINE_2], 'Machine modifiée');
  },
};
