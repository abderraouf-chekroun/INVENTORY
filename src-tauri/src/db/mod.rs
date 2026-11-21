//! Ouverture de la base, vérifications, pragmas et migrations (PRAGMA user_version).

pub mod exemple;
pub mod migration5;

use crate::error::{AppError, AppResult, journaliser};
use rusqlite::config::DbConfig;
use rusqlite::{Connection, OpenFlags};
use std::collections::BTreeSet;
use std::path::Path;

/// Migrations dans l'ordre ; l'indice + 1 est la valeur de `user_version` après application.
const MIGRATIONS: &[&str] = &[
    include_str!("../../migrations/001_init.sql"),
    include_str!("../../migrations/002_employes_machines.sql"),
    include_str!("../../migrations/003_affectations.sql"),
    include_str!("../../migrations/004_etats_citations_identifiants.sql"),
    include_str!("../../migrations/005_nominations.sql"),
    include_str!("../../migrations/006_fiches_supprimees.sql"),
];

/// Version du schéma produite par toutes les migrations.
#[cfg(test)]
pub const VERSION_SCHEMA: i64 = MIGRATIONS.len() as i64;

/// Ouvre (ou crée) la base sur disque, applique pragmas et migrations.
///
/// Une base existante est d'abord vérifiée en lecture seule ([`verifier_base`]) : si elle est refusée,
/// le fichier n'est pas modifié.
///
/// Une base d'une version antérieure (schéma 1 à 5, applications 1.0 à 1.4.1) est d'abord copiée dans
/// `sauvegardes/avant-version-<n>_<horodatage>/donnees.sqlite`, puis migrée. Ce dossier n'est jamais élagué.
pub fn ouvrir(chemin: &Path) -> AppResult<Connection> {
    let version = if chemin.exists() { verifier_fichier(chemin)? } else { 0 };
    let conn = Connection::open(chemin)?;
    if (1..MIGRATIONS.len() as i64).contains(&version) {
        conn.busy_timeout(ATTENTE_VERROU)?;
        sauvegarder_avant_migration(&conn, chemin, version)?;
    }
    preparer(&conn, true)?;
    Ok(conn)
}

/// Copie de la base telle qu'elle était avant la migration (`VACUUM INTO`).
fn sauvegarder_avant_migration(conn: &Connection, chemin: &Path, version: i64) -> AppResult<()> {
    let echec = |e: &dyn std::fmt::Display| {
        journaliser("migration", e);
        AppError::refus(
            "migration_impossible",
            "La base de données doit être mise à jour, mais sa sauvegarde préalable a échoué. \
             Elle n’a pas été modifiée. Vérifiez la place disponible sur le disque, puis relancez l’application.",
        )
    };
    let dossier = chemin.parent().ok_or_else(|| echec(&"dossier de la base introuvable"))?;
    let horodatage = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let mut cible = None;
    for n in 0..100 {
        let nom = if n == 0 {
            format!("avant-version-{}_{horodatage}", version + 1)
        } else {
            format!("avant-version-{}_{horodatage}-{n}", version + 1)
        };
        let c = dossier.join("sauvegardes").join(nom);
        if !c.exists() {
            cible = Some(c);
            break;
        }
    }
    let cible = cible.ok_or_else(|| echec(&"aucun nom de sauvegarde libre"))?;
    std::fs::create_dir_all(&cible).map_err(|e| echec(&e))?;
    let fichier = cible.join("donnees.sqlite").to_string_lossy().into_owned();
    conn.execute("VACUUM INTO ?1", [fichier]).map_err(|e| echec(&e))?;
    Ok(())
}

/// Base en mémoire, pour les tests.
#[cfg(test)]
pub fn ouvrir_memoire() -> AppResult<Connection> {
    let conn = Connection::open_in_memory()?;
    preparer(&conn, false)?;
    Ok(conn)
}

/// Mode défensif : le schéma lu dans le fichier n'est pas « de confiance » (fonctions, vues, déclencheurs
/// limités) et il ne peut pas être corrompu par des requêtes ordinaires.
fn securiser(conn: &Connection) -> AppResult<()> {
    conn.set_db_config(DbConfig::SQLITE_DBCONFIG_DEFENSIVE, true)?;
    conn.set_db_config(DbConfig::SQLITE_DBCONFIG_TRUSTED_SCHEMA, false)?;
    conn.pragma_update(None, "trusted_schema", "OFF")?;
    Ok(())
}

