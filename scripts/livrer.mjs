// Livraison : compile la version de production, vérifie l'exécutable, copie l'installateur dans
// installateur/ avec son empreinte SHA-256 (fichier .sha256 à côté).
//
//   npm run livrer                         installateur complet
//   node scripts/livrer.mjs --sans-installateur   exécutable seul (utilisé par npm run e2e:build)

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ErreurCompilation, compiler, dossierRelease, racine, version } from './compilation.mjs';

function principal() {
  const args = process.argv.slice(2);
  const inconnus = args.filter((a) => a !== '--sans-installateur');
  if (inconnus.length) throw new ErreurCompilation(`Argument inconnu : ${inconnus.join(' ')}`);
  const installateur = !args.includes('--sans-installateur');

  compiler({ installateur });
  if (!installateur) return;

  const dossierNsis = path.join(dossierRelease, 'bundle', 'nsis');
  const suffixe = `_${version}_x64-setup.exe`;
  const candidats = fs.existsSync(dossierNsis)
    ? fs.readdirSync(dossierNsis).filter((n) => n.endsWith(suffixe))
    : [];
  if (candidats.length !== 1) {
    throw new ErreurCompilation(`Installateur introuvable ou ambigu dans ${dossierNsis} (${candidats.length} fichier(s) *${suffixe}).`);
  }
  const nom = candidats[0];
  const sortie = path.join(racine, 'installateur');
  fs.mkdirSync(sortie, { recursive: true });
  const copie = path.join(sortie, nom);
  fs.copyFileSync(path.join(dossierNsis, nom), copie);

  const empreinte = crypto.createHash('sha256').update(fs.readFileSync(copie)).digest('hex').toUpperCase();
  // Format de sha256sum (« empreinte *nom ») ; Get-FileHash affiche la même empreinte en majuscules.
  fs.writeFileSync(`${copie}.sha256`, `${empreinte} *${nom}\n`, 'utf8');

  console.log('\n──────── Livraison ────────');
  console.log(`Installateur : ${copie}`);
  console.log(`SHA-256      : ${empreinte}`);
  console.log(`Empreinte    : ${copie}.sha256`);
  console.log('Vérification : Get-FileHash -Algorithm SHA256 -LiteralPath "<installateur>"');
}

try {
  principal();
} catch (e) {
  console.error(`\n${e instanceof ErreurCompilation ? e.message : e?.stack ?? e}`);
  process.exitCode = 1;
}
