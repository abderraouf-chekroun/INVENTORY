-- Schéma initial (spécification § 3).
-- Dates en texte ISO, heure locale : 'AAAA-MM-JJ HH:MM:SS' ou 'AAAA-MM-JJ'.

CREATE TABLE parametres (
  cle    TEXT PRIMARY KEY,
  valeur TEXT NOT NULL
);

CREATE TABLE themes (
  id    INTEGER PRIMARY KEY,
  nom   TEXT NOT NULL UNIQUE,
  actif INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE categories (
  id    INTEGER PRIMARY KEY,
  kind  TEXT NOT NULL CHECK (kind IN ('a', 'b')),
  nom   TEXT NOT NULL,
  actif INTEGER NOT NULL DEFAULT 1,
  UNIQUE (kind, nom)
);

CREATE TABLE magasin (
  id    INTEGER PRIMARY KEY,
  nom   TEXT NOT NULL UNIQUE,
  actif INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE entites (
  id           INTEGER PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('a', 'b')),
  nom          TEXT NOT NULL,
  code         TEXT NULL CHECK (code GLOB '[0-9][0-9][0-9][0-9]'),
  categorie_id INTEGER NOT NULL REFERENCES categories (id),
  actif        INTEGER NOT NULL DEFAULT 1,
  cree_le      TEXT NOT NULL,
  maj_le       TEXT NOT NULL
);
CREATE UNIQUE INDEX entites_code_unique ON entites (kind, code) WHERE code IS NOT NULL;
CREATE INDEX entites_kind ON entites (kind);

CREATE TABLE associations (
  a_id    INTEGER NOT NULL REFERENCES entites (id),
  b_id    INTEGER NOT NULL REFERENCES entites (id),
  cree_le TEXT NOT NULL,
  PRIMARY KEY (a_id, b_id)
);
CREATE INDEX associations_b ON associations (b_id);

CREATE TABLE modeles (
  id       INTEGER PRIMARY KEY,
  nom      TEXT NOT NULL,
  theme_id INTEGER NOT NULL REFERENCES themes (id),
  actif    INTEGER NOT NULL DEFAULT 1,
  blocs    TEXT NOT NULL DEFAULT '[]',
  cree_le  TEXT NOT NULL,
  maj_le   TEXT NOT NULL
);

CREATE TABLE dossiers (
  id       INTEGER PRIMARY KEY,
  nom      TEXT NOT NULL,
  annee    INTEGER NOT NULL,
  theme_id INTEGER NOT NULL REFERENCES themes (id),
  statut   TEXT NOT NULL CHECK (statut IN ('cours', 'piece', 'clos')),
  a_id     INTEGER NOT NULL REFERENCES entites (id),
  b_id     INTEGER NOT NULL REFERENCES entites (id),
  cree_le  TEXT NOT NULL,
  maj_le   TEXT NOT NULL,
  clos_le  TEXT NULL
);
CREATE INDEX dossiers_a ON dossiers (a_id);
CREATE INDEX dossiers_b ON dossiers (b_id);

CREATE TABLE sous_dossiers (
  id         INTEGER PRIMARY KEY,
  dossier_id INTEGER NOT NULL REFERENCES dossiers (id) ON DELETE CASCADE,
  parent_id  INTEGER NULL REFERENCES sous_dossiers (id) ON DELETE CASCADE,
  nom        TEXT NOT NULL,
  cree_le    TEXT NOT NULL
);
CREATE INDEX sous_dossiers_dossier ON sous_dossiers (dossier_id);
CREATE INDEX sous_dossiers_parent ON sous_dossiers (parent_id);

CREATE TABLE documents (
  id              INTEGER PRIMARY KEY,
  dossier_id      INTEGER NOT NULL REFERENCES dossiers (id) ON DELETE CASCADE,
  sous_dossier_id INTEGER NULL REFERENCES sous_dossiers (id) ON DELETE CASCADE,
  nom             TEXT NOT NULL,
  origine         TEXT NOT NULL CHECK (origine IN ('modele', 'import')),
  source          TEXT NOT NULL,
  date_doc        TEXT NOT NULL,
  blocs           TEXT NULL,
  fichier_stocke  TEXT NULL,
  fichier_nom     TEXT NULL,
  piece_finale    INTEGER NOT NULL DEFAULT 0,
  cree_le         TEXT NOT NULL
);
CREATE INDEX documents_dossier ON documents (dossier_id);
CREATE INDEX documents_sous_dossier ON documents (sous_dossier_id);

CREATE TABLE options (
  id         INTEGER PRIMARY KEY,
  dossier_id INTEGER NOT NULL REFERENCES dossiers (id) ON DELETE CASCADE,
  nom        TEXT NOT NULL,
  ok         INTEGER NOT NULL DEFAULT 0,
  position   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX options_dossier ON options (dossier_id);

CREATE TABLE evenements (
  id         INTEGER PRIMARY KEY,
  type       TEXT NOT NULL,
  titre      TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  a_id       INTEGER NULL,
  b_id       INTEGER NULL,
  dossier_id INTEGER NULL,
  date       TEXT NOT NULL
);
CREATE INDEX evenements_a ON evenements (a_id);
CREATE INDEX evenements_b ON evenements (b_id);
CREATE INDEX evenements_dossier ON evenements (dossier_id);
