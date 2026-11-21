// Essai du crochet NSIS_HOOK_PREINSTALL (retrait de l'ancienne installation « Entités et Dossiers »).
//
//   node tests/installateur/crochet-preinstall.mjs
//
// Le crochet lit le dossier de l'ancienne installation dans le registre (HKCU, modifiable par tout programme du
// compte) puis y supprime deux fichiers nommés. Cet essai compile le crochet dans un petit installateur
// (essai-crochet.nsi) pour une FAUSSE ancienne installation, au nom propre à l'essai, puis vérifie, pour chaque
// valeur enregistrée, ce qui est supprimé et ce qui ne l'est pas. Seuls des dossiers temporaires et la clé
// HKCU\…\Uninstall\<nom d'essai> sont utilisés ; tout est retiré à la fin. Windows uniquement ; makensis est pris
// dans le cache de Tauri (%LOCALAPPDATA%\tauri\NSIS) ou dans le PATH.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = path.dirname(fileURLToPath(import.meta.url));
const racineProjet = path.resolve(ici, '..', '..');
const NOM = `INVENTORY essai crochet ${crypto.randomBytes(4).toString('hex')}`;
const EXE = 'ancien-essai.exe';
const CLE = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${NOM}`;
const CLE_MANU = `HKCU\\Software\\${NOM}`;

function makensis() {
  const cache = path.join(process.env.LOCALAPPDATA ?? '', 'tauri', 'NSIS', 'makensis.exe');
  return fs.existsSync(cache) ? cache : 'makensis';
}

function lancer(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, ...options });
  if (r.error) throw r.error;
  return r;
}

const reg = (...args) => lancer('reg', args);
const cleExiste = (cle) => reg('query', cle).status === 0;

let echecs = 0;
function verifier(condition, message) {
  console.log(`${condition ? 'ok   ' : 'ÉCHEC'} ${message}`);
  if (!condition) echecs += 1;
}

if (process.platform !== 'win32') {
  console.log('Essai réservé à Windows.');
  process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'entites-dossiers-crochet-'));
const sortie = path.join(tmp, 'essai-crochet.exe');
try {
  const c = lancer(makensis(), [
    '-V2', '-INPUTCHARSET', 'UTF8',
    `-DANCIEN_NOM=${NOM}`, `-DANCIEN_EXE=${EXE}`,
    // ESSAI_CROCHETS : autre version du crochet (par exemple celle d'une version précédente, pour comparer).
    `-DCROCHETS=${process.env.ESSAI_CROCHETS || path.join(racineProjet, 'src-tauri', 'windows', 'hooks.nsh')}`,
    `-DSORTIE=${sortie}`,
    path.join(ici, 'essai-crochet.nsi'),
  ]);
  if (c.status !== 0) throw new Error(`makensis a échoué :\n${c.stdout}\n${c.stderr}`);

  /** Fausse ancienne installation : l'exécutable (ou non), uninstall.exe et un fichier étranger. */
  const installation = (nom, { exe = true, autre = true } = {}) => {
    const d = path.join(tmp, nom);
    fs.mkdirSync(d, { recursive: true });
    if (exe) fs.writeFileSync(path.join(d, EXE), 'ancien');
    fs.writeFileSync(path.join(d, 'uninstall.exe'), 'desinstalleur');
    if (autre) fs.writeFileSync(path.join(d, 'a-garder.txt'), 'garder');
    return d;
  };

  /** Enregistre `valeurs` dans la clé de désinstallation, lance l'essai, renvoie son code de sortie. */
  const jouer = (valeurs) => {
    reg('delete', CLE, '/f');
    reg('add', CLE, '/v', 'DisplayName', '/t', 'REG_SZ', '/d', NOM, '/f');
    for (const [nom, valeur] of Object.entries(valeurs)) reg('add', CLE, '/v', nom, '/t', 'REG_SZ', '/d', valeur, '/f');
    const r = lancer(sortie, ['/S'], { cwd: tmp });
    return r.status;
  };

  const restes = (d) => (fs.existsSync(d) ? fs.readdirSync(d).sort() : null);

  // 1. Ancienne installation réelle : les deux fichiers partent, le fichier étranger et le dossier restent.
  const a = installation('valide');
  egalJouer(jouer({ InstallLocation: `"${a}"` }));
  verifier(JSON.stringify(restes(a)) === '["a-garder.txt"]', `valide : seuls ${EXE} et uninstall.exe supprimés (reste ${JSON.stringify(restes(a))})`);
  verifier(!cleExiste(CLE), 'valide : clé de désinstallation retirée');

  // 2. Dossier vidé par le retrait : supprimé (RMDir non récursif) ; barre finale acceptée.
  const b = installation('valide-vide', { autre: false });
  egalJouer(jouer({ InstallLocation: `${b}\\` }));
  verifier(restes(b) === null, `dossier vide supprimé (reste ${JSON.stringify(restes(b))})`);

  // 3. Dossier déduit de UninstallString.
  const u = installation('par-uninstallstring');
  egalJouer(jouer({ UninstallString: `"${path.join(u, 'uninstall.exe')}"` }));
  verifier(JSON.stringify(restes(u)) === '["a-garder.txt"]', `UninstallString : retrait fait (reste ${JSON.stringify(restes(u))})`);

  // Refus : aucun fichier touché, mais l'enregistrement est retiré.
  const refus = [
    ['sans ancien exécutable', () => { const d = installation('sans-exe', { exe: false }); return [d, d]; }],
    ['chemin relatif', () => { const d = installation('relatif'); return [d, 'relatif']; }],
    ['« .. » dans le chemin', () => { const d = installation('remonte'); fs.mkdirSync(path.join(tmp, 'x'), { recursive: true }); return [d, path.join(tmp, 'x') + '\\..\\remonte']; }],
    ['« . » dans le chemin', () => { const d = installation('point'); return [d, `${tmp}\\.\\point`]; }],
    ['chemin \\\\?\\', () => { const d = installation('verbatim'); return [d, `\\\\?\\${d}`]; }],
    ['chemin réseau', () => { const d = installation('reseau'); return [d, `\\\\localhost\\${d[0]}$${d.slice(2)}`]; }],
    ['flux de données', () => { const d = installation('flux'); return [d, `${d}:flux`]; }],
  ];
  for (const [quoi, preparer] of refus) {
    const [d, valeur] = preparer();
    const avant = restes(d);
    egalJouer(jouer({ InstallLocation: valeur }));
    verifier(JSON.stringify(restes(d)) === JSON.stringify(avant), `${quoi} (${valeur}) : aucun fichier supprimé (reste ${JSON.stringify(restes(d))})`);
    verifier(!cleExiste(CLE), `${quoi} : clé de désinstallation retirée`);
  }
} finally {
  reg('delete', CLE, '/f');
  reg('delete', CLE_MANU, '/f');
  fs.rmSync(tmp, { recursive: true, force: true });
}

function egalJouer(code) {
  verifier(code === 0, `l'installateur d'essai se termine normalement (code ${code})`);
}

console.log(echecs ? `\n${echecs} échec(s).` : '\nCrochet PREINSTALL : tous les contrôles sont passés.');
process.exitCode = echecs ? 1 : 0;
