// Version 1.5 (spécification § 13) dans l'application réelle : suppression directe des documents, des employés et des
// machines.
//
// Dépendances : aucune autre que « premier-lancement » et « donnees-exemple » (toujours joués). Le scénario fabrique lui-même, par le back, ses
// fiches, son modèle, ses dossiers et ses documents (noms en « v15 »), et n'utilise rien que les autres scénarios auraient
// laissé : « npm run e2e -- --seulement v15 » suffit. Il ne supprime que ce qu'il a créé.
//
// - documents : corbeille dans le contenu du dossier (confirmation, Annuler, suppression ; la ligne disparaît ; le clic
//   n'ouvre pas le document ; le document affiché reste affiché), sur le profil d'une fiche (liste, compteur « N sur M »,
//   historique), dans l'arborescence ; fichier importé (sa copie disparaît du disque) ; dossier clôturé (refus expliqué,
//   dans le dossier, l'arborescence et le profil ; refus du back) ;
// - employé (actif, deux machines affectées dont une partagée, une affectation passée, nommé dans 3 documents de
//   2 dossiers dont un clôturé) : textes et nombres exacts de la confirmation, « Archiver plutôt », « Supprimer
//   définitivement », retour au répertoire et message, absent du répertoire, de la recherche, des suggestions et des
//   compteurs ; machine libérée et réaffectée ; machine partagée toujours affectée à l'autre employé ; historique avec le
//   nom « (supprimé) » non cliquable ; documents : nom, identifiant et « fiche supprimée », variables inchangées, « Choisir
//   une autre fiche » dans un dossier ouvert et pas dans un dossier clôturé ; Retour (Alt+←) vers la fiche supprimée ;
//   structure vidée devenue supprimable ; employé recréé à l'identique : même identifiant, fiche neuve ;
// - machine archivée : confirmation sans « Archiver plutôt », même logique côté employé ;
// - après redémarrage, tout ce qui précède est toujours vrai (données écrites) ;
// - captures (clair et sombre) des nouveaux éléments, contrôle de mise en page, du papier à l'écran et à l'impression.

import fs from 'node:fs';
import path from 'node:path';
import { lire } from '../outils/bases.mjs';
import { ecrirePng } from '../outils/fichiers.mjs';
import {
  attendreBadge, attendreTitre, bouton, carteChoisie, detailsCarte, echapper, menu, modale, ouvrirDocument, ouvrirDossier, ouvrirFiche,
  taperDansChoix,
} from '../outils/ui.mjs';
import { attendre, controleImpression, controleMiseEnPage, controleZonesManuscrites, Echec, egal, pause, verifier } from '../outils/verifs.mjs';
import { aujourdhui, lignesAffectations } from './affectations.mjs';
import { lireCompteurs } from './demarrage.mjs';
import { ajouterDepuisModele, importerParLeSelecteur } from './dossiers.mjs';
import { redemarrer, sectionDocuments, variablesPapier } from './v13.mjs';

/** Dossier des captures de la version 1.5 dans l'application réelle. */
const CAP = 'v15-reel';

const STRUCTURE = 'Structure v15 e2e';
const TYPE = 'Type v15 e2e';
const MODELE = 'Modèle v15 e2e';
const INTERVENTION = 'Fiche d’intervention informatique';
const D_OUVERT = 'Dossier v15 e2e';
const D_CLOS = 'Dossier v15 clôturé e2e';

/** Employé supprimé (E1), employé qui garde la machine partagée (E2), employé de la machine supprimée (E3). */
const E1 = { nom: 'Kaci', prenom: 'Lina', dateNaissance: '1990-03-15', poste: 'Technicienne', libelle: 'KACI Lina' };
const E2 = { nom: 'Tahar', prenom: 'Rafik', dateNaissance: '1985-07-02', poste: 'Comptable', libelle: 'TAHAR Rafik' };
const E3 = { nom: 'Hamidi', prenom: 'Nora', dateNaissance: '1992-11-20', poste: 'Secrétaire', libelle: 'HAMIDI Nora' };
/** Machine libérée par la suppression de E1 (M1), machine partagée E1 + E2 (M3), machine supprimée (M2). */
const M1 = { nom: 'PC v15 e2e', code: 'PC-V15-01' };
const M2 = { nom: 'Portable v15 e2e', code: 'LT-V15-02' };
const M3 = { nom: 'PC partagé v15 e2e', code: 'PC-V15-03' };

const VARIABLES = ['Employé · Nom', 'Employé · Prénom', 'Employé · Identifiant', 'Machine · Nom', 'Machine · Identifiant'];

// ───────────────────────────── outils ─────────────────────────────

/** Ligne d'un document dans le contenu du dossier affiché (bouton qui l'ouvre + corbeille). */
const ligneDossier = (page, nom) => page.locator('.files .file-ligne', {
  has: page.locator('.file b', { hasText: new RegExp(`^${echapper(nom)}$`) }),
});
/** Ligne d'un document sur le profil affiché (le titre est le modèle : on cherche le nom dans le sous-titre). */
const ligneProfil = (page, kind, nom) => sectionDocuments(page, kind).locator('.files .file-ligne', {
  has: page.locator('.file small', { hasText: new RegExp(`^${echapper(nom)} · `) }),
});
const corbeille = (zone) => zone.getByRole('button', { name: 'Supprimer le document', exact: true });

/** Document affiché dans la section « Document » du dossier ('' si aucun). */
const documentAffiche = (page) => page.locator('.preview .pv-h b').innerText({ timeout: 1000 }).then((t) => t.trim()).catch(() => '');

/** Textes de la fenêtre de confirmation d'une fiche. */
async function texteConfirmationFiche(page) {
  const m = modale(page);
  return {
    titre: (await m.locator('h3').innerText()).trim(),
    identite: (await m.locator('.sup-identite').innerText()).trim(),
    effets: (await m.locator('.sup-effets li').allInnerTexts()).map((t) => t.trim()),
    avert: (await m.locator('.sup-avert').innerText()).trim(),
    boutons: (await m.locator('.acts button').allInnerTexts()).map((t) => t.trim()),
  };
}

/** Bouton « Supprimer » de l'en-tête de la fiche affichée. */
const supprimerFiche = (page) => page.locator('.ph .ph-actions').getByRole('button', { name: 'Supprimer', exact: true });

/** Groupes et noms des résultats de la recherche globale pour `q`. */
async function rechercher(page, q) {
  await page.keyboard.press('Control+k');
  await page.keyboard.press('Control+a');
  await page.keyboard.type(q);
  const dd = page.locator('#dd');
  await attendre(async () => !(await dd.isHidden()) && (await dd.getAttribute('aria-busy')) === 'false', `La recherche « ${q} » répond`);
  await pause(400);
  const noms = await dd.locator('.res b').allInnerTexts().catch(() => []);
  await page.keyboard.press('Escape');
  await page.fill('#q', '');
  return noms.map((t) => t.trim());
}

/** Noms entre guillemets avec espaces insécables, comme dans la confirmation (aucun guillemet seul en bout de ligne). */
const ins = (s) => s.replace(/« /g, '« ').replace(/ »/g, ' »');

/** Nouveaux éléments dont le contraste texte / fond est contrôlé (WCAG AA : 4,5 pour un texte courant). */
const CONTRASTES = ['.btn.danger:not(:disabled)', '.btn.corbeille:not(.indispo)', '.cf-supp', '.tl-supprime', '.corbeille-motif', '.avis-zone .alert',
  '.sup-identite', '.sup-effets li', '.sup-avert'];

