// Lancement et pilotage de l'application réelle (exécutable Tauri + WebView2) par le protocole CDP.
//
// - Le répertoire de données est imposé par ENTITES_DOSSIERS_DONNEES (voir src-tauri/src/etat.rs) :
//   la suite ne touche jamais aux données de l'utilisateur.
// - Le profil WebView2 (localStorage, cache) est isolé par WEBVIEW2_USER_DATA_FOLDER.
// - Le port de débogage est ouvert par WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS.
// - Ce que la page n'a pas le droit de faire (état de la fenêtre, boîtes de dialogue natives, vraie
//   souris, vrai clavier) passe par Windows : outils/windows.ps1.

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { Echec, attendre, verifier } from './verifs.mjs';
import { TITRE_FENETRE, windows } from './windows.mjs';

/** Hôtes que l'application a le droit de contacter : elle-même (front, IPC, fichiers importés), sans port. */
const HOTES_LOCAUX = new Set(['tauri.localhost', 'ipc.localhost', 'asset.localhost']);
const estHoteLocal = (u) => HOTES_LOCAUX.has(u.hostname) && u.port === '';
/** Visionneuse PDF intégrée de WebView2 (extension interne, aucune requête réseau). */
const VISIONNEUSE_PDF = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/';
/** Titre du sélecteur de fichier ouvert par le back (src-tauri/src/commandes/mod.rs). */
export const TITRE_SELECTEUR = 'Importer un fichier';

/** Vrai si l'URL reste dans l'application (aucune sortie réseau). */
export function urlLocale(url) {
  if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) return true;
  if (url.startsWith(VISIONNEUSE_PDF)) return true;
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') && estHoteLocal(u);
  } catch {
    return false;
  }
}

async function portLibre() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Processus de l'exécutable en cours (Windows). */
export function processusEnCours(exe) {
  const nom = path.basename(exe);
  try {
    const sortie = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${nom}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
    return sortie.split(/\r?\n/).filter((l) => l.toLowerCase().includes(nom.toLowerCase())).length;
  } catch {
    return 0;
  }
}

/**
 * Observateur des violations de CSP, installé dans la page : chaque violation est écrite en console (relevée
 * par la suite comme échec) et comptée dans `window.__violationsCsp`.
 */
const observateurCsp = () => {
  if (window.__observateurCsp) return;
  window.__observateurCsp = true;
  window.__violationsCsp = window.__violationsCsp ?? [];
  document.addEventListener('securitypolicyviolation', (e) => {
    const texte = `${e.violatedDirective} ${e.blockedURI || '(en ligne)'} dans ${e.sourceFile || document.URL}`;
    window.__violationsCsp.push(texte);
    console.error(`[violation CSP] ${texte}`);
  }, true);
};

/**
 * Une exécution de l'application. Le journal (console, erreurs, requêtes, violations de CSP)
 * est cumulé sur toute la vie de l'instance ; `marque()` / `depuis(m)` en extraient une tranche.
 */
export class Application {
  constructor({ exe, donnees, profil }) {
    this.exe = exe;
    this.donnees = donnees;
    this.profil = profil;
    this.journal = [];
    this.sortie = '';
    this.termine = null; // { code } une fois le processus terminé
    // Journal du navigateur : seul témoin des messages de console émis avant la connexion CDP
    // (le front ne doit rien écrire en console ; le niveau du message n'y figure pas).
    this.journalNavigateur = path.join(path.dirname(profil), `webview2-${Date.now()}.log`);
  }

  /** Variables d'environnement d'un lancement (aussi utilisées pour la seconde instance). */
  env() {
    return {
      ...process.env,
      ENTITES_DOSSIERS_DONNEES: this.donnees,
      WEBVIEW2_USER_DATA_FOLDER: this.profil,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
        `--remote-debugging-port=${this.port} --enable-logging --log-file="${this.journalNavigateur}" --log-level=0`,
    };
  }

  /** Messages de console écrits dans le journal du navigateur jusqu'ici. */
  messagesConsoleDuJournal() {
    let texte = '';
    try {
      texte = fs.readFileSync(this.journalNavigateur, 'utf8');
    } catch {
      return [];
    }
    return texte.split(/\r?\n/).filter((l) => /:CONSOLE[:(]/.test(l)).map((l) => l.replace(/^\[[^\]]*\]\s*/, ''));
  }

