-- Version 1.3 (spécification § 10.8) : états de dossier modifiables, dossiers sans employé ni machine,
-- clé secrète de l'identifiant des employés.
-- Exécutée clés étrangères désactivées (reconstruction de la table dossiers, référencée par d'autres tables),
-- puis contrôlée par PRAGMA foreign_key_check avant validation. La clé secrète est tirée et les identifiants
-- des employés sont recalculés ensuite par le code Rust, dans la même transaction.

-- États de dossier (§ 10.1). Les trois états fournis portent un rôle fixe ('cours', 'piece', 'clos') ;
-- les états ajoutés par l'utilisateur ont le rôle 'perso'. Palette de couleurs fermée.
CREATE TABLE statuts (
  id      INTEGER PRIMARY KEY,
  nom     TEXT NOT NULL,
  couleur TEXT NOT NULL CHECK (couleur IN ('gris', 'bleu', 'turquoise', 'vert', 'ambre', 'orange', 'rouge', 'rose', 'violet')),
  role    TEXT NOT NULL CHECK (role IN ('cours', 'piece', 'clos', 'perso'))
);
CREATE UNIQUE INDEX statuts_nom ON statuts (nom COLLATE NOCASE);
CREATE UNIQUE INDEX statuts_role_fourni ON statuts (role) WHERE role <> 'perso';

-- Couleurs des badges du prototype : « En cours » et « Pièce manquante » en orangé, « Clôturé » en vert.
INSERT INTO statuts (id, nom, couleur, role) VALUES
  (1, 'En cours', 'ambre', 'cours'),
  (2, 'Pièce manquante', 'orange', 'piece'),
  (3, 'Clôturé', 'vert', 'clos');

-- Dossiers : rattachés à un état ; employé et machine facultatifs (§ 10.3). Les états actuels sont repris à l'identique.
CREATE TABLE dossiers_v4 (
  id        INTEGER PRIMARY KEY,
  nom       TEXT NOT NULL,
  annee     INTEGER NOT NULL,
  theme_id  INTEGER NOT NULL REFERENCES themes (id),
  statut_id INTEGER NOT NULL REFERENCES statuts (id),
  a_id      INTEGER NULL REFERENCES entites (id),
  b_id      INTEGER NULL REFERENCES entites (id),
  cree_le   TEXT NOT NULL,
  maj_le    TEXT NOT NULL,
  clos_le   TEXT NULL
);

INSERT INTO dossiers_v4 (id, nom, annee, theme_id, statut_id, a_id, b_id, cree_le, maj_le, clos_le)
  SELECT d.id, d.nom, d.annee, d.theme_id, s.id, d.a_id, d.b_id, d.cree_le, d.maj_le, d.clos_le
  FROM dossiers d JOIN statuts s ON s.role = d.statut;

DROP TABLE dossiers;
ALTER TABLE dossiers_v4 RENAME TO dossiers;

CREATE INDEX dossiers_a ON dossiers (a_id);
CREATE INDEX dossiers_b ON dossiers (b_id);
CREATE INDEX dossiers_statut ON dossiers (statut_id);

-- Clé secrète de l'identifiant des employés (§ 10.5) : 32 octets tirés au hasard, une seule ligne.
-- Elle ne sort jamais du back.
CREATE TABLE cle_identifiant (
  id  INTEGER PRIMARY KEY CHECK (id = 1),
  cle BLOB NOT NULL CHECK (typeof(cle) = 'blob' AND length(cle) = 32)
);