/// Attente maximale d'un verrou posé par un autre outil (sauvegarde, antivirus, explorateur SQLite…).
const ATTENTE_VERROU: std::time::Duration = std::time::Duration::from_secs(5);

fn preparer(conn: &Connection, wal: bool) -> AppResult<()> {
    conn.busy_timeout(ATTENTE_VERROU)?;
    securiser(conn)?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    // Les données supprimées sont écrasées dans le fichier, pas seulement marquées libres.
    conn.pragma_update(None, "secure_delete", "ON")?;
    if wal {
        let _mode: String =
            conn.pragma_update_and_check(None, "journal_mode", "WAL", |r| r.get(0))?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
    }
    migrer(conn)
}

/// Applique les migrations manquantes, chacune dans sa transaction.
///
/// Les clés étrangères sont suspendues le temps des migrations (la 002 reconstruit la table `entites`,
/// référencée par d'autres tables), puis contrôlées par `PRAGMA foreign_key_check` avant chaque validation.
/// Une base existante (version ≥ 1) qui passe en version 2 reçoit les modèles standards (§ 8.6) dans la même
/// transaction ; une base neuve les reçoit au premier lancement (`domaine::donnees::initialiser`, § 14).
pub fn migrer(conn: &Connection) -> AppResult<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version >= MIGRATIONS.len() as i64 {
        return Ok(());
    }
    let cles: bool = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0))?;
    conn.pragma_update(None, "foreign_keys", "OFF")?;
    let resultat = (|| -> AppResult<()> {
        for (i, sql) in MIGRATIONS.iter().enumerate() {
            let cible = i as i64 + 1;
            if version >= cible {
                continue;
            }
            let tx = conn.unchecked_transaction()?;
            // La 004 et la 005 reconstruisent la table des dossiers : leur nombre est contrôlé avant validation.
            let dossiers_avant =
                if cible == 4 || cible == 5 { Some(compter(&tx, "SELECT COUNT(*) FROM dossiers")?) } else { None };
            // § 11.5 : le rattachement des dossiers est reporté dans leurs documents avant que ses colonnes disparaissent.
            let report = if cible == 5 { Some(migration5::avant(&tx)?) } else { None };
            tx.execute_batch(sql)?;
            if cible == 2 && version >= 1 {
                crate::domaine::modeles::assurer_standards(&tx)?;
            }
            if dossiers_avant.is_some() && dossiers_avant != Some(compter(&tx, "SELECT COUNT(*) FROM dossiers")?) {
                return Err(AppError::refus(
                    "migration_impossible",
                    "La mise à jour de la base de données a échoué : des dossiers n’ont pas pu être repris. \
                     La base n’a pas été modifiée.",
                ));
            }
            if cible == 4 {
                // Clé secrète tirée au hasard, puis identifiants des employés recalculés (§ 10.5).
                crate::domaine::identifiant::assurer_cle(&tx)?;
                crate::domaine::entites::recalculer_identifiants(&tx)?;
            }
            if let Some(report) = &report {
                migration5::apres(&tx, report)?;
            }
            let mut fk = tx.prepare("PRAGMA foreign_key_check")?;
            if fk.query([])?.next()?.is_some() {
                return Err(AppError::refus(
                    "migration_impossible",
                    "La mise à jour de la base de données a échoué : des références entre ses tables sont invalides. \
                     La base n’a pas été modifiée.",
                ));
            }
            drop(fk);
            tx.pragma_update(None, "user_version", cible)?;
            tx.commit()?;
        }
        Ok(())
    })();
    if cles {
        conn.pragma_update(None, "foreign_keys", "ON")?;
    }
    resultat
}

/// Vrai si la base n'a jamais été initialisée (aucun paramètre `donnees_exemple`).
pub fn est_neuve(conn: &Connection) -> AppResult<bool> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM parametres WHERE cle = 'donnees_exemple'",
        [],
        |r| r.get(0),
    )?;
    Ok(n == 0)
}

