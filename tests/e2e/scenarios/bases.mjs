// Bases fabriquées avant lancement (base piégée refusée, données hostiles, très grands volumes) et
// compatibilité avec une copie de la vraie base de l'utilisateur. Chaque cas lance sa propre instance
// sur son propre dossier de données (l'instance principale est fermée : l'application est à instance unique).

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ajouterDocument, ajouterFichesA, empreinte, executer, fabriquerBase, lire } from '../outils/bases.mjs';
import { attendreTitre, echapper, menu, ouvrirDocument, ouvrirDossier, ouvrirFiche, texteErreur } from '../outils/ui.mjs';
import { attendre, controleVocabulaire, Echec, egal, pause, verifier } from '../outils/verifs.mjs';
import { TITRE_FENETRE, windows } from '../outils/windows.mjs';
import { capturePageEntiere } from './affectations.mjs';
import { documentsCites } from './v13.mjs';
import { boutonPlus } from './securite.mjs';

const TITRE_REFUS = 'INVENTORY ne peut pas démarrer';

/** Ferme l'instance par la barre de titre et vérifie la sortie (code 0). */
async function fermer(app) {
  await app.page.locator('.titlebar .ctl').getByRole('button', { name: 'Fermer', exact: true }).click({ noWaitAfter: true });
  const code = await app.attendreFin(15_000);
  egal(code, 0, 'Code de sortie à la fermeture');
  await app.deconnecter();
}

