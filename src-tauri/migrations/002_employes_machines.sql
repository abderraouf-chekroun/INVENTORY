-- Version 1.1 (spécification § 8.7) : Employés (kind 'a') et Machines (kind 'b').
-- Exécutée clés étrangères désactivées (reconstruction de la table entites), puis contrôlée par
-- PRAGMA foreign_key_check avant validation. Les modèles standards sont ajoutés ensuite par le code Rust.

-- L'ancien code à 4 chiffres d'une fiche A est conservé dans son journal : l'identifiant d'un employé est
-- désormais calculé, et il reste absent tant que la fiche n'est pas complétée.
INSERT INTO evenements (type, titre, detail, a_id, b_id, dossier_id, date)
  SELECT 'fiche_modifiee', 'Fiche reprise en version 1.1',
         'Ancien code : ' || code || '. L’identifiant sera calculé quand la fiche sera complétée (prénom, date de naissance, poste).',
         id, NULL, NULL, strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')
  FROM entites WHERE kind = 'a' AND code IS NOT NULL;

-- Journal repris : les textes enregistrés par la version 1.0 sont réécrits dans le vocabulaire de la 1.1 (§ 8.1 :
-- plus de « Code unique », de « Code #… » ni de « groupe » dans le journal). Seuls les textes produits par la
-- version 1.0 sont visés (titres et formulations exactes) ; les noms des fiches et des dossiers ne changent pas.
UPDATE evenements SET titre = 'Ancien code saisi',
       detail = replace(replace(detail, 'Code #', 'Code '), ' attribué à la fiche.', ' attribué à la fiche (version 1.0).')
  WHERE type = 'code_saisi' AND titre = 'Code unique saisi' AND a_id IS NOT NULL AND b_id IS NULL;
UPDATE evenements SET titre = 'Identifiant saisi', detail = replace(detail, 'Code #', 'Identifiant ')
  WHERE type = 'code_saisi' AND titre = 'Code unique saisi' AND b_id IS NOT NULL AND a_id IS NULL;
UPDATE evenements SET detail = replace(replace(detail, 'code unique', 'identifiant'), 'groupe', 'structure')
  WHERE type = 'fiche_modifiee' AND detail LIKE 'Modification : %' AND a_id IS NOT NULL AND b_id IS NULL;
UPDATE evenements SET detail = replace(replace(detail, 'code unique', 'identifiant'), 'type', 'type de machine')
  WHERE type = 'fiche_modifiee' AND detail LIKE 'Modification : %' AND b_id IS NOT NULL AND a_id IS NULL;

CREATE TABLE entites_v2 (
  id             INTEGER PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('a', 'b')),
  nom            TEXT NOT NULL,
  code           TEXT NULL CHECK (code IS NULL OR length(code) BETWEEN 1 AND 40),
  categorie_id   INTEGER NOT NULL REFERENCES categories (id),
  actif          INTEGER NOT NULL DEFAULT 1,
  cree_le        TEXT NOT NULL,
  maj_le         TEXT NOT NULL,
  libelle        TEXT NOT NULL DEFAULT '',
  prenom         TEXT NOT NULL DEFAULT '',
  date_naissance TEXT NULL,
  poste          TEXT NOT NULL DEFAULT '',
  marque         TEXT NOT NULL DEFAULT '',
  cpu            TEXT NOT NULL DEFAULT '',
  ram            TEXT NOT NULL DEFAULT '',
  stockage       TEXT NOT NULL DEFAULT ''
);

INSERT INTO entites_v2 (id, kind, nom, code, categorie_id, actif, cree_le, maj_le, libelle)
  SELECT id, kind, nom, CASE WHEN kind = 'b' THEN code END, categorie_id, actif, cree_le, maj_le, nom
  FROM entites;

DROP TABLE entites;
ALTER TABLE entites_v2 RENAME TO entites;

CREATE UNIQUE INDEX entites_code_unique ON entites (kind, code COLLATE NOCASE) WHERE code IS NOT NULL;
CREATE INDEX entites_kind ON entites (kind);

-- Modèles standards : clé stable, pour les restaurer sans doublon même renommés.
ALTER TABLE modeles ADD COLUMN standard TEXT NULL;
CREATE UNIQUE INDEX modeles_standard ON modeles (standard) WHERE standard IS NOT NULL;