// ---------- vérification d'une base existante ----------

const NOTE_NON_MODIFIEE: &str = "Elle n’a pas été ouverte ni modifiée.";

fn base_refusee(motif: &str) -> AppError {
    AppError::refus("base_refusee", format!("La base de données « donnees.sqlite » est refusée : {motif} {NOTE_NON_MODIFIEE}"))
}

/// Vérifie un fichier existant au travers d'une connexion en lecture seule ; renvoie sa version.
fn verifier_fichier(chemin: &Path) -> AppResult<i64> {
    let resultat = Connection::open_with_flags(chemin, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .map_err(AppError::from)
        .and_then(|conn| {
            // Une base seulement verrouillée par un autre outil n'est pas « illisible » : on attend.
            conn.busy_timeout(ATTENTE_VERROU)?;
            securiser(&conn)?;
            verifier_base(&conn)?;
            Ok(conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))?)
        });
    resultat.map_err(|e| {
        if e.code == "base_refusee" {
            e
        } else {
            base_refusee(
                "ce fichier n’a pas pu être lu comme une base d’INVENTORY (il est endommagé, \
                 d’un autre type, ou verrouillé par une autre application).",
            )
        }
    })
}

/// Élément du schéma normalisé : (type, nom, table, SQL aux espaces réduits).
type ElementSchema = (String, String, String, String);

/// Schéma normalisé. Seuls les objets internes exacts de SQLite sont exclus : index automatiques
/// (`sqlite_autoindex_…`, sans SQL) et tables `sqlite_sequence`, `sqlite_stat1`, `sqlite_stat4`.
/// Tout autre objet nommé `sqlite_…` (écrit avec `writable_schema`, par exemple) reste visible.
fn lire_schema(conn: &Connection) -> AppResult<BTreeSet<ElementSchema>> {
    let mut stmt = conn.prepare(
        "SELECT type, name, tbl_name, COALESCE(sql, '') FROM sqlite_master
         WHERE NOT (type = 'index' AND name LIKE 'sqlite\\_autoindex\\_%' ESCAPE '\\' AND sql IS NULL)
           AND NOT (type = 'table' AND name IN ('sqlite_sequence', 'sqlite_stat1', 'sqlite_stat4'))",
    )?;
    let lignes = stmt
        .query_map([], |r| {
            let sql: String = r.get(3)?;
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, sql.split_whitespace().collect::<Vec<_>>().join(" ")))
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(lignes)
}

/// Schéma produit par les migrations jusqu'à `version` incluse.
fn schema_attendu(version: usize) -> AppResult<BTreeSet<ElementSchema>> {
    let mem = Connection::open_in_memory()?;
    for sql in &MIGRATIONS[..version] {
        mem.execute_batch(sql)?;
    }
    lire_schema(&mem)
}

fn compter(conn: &Connection, sql: &str) -> AppResult<i64> {
    Ok(conn.query_row(sql, [], |r| r.get(0))?)
}