/**
 * Contraste (WCAG) du texte des éléments visibles qui correspondent aux sélecteurs, sur le premier fond opaque de leurs
 * ancêtres. Exécuté dans la page ; renvoie les éléments sous 4,5 (3 pour une icône seule).
 */
function controleContrastes(selecteurs) {
  const rgba = (c) => (c.match(/[\d.]+/g) ?? []).map(Number);
  const lum = ([r, g, b]) => {
    const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const fond = (el) => {
    for (let p = el; p; p = p.parentElement) {
      const c = rgba(getComputedStyle(p).backgroundColor);
      if (c.length >= 3 && (c.length < 4 || c[3] >= 0.99)) return c;
    }
    return [255, 255, 255];
  };
  const out = [];
  for (const sel of selecteurs) {
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
      const [a, b] = [lum(rgba(getComputedStyle(el).color)), lum(fond(el))].sort((x, y) => y - x);
      const ratio = (a + 0.05) / (b + 0.05);
      const icone = !el.textContent.trim();
      if (ratio < (icone ? 3 : 4.5)) out.push(`${sel} « ${el.textContent.trim().slice(0, 30)} » : contraste ${ratio.toFixed(2)}`);
    }
  }
  return [...new Set(out)];
}

/** Capture en clair puis en sombre (thème appliqué sur <html> le temps de la capture), avec contrôle de mise en page. */
async function capturerDeuxThemes(ctx, nom, problemes, { pleinePage = false } = {}) {
  const { page, app } = ctx;
  const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? null);
  try {
    if (pleinePage) {
      const h = await page.evaluate(() => document.getElementById('content').scrollHeight);
      await app.imposerTaille(1280, Math.min(h + 120, 3000));
    }
    for (const [t, suffixe] of [['light', 'clair'], ['dark', 'sombre']]) {
      await page.evaluate((x) => { document.documentElement.dataset.theme = x; }, t);
      await pause(150);
      await ctx.capture(`${CAP}/${nom}-${suffixe}`);
      for (const p of await page.evaluate(controleMiseEnPage)) problemes.push(`${nom} (${suffixe}) : ${p}`);
      for (const p of await page.evaluate(controleContrastes, CONTRASTES)) problemes.push(`${nom} (${suffixe}) : ${p}`);
    }
  } finally {
    await page.evaluate((x) => {
      if (x) document.documentElement.dataset.theme = x;
      else delete document.documentElement.dataset.theme;
    }, theme);
    if (pleinePage) await app.imposerTaille(0, 0);
  }
}

/** Papier du document affiché, à l'écran et à l'impression : aucune zone à remplir à la main, rien hors du papier. */
async function controlerPapier(ctx, quoi) {
  const { page, app } = ctx;
  const problemes = (await page.evaluate(controleZonesManuscrites)).map((p) => `${quoi}, écran : ${p}`);
  try {
    await page.emulateMedia({ media: 'print' });
    await app.imposerTaille(673, 1000);
    problemes.push(...(await page.evaluate(controleImpression)).map((p) => `${quoi}, impression : ${p}`));
    problemes.push(...(await page.evaluate(controleZonesManuscrites)).map((p) => `${quoi}, impression : ${p}`));
    // La mention « fiche supprimée » est imprimée avec le nom (c'est une information du document).
    const imprime = await page.locator('.paper').innerText();
    if (!imprime.includes('fiche supprimée')) problemes.push(`${quoi}, impression : la mention « fiche supprimée » n’est pas imprimée`);
  } finally {
    await page.emulateMedia({ media: null });
    await app.imposerTaille(0, 0);
  }
  return problemes;
}

/** Bloc d'un document du back par son type et son libellé. */
async function blocDuBack(app, documentId, dossierId, t, v) {
  const d = (await app.appeler('dossier_detail', { id: dossierId })).documents.find((x) => x.id === documentId);
  verifier(d, `Document ${documentId} introuvable dans le dossier ${dossierId}`);
  return d.blocs.find((b) => b.t === t && b.v === v);
}

/** Événements d'une fiche contenant `texte` dans le titre ou le détail. */
const evenementsAvec = async (app, id, texte) => (await app.appeler('entite_fiche', { id })).evenements
  .filter((e) => `${e.titre} ${e.detail}`.includes(texte));

// ───────────────────────────── préparation (par le back) ─────────────────────────────