export const basesFabriquees = {
  id: 'bases-fabriquees',
  titre: 'Bases fabriquées : déclencheurs refusés sans modification, fichiers conservés, « __proto__ », grands volumes bornés',
  sansApplication: true,
  async executer(ctx) {
    fs.mkdirSync(path.join(ctx.captures, 'bases'), { recursive: true });
    const cas = [
      {
        nom: 'déclencheur ordinaire',
        dossier: 'base-piegee',
        sql: `CREATE TRIGGER piege AFTER INSERT ON documents BEGIN
                UPDATE documents SET fichier_stocke = '..\\..\\x.exe' WHERE id = new.id; END;`,
        motifJournal: /base_refusee/,
      },
      {
        // Nom réservé « sqlite_… » : invisible pour un filtre `name NOT LIKE 'sqlite_%'`, inséré par writable_schema.
        nom: 'déclencheur « sqlite_… » inséré par writable_schema',
        dossier: 'base-piegee-sqlite',
        sql: `PRAGMA writable_schema = ON;
              INSERT INTO sqlite_master (type, name, tbl_name, rootpage, sql) VALUES ('trigger', 'sqlite_piege', 'documents', 0,
                'CREATE TRIGGER sqlite_piege AFTER INSERT ON documents BEGIN UPDATE documents SET fichier_stocke = ''x.exe'' WHERE id = new.id; END');
              PRAGMA writable_schema = OFF;`,
        motifJournal: /base_refusee/,
      },
      {
        // Base déjà au schéma de la version 1.1 (user_version = 2) : le contrôle s'applique aussi, sans migration.
        nom: 'déclencheur ordinaire (base en version 2)',
        dossier: 'base-piegee-v2',
        version: 2,
        sql: `CREATE TRIGGER piege AFTER UPDATE ON entites BEGIN
                UPDATE entites SET code = 'PIEGE' WHERE id = new.id; END;`,
        motifJournal: /base_refusee/,
      },
      {
        // Base déjà au schéma de la version 1.2 (user_version = 3) : même contrôle, sans migration ni sauvegarde.
        nom: 'déclencheur ordinaire (base en version 3)',
        dossier: 'base-piegee-v3',
        version: 3,
        sql: `CREATE TRIGGER piege AFTER INSERT ON affectations BEGIN
                UPDATE affectations SET fin = NULL WHERE id = new.id; END;`,
        motifJournal: /base_refusee/,
      },
      {
        // Base déjà au schéma de la version 1.3 (user_version = 4) : même contrôle, sans sauvegarde.
        nom: 'déclencheur ordinaire (base en version 4)',
        dossier: 'base-piegee-v4',
        version: 4,
        sql: `CREATE TRIGGER piege AFTER UPDATE ON statuts BEGIN
                UPDATE dossiers SET statut_id = new.id; END;`,
        motifJournal: /base_refusee/,
      },
      {
        // Base déjà au schéma de la version 1.4 (user_version = 5) : même contrôle, sans sauvegarde.
        nom: 'déclencheur ordinaire (base en version 5)',
        dossier: 'base-piegee-v5',
        version: 5,
        sql: `CREATE TRIGGER piege AFTER INSERT ON nominations BEGIN
                DELETE FROM nominations WHERE document_id = new.document_id; END;`,
        motifJournal: /base_refusee/,
      },
      {
        // Base déjà au schéma de la version 1.5 (user_version = 6) : même contrôle, sans sauvegarde.
        nom: 'déclencheur ordinaire (base en version 6)',
        dossier: 'base-piegee-v6',
        version: 6,
        sql: `CREATE TRIGGER piege AFTER DELETE ON entites BEGIN
                UPDATE evenements SET a_libelle_supprime = NULL; END;`,
        motifJournal: /base_refusee/,
      },
    ];
    for (const c of cas) {
      ctx.etape(`base valide + ${c.nom} : démarrage refusé, message natif, fichier intact, aucune sauvegarde`);
      const piegee = ctx.autreApplication(c.dossier);
      const base = fabriquerBase(ctx.racine, piegee.donnees, { sql: c.sql, version: c.version ?? 1 });
      const etatBase = () => ({ base: empreinte(base), wal: empreinte(`${base}-wal`), shm: empreinte(`${base}-shm`), mtime: fs.statSync(base).mtimeMs });
      const avant = etatBase();
      await piegee.lancerProcessus();
      try {
        const boite = await windows().appel('attendre-fenetre', piegee.proc.pid, TITRE_REFUS, 20_000);
        verifier(boite, `Le message natif « ${TITRE_REFUS} » doit s’afficher`);
        const textes = (await windows().appel('textes', boite)).join(' ');
        verifier(/pas été ouverte ni modifiée/.test(textes), `Message du refus (obtenu : ${textes.slice(0, 400)})`);
        verifier(textes.includes(piegee.donnees), `Le message donne le dossier de données ${piegee.donnees} (obtenu : ${textes.slice(0, 400)})`);
        const fenetres = await windows().appel('fenetres', piegee.proc.pid);
        verifier(!fenetres.some((f) => f.visible && f.titre === TITRE_FENETRE), 'La fenêtre principale ne doit pas être créée');
        // Fermer la boîte SANS ouvrir le dossier : clic sur le bouton qui n'ouvre rien.
        const boutons = await windows().appel('boutons', boite);
        const fermerBoite = boutons.find((b) => !/ouvrir/i.test(b));
        verifier(fermerBoite, `Un bouton de la boîte doit la fermer sans ouvrir le dossier (boutons : ${boutons.join(', ')})`);
        const clique = await windows().appel('cliquer', boite, `^${fermerBoite.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
        ctx.etape(`boîte fermée par « ${clique} » (boutons : ${boutons.join(', ')})`);
        const code = await piegee.attendreFin(10_000);
        egal(code, 1, 'Code de sortie après le refus');
      } finally {
        await piegee.tuer(); // instance unique : rien ne doit rester ouvert pour les lancements suivants
      }
      egal(etatBase(), avant, 'La base refusée n’est pas modifiée (contenu, date, fichiers -wal / -shm)');
      verifier(!fs.existsSync(path.join(piegee.donnees, 'sauvegardes')), 'Une base refusée n’est ni sauvegardée ni migrée');
      const journal = path.join(piegee.donnees, 'journal-erreurs.log');
      verifier(fs.existsSync(journal) && c.motifJournal.test(fs.readFileSync(journal, 'utf8')), 'Le détail du refus est écrit dans journal-erreurs.log');
    }

    ctx.etape('base valide en version 4 (1.3) : sauvegardée, migrée en version 6 ; le dossier rattaché sans document en reçoit un qui nomme ses fiches');
    const v4 = ctx.autreApplication('base-v4-valide');
    const baseV4 = fabriquerBase(ctx.racine, v4.donnees, { version: 4 });
    await v4.demarrer();
    await attendreTitre(v4.page, 'Tableau de bord');
    const [dossierV4] = await v4.appeler('dossiers_lister');
    egal([dossierV4?.nom, dossierV4?.statut.nom], ['Dossier fabriqué', 'En cours'], 'Dossier de la base migrée');
    const detailV4 = await v4.appeler('dossier_detail', { id: dossierV4.id });
    egal(detailV4.documents.map((x) => [x.nom, x.source, x.blocs.filter((y) => y.t === 'employe' || y.t === 'machine').map((y) => [y.t, y.v, y.entiteId])]),
      [['Employé et machine du dossier', 'Reprise de la version 1.3', [['employe', 'Employé', 1], ['machine', 'Machine', 2]]]],
      'Le rattachement du dossier est gardé par un document « Employé et machine du dossier »');
    for (const id of [1, 2]) {
      egal((await v4.appeler('entite_fiche', { id })).dossiers.map((x) => x.nom), ['Dossier fabriqué'], `La fiche ${id} garde son dossier lié`);
    }
    await fermer(v4);
    const sauvegardesV4 = fs.existsSync(path.join(v4.donnees, 'sauvegardes')) ? fs.readdirSync(path.join(v4.donnees, 'sauvegardes')) : [];
    verifier(sauvegardesV4.length === 1 && /^avant-version-5_/.test(sauvegardesV4[0]), `Sauvegarde « avant-version-5_… » de la base 1.3 (${sauvegardesV4.join(', ')})`);
    egal(lire(baseV4, (db) => db.prepare('PRAGMA user_version').get().user_version), 6, 'Version de la base migrée');
    const colonnesJournal = (base) => lire(base, (db) => db.prepare('PRAGMA table_info(evenements)').all().map((r) => r.name));
    verifier(colonnesJournal(baseV4).includes('a_libelle_supprime') && colonnesJournal(baseV4).includes('b_libelle_supprime'),
      'Journal de la base migrée : colonnes de la version 6');

    ctx.etape('base valide en version 5 (1.4) : sauvegardée « avant-version-6_… », migrée en version 6, rien de perdu');
    const v5 = ctx.autreApplication('base-v5-valide');
    const baseV5 = fabriquerBase(ctx.racine, v5.donnees, { version: 5 });
    const avantV5 = instantane(baseV5);
    await v5.demarrer();
    await attendreTitre(v5.page, 'Tableau de bord');
    egal((await v5.appeler('dossiers_lister')).map((d) => [d.nom, d.statut.nom]), [['Dossier fabriqué', 'En cours']], 'Dossier de la base en version 5');
    await fermer(v5);
    const sauvegardesV5 = fs.existsSync(path.join(v5.donnees, 'sauvegardes')) ? fs.readdirSync(path.join(v5.donnees, 'sauvegardes')) : [];
    verifier(sauvegardesV5.length === 1 && /^avant-version-6_/.test(sauvegardesV5[0]), `Sauvegarde « avant-version-6_… » de la base 1.4 (${sauvegardesV5.join(', ')})`);
    egal(instantane(path.join(v5.donnees, 'sauvegardes', sauvegardesV5[0], 'donnees.sqlite')), avantV5, 'La sauvegarde est la base 1.4 d’origine, à l’identique');
    egal(lire(baseV5, (db) => db.prepare('PRAGMA user_version').get().user_version), 6, 'Version de la base migrée');
    egal(pertes(avantV5, instantane(baseV5)), [], 'Base 1.4 migrée : chaque ligne de chaque table est conservée à l’identique');

    ctx.etape('base valide en version 6 (sans piège) : acceptée telle quelle, sans sauvegarde ni migration');
    const v6 = ctx.autreApplication('base-v6-valide');
    const baseV6 = fabriquerBase(ctx.racine, v6.donnees, { version: 6 });
    await v6.demarrer();
    await attendreTitre(v6.page, 'Tableau de bord');
    egal((await v6.appeler('dossiers_lister')).map((d) => [d.nom, d.statut.nom]), [['Dossier fabriqué', 'En cours']], 'Dossier de la base en version 6');
    await fermer(v6);
    verifier(!fs.existsSync(path.join(v6.donnees, 'sauvegardes')), 'Une base déjà en version 6 n’est pas sauvegardée');
    egal(lire(baseV6, (db) => db.prepare('PRAGMA user_version').get().user_version), 6, 'Version de la base');

    ctx.etape('dossier sans base, avec un fichier dans fichiers/ : le fichier est conservé au démarrage');
    const sansBase = ctx.autreApplication('sans-base');
    const etranger = path.join(sansBase.donnees, 'fichiers', 'document-a-garder.txt');
    fs.mkdirSync(path.dirname(etranger), { recursive: true });
    fs.writeFileSync(etranger, 'à conserver');
    await sansBase.demarrer();
    verifier(fs.existsSync(etranger), 'Un fichier non référencé de fichiers/ ne doit pas être supprimé au démarrage');
    await fermer(sansBase);
    verifier(fs.existsSync(etranger), 'Le fichier non référencé est toujours là après la fermeture');

    ctx.etape('base fabriquée : variable « __proto__ », tableau de 5 000 lignes, 5 000 fiches');
    const hostile = ctx.autreApplication('base-hostile');
    const chemin = fabriquerBase(ctx.racine, hostile.donnees);
    ajouterDocument(chemin, { id: 1, nom: 'Document proto', blocs: [{ t: 'variable', v: '__proto__' }, { t: 'variable', v: 'constructor' }, { t: 'texte', v: 'Texte témoin' }] });
    const lignes = Array.from({ length: 5000 }, (_, i) => [`L${i + 1}`, 'x', 'y']);
    ajouterDocument(chemin, { id: 2, nom: 'Document 5000 lignes', blocs: [{ t: 'tableau', v: '', cols: ['A', 'B', 'C'], rows: lignes }] });
    ajouterDocument(chemin, { id: 3, nom: 'Document 600 lignes', blocs: [{ t: 'tableau', v: '', cols: ['A', 'B', 'C'], rows: lignes.slice(0, 600) }] });
    ajouterFichesA(chemin, 5000);
    executer(chemin, 'PRAGMA integrity_check');
    await hostile.demarrer();
    const page = hostile.page;

    ctx.etape('« __proto__ » et « constructor » affichés « — », barre de titre présente');
    await ouvrirDossier(page, 'Dossier fabriqué', 'Document proto');
    const variables = await page.$$eval('.paper .pv-var', (ps) => ps.map((p) => {
      const nom = p.querySelector('small')?.textContent ?? '';
      return [nom, p.textContent.slice(nom.length).trim()];
    }));
    egal(variables, [['__proto__', '—'], ['constructor', '—']], 'Variables hostiles affichées (nom, valeur)');
    verifier((await page.locator('.paper').innerText()).includes('Texte témoin'), 'Le reste du document s’affiche');
    verifier(await page.locator('.titlebar').isVisible(), 'La barre de titre reste affichée');
    egal(await page.locator('.titlebar .ctl button').count(), 3, 'Boutons de la barre de titre');
    await hostile.page.screenshot({ path: path.join(ctx.captures, 'bases', 'proto.png'), scale: 'css' }).catch(() => {});

    ctx.etape('tableau de 5 000 lignes : 200 rendues, « Afficher plus » en rend 200 de plus');
    await page.locator('.files .file', { hasText: 'Document 5000 lignes' }).click();
    await attendre(async () => (await page.locator('.paper tbody tr').count()) === 200, 'Le tableau doit rendre 200 lignes');
    const libelle = (await boutonPlus(page).innerText()).replace(/[\s ]+/g, ' ');
    egal(libelle, 'Afficher 200 lignes de plus (4 800 non affichées)', 'Bouton du rendu borné');
    await boutonPlus(page).click();
    await attendre(async () => (await page.locator('.paper tbody tr').count()) === 400, 'Le bouton doit rendre 200 lignes de plus');
    egal(await page.getByLabel('A, ligne 400', { exact: true }).inputValue(), 'L400', 'La 400e ligne est celle de la base');

    ctx.etape('tableau de 600 lignes déjà en base (au-delà des bornes) : reste modifiable sans grossir');
    await page.locator('.files .file', { hasText: 'Document 600 lignes' }).click();
    await attendre(async () => (await page.locator('.preview .pv-h b').innerText()).trim() === 'Document 600 lignes', 'Le document de 600 lignes ne s’affiche pas');
    await page.getByLabel('A, ligne 1', { exact: true }).fill('Modifiée e2e');
    const relu = await attendre(async () => {
      const d = (await hostile.appeler('dossier_detail', { id: 1 })).documents.find((x) => x.id === 3);
      const rows = d.blocs.find((b) => b.t === 'tableau').rows;
      return rows[0][0] === 'Modifiée e2e' ? rows : false;
    }, 'La modification d’une cellule du tableau de 600 lignes doit être enregistrée');
    egal(relu.length, 600, 'Nombre de lignes après modification');
    egal(await page.locator('.alert.bad').count(), 0, 'Aucune erreur affichée');

    ctx.etape('répertoire de 5 001 employés (base 1.0 migrée) : 200 rendus');
    await menu(page, 'Employés');
    await attendre(async () => (await page.locator('.content tbody tr').count()) === 200, 'Le répertoire doit rendre 200 fiches');
    verifier(await boutonPlus(page).isVisible(), 'Le bouton « Afficher plus » est proposé');
    await menu(page, 'Tableau de bord');
    await attendreTitre(page, 'Tableau de bord');
    await fermer(hostile);

    await basePiegeeRevue182(ctx);
  },
};

const COPIE_PARTAGEE = '0b1c2d3e-4f50-4617-8899-aabbccdd1820.pdf';

/**
 * Revue de sécurité 1.8.2 (docs/audit-securite.md, SEC-182-01 à 03 et non-régression du confinement à fichiers/) : base fabriquée dont les documents désignent des
 * fichiers hors de `fichiers/`, deux documents qui partagent une copie, une nomination au numéro de ligne extrême, un
 * document démesuré qui a choisi un mot-clé du Magasin.
 */
async function basePiegeeRevue182(ctx) {
  ctx.etape('revue 1.8.2 : noms de copie hostiles, copie partagée, numéro de ligne extrême, contenu démesuré au Magasin');
  const app = ctx.autreApplication('base-revue-182');
  const temoinDonnees = path.join(app.donnees, 'temoin-donnees.txt');
  const temoinVoisin = path.join(path.dirname(app.donnees), 'temoin-voisin.pdf');
  const hostiles = [
    '..\\temoin-donnees.txt',
    '../temoin-donnees.txt',
    '..\\..\\temoin-voisin.pdf',
    temoinVoisin,
    `\\\\?\\${temoinVoisin}`,
    `${COPIE_PARTAGEE}:flux`,
  ];
  const geant = JSON.stringify([{ t: 'magasin', v: 'Article', val: 'Clavier' }, { t: 'texte', v: 'x'.repeat(8_100_000) }]);
  const base = fabriquerBase(ctx.racine, app.donnees, { version: 6 });
  fs.writeFileSync(temoinDonnees, 'témoin');
  fs.writeFileSync(temoinVoisin, 'témoin voisin');
  fs.mkdirSync(path.join(app.donnees, 'fichiers'), { recursive: true });
  const copie = path.join(app.donnees, 'fichiers', COPIE_PARTAGEE);
  fs.writeFileSync(copie, '%PDF-1.4\n%%EOF\n');
  executer(base, `
    INSERT INTO dossiers (id, nom, annee, theme_id, statut_id, cree_le, maj_le)
      VALUES (2, 'Dossier partageant une copie', 2026, 1, 1, '2026-01-01 09:00:00', '2026-01-01 09:00:00'),
             (3, 'Dossier démesuré', 2026, 1, 1, '2026-01-01 09:00:00', '2026-01-01 09:00:00');
    INSERT INTO documents (id, dossier_id, nom, origine, source, date_doc, blocs, fichier_stocke, fichier_nom, cree_le) VALUES
      (10, 1, 'Copie partagée A', 'import', 'Fichier importé', '2026-01-15', '[]', '${COPIE_PARTAGEE}', 'a.pdf', '2026-01-15 09:00:00'),
      (11, 2, 'Copie partagée B', 'import', 'Fichier importé', '2026-01-15', '[]', '${COPIE_PARTAGEE}', 'b.pdf', '2026-01-15 09:00:00');
    INSERT INTO nominations (rowid, document_id, entite_id, facon, champ, depuis)
      VALUES (-9223372036854775808, 10, 1, 'texte', 'Champ', '2026-01-15 09:00:00');
    INSERT INTO magasin (id, nom) VALUES (1, 'Clavier');`);
  const db = new DatabaseSync(base);
  try {
    const inserer = db.prepare(`INSERT INTO documents (id, dossier_id, nom, origine, source, date_doc, blocs, fichier_stocke, fichier_nom, cree_le)
      VALUES (?, ?, ?, ?, 'Fichier importé', '2026-01-15', ?, ?, 'x.pdf', '2026-01-15 09:00:00')`);
    hostiles.forEach((h, i) => inserer.run(20 + i, 1, `Hostile ${i + 1}`, 'import', '[]', h));
    inserer.run(30, 3, 'Document démesuré', 'modele', geant, null);
  } finally {
    db.close();
  }
  await app.demarrer();
  await attendreTitre(app.page, 'Tableau de bord');

  ctx.etape('nomination au numéro de ligne extrême : le profil s’ouvre, l’application continue');
  const fiche = await app.appeler('entite_fiche', { id: 1 });
  verifier(fiche.evenements.some((e) => e.type === 'nomination'), 'La nomination fabriquée apparaît dans l’historique');
  await ouvrirFiche(app.page, 'a', 'Employé fabriqué');
  verifier(!app.termine, 'L’application tourne toujours après l’ouverture du profil');
  // L'employé du socle est incomplet : seul l'avertissement « Fiche à compléter » est attendu.
  const alertesProfil = (await texteErreur(app.page)).replace(/Fiche à compléter.*?Compléter la fiche/s, '').trim();
  egal(alertesProfil, '', 'Profil affiché sans autre alerte que « Fiche à compléter »');
  await menu(app.page, 'Tableau de bord');

  ctx.etape('Magasin : le document démesuré n’est ni compté ni réécrit');
  const t0 = Date.now();
  const [clavier] = await app.appeler('magasin_lister');
  egal([clavier.nom, clavier.nbDocuments], ['Clavier', 0], 'Mot-clé du Magasin (le contenu démesuré ne compte pas)');
  await app.appeler('magasin_renommer', { id: 1, nom: 'Clavier USB' });
  ctx.etape(`Magasin listé et renommé en ${Date.now() - t0} ms`);
  egal(lire(base, (d) => d.prepare('SELECT blocs FROM documents WHERE id = 30').get().blocs) === geant, true,
    'Le contenu démesuré n’est pas réécrit par le renommage');

  ctx.etape('copie partagée par deux documents : supprimer l’un garde la copie de l’autre');
  await app.appeler('document_supprimer', { id: 10 });
  verifier(fs.existsSync(copie), 'La copie référencée par un autre document est conservée');
  const autre = (await app.appeler('dossier_detail', { id: 2 })).documents.find((d) => d.id === 11);
  verifier(autre?.fichierChemin && path.resolve(autre.fichierChemin) === path.resolve(copie), 'L’autre document affiche toujours son fichier');

  ctx.etape('noms de copie hostiles : rien n’est exposé ni supprimé hors de fichiers/');
  const detail = await app.appeler('dossier_detail', { id: 1 });
  const hostilesLus = detail.documents.filter((d) => d.id >= 20 && d.id < 20 + hostiles.length);
  egal(hostilesLus.map((d) => [d.fichierChemin, d.ouvrable, d.apercu]), hostiles.map(() => [null, false, 'aucun']),
    'Documents hostiles : ni chemin, ni ouverture, ni aperçu');
  for (const d of hostilesLus.slice(0, 2)) {
    const r = await app.invoquer('document_ouvrir_externe', { id: d.id });
    verifier(!r.ok && r.erreur?.code === 'fichier_invalide', `Ouverture refusée pour « ${d.nom} » (${JSON.stringify(r)})`);
  }
  await app.appeler('document_supprimer', { id: 20 });
  await app.appeler('dossier_supprimer', { id: 1 });
  egal([fs.readFileSync(temoinDonnees, 'utf8'), fs.readFileSync(temoinVoisin, 'utf8')], ['témoin', 'témoin voisin'],
    'Les fichiers témoins hors de fichiers/ sont intacts');
  verifier(fs.existsSync(copie), 'La copie partagée existe toujours après la suppression du dossier');
  egal(await texteErreur(app.page), '', 'Aucune erreur affichée');
  await fermer(app);
}

/** Dossier de données réel de l'utilisateur (lecture seule : il est copié, jamais ouvert). */
function dossierReel() {
  return process.env.APPDATA ? path.join(process.env.APPDATA, 'fr.entitesdossiers.app') : null;
}

function copierDossier(de, vers) {
  fs.mkdirSync(vers, { recursive: true });
  for (const nom of ['donnees.sqlite', 'donnees.sqlite-wal', 'donnees.sqlite-shm']) {
    if (fs.existsSync(path.join(de, nom))) fs.copyFileSync(path.join(de, nom), path.join(vers, nom));
  }
  if (fs.existsSync(path.join(de, 'fichiers'))) fs.cpSync(path.join(de, 'fichiers'), path.join(vers, 'fichiers'), { recursive: true });
}

function empreintesReelles(dossier) {
  const r = {};
  for (const nom of ['donnees.sqlite', 'donnees.sqlite-wal', 'donnees.sqlite-shm']) r[nom] = empreinte(path.join(dossier, nom));
  const f = path.join(dossier, 'fichiers');
  r.fichiers = fs.existsSync(f) ? fs.readdirSync(f).sort().map((n) => `${n}:${empreinte(path.join(f, n))}`) : [];
  const s = path.join(dossier, 'sauvegardes');
  r.sauvegardes = fs.existsSync(s) ? fs.readdirSync(s, { recursive: true }).map(String).sort()
    .map((n) => `${n}:${fs.statSync(path.join(s, n)).isFile() ? empreinte(path.join(s, n)) : 'dossier'}`) : [];
  return r;
}

/** Valeur d'une cellule SQLite, comparable en JSON (les BLOB en hexadécimal). */
const cellule = (v) => (v instanceof Uint8Array ? `x'${Buffer.from(v).toString('hex')}'` : typeof v === 'bigint' ? String(v) : v);

/**
 * Instantané complet d'une base : version, schéma (tables, index) et chaque ligne de chaque table, dans l'ordre des
 * rowid. Lecture seule (sur une copie : jamais sur le dossier réel).
 */
export function instantane(chemin) {
  return lire(chemin, (db) => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
    const out = {
      version: db.prepare('PRAGMA user_version').get().user_version,
      schema: db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all()
        .map((r) => [r.type, r.name, r.tbl_name, r.sql]),
      tables: {},
    };
    for (const t of tables) {
      const cols = db.prepare(`PRAGMA table_info("${t}")`).all().map((r) => r.name);
      const rows = db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all().map((r) => cols.map((c) => cellule(r[c])));
      out.tables[t] = { cols, rows };
    }
    return out;
  });
}

/**
 * Lignes d'avant absentes d'après : pour chaque table d'avant, chaque ligne (sur les colonnes d'avant) doit exister
 * à l'identique après. Renvoie la liste des pertes (vide si rien n'est perdu).
 */
export function pertes(avant, apres) {
  const out = [];
  for (const [t, { cols, rows }] of Object.entries(avant.tables)) {
    const a = apres.tables[t];
    if (!a) { out.push(`table ${t} disparue`); continue; }
    const idx = cols.map((c) => a.cols.indexOf(c));
    if (idx.includes(-1)) { out.push(`table ${t} : colonne(s) ${cols.filter((_, i) => idx[i] < 0).join(', ')} disparue(s)`); continue; }
    const restantes = new Map();
    for (const r of a.rows) {
      const k = JSON.stringify(idx.map((i) => r[i]));
      restantes.set(k, (restantes.get(k) ?? 0) + 1);
    }
    let n = 0;
    for (const r of rows) {
      const k = JSON.stringify(r);
      if (restantes.get(k)) restantes.set(k, restantes.get(k) - 1);
      else if (n++ < 5) out.push(`table ${t} : ligne perdue ou modifiée ${k.slice(0, 200)}`);
    }
    if (n > 5) out.push(`table ${t} : ${n - 5} autre(s) ligne(s) perdue(s) ou modifiée(s)`);
  }
  return out;
}

/** Nombres relevés avant / après une migration (rapport). */
const COMPTES = { fiches: 'entites', affectations: 'affectations', dossiers: 'dossiers', documents: 'documents', nominations: 'nominations',
  evenements: 'evenements' };
const comptes = (inst) => Object.fromEntries(Object.entries(COMPTES).map(([k, t]) => [k, inst.tables[t]?.rows.length ?? null]));


/** Lit une base (copie) : comptes, version du schéma, fiches, liens employé ↔ machine. */
function etatBase(chemin) {
  return lire(chemin, (db) => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
    const colonnes = db.prepare('PRAGMA table_info(entites)').all().map((r) => r.name);
    // Liens entre fiches : associations (versions 1 et 2) ou affectations en cours (version 3), avec leur date de début.
    const liens = tables.includes('associations')
      ? db.prepare('SELECT a_id, b_id, cree_le AS debut FROM associations ORDER BY a_id, b_id').all()
      : db.prepare('SELECT a_id, b_id, debut FROM affectations WHERE fin IS NULL ORDER BY a_id, b_id').all();
    // État de chaque dossier : colonne `statut` (versions 1 à 3) ou état rattaché (version 4), par son rôle.
    const etats = tables.includes('statuts')
      ? db.prepare('SELECT d.nom, s.role FROM dossiers d JOIN statuts s ON s.id = d.statut_id ORDER BY d.id').all()
      : db.prepare('SELECT nom, statut AS role FROM dossiers ORDER BY id').all();
    const colonnesA = ['prenom', 'date_naissance', 'poste'].every((c) => colonnes.includes(c));
    return {
      a: db.prepare("SELECT COUNT(*) AS n FROM entites WHERE kind = 'a'").get().n,
      b: db.prepare("SELECT COUNT(*) AS n FROM entites WHERE kind = 'b'").get().n,
      dossiers: db.prepare('SELECT COUNT(*) AS n FROM dossiers').get().n,
      documents: db.prepare('SELECT COUNT(*) AS n FROM documents').get().n,
      sousDossiers: db.prepare('SELECT COUNT(*) AS n FROM sous_dossiers').get().n,
      liens: liens.map((r) => [r.a_id, r.b_id, r.debut]),
      affectationsTerminees: tables.includes('affectations') ? db.prepare('SELECT COUNT(*) AS n FROM affectations WHERE fin IS NOT NULL').get().n : 0,
      version: db.prepare('PRAGMA user_version').get().user_version,
      machines: db.prepare("SELECT id, nom, code FROM entites WHERE kind = 'b' ORDER BY id").all().map((r) => [r.id, r.nom, r.code]),
      employes: db.prepare(`SELECT id, nom, ${colonnes.includes('libelle') ? 'libelle' : 'nom AS libelle'}, code FROM entites WHERE kind = 'a' ORDER BY id`)
        .all().map((r) => [r.id, r.nom, r.libelle, r.code]),
      // Rattachement des dossiers (versions 1 à 4) ; les colonnes disparaissent à la version 5 (§ 11.5).
      dossiersFiches: db.prepare('PRAGMA table_info(dossiers)').all().some((r) => r.name === 'a_id')
        ? db.prepare('SELECT nom, a_id, b_id FROM dossiers ORDER BY id').all().map((r) => [r.nom, r.a_id, r.b_id])
        : null,
      documentsParDossier: db.prepare('SELECT id, dossier_id, sous_dossier_id, nom FROM documents ORDER BY id').all()
        .map((r) => [r.id, r.dossier_id, r.sous_dossier_id, r.nom]),
      etatsDossiers: etats.map((r) => [r.nom, r.role]),
      // Employé complet (nom, prénom, date de naissance, poste) : il doit avoir un identifiant après la migration.
      complets: colonnesA
        ? db.prepare(`SELECT id FROM entites WHERE kind = 'a' AND trim(nom) <> '' AND trim(prenom) <> '' AND date_naissance IS NOT NULL
                      AND trim(poste) <> '' ORDER BY id`).all().map((r) => r.id)
        : [],
      affectations: tables.includes('affectations')
        ? db.prepare('SELECT a_id, b_id, debut, fin FROM affectations ORDER BY id').all().map((r) => [r.a_id, r.b_id, r.debut, r.fin])
        : [],
      nomsDossiers: db.prepare('SELECT nom FROM dossiers ORDER BY id').all().map((r) => r.nom),
      nomsDocuments: db.prepare('SELECT nom FROM documents ORDER BY id').all().map((r) => r.nom),
    };
  });
}

// ───────────────────────── relevé « avant » d'une base de la version 1.3 (§ 10.4), lu en SQL ─────────────────────────

/** Texte replié pour comparer : minuscules, sans accents (« Œ » → « oe »). */
const replier = (s) => String(s ?? '').toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').normalize('NFD').replace(/[̀-ͯ]/g, '');
const LETTRE = /[\p{L}\p{N}]/u;
/** Mots repliés d'un texte, chacun avec `lie` : il suit le précédent sans autre séparateur qu'espace, tiret ou apostrophe. */
function motsLies(s) {
  const v = [];
  let courant = '';
  let coupe = false;
  for (const c of replier(s)) {
    if (LETTRE.test(c)) { courant += c; continue; }
    if (courant) { v.push([courant, v.length > 0 && !coupe]); courant = ''; coupe = false; }
    if (!/[ \t  '’-]/.test(c)) coupe = true;
  }
  if (courant) v.push([courant, v.length > 0 && !coupe]);
  return v;
}
const mots = (s) => motsLies(s).map(([m]) => m);
/** Nom et prénom d'un employé écrits ensemble (dans un ordre ou l'autre), en mots entiers liés. */
function employeEcrit(texte, nom, prenom) {
  const n = mots(nom);
  const p = mots(prenom);
  if (!n.length || !p.length) return false;
  const m = motsLies(texte);
  return [[...n, ...p], [...p, ...n]].some((suite) => m.some((_, i) => i + suite.length <= m.length
    && suite.every((s, j) => m[i + j][0] === s && (j === 0 || m[i + j][1]))));
}
/** Identifiant de machine écrit en mot entier (ni lettre ni chiffre collé, ni morceau d'identifiant qui le prolonge). */
function machineEcrite(texte, code) {
  const c = replier(code ?? '').trim();
  if ([...c].filter((x) => LETTRE.test(x)).length < 3) return false;
  const t = replier(texte);
  const frontiere = (v, au) => v === undefined || (!LETTRE.test(v) && !('-_./\\#+'.includes(v) && au !== undefined && LETTRE.test(au)));
  for (let i = t.indexOf(c); i >= 0; i = t.indexOf(c, i + 1)) {
    if (frontiere(t[i - 1], t[i - 2]) && frontiere(t[i + c.length], t[i + c.length + 1])) return true;
  }
  return false;
}
/** Anciens noms de variables (version 1.0). */
const VARIABLES_ANCIENNES = { 'Entité A · Nom': 'Employé · Nom', 'Entité A · Code': 'Employé · Identifiant', 'Entité B · Nom': 'Machine · Nom', 'Entité B · Code unique': 'Machine · Identifiant' };
const ou = (s) => String(s ?? '').trim() || '—';
const dateJJMMAAAA = (iso) => (/^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '') ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
/** Valeur d'une variable telle que la version 1.3 l'affichait : fiches du dossier (`a`, `b`), date du document. */
function valeurVariable13(nom, a, b, dateDoc) {
  const n = VARIABLES_ANCIENNES[nom] ?? nom;
  const t = {
    'Employé · Nom': a ? ou(a.nom) : '—', 'Employé · Prénom': a ? ou(a.prenom) : '—', 'Employé · Poste': a ? ou(a.poste) : '—',
    'Employé · Structure': a ? ou(a.categorie) : '—', 'Employé · Identifiant': a ? (a.code || 'Fiche à compléter') : '—',
    'Machine · Nom': b ? ou(b.nom) : '—', 'Machine · Identifiant': b ? (b.code || 'Sans identifiant') : '—',
    'Machine · Marque et modèle': b ? ou(b.marque) : '—', 'Machine · Processeur': b ? ou(b.cpu) : '—', 'Machine · RAM': b ? ou(b.ram) : '—',
    'Machine · Stockage': b ? ou(b.stockage) : '—', 'Date du jour': dateJJMMAAAA(dateDoc),
  };
  return [n, Object.prototype.hasOwnProperty.call(t, n) ? t[n] : '—'];
}

/**
 * Relevé d'une base de la version 1.3 (user_version 4), selon ses propres règles (§ 10.4) : pour chaque fiche, les
 * documents où elle figure (bloc qui la désigne, fiche du dossier, nom ou identifiant écrit) et ses dossiers liés ;
 * pour chaque dossier, son état et ses documents ; pour chaque document, les variables affichées.
 */
export function releve13(chemin) {
  return lire(chemin, (db) => {
    const entites = db.prepare(`SELECT e.id, e.kind, e.nom, e.prenom, e.code, e.libelle, e.actif, e.poste, e.marque, e.cpu, e.ram, e.stockage,
                                       c.nom AS categorie FROM entites e JOIN categories c ON c.id = e.categorie_id ORDER BY e.id`).all();
    const parId = new Map(entites.map((e) => [e.id, e]));
    const dossiers = db.prepare(`SELECT d.id, d.nom, d.a_id, d.b_id, s.role, s.nom AS statut FROM dossiers d JOIN statuts s ON s.id = d.statut_id
                                 ORDER BY d.id`).all();
    const docs = db.prepare('SELECT id, dossier_id, sous_dossier_id, nom, origine, blocs, date_doc FROM documents ORDER BY id').all();
    const fiches = new Map(entites.map((e) => [e.id, { libelle: e.libelle, kind: e.kind, actif: !!e.actif, documents: new Set(), dossiers: new Set() }]));
    const variables = [];
    for (const d of dossiers) {
      for (const id of [d.a_id, d.b_id]) if (fiches.has(id)) fiches.get(id).dossiers.add(d.id);
    }
    for (const x of docs) {
      const d = dossiers.find((y) => y.id === x.dossier_id);
      let blocs = null;
      try { blocs = x.blocs ? JSON.parse(x.blocs) : null; } catch { blocs = null; }
      const lisibles = Array.isArray(blocs) ? blocs.filter((b) => b && typeof b === 'object') : [];
      const textes = lisibles.flatMap((b) => ((b.t === 'champ' || b.t === 'zone') && typeof b.val === 'string' ? [b.val]
        : b.t === 'tableau' && Array.isArray(b.rows) ? b.rows.flat().filter((c) => typeof c === 'string') : []));
      for (const e of entites) {
        const designe = lisibles.some((b) => b.t === (e.kind === 'a' ? 'employe' : 'machine') && b.entiteId === e.id);
        const duDossier = d && (e.kind === 'a' ? d.a_id : d.b_id) === e.id;
        const ecrit = textes.some((t) => (e.kind === 'a' ? employeEcrit(t, e.nom, e.prenom) : machineEcrite(t, e.code)));
        if (designe || duDossier || ecrit) {
          fiches.get(e.id).documents.add(x.id);
          fiches.get(e.id).dossiers.add(x.dossier_id);
        }
      }
      const vars = lisibles.filter((b) => b.t === 'variable');
      if (x.origine === 'modele' && vars.length) {
        variables.push({ id: x.id, dossierId: x.dossier_id, sousDossierId: x.sous_dossier_id, nom: x.nom,
          valeurs: vars.map((b) => valeurVariable13(String(b.v ?? ''), parId.get(d?.a_id) ?? null, parId.get(d?.b_id) ?? null, x.date_doc)) });
      }
    }
    return {
      fiches: [...fiches].map(([id, f]) => ({ id, ...f, documents: [...f.documents].sort((p, q) => p - q), dossiers: [...f.dossiers].sort((p, q) => p - q) })),
      dossiers: dossiers.map((d) => ({ id: d.id, nom: d.nom, role: d.role, statut: d.statut,
        documents: docs.filter((x) => x.dossier_id === d.id).map((x) => [x.id, x.sous_dossier_id, x.nom]) })),
      variables,
    };
  });
}

/**
 * Relevé d'une base de la version 1.4 ou 1.5 (user_version 5 ou 6), selon ses propres règles (§ 11) : pour chaque fiche,
 * les documents où elle est nommée (table `nominations`) et ses dossiers liés (dossiers de ces documents) ; pour chaque
 * dossier, son état et ses documents ; pour chaque document issu d'un modèle, les variables affichées (fiche du premier
 * bloc Employé / Machine qui en désigne une, ou sa copie si elle a été supprimée, § 13.3).
 */
export function releve14(chemin) {
  return lire(chemin, (db) => {
    const entites = db.prepare(`SELECT e.id, e.kind, e.nom, e.prenom, e.code, e.libelle, e.actif, e.poste, e.marque, e.cpu, e.ram, e.stockage,
                                       c.nom AS categorie FROM entites e JOIN categories c ON c.id = e.categorie_id ORDER BY e.id`).all();
    const parId = new Map(entites.map((e) => [e.id, e]));
    const dossiers = db.prepare(`SELECT d.id, d.nom, s.role, s.nom AS statut FROM dossiers d JOIN statuts s ON s.id = d.statut_id ORDER BY d.id`).all();
    const docs = db.prepare('SELECT id, dossier_id, sous_dossier_id, nom, origine, blocs, date_doc FROM documents ORDER BY id').all();
    const dossierDe = new Map(docs.map((x) => [x.id, x.dossier_id]));
    const fiches = new Map(entites.map((e) => [e.id, { libelle: e.libelle, kind: e.kind, actif: !!e.actif, documents: new Set(), dossiers: new Set() }]));
    for (const n of db.prepare('SELECT DISTINCT entite_id, document_id FROM nominations').all()) {
      const f = fiches.get(n.entite_id);
      if (!f) continue;
      f.documents.add(n.document_id);
      f.dossiers.add(dossierDe.get(n.document_id));
    }
    const variables = [];
    for (const x of docs) {
      let blocs = null;
      try { blocs = x.blocs ? JSON.parse(x.blocs) : null; } catch { blocs = null; }
      const lisibles = Array.isArray(blocs) ? blocs.filter((b) => b && typeof b === 'object') : [];
      const vars = lisibles.filter((b) => b.t === 'variable');
      if (x.origine !== 'modele' || !vars.length) continue;
      const premiere = (t, kind) => {
        for (const b of lisibles) {
          if (b.t !== t) continue;
          if (typeof b.entiteId !== 'number') {
            const s = b.ficheSupprimee;
            if (s && typeof s === 'object' && s.kind === kind) return s;
            continue;
          }
          const e = parId.get(b.entiteId);
          if (e && e.kind === kind) return e;
        }
        return null;
      };
      variables.push({ id: x.id, dossierId: x.dossier_id, sousDossierId: x.sous_dossier_id, nom: x.nom,
        valeurs: vars.map((b) => valeurVariable13(String(b.v ?? ''), premiere('employe', 'a'), premiere('machine', 'b'), x.date_doc)) });
    }
    return {
      fiches: [...fiches].map(([id, f]) => ({ id, ...f, documents: [...f.documents].sort((p, q) => p - q), dossiers: [...f.dossiers].sort((p, q) => p - q) })),
      dossiers: dossiers.map((d) => ({ id: d.id, nom: d.nom, role: d.role, statut: d.statut,
        documents: docs.filter((x) => x.dossier_id === d.id).map((x) => [x.id, x.sous_dossier_id, x.nom]) })),
      variables,
    };
  });
}

/** Ouvre un document dans son dossier, en passant par ses sous-dossiers. */
async function ouvrirDocumentDuDossier(page, detail, doc) {
  await ouvrirDossier(page, detail.dossier.nom);
  const chemin = [];
  for (let s = detail.sousDossiers.find((x) => x.id === doc.sousDossierId); s; s = detail.sousDossiers.find((x) => x.id === s.parentId)) chemin.unshift(s.nom);
  for (const nom of chemin) {
    await page.locator('.folder.sub', { has: page.locator('b', { hasText: new RegExp(`^${echapper(nom)}$`) }) }).click();
    await attendreTitre(page, nom);
  }
  await ouvrirDocument(page, doc.nom);
}

/** Variables affichées par le papier : [[nom, valeur]]. */
const variablesAffichees = (page) => page.$$eval('.paper .pv-var', (ps) => ps.map((p) => {
  const nom = p.querySelector('small')?.textContent ?? '';
  return [nom.trim(), p.textContent.slice(nom.length).trim()];
}));

/** Sauvegardes d'un dossier de données (noms des sous-dossiers de `sauvegardes`). */
const sauvegardesDe = (donnees) => (fs.existsSync(path.join(donnees, 'sauvegardes')) ? fs.readdirSync(path.join(donnees, 'sauvegardes')) : []);

/**
 * Migration d'une base réelle (copiée par `copier` dans le dossier de travail, jamais ouverte à sa place) jusqu'à la
 * version 6, depuis la version qu'elle a réellement : sauvegarde « avant-version-<v+1>_… » identique à la base d'origine
 * (rien pour une base déjà en version 6), fiches, dossiers, documents, profils (back et écran), variables affichées,
 * journal ; pour une base 1.4 ou 1.5, chaque ligne de chaque table conservée à l'identique. Renvoie les nombres relevés.
 */
async function migrerUneCopie(ctx, { nom, copier, quoi, capture }) {
  const app = ctx.autreApplication(nom);
  copier(app.donnees);
  // Relevé « avant », sur une seconde copie (la lecture ne touche pas celle que l'application ouvrira).
  const lecture = path.join(path.dirname(app.donnees), 'lecture');
  copier(lecture);
  const base = path.join(lecture, 'donnees.sqlite');
  const attendu = etatBase(base);
  const v = attendu.version;
  verifier([4, 5, 6].includes(v), `${quoi} : base de la version 1.3, 1.4 ou 1.5 attendue (user_version 4, 5 ou 6), obtenu ${v}`);
  const instAvant = instantane(base);
  const avant = v === 4 ? releve13(base) : releve14(base);
  const nbLiensDocs = avant.fiches.reduce((n, f) => n + f.documents.length, 0);
  const nbLiensDossiers = avant.fiches.reduce((n, f) => n + f.dossiers.length, 0);
  ctx.etape(`${quoi} (user_version ${v}) : ${attendu.a} employés, ${attendu.b} machines, ${attendu.dossiers} dossiers, ${attendu.documents} documents ; `
    + `${nbLiensDocs} documents et ${nbLiensDossiers} dossiers liés sur les profils, ${avant.variables.length} documents à variables`);
  const cap = (n) => app.page.screenshot({ path: path.join(ctx.captures, 'bases', `${capture}-${n}.png`), scale: 'css' });
  const avantMigration = sauvegardesDe(lecture);

  await app.demarrer();
  const page = app.page;
  await attendreTitre(page, 'Tableau de bord');
  verifier(await page.locator('.titlebar').isVisible(), 'Barre de titre affichée');

  const nouvelles = sauvegardesDe(app.donnees).filter((n) => !avantMigration.includes(n));
  if (v < 6) {
    ctx.etape(`sauvegarde « avant-version-${v + 1}_… » faite avant la migration, identique à la base d’origine`);
    egal(nouvelles.length, 1, `Une seule nouvelle sauvegarde dans sauvegardes/ (${nouvelles.join(', ') || 'aucune'})`);
    verifier(new RegExp(`^avant-version-${v + 1}_\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2}(-\\d+)?$`).test(nouvelles[0]), `Nom de la sauvegarde : ${nouvelles[0]}`);
    const copieAvant = path.join(app.donnees, 'sauvegardes', nouvelles[0], 'donnees.sqlite');
    verifier(fs.existsSync(copieAvant), 'La sauvegarde contient donnees.sqlite');
    egal(instantane(copieAvant), instAvant, 'La sauvegarde est la base d’origine, à l’identique (schéma, version, chaque ligne de chaque table)');
    egal(etatBase(copieAvant), attendu, 'La sauvegarde est la base d’origine complète, non migrée');
  } else {
    egal(nouvelles, [], 'Base déjà en version 6 : aucune sauvegarde');
  }

  ctx.etape('fiches, dossiers et documents lus par la version 1.5 : rien de perdu');
  const a = await app.appeler('entites_lister', { kind: 'a' });
  const b = await app.appeler('entites_lister', { kind: 'b' });
  const dossiers = await app.appeler('dossiers_lister');
  egal({ a: a.length, b: b.length, dossiers: dossiers.length }, { a: attendu.a, b: attendu.b, dossiers: attendu.dossiers }, 'Fiches et dossiers repris');
  egal(b.map((e) => [e.id, e.nom, e.code]).sort((x, y) => x[0] - y[0]), attendu.machines, 'Machines reprises avec leur identifiant');
  // Une base 1.3 voit ses identifiants d'employés recalculés (§ 10.5 : c'était la migration 004, déjà faite) : ils sont
  // comparés tels qu'ils sont dans la base d'origine.
  egal(a.map((e) => [e.id, e.nom, e.libelle, e.code]).sort((x, y) => x[0] - y[0]), attendu.employes, 'Employés repris avec leur identifiant');
  const details = new Map();
  for (const d of dossiers) details.set(d.id, await app.appeler('dossier_detail', { id: d.id }));
  const manques = [];
  for (const d of avant.dossiers) {
    const r = dossiers.find((x) => x.id === d.id);
    if (!r) { manques.push(`dossier ${d.nom} disparu`); continue; }
    if (r.nom !== d.nom || r.statut.role !== d.role || r.statut.nom !== d.statut) manques.push(`dossier ${d.nom} : état ${d.statut} → ${r.statut.nom}`);
    const docs = details.get(d.id).documents.map((x) => [x.id, x.sousDossierId, x.nom]);
    for (const x of d.documents) if (!docs.some((y) => JSON.stringify(y) === JSON.stringify(x))) manques.push(`dossier ${d.nom} : document ${x[2]} (${x[0]}) disparu ou déplacé`);
  }
  egal(manques, [], 'Chaque dossier garde son nom, son état et tous ses documents, à leur place');

  ctx.etape('fiche par fiche : chaque document et chaque dossier lié d’avant est encore sur le profil');
  const nbApres = { documents: 0, dossiers: 0 };
  for (const f of avant.fiches) {
    const fiche = await app.appeler('entite_fiche', { id: f.id });
    const docs = fiche.documents.map((x) => x.id);
    const dl = fiche.dossiers.map((x) => x.id);
    nbApres.documents += docs.length;
    nbApres.dossiers += dl.length;
    for (const id of f.documents) if (!docs.includes(id)) manques.push(`${f.libelle} : document ${id} n’est plus sur son profil`);
    for (const id of f.dossiers) if (!dl.includes(id)) manques.push(`${f.libelle} : dossier lié ${id} n’est plus sur son profil`);
    for (const x of fiche.documents) {
      if (!x.facons.length || !Array.isArray(x.champs) || !x.champs.length || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(x.depuis)) {
        manques.push(`${f.libelle} : nomination incomplète dans ${x.nom} (${JSON.stringify([x.facons, x.champs, x.depuis])})`);
      }
    }
  }
  egal(manques, [], 'Aucun document ni dossier lié perdu sur les profils');
  ctx.etape(`après : ${nbApres.documents} documents et ${nbApres.dossiers} dossiers liés sur les profils (avant : ${nbLiensDocs} et ${nbLiensDossiers})`);

  ctx.etape('profils à l’écran (fiches actives) : mêmes documents que dans le back');
  let capturee = false;
  for (const f of avant.fiches.filter((x) => x.actif)) {
    const e = [...a, ...b].find((x) => x.id === f.id);
    await ouvrirFiche(page, f.kind, e.libelle, e.kind === 'a' ? (e.code ?? undefined) : undefined);
    const fiche = await app.appeler('entite_fiche', { id: f.id });
    if (!fiche.documents.length) continue;
    const affiches = await attendre(async () => {
      const x = await documentsCites(page, f.kind);
      return x.length === Math.min(fiche.documents.length, 50) ? x : false;
    }, `Documents affichés sur le profil de ${e.libelle}`);
    for (const id of f.documents) {
      const x = fiche.documents.find((y) => y.id === id);
      if (affiches.length < 50) verifier(affiches.some((y) => y.doc === x.nom && y.dossier === x.dossierNom), `${e.libelle} : ${x.nom} (${x.dossierNom}) affiché sur le profil`);
    }
    if (!capturee && fiche.documents.length >= 4) {
      await capturePageEntiere({ ...ctx, page, app, capture: (n) => page.screenshot({ path: path.join(ctx.captures, `${n}.png`), scale: 'css' }) },
        `bases/${capture}-profil`);
      capturee = true;
    }
  }

  ctx.etape(`variables de ${avant.variables.length} documents, affichées à l’écran : les mêmes qu’avant`);
  for (const x of avant.variables) {
    await ouvrirDocumentDuDossier(page, details.get(x.dossierId), x);
    const obtenu = await attendre(async () => {
      const y = await variablesAffichees(page);
      return y.length === x.valeurs.length ? y : false;
    }, `Variables du document ${x.nom} (${details.get(x.dossierId).dossier.nom})`);
    egal(obtenu, x.valeurs, `Variables de ${x.nom} (${details.get(x.dossierId).dossier.nom}), comme avant la migration`);
  }
  if (avant.variables.length) await cap('document-variables');

  // Textes saisis par l'utilisateur dans sa base : gardés tels quels par la migration, ils ne comptent pas comme
  // libellés de l'interface dans le contrôle du vocabulaire.
  const donneesUtilisateur = [...new Set([
    ...a.flatMap((e) => [e.nom, e.libelle, e.categorie, e.prenom, e.poste, e.code]),
    ...b.flatMap((e) => [e.nom, e.libelle, e.categorie, e.code, e.marque, e.cpu, e.ram, e.stockage]),
    ...dossiers.flatMap((d) => [d.nom, d.theme]),
    ...(await app.appeler('modeles_lister')).flatMap((m) => [m.nom, ...m.blocs.flatMap((x) => (x.t === 'variable' ? [] : [x.v, ...(x.cols ?? [])]))]),
    ...(await app.appeler('magasin_lister')).map((m) => m.nom),
    ...[...details.values()].flatMap((det) => [...det.sousDossiers.map((s) => s.nom), ...det.documents.flatMap((x) => [x.nom, x.source])]),
  ].filter((s) => typeof s === 'string' && s.trim().length > 1))];
  await menu(page, 'Tableau de bord');
  await cap('tableau-de-bord');
  for (const p of await page.evaluate(controleVocabulaire, donneesUtilisateur)) throw new Echec(`Tableau de bord de la base migrée : ancien vocabulaire ${p}`);
  const standards = (await app.appeler('modeles_lister')).filter((m) => m.standard).map((m) => m.nom).sort();
  verifier(['État des besoins', 'Fiche d’identification', 'Fiche d’intervention informatique', 'Fiche pour formatage PC'].every((n) => standards.includes(n))
    || v >= 5, `Modèles standards présents après la migration (${standards.join(', ')})`);
  await fermer(app);

  ctx.etape('la copie est en version 6 ; une relance ne refait ni migration ni sauvegarde ; le journal est conservé');
  const cheminApres = path.join(app.donnees, 'donnees.sqlite');
  const apres = etatBase(cheminApres);
  egal([apres.version, apres.a, apres.b, apres.dossiers, apres.sousDossiers, apres.liens, apres.affectationsTerminees, apres.etatsDossiers, apres.affectations],
    [6, attendu.a, attendu.b, attendu.dossiers, attendu.sousDossiers, attendu.liens, attendu.affectationsTerminees, attendu.etatsDossiers, attendu.affectations],
    'Base migrée (version 6, comptes, états, affectations)');
  for (const x of attendu.documentsParDossier) {
    verifier(apres.documentsParDossier.some((y) => JSON.stringify(y) === JSON.stringify(x)), `Document ${x[3]} (${x[0]}) conservé dans la base migrée`);
  }
  const instApres = instantane(cheminApres);
  const journal = (inst) => {
    const { cols, rows } = inst.tables.evenements;
    const k = ['id', 'type', 'titre', 'detail', 'date'].map((c) => cols.indexOf(c));
    return rows.map((r) => JSON.stringify(k.map((i) => r[i])));
  };
  const journalApres = new Set(journal(instApres));
  egal(journal(instAvant).filter((x) => !journalApres.has(x)), [], 'Journal conservé (chaque événement d’avant est toujours là)');
  // 1.4 → 1.5 : la migration 006 n'ajoute que deux colonnes ; chaque ligne d'avant doit être là, à l'identique.
  if (v >= 5) egal(pertes(instAvant, instApres), [], 'Chaque ligne de chaque table est conservée à l’identique');
  const colonnes = instApres.tables.evenements.cols;
  verifier(colonnes.includes('a_libelle_supprime') && colonnes.includes('b_libelle_supprime'), 'Colonnes de la version 6 dans le journal');
  const relance = ctx.autreApplication(`${nom}-relance`);
  fs.rmSync(path.dirname(relance.donnees), { recursive: true, force: true });
  fs.cpSync(app.donnees, relance.donnees, { recursive: true });
  const nbSauvegardes = sauvegardesDe(relance.donnees).length;
  await relance.demarrer();
  await attendreTitre(relance.page, 'Tableau de bord');
  await fermer(relance);
  egal(sauvegardesDe(relance.donnees).length, nbSauvegardes, 'Aucune nouvelle sauvegarde à la relance');
  return { quoi, version: v, sauvegarde: nouvelles[0] ?? null, avant: comptes(instAvant), apres: comptes(instApres) };
}

export const compatibilite = {
  id: 'migration',
  titre: 'Copie de la vraie base : sauvegardée, migrée jusqu’à la version 6 depuis sa version réelle (et depuis sa sauvegarde de la 1.3, si elle existe), rien de perdu ; original intact',
  sansApplication: true,
  indisponible(ctx, args) {
    if (args.sansBaseReelle) return 'option --sans-base-reelle';
    const d = dossierReel();
    if (!d || !fs.existsSync(path.join(d, 'donnees.sqlite'))) return `aucune base réelle dans ${d}`;
    return null;
  },
  async executer(ctx) {
    fs.mkdirSync(path.join(ctx.captures, 'bases'), { recursive: true });
    const reel = dossierReel();
    const empreintesAvant = empreintesReelles(reel);
    const resultats = [];

    ctx.etape(`copie de ${reel} (base, -wal, -shm, fichiers) dans le dossier de travail`);
    resultats.push(await migrerUneCopie(ctx, { nom: 'compatibilite', copier: (vers) => copierDossier(reel, vers), quoi: 'base réelle', capture: 'migration' }));

    // Sauvegarde faite par la 1.4 avant de migrer la base de la 1.3 : la même base, telle qu'elle était en 1.3.
    const s13 = sauvegardesDe(reel).filter((n) => /^avant-version-5_/.test(n)).sort().pop();
    if (s13) {
      ctx.etape(`copie de la sauvegarde ${s13} (base de la 1.3) : migration 1.3 → 1.5`);
      resultats.push(await migrerUneCopie(ctx, {
        nom: 'compatibilite-13',
        copier: (vers) => {
          fs.mkdirSync(vers, { recursive: true });
          fs.copyFileSync(path.join(reel, 'sauvegardes', s13, 'donnees.sqlite'), path.join(vers, 'donnees.sqlite'));
          if (fs.existsSync(path.join(reel, 'fichiers'))) fs.cpSync(path.join(reel, 'fichiers'), path.join(vers, 'fichiers'), { recursive: true });
        },
        quoi: `sauvegarde ${s13}`,
        capture: 'migration-13',
      }));
    } else {
      ctx.etape('aucune sauvegarde « avant-version-5_… » dans le dossier réel : cas 1.3 → 1.5 non joué');
    }
    fs.writeFileSync(path.join(ctx.captures, 'bases', 'migration-comptes.json'), JSON.stringify(resultats, null, 2));
    for (const r of resultats) ctx.etape(`${r.quoi} (version ${r.version}) : avant ${JSON.stringify(r.avant)} ; après ${JSON.stringify(r.apres)}`);
    egal(empreintesReelles(reel), empreintesAvant, 'Le dossier de données réel n’est pas modifié');
  },
};
