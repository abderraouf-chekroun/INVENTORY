// Suite de bout en bout d'INVENTORY, sur la version de production.
//
//   npm run e2e                      exécutable déjà construit (src-tauri/target/release/inventory.exe)
//   npm run e2e:build                construit d'abord la version de production (sans installateur), puis lance la suite
//   npm run e2e -- --captures <dir>  dossier des captures d'écran (défaut : tests/e2e/resultats/captures)
//   npm run e2e -- --seulement fiches,dossiers   ne lance que ces scénarios (« premier-lancement » et « donnees-exemple » sont toujours joués)
//   npm run e2e -- --garder          conserve le dossier de données de test, même en cas de succès
//   npm run e2e -- --exe <chemin>    autre exécutable
//   npm run e2e -- --sans-base-reelle  ne joue pas le contrôle de migration sur une copie de la vraie base
//
// L'application est lancée sur un dossier de données vierge créé dans le dossier temporaire du système
// (variable ENTITES_DOSSIERS_DONNEES), avec un profil WebView2 isolé : les données de l'utilisateur
// ne sont jamais modifiées. Seul le scénario « migration » les lit : il COPIE le dossier de données
// réel (%APPDATA%\fr.entitesdossiers.app) dans le dossier de travail et lance l'application sur la copie.
// L'application étant à instance unique, aucune autre instance ne doit être ouverte pendant la suite.
// Il faut une session Windows visible et un poste où l'on est seul connecté (le port de débogage de
// WebView2 est ouvert sur 127.0.0.1) : la suite pilote la vraie souris (glisser-déposer du Studio) et le
// vrai clavier (sélecteur de fichier natif), par outils/windows.ps1. Ne touchez ni la souris ni le
// clavier pendant la suite.
//
// Chaque scénario rend un verdict. En plus de ses propres contrôles, un scénario échoue si, pendant qu'il
// se déroule, la console affiche une erreur ou un avertissement, si une violation de CSP est signalée,
// ou si une requête part vers autre chose que l'application elle-même.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Application, processusEnCours } from './outils/application.mjs';
import { Echec } from './outils/verifs.mjs';
import { fermerWindows } from './outils/windows.mjs';
import { verifierExecutable as verifierLivraison } from '../../scripts/compilation.mjs';
import { SCENARIOS } from './scenarios/index.mjs';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function lireArguments(argv) {
  const a = { seulement: null, garder: false, exe: null, captures: null, sortie: null, sansBaseReelle: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--garder') a.garder = true;
    else if (x === '--sans-base-reelle') a.sansBaseReelle = true;
    else if (x === '--seulement') a.seulement = argv[++i].split(',').map((s) => s.trim());
    else if (x === '--exe') a.exe = path.resolve(argv[++i]);
    else if (x === '--captures') a.captures = path.resolve(argv[++i]);
    else if (x === '--sortie') a.sortie = path.resolve(argv[++i]);
    else throw new Error(`Argument inconnu : ${x}`);
  }
  return a;
}

/** Date de modification la plus récente des sources embarquées dans l'exécutable. */
function derniereModification(chemins) {
  let max = 0;
  const visiter = (p) => {
    if (!fs.existsSync(p)) return;
    const st = fs.statSync(p);
    if (st.isDirectory()) for (const e of fs.readdirSync(p)) visiter(path.join(p, e));
    else max = Math.max(max, st.mtimeMs);
  };
  chemins.forEach(visiter);
  return max;
}

function verifierExecutable(exe) {
  if (!fs.existsSync(exe)) {
    throw new Error(`Exécutable introuvable : ${exe}\nConstruisez la version de production : npm run e2e:build`);
  }
  const sources = ['src', 'index.html', 'src-tauri/src', 'src-tauri/migrations', 'src-tauri/capabilities',
    'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml'].map((p) => path.join(racine, p));
  if (fs.statSync(exe).mtimeMs < derniereModification(sources)) {
    throw new Error(`L'exécutable est plus ancien que les sources : ${exe}\nReconstruisez-le : npm run e2e:build`);
  }
  // Compilé comme la livraison (npm run livrer / e2e:build) : aucun chemin de la machine, CFG, ASLR, DEP.
  try {
    verifierLivraison(exe);
  } catch (e) {
    throw new Error(`${e.message}\nCet exécutable n'a pas été compilé comme la livraison : npm run e2e:build ou npm run livrer.`);
  }
}