async function preparer(ctx) {
  const { app } = ctx;
  const cat = async (kind, nom) => {
    const deja = (await app.appeler('categories_lister', { kind })).find((c) => c.nom === nom);
    return deja ?? app.appeler('categorie_creer', { kind, nom });
  };
  const s15 = await cat('a', STRUCTURE);
  const t15 = await cat('b', TYPE);
  const autreStructure = (await app.appeler('categories_lister', { kind: 'a' })).find((c) => c.id !== s15.id && c.actif !== false);
  const autreType = (await app.appeler('categories_lister', { kind: 'b' })).find((c) => c.id !== t15.id && c.actif !== false);
  verifier(autreStructure && autreType, 'Une autre structure et un autre type existent (données d’exemple)');
  const employe = (e, categorieId) => app.appeler('entite_creer', {
    saisie: { kind: 'a', nom: e.nom, prenom: e.prenom, dateNaissance: e.dateNaissance, poste: e.poste, categorieId },
  });
  const machine = (m, categorieId) => app.appeler('entite_creer', {
    saisie: { kind: 'b', nom: m.nom, code: m.code, marque: 'Lenovo ThinkPad T14', cpu: 'Ryzen 7', ram: '16 Go', stockage: 'SSD 512 Go', categorieId },
  });
  const e1 = await employe(E1, s15.id);
  const e2 = await employe(E2, autreStructure.id);
  const e3 = await employe(E3, autreStructure.id);
  const m1 = await machine(M1, autreType.id);
  const m2 = await machine(M2, t15.id);
  const m3 = await machine(M3, autreType.id);
  // E1 : M1 et M3 en cours, M2 passée ; E2 : M3 en cours ; E3 : M2 en cours, et une affectation passée.
  const affecter = (a, b) => app.appeler('association_creer', { aId: a.id, bId: b.id });
  const retirer = (a, b) => app.appeler('association_retirer', { aId: a.id, bId: b.id });
  await affecter(e1, m2);
  await retirer(e1, m2);
  await affecter(e3, m2);
  await retirer(e3, m2);
  await affecter(e3, m2);
  await affecter(e1, m1);
  await affecter(e1, m3);
  await affecter(e2, m3);

  // Modèle à variables (les modèles standards n'en ont pas).
  const theme = (await app.appeler('themes_lister')).find((t) => t.actif !== false);
  let modele = (await app.appeler('modeles_lister')).find((m) => m.nom === MODELE);
  if (!modele) {
    modele = await app.appeler('modele_creer');
    modele = await app.appeler('modele_enregistrer', {
      id: modele.id,
      saisie: {
        nom: MODELE, themeId: theme.id,
        blocs: [
          { t: 'titre', v: 'Remise de matériel' },
          ...VARIABLES.map((v) => ({ t: 'variable', v })),
          { t: 'employe', v: 'Utilisateur' },
          { t: 'machine', v: 'Matériel' },
          { t: 'zone', v: 'Observations' },
        ],
      },
    }) ?? (await app.appeler('modeles_lister')).find((m) => m.nom === MODELE);
  }
  const intervention = (await app.appeler('modeles_lister')).find((m) => m.nom === INTERVENTION && m.standard && m.actif);
  verifier(modele && intervention, 'Modèle v15 et modèle standard « Fiche d’intervention informatique »');

  // Dossiers et documents.
  const statuts = await app.appeler('statuts_lister');
  const dossier = (nom) => app.appeler('dossier_creer', { saisie: { nom, annee: new Date().getFullYear(), themeId: theme.id, statutId: null } });
  const dOuvert = await dossier(D_OUVERT);
  const dClos = await dossier(D_CLOS);
  const documents = {};
  const creer = async (cle, d, m, nom, remplir) => {
    const doc = await app.appeler('document_creer_depuis_modele', { dossierId: d.id, sousDossierId: null, modeleId: m.id, pieceFinale: false });
    await app.appeler('document_renommer', { id: doc.id, nom });
    const detail = await app.appeler('dossier_detail', { id: d.id });
    const lu = detail.documents.find((x) => x.id === doc.id);
    const blocs = lu.blocs.map((b) => remplir(b) ?? b);
    await app.appeler('document_enregistrer_blocs', { id: doc.id, blocs });
    documents[cle] = { id: doc.id, nom, dossierId: d.id };
  };
  const fiches = (a, b, obs) => (b0) => {
    if (b0.t === 'employe' && b0.v === 'Utilisateur') return { ...b0, entiteId: a?.id ?? null };
    if (b0.t === 'machine' && (b0.v === 'Matériel') && b) return { ...b0, entiteId: b.id };
    if (obs && b0.t === 'zone' && b0.v === 'Observations') return { ...b0, val: obs };
    return null;
  };
  // Dossier ouvert : A (E1 + M2, variables), B (E1 par le nom écrit), C (à supprimer depuis le dossier), D, F, G (E3 :
  // profil), H (à supprimer depuis l'arborescence).
  await creer('A', dOuvert, modele, 'Remise v15 A', fiches(e1, m2, 'Remise du portable.'));
  await creer('B', dOuvert, intervention, 'Intervention v15 B', (b) => (b.t === 'champ' && b.v === 'Signalée par' ? { ...b, val: 'Mme Lina Kaci' } : null));
  await creer('C', dOuvert, intervention, 'Intervention v15 C', () => null);
  await creer('D', dOuvert, intervention, 'Intervention v15 D', fiches(e3, null));
  await creer('F', dOuvert, intervention, 'Intervention v15 F', fiches(e3, null));
  await creer('G', dOuvert, modele, 'Remise v15 G', fiches(e3, null));
  await creer('H', dOuvert, intervention, 'Intervention v15 H', () => null);
  // Dossier clôturé : E (E1 + M2).
  await creer('E', dClos, modele, 'Remise v15 E', fiches(e1, m2, 'Remise dans un dossier clos.'));
  await app.appeler('dossier_definir_statut', { id: dClos.id, statutId: statuts.find((s) => s.role === 'clos').id });

  return { s15, t15, autreStructure, e1, e2, e3, m1, m2, m3, dOuvert, dClos, documents, modele };
}

// ───────────────────────────── scénario ─────────────────────────────

