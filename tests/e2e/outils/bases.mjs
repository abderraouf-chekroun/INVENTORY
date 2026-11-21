// Bases SQLite fabriquées avant lancement (schéma exact des migrations) et lecture de bases existantes,
// avec le module SQLite intégré à Node (node:sqlite).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const HORODATAGE = '2026-01-01 09:00:00';

/** Contenu minimal valide : un thème, un employé et une machine associés, un dossier en cours. */
const SQL_SOCLE = `
  INSERT INTO parametres (cle, valeur) VALUES ('donnees_exemple', '0');
  INSERT INTO themes (id, nom) VALUES (1, 'Thème fabriqué');
  INSERT INTO categories (id, kind, nom) VALUES (1, 'a', 'Structure fabriquée'), (2, 'b', 'Type fabriqué');
  INSERT INTO entites (id, kind, nom, code, categorie_id, cree_le, maj_le)
    VALUES (1, 'a', 'Employé fabriqué', '0001', 1, '${HORODATAGE}', '${HORODATAGE}'),
           (2, 'b', 'Machine fabriquée', '0002', 2, '${HORODATAGE}', '${HORODATAGE}');
  INSERT INTO associations (a_id, b_id, cree_le) VALUES (1, 2, '${HORODATAGE}');
  INSERT INTO dossiers (id, nom, annee, theme_id, statut, a_id, b_id, cree_le, maj_le)
    VALUES (1, 'Dossier fabriqué', 2026, 1, 'cours', 1, 2, '${HORODATAGE}', '${HORODATAGE}');
`;

/**
 * Crée `dossier/donnees.sqlite` : schéma des migrations de l'application (version 1 = base de la version 1.0,
 * migrée au lancement ; version 2 = schéma de la version 1.1 ; version 3 = schéma de la version 1.2 ; version 4 = schéma de la
 * version 1.3 ; version 5 = schéma de la version 1.4 ; version 6 = schéma de la version 1.5), socle de données, puis `sql`
 * (avec `params` pour les `?`). Mode de journal par défaut (un seul fichier). Renvoie le chemin de la base.
 */
export function fabriquerBase(racine, dossier, { sql = '', params = [], version = 1 } = {}) {
  fs.mkdirSync(dossier, { recursive: true });
  const chemin = path.join(dossier, 'donnees.sqlite');
  // Mode défensif coupé : la suite fabrique aussi des bases piégées (writable_schema).
  const db = new DatabaseSync(chemin, { defensive: false });
  try {
    db.exec(fs.readFileSync(path.join(racine, 'src-tauri', 'migrations', '001_init.sql'), 'utf8'));
    db.exec('PRAGMA user_version = 1');
    db.exec(SQL_SOCLE);
    if (version >= 2) {
      db.exec('PRAGMA foreign_keys = OFF');
      db.exec(fs.readFileSync(path.join(racine, 'src-tauri', 'migrations', '002_employes_machines.sql'), 'utf8'));
      db.exec("UPDATE entites SET libelle = nom; PRAGMA user_version = 2");
    }
    if (version >= 3) {
      db.exec(fs.readFileSync(path.join(racine, 'src-tauri', 'migrations', '003_affectations.sql'), 'utf8'));
      db.exec('PRAGMA user_version = 3');
    }
    if (version >= 4) {
      // Schéma de la version 1.3 ; la clé secrète de l'identifiant est tirée ici (le back la tire à la migration).
      db.exec(fs.readFileSync(path.join(racine, 'src-tauri', 'migrations', '004_etats_citations_identifiants.sql'), 'utf8'));
      // L'employé du socle est incomplet : comme après la migration, il n'a pas d'identifiant.
      db.exec(`INSERT INTO cle_identifiant (id, cle) VALUES (1, randomblob(32));
               UPDATE entites SET code = NULL WHERE kind = 'a'; PRAGMA user_version = 4`);
    }
    if (version >= 5) {
      // Schéma de la version 1.4 (script SQL seul : le dossier du socle perd son rattachement, sans document à reporter).
      db.exec(fs.readFileSync(path.join(racine, 'src-tauri', 'migrations', '005_nominations.sql'), 'utf8'));
      db.exec('PRAGMA user_version = 5');
    }
    if (version >= 6) {
      // Schéma de la version 1.5 (§ 13.3) : deux colonnes ajoutées au journal.
      db.exec(fs.readFileSync(path.join(racine, 'src-tauri', 'migrations', '006_fiches_supprimees.sql'), 'utf8'));
      db.exec('PRAGMA user_version = 6');
    }
    if (sql) {
      if (params.length) db.prepare(sql).run(...params);
      else db.exec(sql);
    }
  } finally {
    db.close();
  }
  return chemin;
}

/** Ajoute un document « issu d'un modèle » avec ces blocs (JSON) au dossier fabriqué. */
export function ajouterDocument(chemin, { id, nom, blocs }) {
  const db = new DatabaseSync(chemin);
  try {
    db.prepare(`INSERT INTO documents (id, dossier_id, nom, origine, source, date_doc, blocs, cree_le)
                VALUES (?, 1, ?, 'modele', 'Modèle fabriqué', '2026-01-15', ?, '${HORODATAGE}')`)
      .run(id, nom, JSON.stringify(blocs));
  } finally {
    db.close();
  }
}

/** Ajoute `n` fiches A (« Fiche n° k »). */
export function ajouterFichesA(chemin, n) {
  const db = new DatabaseSync(chemin);
  try {
    db.exec(`WITH RECURSIVE k(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM k WHERE i < ${n})
             INSERT INTO entites (kind, nom, categorie_id, cree_le, maj_le)
             SELECT 'a', 'Fiche n° ' || i, 1, '${HORODATAGE}', '${HORODATAGE}' FROM k`);
  } finally {
    db.close();
  }
}

/** Exécute `sql` sur une base existante (fabriquée par la suite). */
export function executer(chemin, sql) {
  const db = new DatabaseSync(chemin);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}

/** Lit une base : `fn(db)` avec une connexion en lecture seule. */
export function lire(chemin, fn) {
  const db = new DatabaseSync(chemin, { readOnly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/** Empreinte SHA-256 d'un fichier (null s'il n'existe pas). */
export function empreinte(chemin) {
  if (!fs.existsSync(chemin)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(chemin)).digest('hex');
}