async function principal() {
  const args = lireArguments(process.argv.slice(2));
  const exe = args.exe ?? path.join(racine, 'src-tauri', 'target', 'release', 'inventory.exe');
  if (!args.exe) verifierExecutable(exe);
  if (processusEnCours(exe) > 0) {
    throw new Error(`${path.basename(exe)} est déjà ouvert : fermez-le (l'application est à instance unique).`);
  }

  const sortie = args.sortie ?? path.join(racine, 'tests', 'e2e', 'resultats');
  const captures = args.captures ?? path.join(sortie, 'captures');
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'entites-dossiers-e2e-'));
  const ctx = {
    racine,
    exe,
    travail,
    donnees: path.join(travail, 'donnees'),
    profil: path.join(travail, 'webview2'),
    entrees: path.join(travail, 'entrees'),
    captures,
    memo: {},
    /** Limites connues relevées par les scénarios : affichées au verdict, sans faire échouer la suite. */
    limites: [],
    limite(texte) {
      console.log(`     ⚠ limite connue : ${texte}`);
      this.limites.push(texte);
    },
    app: null,
    apps: [],
    get page() {
      return this.app.page;
    },
    etape(texte) {
      console.log(`     · ${texte}`);
    },
    async capture(nom) {
      fs.mkdirSync(path.dirname(path.join(captures, nom)), { recursive: true });
      // Taille en pixels CSS : 1280 × 800 donne une image de 1280 × 800 quelle que soit la mise à l'échelle de Windows.
      await this.page.screenshot({ path: path.join(captures, `${nom}.png`), scale: 'css' });
    },
    /**
     * Instance sur un dossier de données à part (sous-dossier `nom` du dossier de travail), non démarrée.
     * Elle est arrêtée en fin de suite comme les autres.
     */
    autreApplication(nom) {
      const base = path.join(travail, nom);
      const app = new Application({ exe, donnees: path.join(base, 'donnees'), profil: path.join(base, 'webview2') });
      fs.mkdirSync(base, { recursive: true });
      this.apps.push(app);
      return app;
    },
    /** Lance (ou relance) l'application sur le même dossier de données. */
    async lancer() {
      const app = new Application({ exe, donnees: this.donnees, profil: this.profil });
      this.apps.push(app);
      this.app = app;
      try {
        await app.demarrer();
      } catch (e) {
        await app.tuer();
        throw e;
      }
      return app;
    },
  };
  for (const d of [ctx.entrees, captures, sortie]) fs.mkdirSync(d, { recursive: true });

  console.log(`Exécutable      : ${exe}`);
  console.log(`Données de test : ${ctx.donnees}`);
  console.log(`Captures        : ${captures}\n`);

  const choisis = SCENARIOS.filter((s) => s.toujours || !args.seulement || args.seulement.includes(s.id));
  const verdicts = [];
  try {
    for (const s of choisis) {
      console.log(`▶ ${s.id} — ${s.titre}`);
      const debut = Date.now();
      // Scénario dépendant de la machine (ex. : base réelle absente) : signalé, jamais compté comme réussi.
      const indisponible = s.indisponible?.(ctx, args);
      if (indisponible) {
        console.log(`  – NON JOUÉ : ${indisponible}`);
        verdicts.push({ id: s.id, titre: s.titre, ok: null, problemes: [indisponible], duree: 0, requetes: 0 });
        continue;
      }
      const problemes = [];
      let marque = 0;
      let appDebut = null;
      const nbApps = ctx.apps.length;
      try {
        // `sansApplication` : le scénario lance lui-même ses instances (bases fabriquées, dossiers à part).
        // Instance unique : l'instance principale encore ouverte (« --seulement ») est arrêtée d'abord.
        if (s.sansApplication && ctx.app && !ctx.app.termine) await ctx.app.tuer();
        const lanceeIci = !s.sansApplication && (!ctx.app || ctx.app.termine);
        if (lanceeIci) await ctx.lancer();
        appDebut = s.sansApplication ? null : ctx.app;
        marque = lanceeIci || !appDebut ? 0 : appDebut.marque(); // le démarrage compte dans le scénario qui l'a provoqué
        await s.executer(ctx);
      } catch (e) {
        problemes.push(e instanceof Echec ? e.message : `${e?.message ?? e}`);
        try {
          await ctx.capture(path.join('echecs', s.id));
        } catch {
          /* fenêtre fermée */
        }
      }
      // Instances à part lancées par le scénario : arrêtées (instance unique) avant le scénario suivant.
      for (const a of ctx.apps.slice(nbApps)) if (a !== ctx.app) await a.tuer();
      // Journal de la (ou des) instance(s) pendant le scénario (un scénario peut relancer l'application).
      if (!appDebut && !s.sansApplication) appDebut = ctx.app; // lancement en échec : son propre journal seulement
      const i0 = appDebut ? ctx.apps.indexOf(appDebut) : -1;
      const journal = i0 < 0 ? ctx.apps.slice(nbApps).flatMap((a) => a.journal)
        : [...appDebut.depuis(marque), ...ctx.apps.slice(i0 + 1).flatMap((a) => a.journal)];
      for (const j of journal) {
        if (j.type === 'console-erreur') problemes.push(`Erreur en console : ${j.texte}`);
        else if (j.type === 'console-avertissement') problemes.push(`Avertissement en console : ${j.texte}`);
        else if (j.type === 'console-demarrage') problemes.push(`Message en console au démarrage : ${j.texte}`);
        else if (j.type === 'erreur-page') problemes.push(`Exception non rattrapée : ${j.texte}`);
        else if (j.type === 'csp') problemes.push(`Violation de CSP : ${j.texte}`);
        else if (j.type === 'requete-externe') problemes.push(`Requête hors de l'application : ${j.texte}`);
        else if (j.type === 'requete-echouee') problemes.push(`Requête en échec : ${j.texte}`);
      }
      problemes.splice(0, problemes.length, ...new Set(problemes)); // un message vu par deux canaux CDP compte une fois
      const ok = problemes.length === 0;
      // Après un échec, l'interface peut rester dans un état inattendu (fenêtre modale ouverte…) : l'instance est
      // arrêtée et le scénario suivant la relance sur le même dossier de données, pour qu'un échec n'entraîne pas les suivants.
      if (!ok && ctx.app && !ctx.app.termine) await ctx.app.tuer();
      const requetes = journal.filter((j) => j.type === 'requete').length;
      verdicts.push({ id: s.id, titre: s.titre, ok, problemes, duree: Date.now() - debut, requetes });
      console.log(`  ${ok ? '✔ RÉUSSI' : '✘ ÉCHEC'} (${((Date.now() - debut) / 1000).toFixed(1)} s, ${requetes} requêtes locales)`);
      for (const p of problemes) console.log(`     ✘ ${p}`);
    }
  } finally {
    for (const a of ctx.apps) await a.tuer();
    fermerWindows();
  }

  const echecs = verdicts.filter((v) => v.ok === false);
  const nonJoues = verdicts.filter((v) => v.ok === null);
  // Toutes les origines contactées pendant la suite (requêtes vues par CDP, toutes instances confondues).
  const origines = [...new Set(ctx.apps.flatMap((a) => a.journal)
    .filter((j) => j.type === 'requete' || j.type === 'requete-externe')
    .map((j) => {
      try {
        const u = new URL(j.texte);
        return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : `${u.protocol}…`;
      } catch {
        return j.texte.slice(0, 40);
      }
    }))].sort();
  console.log(`\nOrigines contactées : ${origines.join(', ') || '(aucune)'}`);
  console.log('\n──────── Verdict ────────');
  for (const v of verdicts) console.log(`${v.ok ? '✔' : v.ok === null ? '–' : '✘'} ${v.id.padEnd(24)} ${v.titre}`);
  console.log(`\n${verdicts.length - echecs.length - nonJoues.length} réussi(s), ${echecs.length} en échec`
    + `${nonJoues.length ? `, ${nonJoues.length} non joué(s)` : ''}.`);
  if (ctx.limites.length) {
    console.log('\nLimites connues (sans échec) :');
    for (const l of ctx.limites) console.log(`  ⚠ ${l}`);
  }
  fs.writeFileSync(path.join(sortie, 'rapport.json'),
    JSON.stringify({ date: new Date().toISOString(), exe, origines, verdicts, limites: ctx.limites }, null, 2));
  console.log(`Rapport : ${path.join(sortie, 'rapport.json')}`);

  if (args.garder || echecs.length) console.log(`Données de test conservées : ${travail}`);
  // WebView2 peut garder un instant ses fichiers ouverts après l'arrêt de l'application : suppression retentée.
  else fs.rmSync(travail, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  process.exitCode = echecs.length ? 1 : 0;
}

principal().catch((e) => {
  console.error(`\n${e.message ?? e}`);
  process.exitCode = 2;
});