export const v15 = {
  id: 'v15',
  titre: 'Suppression directe (§ 13) : documents (dossier, profil, arborescence, import, clôturé), employé, machine, Retour, structure vidée, recréation, redémarrage',
  async executer(ctx) {
    let { page, app } = ctx;
    const problemes = [];
    const jour = aujourdhui();
    const fichiers = path.join(ctx.donnees, 'fichiers');

    ctx.etape('préparation par le back : structure, type, 3 employés, 3 machines, affectations, modèle à variables, 2 dossiers, 8 documents');
    const x = await preparer(ctx);
    const { e1, e2, e3, m1, m2, m3, dOuvert, dClos, documents: docs } = x;
    egal(typeof e1.code === 'string' && e1.code.startsWith('EMP-'), true, 'E1 a un identifiant');
    const compteursAvant = await (async () => { await menu(page, 'Tableau de bord'); return lireCompteurs(page); })();

    // ─────────── documents : corbeille dans le contenu du dossier ───────────
    ctx.etape('dossier ouvert : une corbeille sur chaque ligne de document, visible sans survol, avec infobulle');
    await ouvrirDossier(page, D_OUVERT, docs.A.nom);
    const lignes = page.locator('.files .file-ligne');
    const nbLignes = (await app.appeler('dossier_detail', { id: dOuvert.id })).documents.length;
    egal(await lignes.count(), nbLignes, 'Une ligne par document');
    egal(await page.locator('.files .file-ligne .corbeille').count(), nbLignes, 'Une corbeille par ligne');
    const c = corbeille(ligneDossier(page, docs.C.nom));
    verifier(await c.isVisible(), 'La corbeille est visible sans survol');
    egal([await c.getAttribute('title'), await c.getAttribute('aria-disabled')], ['Supprimer le document', null], 'Infobulle de la corbeille, active');
    const boiteLigne = await ligneDossier(page, docs.C.nom).boundingBox();
    const boiteC = await c.boundingBox();
    verifier(boiteC.x > boiteLigne.x + boiteLigne.width / 2 && boiteC.x + boiteC.width <= boiteLigne.x + boiteLigne.width + 1,
      'La corbeille est à droite, dans le cadre de la ligne');
    verifier(Math.abs((boiteC.y + boiteC.height / 2) - (boiteLigne.y + boiteLigne.height / 2)) <= 2, 'La corbeille est centrée verticalement sur la ligne');
    await capturerDeuxThemes(ctx, '01-dossier-lignes-corbeille', problemes);

    ctx.etape('corbeille : confirmation qui nomme le document et son dossier ; Annuler ; le document n’est pas ouvert');
    egal(await documentAffiche(page), docs.A.nom, 'Document affiché avant');
    await c.click();
    await attendre(() => modale(page).isVisible(), 'La confirmation s’ouvre');
    egal((await modale(page).locator('h3').innerText()).trim(), 'Supprimer le document ?', 'Titre de la confirmation');
    egal((await modale(page).locator('p').first().innerText()).trim(),
      `Le document « ${docs.C.nom} » du dossier « ${D_OUVERT} » sera supprimé. Cette action est irréversible.`, 'Message de la confirmation');
    egal((await modale(page).locator('.acts button').allInnerTexts()).map((t) => t.trim()), ['Supprimer le document', 'Annuler'], 'Boutons');
    await capturerDeuxThemes(ctx, '02-confirmation-document', problemes);
    await bouton(modale(page), 'Annuler').click();
    await attendre(async () => !(await modale(page).count()), 'Annuler ferme la confirmation');
    egal(await documentAffiche(page), docs.A.nom, 'Le clic sur la corbeille n’a pas ouvert le document');
    verifier(await ligneDossier(page, docs.C.nom).isVisible(), 'Annuler : le document est toujours là');
    verifier((await app.appeler('dossier_detail', { id: dOuvert.id })).documents.some((d) => d.id === docs.C.id), 'Annuler : rien n’est supprimé dans le back');

    ctx.etape('corbeille : suppression confirmée, la ligne disparaît, le document affiché reste affiché');
    await c.click();
    await bouton(modale(page), 'Supprimer le document').click();
    await attendre(async () => !(await modale(page).count()), 'La confirmation se ferme');
    await attendre(async () => !(await ligneDossier(page, docs.C.nom).count()), 'La ligne du document supprimé disparaît');
    verifier(!(await app.appeler('dossier_detail', { id: dOuvert.id })).documents.some((d) => d.id === docs.C.id), 'Document supprimé dans le back');
    egal(await documentAffiche(page), docs.A.nom, 'Le document affiché (un autre) reste affiché');

    ctx.etape('corbeille du document affiché : il est supprimé et la section « Document » se vide');
    // Document créé pour l'occasion (H sert plus loin à l'arborescence), affiché dès sa création.
    const nomJetable = await ajouterDepuisModele(page, INTERVENTION);
    const jetable = (await app.appeler('dossier_detail', { id: dOuvert.id })).documents.find((d) => d.nom === nomJetable);
    egal(await documentAffiche(page), jetable.nom, 'Le document créé est affiché');
    await corbeille(ligneDossier(page, jetable.nom)).click();
    await bouton(modale(page), 'Supprimer le document').click();
    await attendre(async () => !(await ligneDossier(page, jetable.nom).count()), 'La ligne disparaît');
    await attendre(async () => (await documentAffiche(page)) !== jetable.nom, 'Le document supprimé n’est plus affiché');

    // ─────────── fichier importé ───────────
    ctx.etape('fichier importé supprimé par la corbeille : sa copie disparaît de fichiers/');
    const png = path.join(ctx.entrees, 'Image v15.png');
    ecrirePng(png);
    const importe = await importerParLeSelecteur(ctx, dOuvert.id, png);
    verifier(fs.existsSync(importe.fichierChemin), `La copie existe (${importe.fichierChemin})`);
    await corbeille(ligneDossier(page, importe.nom)).click();
    egal((await modale(page).locator('p').first().innerText()).trim(),
      `Le document « ${importe.nom} » du dossier « ${D_OUVERT} » sera supprimé, ainsi que sa copie du fichier importé. Cette action est irréversible.`,
      'La confirmation annonce la suppression de la copie');
    await bouton(modale(page), 'Supprimer le document').click();
    await attendre(async () => !(await ligneDossier(page, importe.nom).count()), 'La ligne du fichier importé disparaît');
    await attendre(() => !fs.existsSync(importe.fichierChemin), 'La copie du fichier importé disparaît du disque');
    verifier(fs.existsSync(png), 'Le fichier d’origine n’est pas touché');
    verifier(!fs.readdirSync(fichiers).includes(path.basename(importe.fichierChemin)), 'Plus aucune trace de la copie dans fichiers/');

    // ─────────── profil d'une fiche ───────────
    ctx.etape('profil de HAMIDI Nora : corbeille sur chaque ligne, « 2 sur 3 documents », suppression, « 1 sur 2 », historique à jour');
    await ouvrirFiche(page, 'a', E3.libelle);
    const sec = sectionDocuments(page, 'a');
    const statut = sec.locator('.recherche-barre [role=status]');
    await attendre(async () => (await statut.innerText()).trim() === '3 documents', 'Le profil compte 3 documents');
    egal(await sec.locator('.files .file-ligne .corbeille').count(), 3, 'Une corbeille par document du profil');
    const nomineD = (await app.appeler('entite_fiche', { id: e3.id })).evenements.filter((e) => e.documentId === docs.D.id);
    verifier(nomineD.length > 0, 'La nomination de HAMIDI Nora dans D figure dans son historique (back)');
    await page.getByRole('tab', { name: /^Historique complet/ }).click();
    await attendre(async () => (await page.locator('[role=tabpanel] .tl li', { hasText: docs.D.nom }).count()) > 0, 'La nomination dans D est dans l’historique affiché');
    await sec.getByRole('searchbox', { name: 'Rechercher dans les documents', exact: true }).fill('intervention');
    await attendre(async () => (await statut.innerText()).trim() === '2 sur 3 documents', 'Recherche « intervention » : 2 sur 3 documents');
    await capturerDeuxThemes(ctx, '03-profil-lignes-corbeille', problemes);
    await corbeille(ligneProfil(page, 'a', docs.D.nom)).click();
    egal((await modale(page).locator('p').first().innerText()).trim(),
      `Le document « ${docs.D.nom} » du dossier « ${D_OUVERT} » sera supprimé. Cette action est irréversible.`, 'Confirmation depuis le profil');
    await bouton(modale(page), 'Supprimer le document').click();
    await attendre(async () => !(await ligneProfil(page, 'a', docs.D.nom).count()), 'La ligne disparaît du profil sans rechargement');
    await attendre(async () => (await statut.innerText()).trim() === '1 sur 2 documents', 'Compteur à jour : 1 sur 2 documents');
    await attendreTitre(page, E3.libelle);
    await attendre(async () => (await page.locator('[role=tabpanel] .tl li', { hasText: docs.D.nom }).count()) === 0, 'L’historique affiché n’a plus la nomination dans D');
    egal((await app.appeler('entite_fiche', { id: e3.id })).evenements.filter((e) => e.documentId === docs.D.id).length, 0, 'Ni dans le back');
    await sec.getByRole('searchbox', { name: 'Rechercher dans les documents', exact: true }).fill('');
    await attendre(async () => (await statut.innerText()).trim() === '2 documents', 'Sans recherche : 2 documents');

    // ─────────── arborescence ───────────
    ctx.etape('arborescence de « Dossiers & Archives » : corbeille sur la ligne d’un document, suppression');
    await menu(page, 'Dossiers & Archives');
    await page.locator('.seg button', { hasText: 'Arborescence' }).click();
    await attendre(() => page.locator('.tree').isVisible(), 'L’arborescence s’affiche');
    const deplier = async (nom) => {
      const b = page.getByRole('button', { name: `Déplier ${nom}`, exact: true });
      if (await b.count()) await b.click();
    };
    await deplier(D_OUVERT);
    const ligneArbre = (nom) => page.locator('.tree .trow.f', { has: page.locator('b', { hasText: new RegExp(`^${echapper(nom)}$`) }) });
    await attendre(() => ligneArbre(docs.H.nom).isVisible(), 'Le document H apparaît dans l’arborescence');
    // Le contenu déplié est d'abord celui du cache, puis celui relu après les suppressions précédentes : on compare
    // une fois l'affichage stable (mêmes nombres lus deux fois de suite).
    const comptes = async () => [
      await page.locator('.tree .trow.f .corbeille').count(),
      await page.locator('.tree .trow.f:has(> button.open)').count(),
    ];
    let derniers = null;
    await attendre(async () => {
      const c = await comptes();
      const stable = derniers && c[0] === derniers[0] && c[1] === derniers[1];
      derniers = c;
      return stable && c[0] === c[1];
    }, 'Une corbeille par document déplié', 8000).catch(() => {
      throw new Echec(`Une corbeille par document déplié : ${derniers?.[0]} corbeille(s) pour ${derniers?.[1]} document(s)`);
    });
    await capturerDeuxThemes(ctx, '04-arborescence-corbeille', problemes);
    await corbeille(ligneArbre(docs.H.nom)).click();
    egal((await modale(page).locator('p').first().innerText()).trim(),
      `Le document « ${docs.H.nom} » du dossier « ${D_OUVERT} » sera supprimé. Cette action est irréversible.`, 'Confirmation depuis l’arborescence');
    await bouton(modale(page), 'Supprimer le document').click();
    await attendre(async () => !(await ligneArbre(docs.H.nom).count()), 'La ligne disparaît de l’arborescence');
    egal(await titreCourant(page), 'Dossiers & Archives', 'On reste sur l’arborescence (le document n’a pas été ouvert)');
    verifier(!(await app.appeler('dossier_detail', { id: dOuvert.id })).documents.some((d) => d.id === docs.H.id), 'Document H supprimé dans le back');

    // ─────────── dossier clôturé ───────────
    ctx.etape('dossier clôturé : corbeille indisponible, motif expliqué, aucune confirmation ; refus du back');
    await deplier(D_CLOS);
    await attendre(() => ligneArbre(docs.E.nom).isVisible(), 'Le document E apparaît dans l’arborescence');
    const cArbre = corbeille(ligneArbre(docs.E.nom));
    egal([await cArbre.getAttribute('aria-disabled'), await cArbre.getAttribute('title'), await cArbre.evaluate((b) => b.classList.contains('indispo'))],
      ['true', 'Rouvrez le dossier pour le modifier.', true], 'Corbeille d’un dossier clôturé dans l’arborescence');
    await cArbre.click({ force: true });
    await attendre(() => ligneArbre(docs.E.nom).locator('.corbeille-motif').isVisible(), 'Le motif s’affiche dans l’arborescence');
    egal(await modale(page).count(), 0, 'Aucune confirmation ne s’ouvre');
    await page.locator('.seg button', { hasText: 'Groupes' }).click();
    await ouvrirDossier(page, D_CLOS);
    await attendreBadge(page, 'Clôturé');
    const cClos = corbeille(ligneDossier(page, docs.E.nom));
    egal(await cClos.getAttribute('aria-disabled'), 'true', 'Corbeille indisponible (aria-disabled) dans un dossier clôturé');
    const routeAvant = await page.locator('.files .file[aria-pressed=true]').count();
    await cClos.click({ force: true });
    const motif = ligneDossier(page, docs.E.nom).locator('.corbeille-motif');
    await attendre(() => motif.isVisible(), 'Le motif s’affiche sous la ligne');
    egal((await motif.innerText()).replace(/\s+/g, ' ').trim(), 'Suppression impossible. Rouvrez le dossier pour le modifier.', 'Motif');
    egal(await modale(page).count(), 0, 'Aucune confirmation ne s’ouvre');
    // Seul document du dossier, il est affiché d'office : le clic ne change pas la page (aucun document choisi).
    egal(await page.locator('.files .file[aria-pressed=true]').count(), routeAvant, 'Le clic sur la corbeille indisponible ne change pas le document affiché');
    await capturerDeuxThemes(ctx, '05-dossier-cloture-corbeille', problemes);
    const refus = await app.invoquer('document_supprimer', { id: docs.E.id });
    verifier(!refus.ok && refus.erreur.code === 'dossier_clos', `Le back refuse la suppression dans un dossier clôturé (${JSON.stringify(refus)})`);

    // ─────────── avant la suppression de l'employé ───────────
    ctx.etape(`avant : ${E1.libelle} dans le répertoire, la recherche, les suggestions ; documents A et E affichés avec ses valeurs`);
    await ouvrirFiche(page, 'a', E1.libelle);
    await attendre(async () => (await sectionDocuments(page, 'a').locator('.files .file-ligne').count()) === 3, 'KACI Lina est nommée dans 3 documents');
    egal(await corbeille(ligneProfil(page, 'a', docs.E.nom)).getAttribute('aria-disabled'), 'true', 'Sur le profil, le document du dossier clôturé a sa corbeille indisponible');
    egal(await corbeille(ligneProfil(page, 'a', docs.A.nom)).getAttribute('aria-disabled'), null, 'Celle d’un dossier ouvert est disponible');
    verifier((await rechercher(page, 'kaci')).includes(E1.libelle), 'La recherche trouve KACI Lina');
    verifier((await app.appeler('entites_suggerer', { kind: 'a', q: 'kaci' })).some((e) => e.id === e1.id), 'Les suggestions proposent KACI Lina');
    await ouvrirDossier(page, D_OUVERT, docs.A.nom);
    const variablesA = await attendre(async () => {
      const v = await variablesPapier(page);
      return v.length === VARIABLES.length && v.every(([, val]) => val !== '—') ? v : false;
    }, 'Les variables de A affichent les valeurs de KACI Lina et du portable');
    egal(variablesA.map(([n]) => n), VARIABLES, 'Variables du document A');
    verifier(variablesA.some(([n, v]) => n === 'Employé · Identifiant' && v === e1.code), `Identifiant de KACI Lina dans les variables (${JSON.stringify(variablesA)})`);
    const detailsE1 = await detailsCarte(page, 'Utilisateur');
    await ouvrirDossier(page, D_CLOS, docs.E.nom);
    const variablesE = await attendre(async () => {
      const v = await variablesPapier(page);
      return v.length === VARIABLES.length && v.every(([, val]) => val !== '—') ? v : false;
    }, 'Les variables de E affichent les valeurs de KACI Lina');

    // ─────────── suppression de l'employé : confirmation ───────────
    ctx.etape('fiche de KACI Lina : « Supprimer » à côté de « Archiver la fiche » ; confirmation exacte (nombres réels)');
    await ouvrirFiche(page, 'a', E1.libelle);
    const actions = (await page.locator('.ph .ph-actions button').allInnerTexts()).map((t) => t.trim());
    verifier(actions.indexOf('Supprimer') === actions.indexOf('Archiver la fiche') + 1, `« Supprimer » suit « Archiver la fiche » (${actions.join(', ')})`);
    const apercu = await app.appeler('entite_suppression_apercu', { id: e1.id });
    egal([apercu.affectationsEnCours.map((a) => a.nom).sort(), apercu.nbAffectationsPassees, apercu.nbDocuments, apercu.nbDossiers],
      [[M1.nom, M3.nom].sort(), 1, 3, 2], 'Aperçu du back');
    await supprimerFiche(page).click();
    await attendre(async () => (await modale(page).locator('.sup-effets li').count()) > 0, 'La confirmation s’ouvre avec l’aperçu');
    const noms = apercu.affectationsEnCours.map((a) => `« ${a.nom} »`);
    egal(await texteConfirmationFiche(page), {
      titre: 'Supprimer l’employé ?',
      identite: `Employé « ${E1.libelle} » · ${e1.code}`,
      effets: [
        ins(`Les affectations des machines ${noms[0]} et ${noms[1]} à cet employé prendront fin.`),
        'Son affectation passée disparaîtra de son historique.',
        'Cet employé est nommé dans 3 documents de 2 dossiers. Son nom reste écrit dans ces 3 documents, mais ils ne mèneront plus à sa fiche.',
      ],
      avert: 'Son historique sera supprimé. Cette action est irréversible. Pour garder la fiche et son historique, archivez-la plutôt.',
      boutons: ['Supprimer définitivement', 'Archiver plutôt', 'Annuler'],
    }, 'Confirmation de la suppression de l’employé');
    verifier(await modale(page).locator('.btn.danger.fort', { hasText: 'Supprimer définitivement' }).isVisible(), '« Supprimer définitivement » est le bouton danger');
    await capturerDeuxThemes(ctx, '06-confirmation-employe', problemes);

    ctx.etape('« Annuler » ne change rien ; « Archiver plutôt » archive sans supprimer');
    await bouton(modale(page), 'Annuler').click();
    await attendre(async () => !(await modale(page).count()), 'Annuler ferme la fenêtre');
    egal((await app.appeler('entite_fiche', { id: e1.id })).entite.actif, true, 'Toujours active');
    await supprimerFiche(page).click();
    await attendre(async () => (await modale(page).locator('.sup-effets li').count()) > 0, 'La confirmation se rouvre');
    await bouton(modale(page), 'Archiver plutôt').click();
    await attendre(async () => !(await modale(page).count()), '« Archiver plutôt » ferme la fenêtre');
    await attendre(async () => (await page.locator('.ph .ph-actions').getByRole('button', { name: 'Réactiver la fiche', exact: true }).count()) === 1,
      'La fiche est archivée (« Réactiver la fiche »)');
    const archivee = await app.appeler('entite_fiche', { id: e1.id });
    egal([archivee.entite.actif, archivee.documents.length, archivee.affectations.filter((a) => a.fin === null).length], [false, 3, 2],
      'Archivée, rien de supprimé (documents, affectations)');
    await bouton(page.locator('.ph .ph-actions'), 'Réactiver la fiche').click();
    await attendre(async () => (await app.appeler('entite_fiche', { id: e1.id })).entite.actif, 'Fiche réactivée');

    // ─────────── suppression de l'employé : « Supprimer définitivement » ───────────
    ctx.etape('chemin : profil → document (dossier) → recherche → fiche, puis « Supprimer définitivement »');
    await ligneProfil(page, 'a', docs.A.nom).locator('.file').click();
    await attendreTitre(page, D_OUVERT);
    await page.keyboard.press('Control+k');
    await page.keyboard.type('kaci');
    const dd = page.locator('#dd');
    await attendre(async () => (await dd.getAttribute('aria-busy')) === 'false' && (await dd.locator('.res', { hasText: E1.libelle }).count()) === 1, 'Résultat KACI Lina');
    await dd.locator('.res', { hasText: E1.libelle }).click();
    await attendreTitre(page, E1.libelle);
    await supprimerFiche(page).click();
    await attendre(async () => (await modale(page).locator('.sup-effets li').count()) > 0, 'La confirmation s’ouvre');
    await bouton(modale(page), 'Supprimer définitivement').click();
    await attendreTitre(page, 'Employés');
    const avis = page.locator('div.avis-zone[role=status]');
    await attendre(async () => (await avis.innerText()).includes(`Employé « ${E1.libelle} » supprimé.`), 'Message « Employé « KACI Lina » supprimé. »');
    await capturerDeuxThemes(ctx, '07-repertoire-message', problemes);
    egal(await page.locator('.content table tbody tr', { has: page.locator('td.name', { hasText: new RegExp(`^${E1.libelle}$`) }) }).count(), 0,
      'KACI Lina absente du répertoire');
    const ficheSupprimee = await app.invoquer('entite_fiche', { id: e1.id });
    verifier(!ficheSupprimee.ok && ficheSupprimee.erreur.code === 'introuvable', `La fiche n’existe plus (${JSON.stringify(ficheSupprimee)})`);

    ctx.etape('Retour (Alt+←) vers la fiche supprimée : « Cette fiche a été supprimée. », sans erreur');
    await page.keyboard.press('Alt+ArrowLeft');
    await attendreTitre(page, D_OUVERT);
    await page.keyboard.press('Alt+ArrowLeft');
    await attendreTitre(page, 'Fiche supprimée');
    const alerte = page.locator('.content .alert', { hasText: 'Cette fiche a été supprimée.' });
    await attendre(() => alerte.isVisible(), '« Cette fiche a été supprimée. » s’affiche');
    egal(await alerte.getByRole('button').allInnerTexts(), ['Retour aux employés'], 'Un seul retour : au répertoire des employés');
    egal(await page.locator('.alert.bad').count(), 0, 'Aucune erreur affichée');
    await capturerDeuxThemes(ctx, '08-fiche-supprimee', problemes);
    await bouton(alerte, 'Retour aux employés').click();
    await attendreTitre(page, 'Employés');

    ctx.etape('absente de la recherche globale, des suggestions et des compteurs du tableau de bord');
    verifier(!(await rechercher(page, 'kaci')).includes(E1.libelle), 'La recherche ne trouve plus KACI Lina');
    egal((await app.appeler('entites_suggerer', { kind: 'a', q: 'kaci' })).length, 0, 'Plus aucune suggestion « kaci »');
    await menu(page, 'Tableau de bord');
    const compteursApres = await lireCompteurs(page);
    const nb = (k, l) => Number(k.find((y) => y.label === l).valeur);
    egal(nb(compteursApres, 'Employés actifs'), nb(compteursAvant, 'Employés actifs') - 1, 'Compteur « Employés actifs »');

    ctx.etape('machines : PC v15 libre et réaffectable ; la machine partagée reste affectée à TAHAR Rafik');
    const enCours = async (id) => (await app.appeler('entite_fiche', { id })).affectations.filter((a) => a.fin === null).map((a) => a.entite.id);
    egal(await enCours(m1.id), [], 'PC v15 e2e n’est plus affectée');
    egal(await enCours(m3.id), [e2.id], 'PC partagé v15 e2e reste affectée à TAHAR Rafik');
    await ouvrirFiche(page, 'b', M1.nom);
    egal(await lignesAffectations(page, 'Affectations en cours'), [], 'Plus d’affectation en cours à l’écran');
    await page.getByRole('tab', { name: /^Historique des affectations/ }).click();
    const panneau = page.locator('[role=tabpanel]');
    const fin = panneau.locator('.tl li', { has: page.locator('b', { hasText: new RegExp(`^Fin de l’affectation de ${E1.libelle} \\(supprimé\\)$`) }) });
    await attendre(async () => (await fin.count()) === 1, 'Historique : « Fin de l’affectation de KACI Lina (supprimé) »');
    const debut = panneau.locator('.tl li', { has: page.locator('b', { hasText: new RegExp(`^Affectation de ${E1.libelle} \\(supprimé\\)$`) }) });
    egal(await debut.count(), 1, 'Historique : « Affectation de KACI Lina (supprimé) »');
    egal(await panneau.locator('.tl .tl-supprime', { hasText: E1.libelle }).count() >= 2, true, 'Le nom est en texte « supprimé »');
    egal(await panneau.locator('.tl button', { hasText: E1.libelle }).count(), 0, 'Le nom de la fiche supprimée n’est pas cliquable');
    egal(await panneau.locator('.tl .tl-supprime').first().evaluate((s) => s.closest('button, a') === null && getComputedStyle(s).cursor !== 'pointer'), true,
      'Ni bouton, ni lien, ni curseur de lien');
    await capturerDeuxThemes(ctx, '09-historique-nom-supprime', problemes, { pleinePage: true });
    await bouton(page.locator('.ph .ph-actions'), 'Affecter à un employé').click();
    await attendre(() => modale(page).isVisible(), 'La fenêtre d’affectation s’ouvre');
    const props = await taperDansChoix(modale(page), 'Employé', 'hamidi');
    egal(props.map((p) => p.nom), [E3.libelle], 'HAMIDI Nora proposée');
    await page.keyboard.press('Enter');
    await bouton(modale(page), 'Affecter').click();
    await attendre(async () => !(await modale(page).count()), 'La fenêtre d’affectation se ferme');
    await attendre(async () => JSON.stringify(await enCours(m1.id)) === JSON.stringify([e3.id]), 'PC v15 e2e réaffectée à HAMIDI Nora');
    egal(await lignesAffectations(page, 'Affectations en cours'), [{ nom: E3.libelle, identifiant: e3.code, du: jour }], 'Affectation affichée');

    ctx.etape('documents : nom, identifiant et « fiche supprimée » ; variables inchangées ; dossier clôturé sans « Choisir une autre fiche »');
    const blocA = await blocDuBack(app, docs.A.id, dOuvert.id, 'employe', 'Utilisateur');
    egal([blocA.entiteId, blocA.ficheSupprimee?.libelle, blocA.ficheSupprimee?.code, blocA.ficheSupprimee?.kind], [null, E1.libelle, e1.code, 'a'],
      'Bloc de A (back) : plus de fiche, copie de la fiche supprimée');
    const blocE = await blocDuBack(app, docs.E.id, dClos.id, 'employe', 'Utilisateur');
    egal([blocE.entiteId, blocE.ficheSupprimee?.libelle], [null, E1.libelle], 'Bloc de E (dossier clôturé, back) : copie conservée');
    egal((await blocDuBack(app, docs.B.id, dOuvert.id, 'champ', 'Signalée par')).val, 'Mme Lina Kaci', 'Le nom écrit dans B reste tel quel');
    await ouvrirDossier(page, D_CLOS, docs.E.nom);
    const carteE = carteChoisie(page, 'Utilisateur');
    await attendre(() => carteE.isVisible(), 'Le bloc de E s’affiche');
    egal(await carteE.evaluate((el) => el.classList.contains('supprimee')), true, 'Carte « supprimée »');
    egal((await carteE.locator('.cf-supp').innerText()).trim(), 'fiche supprimée', 'Mention « fiche supprimée »');
    egal(await detailsCarte(page, 'Utilisateur'), detailsE1, 'Nom, prénom, poste, structure et identifiant gardés');
    egal(await page.getByRole('button', { name: /^Choisir une autre fiche/ }).count(), 0, 'Pas de « Choisir une autre fiche » dans un dossier clôturé');
    egal(await variablesPapier(page), variablesE, 'Variables de E inchangées');
    problemes.push(...await controlerPapier(ctx, 'Document E (fiche supprimée, dossier clôturé)'));
    await ouvrirDossier(page, D_OUVERT, docs.A.nom);
    const carteA = carteChoisie(page, 'Utilisateur');
    await attendre(async () => (await carteA.locator('.cf-supp').count()) === 1, 'Le bloc de A montre « fiche supprimée »');
    egal(await detailsCarte(page, 'Utilisateur'), detailsE1, 'A : nom, prénom, poste, structure et identifiant gardés');
    egal(await variablesPapier(page), variablesA, 'Variables de A inchangées');
    egal(await carteA.getByRole('link').count() + await carteA.getByRole('button').count(), 0, 'La carte ne mène nulle part');
    await page.locator('.paper').scrollIntoViewIfNeeded();
    await capturerDeuxThemes(ctx, '10-document-fiche-supprimee', problemes);
    problemes.push(...await controlerPapier(ctx, 'Document A (fiche supprimée)'));

    ctx.etape('« Choisir une autre fiche » (dossier ouvert) : KACI Lina n’est pas proposée ; TAHAR Rafik choisi ; la copie disparaît');
    const choisirAutre = page.getByRole('button', { name: `Choisir une autre fiche : Utilisateur (${E1.libelle}, fiche supprimée)`, exact: true });
    await choisirAutre.click();
    egal((await taperDansChoix(page, 'Utilisateur', 'kaci')).length, 0, 'Aucune proposition « kaci »');
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    egal((await taperDansChoix(page, 'Utilisateur', 'tahar')).map((p) => p.nom), [E2.libelle], 'TAHAR Rafik proposé');
    await page.keyboard.press('Enter');
    await attendre(async () => (await blocDuBack(app, docs.A.id, dOuvert.id, 'employe', 'Utilisateur')).entiteId === e2.id, 'TAHAR Rafik enregistré dans le bloc');
    egal('ficheSupprimee' in (await blocDuBack(app, docs.A.id, dOuvert.id, 'employe', 'Utilisateur')), false, 'La copie de la fiche supprimée a disparu du bloc');
    await attendre(async () => (await variablesPapier(page)).some(([n, v]) => n === 'Employé · Identifiant' && v === e2.code), 'Les variables suivent la nouvelle fiche');

    ctx.etape('structure vidée par la suppression : devient supprimable dans Paramètres (et supprimée)');
    egal((await app.appeler('categories_lister', { kind: 'a' })).find((c) => c.id === x.s15.id).nbFiches, 0, 'nbFiches de la structure : 0');
    await menu(page, 'Paramètres');
    const supS15 = page.getByRole('button', { name: `Supprimer ${STRUCTURE}`, exact: true });
    egal(await supS15.getAttribute('aria-disabled'), null, '« Supprimer » disponible pour la structure vidée');
    await supS15.click();
    await bouton(modale(page), 'Supprimer').click();
    await attendre(async () => !(await app.appeler('categories_lister', { kind: 'a' })).some((cat) => cat.id === x.s15.id), 'La structure est supprimée');

    ctx.etape('employé recréé à l’identique : même identifiant, fiche neuve (seul le nom écrit dans B la nomme)');
    await menu(page, 'Employés');
    await bouton(page, 'Créer un employé').click();
    await attendreTitre(page, 'Créer un employé');
    await page.fill('#n-nom', E1.nom);
    await page.fill('#n-prenom', E1.prenom);
    await page.fill('#n-naissance', E1.dateNaissance);
    await page.fill('#n-poste', E1.poste);
    await page.selectOption('#n-cat', { label: x.autreStructure.nom });
    await bouton(page, 'Enregistrer la fiche').click();
    await attendreTitre(page, E1.libelle);
    const recree = (await app.appeler('entites_lister', { kind: 'a' })).filter((e) => e.libelle === E1.libelle);
    egal(recree.length, 1, 'Une seule fiche KACI Lina');
    egal(recree[0].code, e1.code, 'Même identifiant qu’avant la suppression');
    const neuve = await app.appeler('entite_fiche', { id: recree[0].id });
    egal([neuve.affectations.length, neuve.documents.map((d) => d.id)], [0, [docs.B.id]], 'Fiche neuve : aucune affectation, nommée seulement par le nom écrit dans B');
    for (const [d, dossierId] of [[docs.A, dOuvert.id], [docs.E, dClos.id]]) {
      const b = await blocDuBack(app, d.id, dossierId, 'employe', 'Utilisateur');
      verifier(b.entiteId !== recree[0].id, `${d.nom} ne désigne pas la nouvelle fiche`);
    }
    egal((await blocDuBack(app, docs.E.id, dClos.id, 'employe', 'Utilisateur')).ficheSupprimee?.libelle, E1.libelle, 'E garde la copie de l’ancienne fiche');

    // ─────────── suppression d'une machine (archivée) ───────────
    ctx.etape('machine archivée : confirmation (employé, affectation passée, documents), sans « Archiver plutôt »');
    await ouvrirFiche(page, 'b', M2.nom);
    await bouton(page.locator('.ph .ph-actions'), 'Archiver la fiche').click();
    await attendre(async () => (await page.locator('.ph .ph-actions').getByRole('button', { name: 'Réactiver la fiche', exact: true }).count()) === 1, 'Machine archivée');
    // La fiche a été ouverte depuis le répertoire : après la suppression, l'application y revient (page précédente).
    const apercuM = await app.appeler('entite_suppression_apercu', { id: m2.id });
    egal([apercuM.affectationsEnCours.map((a) => a.nom), apercuM.nbAffectationsPassees, apercuM.nbDocuments, apercuM.nbDossiers], [[E3.libelle], 1, 2, 2],
      'Aperçu du back (machine)');
    await supprimerFiche(page).click();
    await attendre(async () => (await modale(page).locator('.sup-effets li').count()) > 0, 'La confirmation s’ouvre');
    egal(await texteConfirmationFiche(page), {
      titre: 'Supprimer la machine ?',
      identite: `Machine « ${M2.nom} » · ${M2.code}`,
      effets: [
        ins(`L’employé « ${E3.libelle} » n’aura plus cette machine.`),
        'Son affectation passée disparaîtra de son historique.',
        'Cette machine est nommée dans 2 documents de 2 dossiers. Son nom reste écrit dans ces 2 documents, mais ils ne mèneront plus à sa fiche.',
      ],
      avert: 'Son historique sera supprimé. Cette action est irréversible.',
      boutons: ['Supprimer définitivement', 'Annuler'],
    }, 'Confirmation de la suppression de la machine archivée');
    await capturerDeuxThemes(ctx, '11-confirmation-machine-archivee', problemes);
    await bouton(modale(page), 'Supprimer définitivement').click();
    await attendreTitre(page, 'Machines');
    await attendre(async () => (await avis.innerText()).includes(`Machine « ${M2.nom} » supprimée.`), 'Message « Machine « Portable v15 e2e » supprimée. »');
    egal(await page.locator('.content table tbody tr', { has: page.locator('td.name', { hasText: new RegExp(`^${echapper(M2.nom)}$`) }) }).count(), 0,
      'Machine absente du répertoire');
    verifier(!(await rechercher(page, 'LT-V15')).some((n) => n === M2.nom), 'La recherche ne trouve plus la machine');
    egal((await app.appeler('entites_suggerer', { kind: 'b', q: 'v15' })).map((e) => e.nom).sort(), [M1.nom, M3.nom].sort(), 'Suggestions de machines « v15 »');

    ctx.etape('côté employé : HAMIDI Nora n’a plus la machine ; son historique cite « Portable v15 e2e (supprimée) » sans lien');
    await ouvrirFiche(page, 'a', E3.libelle);
    egal((await lignesAffectations(page, 'Affectations en cours')).map((l) => l.nom), [M1.nom], 'Affectations en cours de HAMIDI Nora');
    await page.getByRole('tab', { name: /^Journal chronologique/ }).click();
    const panneauE3 = page.locator('[role=tabpanel]');
    await attendre(async () => (await panneauE3.locator('.tl li', { has: page.locator('b', { hasText: `Fin de l’affectation de ${M2.nom} (supprimée)` }) }).count()) >= 1,
      'Historique : « Fin de l’affectation de Portable v15 e2e (supprimée) »');
    egal(await panneauE3.locator('.tl button', { hasText: M2.nom }).count(), 0, 'Le nom de la machine supprimée n’est pas cliquable');
    verifier(await panneauE3.locator('.tl .tl-supprime', { hasText: M2.nom }).count() >= 1, 'Nom en texte « supprimée »');
    egal((await app.appeler('categories_lister', { kind: 'b' })).find((cat) => cat.id === x.t15.id).nbFiches, 0, 'Type vidé : 0 machine');
    await menu(page, 'Paramètres');
    egal(await page.getByRole('button', { name: `Supprimer ${TYPE}`, exact: true }).getAttribute('aria-disabled'), null, '« Supprimer » disponible pour le type vidé');
    await ouvrirDossier(page, D_OUVERT, docs.A.nom);
    await attendre(async () => (await carteChoisie(page, 'Matériel').locator('.cf-supp').count()) === 1, 'Bloc « Matériel » de A : « fiche supprimée »');
    egal((await variablesPapier(page)).filter(([n]) => n.startsWith('Machine')), variablesA.filter(([n]) => n.startsWith('Machine')), 'Variables Machine de A inchangées');

    // ─────────── redémarrage ───────────
    ctx.etape('redémarrage : tout est toujours vrai');
    await redemarrer(ctx);
    ({ page, app } = ctx);
    const lister = async (kind) => (await app.appeler('entites_lister', { kind })).map((e) => e.libelle);
    egal((await lister('a')).filter((l) => l === E1.libelle).length, 1, 'Seule la KACI Lina recréée existe');
    verifier(!(await lister('b')).includes(M2.nom), 'La machine supprimée n’existe plus');
    for (const id of [e1.id, m2.id]) {
      const r = await app.invoquer('entite_fiche', { id });
      verifier((!r.ok && r.erreur.code === 'introuvable') || (r.ok && r.valeur.entite.id === recree[0].id), `Fiche ${id} introuvable après redémarrage`);
    }
    const detailOuvert = await app.appeler('dossier_detail', { id: dOuvert.id });
    egal(detailOuvert.documents.filter((d) => [docs.C.id, docs.D.id, docs.H.id, importe.id, jetable.id].includes(d.id)).length, 0, 'Documents supprimés absents');
    verifier(!fs.existsSync(importe.fichierChemin), 'La copie du fichier importé n’est pas revenue');
    egal(await enCours(m1.id), [e3.id], 'PC v15 e2e toujours affectée à HAMIDI Nora');
    egal(await enCours(m3.id), [e2.id], 'PC partagé v15 e2e toujours affectée à TAHAR Rafik');
    const blocEApres = await blocDuBack(app, docs.E.id, dClos.id, 'employe', 'Utilisateur');
    egal([blocEApres.entiteId, blocEApres.ficheSupprimee?.libelle], [null, E1.libelle], 'Bloc de E toujours orphelin, avec sa copie');
    egal((await blocDuBack(app, docs.A.id, dOuvert.id, 'machine', 'Matériel')).ficheSupprimee?.libelle, M2.nom, 'Bloc Matériel de A : copie de la machine');
    egal((await evenementsAvec(app, m1.id, `${E1.libelle} (supprimé)`)).length >= 2, true, 'Historique de PC v15 e2e : KACI Lina (supprimé)');
    verifier(!(await app.appeler('categories_lister', { kind: 'a' })).some((cat) => cat.id === x.s15.id), 'La structure supprimée n’est pas revenue');
    await ouvrirDossier(page, D_CLOS, docs.E.nom);
    await attendre(async () => (await carteChoisie(page, 'Utilisateur').locator('.cf-supp').count()) === 1, 'Après redémarrage, E montre « fiche supprimée »');
    egal(await variablesPapier(page), variablesE, 'Variables de E après redémarrage');
    const version = lire(path.join(ctx.donnees, 'donnees.sqlite'), (db) => db.prepare('PRAGMA user_version').get().user_version);
    egal(version, 6, 'Base de test en version 6');
    await menu(page, 'Tableau de bord');

    if (problemes.length) throw new Echec(`Contrôles d’affichage :\n       - ${problemes.join('\n       - ')}`);
  },
};

/** Titre (h1) de la page affichée. */
async function titreCourant(page) {
  return (await page.locator('.content .ph h1').first().innerText()).trim();
}
