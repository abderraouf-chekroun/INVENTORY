-- Version 1.5 (spécification § 13.2, 13.3) : suppression d'un employé ou d'une machine.
-- Les identifiants des fiches peuvent être réattribués après une suppression (INTEGER PRIMARY KEY) : un événement
-- du journal qui citait une fiche supprimée perd son identifiant (a_id / b_id mis à NULL) et garde le libellé
-- qu'avait la fiche dans ces colonnes, pour rester lisible dans l'historique de l'autre fiche et du dossier.
-- Ajout de colonnes seulement : aucune donnée existante n'est modifiée (les colonnes valent NULL).

ALTER TABLE evenements ADD COLUMN a_libelle_supprime TEXT NULL;
ALTER TABLE evenements ADD COLUMN b_libelle_supprime TEXT NULL;
