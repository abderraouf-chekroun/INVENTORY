-- Version 1.4 (spécification § 11.5) : dossiers sans employé ni machine, nominations enregistrées, modèle d'origine
-- des documents.
-- Exécutée clés étrangères désactivées (reconstruction de la table dossiers, référencée par d'autres tables), puis
-- contrôlée par PRAGMA foreign_key_check avant validation. Le code Rust reporte d'abord le rattachement de chaque
-- dossier dans ses documents (blocs employe / machine), avant ce script ; il retrouve ensuite le modèle d'origine des
-- documents et remplit la table des nominations, dans la même transaction.

-- Dossiers : les colonnes de rattachement à un employé et à une machine disparaissent (§ 11.1).
CREATE TABLE dossiers_v5 (
  id        INTEGER PRIMARY KEY,
  nom       TEXT NOT NULL,
  annee     INTEGER NOT NULL,
  theme_id  INTEGER NOT NULL REFERENCES themes (id),
  statut_id INTEGER NOT NULL REFERENCES statuts (id),
  cree_le   TEXT NOT NULL,
  maj_le    TEXT NOT NULL,
  clos_le   TEXT NULL
);

INSERT INTO dossiers_v5 (id, nom, annee, theme_id, statut_id, cree_le, maj_le, clos_le)
  SELECT id, nom, annee, theme_id, statut_id, cree_le, maj_le, clos_le FROM dossiers;

DROP TABLE dossiers;
ALTER TABLE dossiers_v5 RENAME TO dossiers;

CREATE INDEX dossiers_statut ON dossiers (statut_id);

-- Modèle d'origine d'un document (§ 11.4) : NULL pour un fichier importé, ou quand il n'a pas pu être retrouvé.
ALTER TABLE documents ADD COLUMN modele_id INTEGER NULL REFERENCES modeles (id);
CREATE INDEX documents_modele ON documents (modele_id);

-- Nominations (§ 11.2) : une fiche nommée dans un document, par un bloc employe / machine ('bloc') ou par son nom
-- écrit dans une valeur saisie ('texte'). champ : libellé du bloc (de la colonne pour une cellule de tableau) ;
-- depuis : moment où la nomination est apparue, AAAA-MM-JJ HH:MM:SS.
CREATE TABLE nominations (
  document_id INTEGER NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  entite_id   INTEGER NOT NULL REFERENCES entites (id),
  facon       TEXT NOT NULL CHECK (facon IN ('bloc', 'texte')),
  champ       TEXT NOT NULL,
  depuis      TEXT NOT NULL,
  PRIMARY KEY (document_id, entite_id, facon, champ)
);
CREATE INDEX nominations_entite ON nominations (entite_id);
