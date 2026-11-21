// Compilation de la version de production, commune à la livraison (`npm run livrer`) et à la suite de
// bout en bout (`npm run e2e:build`) : l'exécutable testé est compilé exactement comme celui qui est livré.
//
// Options de compilation (passées à rustc par CARGO_ENCODED_RUSTFLAGS, qui accepte les chemins avec espaces) :
// - --remap-path-prefix : les chemins de cette machine (profil, Cargo, rustup, projet) sont remplacés par des
//   noms neutres dans l'exécutable (messages de panique des dépendances) ;
// - -C control-flow-guard=checks : Control Flow Guard de Windows ;
// - -C link-arg=/CETCOMPAT : exécutable déclaré compatible avec la pile fantôme matérielle (Intel CET / AMD shadow
//   stack) : Windows protège les adresses de retour sur les processeurs qui la gèrent.
// Le profil release de Cargo.toml ajoute : LTO, panic = "abort", symboles retirés, overflow-checks.
// L'exécutable produit est contrôlé (verifierExecutable) : aucun chemin ni nom de compte de la machine ; CFG,
// ASLR (64 bits), DEP et compatibilité CET déclarés dans l'en-tête PE.
// Les dépendances Rust sont verrouillées (`cargo build --locked`) ; les paquets npm installés doivent
// correspondre exactement à package-lock.json (`npm ci`).
//
// Rien de propre à la machine n'est écrit ici : les chemins et le nom du compte sont lus à l'exécution.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const dossierRelease = path.join(racine, 'src-tauri', 'target', 'release');

const configTauri = JSON.parse(fs.readFileSync(path.join(racine, 'src-tauri', 'tauri.conf.json'), 'utf8'));
export const exe = path.join(dossierRelease, `${configTauri.mainBinaryName}.exe`);
export const version = configTauri.version;

export class ErreurCompilation extends Error {}

/** Correspondances chemin réel → nom neutre. Rustc retient la dernière qui correspond : du plus général au plus précis. */
function correspondances() {
  const profil = os.homedir();
  const cargo = process.env.CARGO_HOME || path.join(profil, '.cargo');
  const rustup = process.env.RUSTUP_HOME || path.join(profil, '.rustup');
  return [
    [profil, 'C:\\profil'],
    [path.resolve(cargo), 'C:\\cargo'],
    [path.resolve(rustup), 'C:\\rustup'],
    [racine, 'C:\\projet'],
  ];
}

/** Options rustc de la version de production. */
export function optionsRustc() {
  return [
    ...correspondances().map(([de, vers]) => `--remap-path-prefix=${de}=${vers}`),
    '-C', 'control-flow-guard=checks',
    '-C', 'link-arg=/CETCOMPAT',
  ];
}

/** Vérifie que node_modules correspond à package-lock.json (versions exactes), comme après `npm ci`. */
export function verifierPaquetsNpm() {
  const verrou = JSON.parse(fs.readFileSync(path.join(racine, 'package-lock.json'), 'utf8'));
  const ecarts = [];
  for (const [chemin, attendu] of Object.entries(verrou.packages ?? {})) {
    if (!chemin || attendu.link) continue;
    let installe = null;
    try {
      installe = JSON.parse(fs.readFileSync(path.join(racine, chemin, 'package.json'), 'utf8')).version;
    } catch {
      /* absent */
    }
    if (installe === null) {
      if (!attendu.optional) ecarts.push(`${chemin} : absent (attendu ${attendu.version})`);
    } else if (installe !== attendu.version) {
      ecarts.push(`${chemin} : ${installe} installé, ${attendu.version} attendu`);
    }
  }
  if (ecarts.length) {
    throw new ErreurCompilation(`node_modules ne correspond pas à package-lock.json :\n  ${ecarts.slice(0, 15).join('\n  ')}\n`
      + 'Lancez « npm ci » puis recommencez.');
  }
}

/**
 * Compile la version de production avec `tauri build`.
 * `installateur: false` → `--no-bundle` (exécutable seul, pour la suite de bout en bout).
 */
