// Contrôles de sécurité dans l'application réelle : aperçu décidé par le contenu et servi seulement pour un
// PDF ou une image, types de fichiers non ouvrables, export d'une copie, capacités refusées à la page,
// navigation et nouvelles fenêtres bloquées, dépôt de fichiers neutralisé, CSP, fermeture (saisie conservée,
// demandes répétées, JavaScript gelé).
//
// Aucun fichier importé n'est réellement ouvert : seul le refus du back est vérifié.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { ecrirePdf, ecrirePng } from '../outils/fichiers.mjs';
import { champPapier, ouvrirDossier, ouvrirFiche } from '../outils/ui.mjs';
import { attendre, Echec, egal, pause, verifier } from '../outils/verifs.mjs';
import { windows } from '../outils/windows.mjs';
import { importerParLeSelecteur, lireZoneIdentifier } from './dossiers.mjs';

export const NOM_DOSSIER_SECURITE = 'Dossier sécurité e2e';
const SAISIE_WM_CLOSE = 'Saisie avant fermeture par Windows';
const SAISIE_DOUBLE = 'Saisie avant deux demandes de fermeture';

/** Charge utile : document HTML qui tenterait de parler à la page s'il était exécuté. */
const HTML_PIEGE = '<!doctype html><script>parent.postMessage(\'execute\',\'*\')</script>';
const SVG_PIEGE = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><script>parent.postMessage(\'execute\',\'*\')</script><rect width="40" height="40" fill="red"/></svg>';

/** Texte du papier (aperçu) du document affiché. */
const textePapier = (page) => page.locator('.preview .pv-b').innerText();
const boutonOuvrir = (page) => page.locator('.preview').getByRole('button', { name: 'Ouvrir avec l’application par défaut' });
const boutonExporter = (page) => page.locator('.preview').getByRole('button', { name: /^Enregistrer une copie/ });

/** Bouton « Afficher … de plus » (rendu borné). */
export const boutonPlus = (page) => page.getByRole('button', { name: /^Afficher \d[\d\s\u202f]* \S+ de plus/ });

/** Appel d'une commande avec délai : si la commande ouvrait une boîte native, l'appel ne reviendrait pas. */
async function invoquerAvecDelai(app, commande, args, delai = 4000) {
  return app.page.evaluate(([c, a, d]) => Promise.race([
    window.__TAURI_INTERNALS__.invoke(c, a).then((valeur) => ({ ok: true, valeur }), (erreur) => ({ ok: false, erreur: String(erreur?.message ?? erreur) })),
    new Promise((r) => setTimeout(() => r({ ok: 'delai' }), d)),
  ]), [commande, args, delai]);
}

async function creerDossierSecurite(app) {
  const theme = (await app.appeler('themes_lister')).find((t) => t.actif);
  // § 11.6 : la saisie d'un dossier n'a plus d'employé ni de machine.
  const d = await app.appeler('dossier_creer', {
    saisie: { nom: NOM_DOSSIER_SECURITE, annee: new Date().getFullYear(), themeId: theme.id, statutId: null },
  });
  return d.id;
}

/**
 * Serveur témoin sur 127.0.0.1 : compte les connexions reçues. Une navigation ou une fenêtre vers lui qui ne
 * serait pas bloquée AVANT la sortie réseau s'y connecterait.
 */
async function serveurTemoin() {
  let connexions = 0;
  const requetes = [];
  const srv = http.createServer((req, res) => {
    requetes.push(`${req.method} ${req.url}`);
    res.end('temoin');
  });
  srv.on('connection', () => { connexions += 1; });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${srv.address().port}/temoin-e2e`,
    connexions: () => connexions,
    requetes: () => [...requetes],
    fermer: () => new Promise((r) => srv.close(r)),
  };
}

/**
 * Retire du journal de l'instance les entrées attendues d'un geste volontairement interdit (ajoutées depuis
 * `marque` et dont le texte contient `motif`). Renvoie les entrées retirées.
 */
function retirerDuJournal(app, marque, motif) {
  const retirees = [];
  for (let i = app.journal.length - 1; i >= marque; i--) {
    if (app.journal[i].texte.includes(motif)) retirees.push(...app.journal.splice(i, 1));
  }
  return retirees;
}

export const securite = {
  id: 'securite',
  titre: 'Sécurité : contenu piégé, aperçu, types interdits, export, capacités, navigation, dépôt, CSP, fermeture',
  async executer(ctx) {
    let { page, app } = ctx;
    const e = ctx.entrees;
    const fichiers = path.join(ctx.donnees, 'fichiers');
    fs.writeFileSync(path.join(e, 'piege.pdf'), HTML_PIEGE);
    fs.writeFileSync(path.join(e, 'dessin.png'), SVG_PIEGE);
    fs.writeFileSync(path.join(e, 'script.bat'), '@echo off\r\necho e2e\r\n');
    fs.writeFileSync(path.join(e, 'script.js'), 'WScript.Echo("e2e");\r\n');
    ecrirePdf(path.join(e, 'vrai.pdf'), 'PDF securite e2e');
    ecrirePng(path.join(e, 'vraie.png'), 120, 80);

    const dossierId = await creerDossierSecurite(app);
    await ouvrirDossier(page, NOM_DOSSIER_SECURITE);
    // Témoin : tout message reçu par la page (un contenu exécuté dans un cadre en enverrait un).
    await page.evaluate(() => {
      window.__messagesE2e = [];
      window.addEventListener('message', (ev) => window.__messagesE2e.push(String(ev.data)));
    });

    ctx.etape('HTML déguisé en PDF : ni cadre ni exécution, explication affichée');
    const piege = await importerParLeSelecteur(ctx, dossierId, path.join(e, 'piege.pdf'));
    egal([piege.apercu, piege.ouvrable], ['aucun', true], 'piege.pdf : aperçu décidé par le contenu (aucun), extension .pdf ouvrable');
    egal(await page.locator('.paper iframe, .paper img, .paper embed, .paper object').count(), 0, 'Aucun cadre ni image pour piege.pdf');
    await pause(2000);
    egal(await page.evaluate(() => window.__messagesE2e), [], 'Aucun message reçu de piege.pdf');
    verifier((await textePapier(page)).includes('Ce fichier ne peut pas être affiché ici (piege.pdf)'),
      `Explication affichée pour piege.pdf (obtenu : ${(await textePapier(page)).replace(/\s+/g, ' ').slice(0, 200)})`);
    verifier(/^\s*ZoneId=3\s*$/m.test(lireZoneIdentifier(piege.fichierChemin)), 'Copie de piege.pdf marquée « venu d’Internet » (ZoneId=3)');
    await ctx.capture('securite/html-deguise');

    ctx.etape('vrai PDF : cadre vers http://asset.localhost/');
    const vraiPdf = await importerParLeSelecteur(ctx, dossierId, path.join(e, 'vrai.pdf'));
    egal(vraiPdf.apercu, 'pdf', 'Aperçu du vrai PDF');
    const src = await attendre(() => page.locator('.paper iframe').getAttribute('src'), 'Le vrai PDF doit s’afficher dans un cadre');
    verifier(src.startsWith('http://asset.localhost/'), `Cadre du PDF servi par le protocole asset (${src})`);

    ctx.etape('vraie image PNG : image affichée');
    const vraiePng = await importerParLeSelecteur(ctx, dossierId, path.join(e, 'vraie.png'));
    egal(vraiePng.apercu, 'image', 'Aperçu de la vraie image');
    await attendre(() => page.locator('.paper img').evaluate((i) => i.complete && i.naturalWidth === 120), 'La vraie image doit s’afficher');
    egal(await page.locator('.paper iframe').count(), 0, 'Pas de cadre pour une image');

    ctx.etape('SVG renommé .png : ni image ni cadre');
    const svg = await importerParLeSelecteur(ctx, dossierId, path.join(e, 'dessin.png'));
    egal(svg.apercu, 'aucun', 'Aperçu d’un SVG renommé .png');
    egal(await page.locator('.paper iframe, .paper img, .paper embed, .paper object').count(), 0, 'Ni image ni cadre pour le SVG renommé');
    await pause(1000);
    egal(await page.evaluate(() => window.__messagesE2e), [], 'Aucun message reçu du SVG');

    const binaires = [];
    for (const nom of ['script.bat', 'script.js']) {
      ctx.etape(`${nom} : stocké en .bin, pas d’ouverture possible`);
      const doc = await importerParLeSelecteur(ctx, dossierId, path.join(e, nom));
      verifier(doc.fichierChemin?.endsWith('.bin') && path.dirname(doc.fichierChemin) === fichiers, `${nom} stocké en .bin (${doc.fichierChemin})`);
      egal([doc.apercu, doc.ouvrable, doc.fichierNom], ['aucun', false, nom], `${nom} : aperçu, ouverture, nom d’origine`);
      egal(await boutonOuvrir(page).count(), 0, `Pas de bouton « Ouvrir avec l’application par défaut » pour ${nom}`);
      verifier((await textePapier(page)).includes('par mesure de sécurité, ce type de fichier n’est pas pris en charge'),
        `Explication de sécurité affichée pour ${nom}`);
      const r = await app.invoquer('document_ouvrir_externe', { id: doc.id });
      verifier(!r.ok && r.erreur?.code === 'type_interdit', `document_ouvrir_externe doit être refusé (type_interdit) pour ${nom} : ${JSON.stringify(r)}`);
      binaires.push(doc);
    }
    await ctx.capture('securite/type-interdit');

    ctx.etape('« Enregistrer une copie… » d’un fichier non ouvrable : fichier identique à l’original');
    // Le document affiché est le dernier importé : script.js (stocké en .bin).
    const exporte = path.join(e, 'export-script.js');
    await boutonExporter(page).click();
    const { nomPropose } = await app.enregistrerSous(exporte);
    // Windows masque l'extension d'un type connu dans ce champ si l'Explorateur est réglé ainsi.
    verifier(['script.js', 'script'].includes(nomPropose), `Nom d’origine proposé dans la boîte d’enregistrement (obtenu ${JSON.stringify(nomPropose)})`);
    ctx.etape(`nom proposé : « ${nomPropose} »`);
    await attendre(() => fs.existsSync(exporte), 'La copie enregistrée doit exister');
    // Le fichier peut rester verrouillé un instant après sa création (écriture en cours, analyse antivirus d'un .js) :
    // la lecture est retentée (EBUSY) ; le contenu doit être identique.
    await attendre(() => fs.readFileSync(exporte).equals(fs.readFileSync(path.join(e, 'script.js'))),
      'La copie enregistrée est identique à l’original');
    verifier(/^\s*ZoneId=3\s*$/m.test(lireZoneIdentifier(exporte)), 'Copie enregistrée marquée « venu d’Internet » (ZoneId=3)');

    ctx.etape('texte venu des données affiché comme du texte, jamais interprété comme du HTML');
    const piegeHtml = '<img src=x onerror="window.__xssE2e=1">';
    const structure = (await app.appeler('categories_lister', { kind: 'a' })).find((c) => c.actif);
    const fichePiegee = await app.appeler('entite_creer', {
      saisie: { kind: 'a', nom: piegeHtml, prenom: 'Script', dateNaissance: '1990-01-01', poste: '<b>gras</b>', categorieId: structure.id },
    });
    await ouvrirFiche(page, 'a', fichePiegee.libelle);
    await pause(500);
    egal(await page.evaluate(() => window.__xssE2e ?? null), null, 'Aucun script exécuté depuis le nom d’une fiche');
    egal(await page.locator('.content img[src="x"], .content b:text-is("gras")').count(), 0, 'Aucune balise créée à partir des données');
    verifier((await page.locator('.content').innerText()).includes(piegeHtml.toUpperCase()), 'Le nom est affiché tel quel, comme du texte');
    await app.appeler('entite_supprimer', { id: fichePiegee.id });
    await ouvrirDossier(page, NOM_DOSSIER_SECURITE);

    ctx.etape('capacités : greffons refusés à la page');
    for (const [cmd, args] of [
      ['plugin:opener|open_path', { path: ctx.donnees }],
      ['plugin:opener|reveal_item_in_dir', { paths: [ctx.donnees] }],
      ['plugin:dialog|open', { options: {} }],
      ['plugin:window|set_focus', { label: 'main' }],
      ['plugin:window|inner_position', { label: 'main' }],
    ]) {
      const r = await invoquerAvecDelai(app, cmd, args);
      if (r.ok === 'delai') {
        // Une boîte native se serait ouverte : on la ferme avant d'échouer.
        for (const f of await windows().appel('fenetres', app.proc.pid)) {
          if (f.visible && f.classe === '#32770') await windows().appel('touche', f.hwnd, 'echap').catch(() => {});
        }
      }
      verifier(r.ok === false && /not allowed|denied|not found/i.test(r.erreur),
        `${cmd} doit être refusé par les capacités (obtenu ${JSON.stringify(r)})`);
    }
    egal((await invoquerAvecDelai(app, 'plugin:window|is_maximized', { label: 'main' })).ok, true, 'Témoin : une permission accordée reste utilisable');

    ctx.etape('commandes appelées par un script avec des entrées démesurées ou hors liste : refus propres, rien d’écrit');
    const saisieId = (nom) => ({ saisie: { nom, prenom: 'Sofia', dateNaissance: '1990-05-14', poste: 'Technicienne' }, idExistant: null });
    egal(await app.appeler('identifiant_employe_apercu', saisieId('B'.repeat(2_000_000))), null,
      'Aperçu de l’identifiant d’un nom démesuré : aucun (SEC-182-04)');
    verifier(/^EMP-[0-9A-Z]{5}-[0-9A-Z]{5}$/.test(await app.appeler('identifiant_employe_apercu', saisieId('Benali'))),
      'Témoin : aperçu de l’identifiant d’une saisie normale');
    for (const [cmd, args, code] of [
      ['statut_creer', { nom: 'État e2e', couleur: 'url(javascript:alert(1))' }, 'saisie_invalide'],
      ['parametre_definir', { cle: 'theme', valeur: '<img src=x onerror=alert(1)>' }, 'saisie_invalide'],
      ['parametre_definir', { cle: '__proto__', valeur: 'x' }, 'saisie_invalide'],
      ['donnees_reinitialiser', { mode: 'tout' }, 'saisie_invalide'],
      ['dossier_creer', { saisie: { nom: 'x'.repeat(201), annee: 2026, themeId: 1, statutId: null } }, 'saisie_invalide'],
      ['document_definir_date', { id: 2 ** 53 - 1, date: '2026-01-01' }, 'introuvable'],
      ['dossier_supprimer', { id: -1 }, 'introuvable'],
      ['sous_dossier_supprimer', { id: 2 ** 53 - 1 }, 'introuvable'],
      ['magasin_renommer', { id: 2 ** 53 - 1, nom: 'x' }, 'introuvable'],
    ]) {
      const r = await app.invoquer(cmd, args);
      verifier(!r.ok && r.erreur?.code === code, `${cmd} ${JSON.stringify(args).slice(0, 80)} : refus « ${code} » (obtenu ${JSON.stringify(r).slice(0, 200)})`);
      verifier(!/[A-Za-z]:\\|\\\\|sqlite|SELECT|rusqlite/i.test(r.erreur?.message ?? ''), `${cmd} : message sans détail interne (${r.erreur?.message})`);
    }

    const differes = [];
    const temoin = await serveurTemoin();
    try {
      ctx.etape('navigation de premier niveau bloquée avant toute sortie réseau');
      const urlApp = page.url();
      for (const cible of ['about:blank', temoin.url, 'file:///C:/Windows/win.ini']) {
        const marque = app.marque();
        await page.evaluate((u) => { window.location.href = u; }, cible).catch(() => {});
        await pause(1500);
        egal(page.url(), urlApp, `URL après location.href = ${cible}`);
        verifier(await page.locator('.side .nav').first().isVisible(), `L’application reste affichée après location.href = ${cible}`);
        // Les traces du geste interdit (requête annoncée puis annulée, refus de Chromium pour file://) sont
        // retirées du journal : la preuve qu'aucune sortie n'a eu lieu est le serveur témoin, vérifié ci-dessous.
        const retirees = retirerDuJournal(app, marque, cible);
        if (retirees.length) ctx.etape(`${cible} : ${retirees.map((j) => j.type).join(', ')}`);
      }
      ctx.etape(`serveur témoin : ${temoin.connexions()} connexion(s), requêtes HTTP : ${JSON.stringify(temoin.requetes())}`);
      // Échec différé : les contrôles suivants sont joués quand même, le scénario échoue à la fin.
      if (temoin.requetes().length) {
        differes.push(`Navigation interdite mais requête HTTP sortie : le serveur témoin a reçu ${JSON.stringify(temoin.requetes())} (attendu : aucune)`);
      }
      // Limite connue (affichée au verdict, sans échec) : WebView2 ouvre une connexion TCP spéculative vers
      // l'hôte visé dès le début de la navigation, avant tout filtre de l'application ; aucune requête HTTP ne part.
      if (temoin.connexions()) {
        ctx.limite(`location.href vers un hôte externe : ${temoin.connexions()} connexion(s) TCP spéculative(s) ouverte(s) `
          + 'par WebView2 avant le filtre de l’application (aucune requête HTTP envoyée, adresse de la fenêtre inchangée)');
      }

      ctx.etape('nouvelles fenêtres refusées');
      const pagesAvant = (await app.ciblesPages()).length;
      const marque = app.marque();
      const [c0, r0] = [temoin.connexions(), temoin.requetes().length];
      const ouvertes = await page.evaluate((u) => [u, 'about:blank', '/index.html'].map((x) => window.open(x, '_blank') !== null), temoin.url);
      await pause(1500);
      retirerDuJournal(app, marque, temoin.url);
      egal(ouvertes, [false, false, false], 'window.open renvoie null');
      egal((await app.ciblesPages()).length, pagesAvant, 'Aucune nouvelle page dans la WebView');
      egal(app.contexte.pages().length, 1, 'Une seule page');
      egal([temoin.connexions() - c0, temoin.requetes().length - r0], [0, 0], 'Connexions et requêtes reçues par le serveur témoin après window.open');
    } finally {
      await temoin.fermer();
    }

    ctx.etape('dépôt : fichiers neutralisés, texte du Studio non touché');
    const urlApp = page.url();
    const depot = await page.evaluate(() => {
      const envoyer = (type, dt) => {
        const ev = new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true });
        document.querySelector('.content').dispatchEvent(ev);
        return ev.defaultPrevented;
      };
      const fichier = new DataTransfer();
      fichier.items.add(new File(['x'], 'depose.txt', { type: 'text/plain' }));
      const texte = new DataTransfer();
      texte.setData('text/plain', 'bloc');
      return {
        fichierDragover: envoyer('dragover', fichier),
        fichierDrop: envoyer('drop', fichier),
        texteDragover: envoyer('dragover', texte),
      };
    });
    egal(depot, { fichierDragover: true, fichierDrop: true, texteDragover: false }, 'Événements de dépôt neutralisés');
    verifier(page.url() === urlApp, 'Le dépôt d’un fichier ne quitte pas l’application');

    ctx.etape('CSP : aucune violation depuis la connexion, et le détecteur fonctionne');
    egal(await page.evaluate(() => window.__violationsCsp ?? null), [], 'Violations de CSP relevées dans la page');
    const marqueCsp = app.marque();
    const temoinCsp = await page.evaluate(async () => {
      const avant = window.__violationsCsp.length;
      const d = document.createElement('div');
      d.innerHTML = '<span style="color: red">témoin CSP</span>';
      document.body.append(d);
      await new Promise((r) => setTimeout(r, 300));
      const bloque = getComputedStyle(d.firstChild).color !== 'rgb(255, 0, 0)';
      d.remove();
      return { signalees: window.__violationsCsp.length - avant, bloque };
    });
    await pause(500);
    // Le témoin est volontaire : ses signalements sont retirés du journal du scénario.
    for (let i = app.journal.length - 1; i >= marqueCsp; i--) {
      if (app.journal[i].type === 'csp' || /violation CSP/.test(app.journal[i].texte)) app.journal.splice(i, 1);
    }
    egal(temoinCsp, { signalees: 1, bloque: true }, 'Témoin : un style en ligne injecté est bloqué et signalé');
    await page.evaluate(() => { window.__violationsCsp.length = 0; });

    const modele01 = (await app.appeler('modeles_lister')).find((m) => m.nom === 'Fiche d’intervention informatique').id;
    const docSaisie = await app.appeler('document_creer_depuis_modele', { dossierId, sousDossierId: null, modeleId: modele01, pieceFinale: false });

    ctx.etape('fermeture par Windows (WM_CLOSE) juste après une saisie : saisie conservée');
    await ouvrirDossier(page, NOM_DOSSIER_SECURITE, docSaisie.nom);
    await champPapier(page, 'Signalée par').fill(SAISIE_WM_CLOSE);
    let t0 = Date.now();
    await app.fermerParWindows();
    let code = await app.attendreFin(10_000);
    verifier(code !== null, 'WM_CLOSE doit terminer le processus');
    egal(code, 0, 'Code de sortie après WM_CLOSE');
    ctx.etape(`processus terminé ${Date.now() - t0} ms après WM_CLOSE`);
    await app.deconnecter();
    app = await ctx.lancer();
    page = app.page;
    await ouvrirDossier(page, NOM_DOSSIER_SECURITE, docSaisie.nom);
    egal(await champPapier(page, 'Signalée par').inputValue(), SAISIE_WM_CLOSE, 'Saisie conservée après WM_CLOSE');

    ctx.etape('deux demandes de fermeture rapprochées juste après une saisie : saisie conservée');
    await champPapier(page, 'Signalée par').fill(SAISIE_DOUBLE);
    t0 = Date.now();
    await app.fermerParWindows();
    await app.fermerParWindows().catch(() => { /* fenêtre déjà détruite */ });
    code = await app.attendreFin(10_000);
    verifier(code !== null, 'Deux demandes de fermeture doivent terminer le processus');
    ctx.etape(`processus terminé ${Date.now() - t0} ms après la première demande (code ${code})`);
    await app.deconnecter();
    app = await ctx.lancer();
    page = app.page;
    await ouvrirDossier(page, NOM_DOSSIER_SECURITE, docSaisie.nom);
    egal(await champPapier(page, 'Signalée par').inputValue(), SAISIE_DOUBLE, 'Saisie conservée après deux demandes de fermeture');

    ctx.etape('JavaScript gelé : une demande de fermeture termine le processus en moins de 5 s');
    await page.evaluate(() => { setTimeout(() => { for (;;) { /* gel volontaire */ } }, 0); });
    await pause(300);
    const t1 = Date.now();
    await app.fermerParWindows();
    const codeGele = await app.attendreFin(5000);
    const duree = Date.now() - t1;
    verifier(codeGele !== null, `Le processus doit se terminer moins de 5 s après la demande de fermeture (toujours actif après ${duree} ms)`);
    ctx.etape(`processus terminé ${duree} ms après la demande (code ${codeGele})`);
    await app.deconnecter();
    if (differes.length) throw new Echec(differes.join(' ; '));
  },
};