/// Contrôles d'une base avant usage : version connue, intégrité, schéma identique à celui des migrations
/// (aucune table, aucune vue ni aucun déclencheur inconnus), clés étrangères et arborescence des
/// sous-dossiers cohérentes.
pub fn verifier_base(conn: &Connection) -> AppResult<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version > MIGRATIONS.len() as i64 {
        return Err(base_refusee(
            "elle a été créée par une version plus récente d’INVENTORY. Installez la dernière version de l’application.",
        ));
    }
    let version = usize::try_from(version).map_err(|_| base_refusee("sa version est invalide."))?;

    let controle: String = conn.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
    if controle != "ok" {
        journaliser("base", &controle);
        return Err(base_refusee("le fichier est endommagé."));
    }

    // L'application ne crée ni déclencheur ni vue : il ne doit y en avoir aucun, quel que soit leur nom.
    if compter(conn, "SELECT COUNT(*) FROM sqlite_master WHERE type IN ('trigger', 'view')")? != 0 {
        return Err(base_refusee("elle contient des déclencheurs ou des vues qui ne viennent pas de l’application."));
    }
    let present = lire_schema(conn)?;
    let attendu = schema_attendu(version)?;
    if present != attendu {
        let inconnus: Vec<String> = present.difference(&attendu).map(|(t, n, _, _)| format!("{t} {n}")).collect();
        journaliser("base", &format!("schéma inattendu ; éléments inconnus ou modifiés : {}", inconnus.join(", ")));
        let piege = present.difference(&attendu).any(|(t, _, _, _)| t == "trigger" || t == "view");
        return Err(base_refusee(if piege {
            "elle contient des déclencheurs ou des vues qui ne viennent pas de l’application."
        } else {
            "sa structure ne correspond pas à celle de l’application."
        }));
    }
    if version == 0 {
        return Ok(());
    }

    let mut fk = conn.prepare("PRAGMA foreign_key_check")?;
    if fk.query([])?.next()?.is_some() {
        return Err(base_refusee("elle contient des références invalides entre ses tables."));
    }
    let incoherences = compter(
        conn,
        "SELECT COUNT(*) FROM sous_dossiers s JOIN sous_dossiers p ON p.id = s.parent_id
         WHERE p.dossier_id <> s.dossier_id",
    )? + compter(
        conn,
        "SELECT COUNT(*) FROM documents x JOIN sous_dossiers s ON s.id = x.sous_dossier_id
         WHERE s.dossier_id <> x.dossier_id",
    )? + compter(
        conn,
        "WITH RECURSIVE r(id) AS (
             SELECT id FROM sous_dossiers WHERE parent_id IS NULL
             UNION
             SELECT s.id FROM sous_dossiers s JOIN r ON s.parent_id = r.id
         )
         SELECT (SELECT COUNT(*) FROM sous_dossiers) - (SELECT COUNT(*) FROM r)",
    )?;
    if incoherences != 0 {
        return Err(base_refusee("l’arborescence de ses sous-dossiers est incohérente."));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            let p = std::env::temp_dir().join(format!("entites-dossiers-db-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&p).unwrap();
            Temp(p)
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// Crée une base valide sur disque, applique `modifier`, ferme, puis tente de l'ouvrir.
    /// Renvoie le résultat et, en cas de refus, si le fichier est resté identique.
    fn ouvrir_apres(modifier: &str) -> (AppResult<Connection>, bool) {
        let t = Temp::new();
        let chemin = t.0.join("donnees.sqlite");
        {
            let c = Connection::open(&chemin).unwrap();
            migrer(&c).unwrap();
            c.execute_batch(
                "INSERT INTO themes (id, nom) VALUES (1, 'T');
                 INSERT INTO categories (id, kind, nom) VALUES (1, 'a', 'G'), (2, 'b', 'T');
                 INSERT INTO entites (id, kind, nom, categorie_id, cree_le, maj_le)
                   VALUES (1, 'a', 'A', 1, 'x', 'x'), (2, 'b', 'B', 2, 'x', 'x');
                 INSERT INTO dossiers (id, nom, annee, theme_id, statut_id, cree_le, maj_le)
                   VALUES (1, 'D1', 2026, 1, 1, 'x', 'x'), (2, 'D2', 2026, 1, 1, 'x', 'x');
                 INSERT INTO documents (id, dossier_id, nom, origine, source, date_doc, blocs, cree_le)
                   VALUES (1, 1, 'Doc', 'modele', 'M', '2026-01-01', '[{\"t\":\"employe\",\"v\":\"E\",\"entiteId\":1}]', 'x');
                 INSERT INTO nominations (document_id, entite_id, facon, champ, depuis) VALUES (1, 1, 'bloc', 'E', 'x');
                 INSERT INTO sous_dossiers (id, dossier_id, parent_id, nom, cree_le)
                   VALUES (1, 1, NULL, 'S1', 'x'), (2, 1, 1, 'S2', 'x');",
            )
            .unwrap();
            c.execute_batch(modifier).unwrap();
        }
        let avant = fs::read(&chemin).unwrap();
        let r = ouvrir(&chemin);
        let inchange = r.is_ok() || fs::read(&chemin).unwrap() == avant;
        (r, inchange)
    }

    fn refusee(modifier: &str) {
        let (r, inchange) = ouvrir_apres(modifier);
        let e = r.err().unwrap_or_else(|| panic!("base acceptée : {modifier}"));
        assert_eq!(e.code, "base_refusee", "{modifier}");
        assert!(e.message.contains("pas été ouverte ni modifiée"), "{}", e.message);
        assert!(inchange, "le fichier refusé a été modifié : {modifier}");
    }

    #[test]
    fn base_valide_acceptee() {
        let (r, _) = ouvrir_apres("");
        r.unwrap();
    }

    #[test]
    fn base_piegee_refusee_sans_modification() {
        refusee(
            "CREATE TRIGGER piege AFTER INSERT ON documents BEGIN
               UPDATE documents SET fichier_stocke = '..\\..\\x.exe' WHERE id = new.id; END;",
        );
        refusee("CREATE VIEW v AS SELECT * FROM documents;");
        refusee("CREATE TABLE intruse (x);");
        refusee("PRAGMA user_version = 99;");
        // Déclencheur au nom réservé `sqlite_…`, écrit directement dans le schéma.
        refusee(
            "PRAGMA writable_schema = ON;
             INSERT INTO sqlite_master (type, name, tbl_name, rootpage, sql) VALUES ('trigger', 'sqlite_piege', 'documents', 0,
               'CREATE TRIGGER sqlite_piege AFTER INSERT ON documents BEGIN UPDATE documents SET fichier_stocke = ''x'' WHERE id = new.id; END');
             PRAGMA writable_schema = OFF;",
        );
        // Faux index automatique porteur de SQL.
        refusee(
            "PRAGMA writable_schema = ON;
             INSERT INTO sqlite_master (type, name, tbl_name, rootpage, sql) VALUES ('view', 'sqlite_autoindex_documents_9', 'documents', 0,
               'CREATE VIEW sqlite_autoindex_documents_9 AS SELECT 1');
             PRAGMA writable_schema = OFF;",
        );
    }

    #[test]
    fn base_verrouillee_un_instant_acceptee() {
        let t = Temp::new();
        let chemin = t.0.join("donnees.sqlite");
        {
            let c = Connection::open(&chemin).unwrap();
            migrer(&c).unwrap();
        }
        // Un autre outil tient un verrou exclusif pendant 500 ms.
        let autre = Connection::open(&chemin).unwrap();
        autre.execute_batch("BEGIN EXCLUSIVE; INSERT INTO themes (nom) VALUES ('T');").unwrap();
        let liberation = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(500));
            autre.execute_batch("COMMIT;").unwrap();
        });
        ouvrir(&chemin).unwrap();
        liberation.join().unwrap();
    }

    #[test]
    fn arborescence_incoherente_refusee() {
        // Cycle S1 ↔ S2.
        refusee("UPDATE sous_dossiers SET parent_id = 2 WHERE id = 1;");
        // Parent dans un autre dossier.
        refusee("INSERT INTO sous_dossiers (id, dossier_id, parent_id, nom, cree_le) VALUES (3, 2, 1, 'S3', 'x');");
        // Référence vers une ligne absente (écrite par un outil qui ne vérifie pas les clés étrangères).
        refusee(
            "PRAGMA foreign_keys = OFF;
             INSERT INTO sous_dossiers (id, dossier_id, parent_id, nom, cree_le) VALUES (4, 9, NULL, 'S4', 'x');",
        );
    }

    #[test]
    fn fichier_qui_n_est_pas_une_base_refuse() {
        let t = Temp::new();
        let chemin = t.0.join("donnees.sqlite");
        fs::write(&chemin, [b'x'; 4096]).unwrap();
        let e = ouvrir(&chemin).err().unwrap();
        assert_eq!(e.code, "base_refusee");
    }

    #[test]
    fn suppression_securisee_et_schema_non_fiable() {
        let c = ouvrir_memoire().unwrap();
        let v: i64 = c.query_row("PRAGMA secure_delete", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 1);
        let t: i64 = c.query_row("PRAGMA trusted_schema", [], |r| r.get(0)).unwrap();
        assert_eq!(t, 0);
    }
}