export function compiler({ installateur }) {
  verifierPaquetsNpm();
  const env = { ...process.env, CARGO_ENCODED_RUSTFLAGS: optionsRustc().join('\x1f') };
  // CARGO_ENCODED_RUSTFLAGS l'emporte sur RUSTFLAGS : on retire ce dernier pour qu'il n'y ait pas d'ambiguïté.
  if (env.RUSTFLAGS) console.warn(`RUSTFLAGS ignorée pour cette compilation : ${env.RUSTFLAGS}`);
  delete env.RUSTFLAGS;
  const cli = path.join(racine, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
  // Ce qui suit « -- » est transmis à `cargo build`.
  const args = [cli, 'build', ...(installateur ? ['--bundles', 'nsis'] : ['--no-bundle']), '--', '--locked'];
  console.log(`Compilation : tauri ${args.slice(1).join(' ')}`);
  console.log(`Options rustc : ${optionsRustc().join(' ')}\n`);
  const r = spawnSync(process.execPath, args, { cwd: racine, env, stdio: 'inherit' });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new ErreurCompilation(`tauri build a échoué (code ${r.status}).`);
  verifierExecutable(exe);
}

/** Positions (au plus `max`) où `aiguille` apparaît dans `texte`, sans tenir compte de la casse. */
function occurrences(texte, aiguille, max = 5) {
  const t = texte.toLowerCase();
  const a = aiguille.toLowerCase();
  const res = [];
  for (let i = t.indexOf(a); i >= 0 && res.length < max; i = t.indexOf(a, i + 1)) res.push(i);
  return res;
}

/**
 * Contrôles de l'exécutable produit :
 * - ni le nom du compte Windows courant, ni le chemin du profil, ni celui du projet (ASCII et UTF-16) ;
 * - Control Flow Guard, ASLR et DEP déclarés dans l'en-tête PE.
 */
export function verifierExecutable(chemin) {
  const octets = fs.readFileSync(chemin);
  const vues = [
    ['ASCII', octets.toString('latin1')],
    ['UTF-16', octets.toString('utf16le')],
    ['UTF-16', octets.subarray(1).toString('utf16le')],
  ];
  const interdits = [os.userInfo().username, os.homedir(), racine].filter((s) => s && s.length >= 3);
  const trouves = [];
  for (const mot of interdits) {
    for (const [codage, texte] of vues) {
      for (const i of occurrences(texte, mot)) {
        const contexte = texte.slice(Math.max(0, i - 40), i + mot.length + 60).replace(/[^\x20-\x7e]/g, '.');
        trouves.push(`« ${mot} » (${codage}) : …${contexte}…`);
      }
    }
  }
  if (trouves.length) {
    throw new ErreurCompilation(`L'exécutable contient des informations de cette machine :\n  ${trouves.slice(0, 10).join('\n  ')}`);
  }

  // En-tête PE : DllCharacteristics (PE32+ : en-tête optionnel + 70).
  const pe = octets.readUInt32LE(0x3c);
  const caracteristiques = octets.readUInt16LE(pe + 24 + 70);
  const manquants = [[0x4000, 'Control Flow Guard'], [0x40, 'ASLR'], [0x20, 'ASLR 64 bits (high entropy)'], [0x100, 'DEP']]
    .filter(([bit]) => !(caracteristiques & bit)).map(([, nom]) => nom);
  if (!cetCompatible(octets, pe)) manquants.push('compatibilité CET (pile fantôme)');
  if (manquants.length) {
    throw new ErreurCompilation(`Protections absentes de l'exécutable : ${manquants.join(', ')} (DllCharacteristics 0x${caracteristiques.toString(16)}).`);
  }
  console.log(`\nExécutable vérifié : ${chemin}\n  aucun chemin ni nom de compte de cette machine ; CFG, ASLR 64 bits, DEP et CET actifs.`);
}

/**
 * Vrai si l'exécutable (PE32+) déclare la compatibilité CET : entrée de type IMAGE_DEBUG_TYPE_EX_DLLCHARACTERISTICS
 * (20) du répertoire de débogage, avec le bit IMAGE_DLLCHARACTERISTICS_EX_CET_COMPAT (0x1), posé par /CETCOMPAT.
 */
export function cetCompatible(octets, pe = octets.readUInt32LE(0x3c)) {
  const nbSections = octets.readUInt16LE(pe + 6);
  const tailleOptionnel = octets.readUInt16LE(pe + 20);
  const optionnel = pe + 24;
  if (octets.readUInt16LE(optionnel) !== 0x20b) return false; // PE32+ seulement
  // Répertoires de données : à + 112 en PE32+ ; le répertoire de débogage est le 7e (indice 6).
  const rvaDebug = octets.readUInt32LE(optionnel + 112 + 6 * 8);
  const tailleDebug = octets.readUInt32LE(optionnel + 112 + 6 * 8 + 4);
  const sections = optionnel + tailleOptionnel;
  const versFichier = (rva) => {
    for (let i = 0; i < nbSections; i++) {
      const s = sections + i * 40;
      const va = octets.readUInt32LE(s + 12);
      const taille = Math.max(octets.readUInt32LE(s + 8), octets.readUInt32LE(s + 16));
      if (rva >= va && rva < va + taille) return octets.readUInt32LE(s + 20) + (rva - va);
    }
    return -1;
  };
  const debut = versFichier(rvaDebug);
  if (!rvaDebug || debut < 0) return false;
  for (let e = debut; e + 28 <= debut + tailleDebug; e += 28) {
    if (octets.readUInt32LE(e + 12) !== 20) continue;
    const donnees = octets.readUInt32LE(e + 24);
    return (octets.readUInt32LE(donnees) & 0x1) === 0x1;
  }
  return false;
}
