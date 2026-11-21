// Fichiers d'entrée de l'import réel : une image PNG et un PDF, fabriqués sans dépendance.

import fs from 'node:fs';
import zlib from 'node:zlib';

const TABLE_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = TABLE_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function bloc(type, donnees) {
  const longueur = Buffer.alloc(4);
  longueur.writeUInt32BE(donnees.length);
  const corps = Buffer.concat([Buffer.from(type, 'ascii'), donnees]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corps));
  return Buffer.concat([longueur, corps, crc]);
}

/** PNG RVB `largeur` × `hauteur` : dégradé bleu avec un damier, facile à reconnaître sur une capture. */
export function ecrirePng(chemin, largeur = 360, hauteur = 240) {
  const lignes = [];
  for (let y = 0; y < hauteur; y++) {
    const ligne = Buffer.alloc(1 + largeur * 3);
    ligne[0] = 0; // filtre « None »
    for (let x = 0; x < largeur; x++) {
      const damier = ((x >> 5) + (y >> 5)) % 2 === 0;
      ligne[1 + x * 3] = damier ? 43 : 238;
      ligne[2 + x * 3] = damier ? 89 : Math.round(200 * (y / hauteur));
      ligne[3 + x * 3] = damier ? 195 : Math.round(255 * (x / largeur));
    }
    lignes.push(ligne);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largeur, 0);
  ihdr.writeUInt32BE(hauteur, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 2; // RVB
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloc('IHDR', ihdr),
    bloc('IDAT', zlib.deflateSync(Buffer.concat(lignes))),
    bloc('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(chemin, png);
  return { largeur, hauteur };
}

/** PDF d'une page A4 avec un titre, tables de références croisées exactes. */
export function ecrirePdf(chemin, texte = 'Piece finale e2e') {
  const flux = `BT /F1 28 Tf 72 760 Td (${texte}) Tj ET\nBT /F1 14 Tf 72 720 Td (Document genere par la suite de bout en bout.) Tj ET`;
  const objets = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(flux, 'latin1')} >>\nstream\n${flux}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let sortie = '%PDF-1.4\n';
  const positions = [];
  objets.forEach((o, i) => {
    positions.push(Buffer.byteLength(sortie, 'latin1'));
    sortie += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(sortie, 'latin1');
  sortie += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n`;
  for (const p of positions) sortie += `${String(p).padStart(10, '0')} 00000 n \n`;
  sortie += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  fs.writeFileSync(chemin, sortie, 'latin1');
}
