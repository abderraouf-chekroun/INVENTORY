-- Version 1.2 (spécification § 9.3) : les associations deviennent des affectations datées.
-- Une affectation relie une machine (b_id) à un employé (a_id) pendant une période ; fin NULL = en cours.
-- Une paire peut avoir plusieurs périodes successives, mais une seule en cours (index unique partiel).
-- Exécutée clés étrangères désactivées, puis contrôlée par PRAGMA foreign_key_check avant validation.

CREATE TABLE affectations (
  id    INTEGER PRIMARY KEY,
  a_id  INTEGER NOT NULL REFERENCES entites (id),
  b_id  INTEGER NOT NULL REFERENCES entites (id),
  debut TEXT NOT NULL,
  fin   TEXT NULL
);
CREATE UNIQUE INDEX affectations_en_cours ON affectations (a_id, b_id) WHERE fin IS NULL;
CREATE INDEX affectations_a ON affectations (a_id);
CREATE INDEX affectations_b ON affectations (b_id);

-- Chaque association existante devient une affectation en cours, qui commence à sa date de création.
INSERT INTO affectations (a_id, b_id, debut)
  SELECT a_id, b_id, cree_le FROM associations ORDER BY cree_le, a_id, b_id;

DROP TABLE associations;

-- Journal repris : les titres enregistrés des événements d'association prennent le vocabulaire de la 1.2.
-- (À l'affichage, le titre est de toute façon reformulé du point de vue de la fiche consultée.)
UPDATE evenements
   SET titre = 'Affectation de ' || (SELECT libelle FROM entites WHERE id = evenements.b_id)
               || ' à ' || (SELECT libelle FROM entites WHERE id = evenements.a_id)
 WHERE type = 'association'
   AND EXISTS (SELECT 1 FROM entites WHERE id = evenements.a_id)
   AND EXISTS (SELECT 1 FROM entites WHERE id = evenements.b_id);
UPDATE evenements
   SET titre = 'Fin de l’affectation de ' || (SELECT libelle FROM entites WHERE id = evenements.b_id)
               || ' à ' || (SELECT libelle FROM entites WHERE id = evenements.a_id)
 WHERE type = 'dissociation'
   AND EXISTS (SELECT 1 FROM entites WHERE id = evenements.a_id)
   AND EXISTS (SELECT 1 FROM entites WHERE id = evenements.b_id);