  /** Lance le processus sans attendre la page (démarrage refusé, par exemple). */
  async lancerProcessus() {
    this.port = await portLibre();
    this.proc = spawn(this.exe, [], { env: this.env(), stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc.stdout.on('data', (d) => (this.sortie += d));
    this.proc.stderr.on('data', (d) => (this.sortie += d));
    this.finProcessus = new Promise((resolve) => {
      this.proc.once('exit', (code) => {
        this.termine = { code };
        resolve(code);
      });
    });
  }

  async demarrer() {
    await this.lancerProcessus();

    // Attente du port de débogage.
    const limite = Date.now() + 45_000;
    for (;;) {
      if (this.termine) throw new Error(`L'application s'est arrêtée au démarrage (code ${this.termine.code}). ${this.sortie}`);
      try {
        const r = await fetch(`http://127.0.0.1:${this.port}/json/version`);
        if (r.ok) break;
      } catch {
        /* pas encore prêt */
      }
      if (Date.now() > limite) throw new Error('Le port de débogage de WebView2 ne répond pas (45 s).');
      await pause(250);
    }

    this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${this.port}`);
    this.contexte = this.browser.contexts()[0];
    this.page = this.contexte.pages()[0] ?? (await this.contexte.waitForEvent('page', { timeout: 20_000 }));
    this.observer();
    // Pas de rechargement : il laisserait côté Rust des écouteurs d'événements orphelins (fausses alertes
    // « Couldn't find callback id »). Ce qui précède la connexion est rejoué par le domaine Log de CDP
    // (violations de CSP, erreurs réseau) ou lu dans le journal du navigateur (console).
    await this.page.addInitScript(observateurCsp);
    // La connexion peut précéder le chargement du front (page encore sur about:blank).
    if (!this.page.url().startsWith('http://tauri.localhost')) {
      await this.page.waitForURL((u) => u.href.startsWith('http://tauri.localhost'), { timeout: 30_000 });
    }
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.evaluate(observateurCsp).catch(() => {
      /* navigation en cours : le script d'initialisation installe l'observateur */
    });
    this.cdp = await this.contexte.newCDPSession(this.page);
    this.cdp.on('Log.entryAdded', ({ entry }) => {
      if (entry.level !== 'error' && entry.level !== 'warning') return;
      const texte = `${entry.text}${entry.url ? ` (${entry.url})` : ''}`;
      this.journal.push({
        type: entry.source === 'security' || /Content Security Policy/i.test(entry.text) ? 'csp'
          : entry.level === 'error' ? 'console-erreur' : 'console-avertissement',
        texte: `[${entry.source}] ${texte}`,
        t: Date.now(),
      });
    });
    await this.cdp.send('Log.enable');
    await this.page.waitForSelector('.side .nav', { timeout: 20_000 });
    await this.page.waitForTimeout(300);
    // Démarrage (avant la connexion) : tout message de console est suspect, quel que soit son niveau.
    for (const m of this.messagesConsoleDuJournal()) {
      this.journal.push({ type: 'console-demarrage', texte: m, t: Date.now() });
    }
    return this;
  }

  /**
   * Taille de rendu imposée (CSS px, facteur d'échelle 1), indépendante de l'écran de la machine.
   * Sans argument : retour à la taille réelle de la fenêtre.
   */
  async imposerTaille(largeur, hauteur) {
    if (largeur) {
      await this.cdp.send('Emulation.setDeviceMetricsOverride', { width: largeur, height: hauteur, deviceScaleFactor: 1, mobile: false });
    } else {
      await this.cdp.send('Emulation.clearDeviceMetricsOverride');
    }
    await this.page.waitForTimeout(250);
  }

  observer() {
    const ajouter = (type, texte, extra = {}) => this.journal.push({ type, texte, t: Date.now(), ...extra });
    this.page.on('console', (m) => {
      const t = m.type();
      if (t === 'error' || t === 'warning') {
        const loc = m.location();
        const texte = `${m.text()}${loc?.url ? ` (${loc.url}${loc.lineNumber != null ? `:${loc.lineNumber}` : ''})` : ''}`;
        ajouter(/Content Security Policy|violation CSP/i.test(m.text()) ? 'csp' : t === 'error' ? 'console-erreur' : 'console-avertissement', texte);
      }
    });
    this.page.on('pageerror', (e) => ajouter('erreur-page', e.message));
    this.page.on('crash', () => ajouter('erreur-page', 'La page a planté.'));
    this.contexte.on('request', (r) => ajouter(urlLocale(r.url()) ? 'requete' : 'requete-externe', r.url()));
    this.contexte.on('requestfailed', (r) => {
      // Un appel IPC annulé par un rechargement n'est pas une panne réseau.
      const raison = r.failure()?.errorText ?? '';
      if (raison !== 'net::ERR_ABORTED') ajouter('requete-echouee', `${r.url()} : ${raison}`);
    });
  }

  marque() {
    return this.journal.length;
  }

  depuis(m) {
    return this.journal.slice(m);
  }

  /** Appel direct d'une commande Tauri depuis la page. Renvoie { ok, valeur } ou { ok: false, erreur }. */
  async invoquer(commande, args = {}) {
    return this.page.evaluate(([c, a]) =>
      window.__TAURI_INTERNALS__.invoke(c, a).then(
        (valeur) => ({ ok: true, valeur }),
        (erreur) => ({ ok: false, erreur }),
      ), [commande, args]);
  }

  /** Comme `invoquer`, mais échoue si la commande est refusée. */
  async appeler(commande, args = {}) {
    const r = await this.invoquer(commande, args);
    if (!r.ok) throw new Error(`${commande} refusée : ${JSON.stringify(r.erreur)}`);
    return r.valeur;
  }

  /**
   * État de la fenêtre principale lu par Windows (la page n'a pas le droit de le demander à Tauri) :
   * { hwnd, exterieur, client {x, y, l, h}, dpi, agrandie, reduite, visible, premierPlan, ecran, travail }.
   * Coordonnées en pixels physiques de l'écran.
   */
  async etatFenetre() {
    return windows().appel('etat', this.proc.pid, TITRE_FENETRE);
  }

  /** Met la fenêtre principale au premier plan (échoue si Windows le refuse). Renvoie son handle. */
  async premierPlan() {
    const { hwnd } = await this.etatFenetre();
    verifier(await windows().appel('premier-plan', hwnd), 'La fenêtre de l’application ne passe pas au premier plan');
    return hwnd;
  }

  /** Demande de fermeture envoyée par Windows (WM_CLOSE), comme Alt+F4 ou la barre des tâches. */
  async fermerParWindows() {
    const { hwnd } = await this.etatFenetre();
    await windows().appel('fermer', hwnd);
  }

  /** Attend la boîte « Importer un fichier » ouverte par le back. Renvoie son handle. */
  async attendreSelecteur(delai = 10_000) {
    const h = await windows().appel('attendre-fenetre', this.proc.pid, TITRE_SELECTEUR, delai);
    verifier(h, `Le sélecteur de fichier natif (« ${TITRE_SELECTEUR} ») ne s’ouvre pas`);
    return h;
  }

  /** Attend la fermeture d'une fenêtre native. */
  async attendreFermetureFenetre(hwnd, quoi, delai = 8000) {
    await attendre(async () => !(await windows().appel('existe', hwnd)), quoi, delai);
  }

  /**
   * Dans le sélecteur de fichier natif ouvert : tape le chemin au clavier dans « Nom du fichier », vérifie
   * le champ, valide par Entrée et attend la fermeture de la boîte.
   */
  async choisirFichier(chemin) {
    const h = await this.attendreSelecteur();
    await this.saisirEtValider(h, chemin, false);
  }

  /**
   * Boîte native d'enregistrement ouverte par le back (« Enregistrer une copie… ») : remplace le nom proposé
   * par `chemin` (tapé au clavier), valide, attend la fermeture. Renvoie { titre, nomPropose }.
   */
  async enregistrerSous(chemin) {
    const boite = await windows().appel('attendre-dialogue', this.proc.pid, 10_000);
    verifier(boite, 'La boîte native d’enregistrement ne s’ouvre pas');
    const avant = await this.saisirEtValider(boite.hwnd, chemin, true);
    return { titre: boite.titre, nomPropose: avant };
  }

  /** Tape `chemin` dans « Nom du fichier » de la boîte `h`, vérifie le champ, Entrée. Renvoie le contenu initial. */
  async saisirEtValider(h, chemin, remplacer) {
    let { avant, apres } = await windows().appel('nom-de-fichier', h, chemin, remplacer);
    // La saisie automatique du champ peut avaler une touche (constaté : « C\… » au lieu de « C:\… ») : le champ est
    // resélectionné et le chemin retapé, une fois ; il doit alors être exact.
    if (apres !== chemin) ({ apres } = await windows().appel('nom-de-fichier', h, chemin, true));
    if (apres !== chemin) {
      await windows().appel('touche', h, 'echap').catch(() => {});
      throw new Echec(`Nom du fichier saisi dans la boîte native : attendu ${JSON.stringify(chemin)}, obtenu ${JSON.stringify(apres)}`);
    }
    await windows().appel('touche', h, 'entree');
    await this.attendreFermetureFenetre(h, 'La boîte native ne se ferme pas après validation');
    return avant;
  }

  /** Ferme le sélecteur de fichier natif par Échap (annulation). */
  async annulerSelecteur() {
    const h = await this.attendreSelecteur();
    await windows().appel('touche', h, 'echap');
    await this.attendreFermetureFenetre(h, 'Le sélecteur de fichier ne se ferme pas avec Échap');
  }

  /**
   * Texte affiché par la visionneuse PDF intégrée (cible CDP à part, invisible pour Playwright et absente
   * des captures CDP). Renvoie null si aucune visionneuse n'est ouverte.
   */
  async texteVisionneusePdf() {
    const cibles = await (await fetch(`http://127.0.0.1:${this.port}/json/list`)).json();
    const v = cibles.find((c) => c.url.startsWith(VISIONNEUSE_PDF) && c.webSocketDebuggerUrl);
    if (!v) return null;
    const ws = new WebSocket(v.webSocketDebuggerUrl);
    try {
      await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve);
        ws.addEventListener('error', reject);
      });
      const reponse = new Promise((resolve) => ws.addEventListener('message', (m) => resolve(JSON.parse(m.data))));
      // Texte de la page, racines fantômes (shadow DOM) et valeurs des champs comprises : la visionneuse « edge_pdf »
      // des versions récentes de WebView2 dessine sa barre (numéro de page, « / 1 ») dans des composants à racine fantôme,
      // invisibles pour `document.body.innerText`.
      const expression = `(() => {
        const morceaux = [];
        const visiter = (n) => {
          if (n.nodeType === 3) morceaux.push(n.textContent);
          if (n.nodeType === 1) {
            if (n.tagName === 'INPUT' && n.value) morceaux.push(n.value);
            if (n.shadowRoot) visiter(n.shadowRoot);
          }
          for (const c of n.childNodes) visiter(c);
        };
        visiter(document.documentElement);
        return morceaux.join(' ').replace(/\\s+/g, ' ').trim();
      })()`;
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
      return (await reponse).result?.result?.value ?? '';
    } finally {
      ws.close();
    }
  }

  /** Cibles CDP de type page (une par fenêtre ou onglet de la WebView). */
  async ciblesPages() {
    const cibles = await (await fetch(`http://127.0.0.1:${this.port}/json/list`)).json();
    return cibles.filter((c) => c.type === 'page');
  }

  /**
   * Glisser-déposer avec la vraie souris, d'un point à un autre de la page (coordonnées CSS de la fenêtre).
   * La fenêtre est d'abord mise au premier plan. Le pointeur de l'utilisateur bouge pendant ce geste.
   */
  async glisserALaSouris(de, vers) {
    const hwnd = await this.premierPlan();
    await this.page.waitForTimeout(200);
    const { client, dpi } = await this.etatFenetre();
    const echelle = dpi / 96;
    const ecran = (p) => [Math.round(client.x + p.x * echelle), Math.round(client.y + p.y * echelle)];
    await windows().appel('glisser', hwnd, ...ecran(de), ...ecran(vers));
  }

  /** Attend la fin du processus (après une fermeture). Renvoie le code de sortie, ou null au-delà du délai. */
  async attendreFin(delai = 15_000) {
    return Promise.race([this.finProcessus, pause(delai).then(() => null)]);
  }

  async deconnecter() {
    try {
      await this.browser?.close();
    } catch {
      /* déjà fermé */
    }
  }

  /** Arrêt forcé (nettoyage en fin de suite ou après un échec). */
  async tuer() {
    await this.deconnecter();
    if (!this.termine && this.proc?.pid) {
      try {
        execFileSync('taskkill', ['/PID', String(this.proc.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        /* déjà terminé */
      }
      await this.attendreFin(10_000);
    }
  }
}
