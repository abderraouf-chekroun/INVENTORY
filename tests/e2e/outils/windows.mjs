// Client de outils/windows.ps1 : un seul processus PowerShell pour toute la suite, piloté ligne par ligne.
// Sert à ce que la page ne peut pas faire (et que l'application n'autorise plus depuis la page) :
// état de la fenêtre, premier plan, boîtes de dialogue natives, vraie souris et vrai clavier.

import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

/** Titre de la fenêtre principale (tauri.conf.json). */
export const TITRE_FENETRE = 'INVENTORY';

class ServeurWindows {
  constructor() {
    const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'windows.ps1');
    this.proc = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.attente = [];
    this.erreurs = '';
    this.proc.stderr.on('data', (d) => (this.erreurs += d));
    readline.createInterface({ input: this.proc.stdout }).on('line', (ligne) => {
      const suivant = this.attente.shift();
      if (!suivant) return;
      try {
        suivant.resolve(JSON.parse(Buffer.from(ligne.trim(), 'base64').toString('utf8')));
      } catch (e) {
        suivant.reject(new Error(`Réponse illisible de windows.ps1 : ${ligne.slice(0, 200)} (${e.message})`));
      }
    });
    this.proc.on('exit', (code) => {
      for (const a of this.attente.splice(0)) a.reject(new Error(`windows.ps1 s'est arrêté (code ${code}). ${this.erreurs}`));
    });
  }

  /** Exécute une commande ; lève une erreur si windows.ps1 la refuse. */
  async appel(cmd, ...args) {
    const reponse = await new Promise((resolve, reject) => {
      this.attente.push({ resolve, reject });
      const ligne = Buffer.from(JSON.stringify({ cmd, args }), 'utf8').toString('base64');
      this.proc.stdin.write(`${ligne}\n`);
    });
    if (!reponse.ok) throw new Error(`windows.ps1 ${cmd} : ${reponse.erreur}`);
    return reponse.valeur;
  }

  fermer() {
    this.proc.stdin.end();
  }
}

let serveur = null;

/** Le serveur partagé (démarré au premier appel ; `fermerWindows()` en fin de suite le termine). */
export function windows() {
  serveur ??= new ServeurWindows();
  return serveur;
}

export function fermerWindows() {
  serveur?.fermer();
  serveur = null;
}
