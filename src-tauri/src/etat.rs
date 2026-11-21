//! État partagé de l'application : connexion SQLite et emplacements des données.

use crate::db;
use crate::domaine::{copies, donnees};
use crate::error::{self, AppError, AppResult, journaliser};
use rusqlite::Connection;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use tauri::{AppHandle, Manager, Runtime};

/// Variable d'environnement qui impose le répertoire de données (chemin absolu sur un disque local).
pub const VAR_DOSSIER_DONNEES: &str = "ENTITES_DOSSIERS_DONNEES";

/// Répertoire imposé par la variable d'environnement.
///
/// Absente ou vide : `None`. Sinon, seul un chemin absolu sur un lecteur local non distant est accepté
/// (une fois les liens résolus) : partage réseau, lecteur réseau mappé, lien vers un partage, chemin
/// `\\?\…` ou périphérique empêchent le démarrage (plutôt que de revenir en silence au dossier habituel).
pub fn dossier_impose(valeur: Option<OsString>) -> AppResult<Option<PathBuf>> {
    let Some(valeur) = valeur.filter(|v| !v.is_empty()) else { return Ok(None) };
    let chemin = PathBuf::from(valeur);
    if copies::lecteur_local(&chemin) {
        Ok(Some(chemin))
    } else {
        Err(AppError::refus(
            "dossier_donnees_refuse",
            format!(
                "La variable {VAR_DOSSIER_DONNEES} doit désigner un chemin absolu sur un disque local de ce poste \
                 (par exemple C:\\…). Partages et lecteurs réseau, chemins \\\\?\\ et périphériques sont refusés."
            ),
        ))
    }
}

/// Répertoire des données : celui imposé par [`VAR_DOSSIER_DONNEES`], sinon `app_data_dir`.
pub fn dossier_donnees<R: Runtime>(app: &AppHandle<R>) -> AppResult<PathBuf> {
    match dossier_impose(std::env::var_os(VAR_DOSSIER_DONNEES))? {
        Some(d) => Ok(d),
        None => app.path().app_data_dir().map_err(|e| {
            journaliser("démarrage", &e);
            AppError::interne("Le répertoire des données de l’application est introuvable.")
        }),
    }
}

/// Message du refus de démarrer : la cause, l'emplacement des données et la marche à suivre.
pub fn message_echec_demarrage(e: &AppError, dossier: Option<&Path>) -> String {
    let mut m = e.message.clone();
    if let Some(d) = dossier {
        m.push_str(&format!("\n\nDossier des données :\n{}", d.display()));
        if e.code == "base_refusee" {
            m.push_str(
                "\n\nPour repartir :\n\
                 • mettez de côté le fichier donnees.sqlite (renommez-le, par exemple en donnees-refusee.sqlite), \
                 puis relancez l’application : elle créera une base neuve, sans toucher aux fichiers importés ;\n\
                 • ou restaurez une sauvegarde : copiez le fichier donnees.sqlite d’un sous-dossier de « sauvegardes » \
                 à la place du fichier refusé.\n\
                 Le bouton « Ouvrir le dossier » ouvre le dossier des données dans l’Explorateur.",
            );
        } else {
            m.push_str("\n\nLe bouton « Ouvrir le dossier » ouvre le dossier des données dans l’Explorateur.");
        }
    }
    m
}

pub struct Etat {
    conn: Mutex<Connection>,
    /// Répertoire de données de l'application (`app_data_dir`).
    pub dossier_donnees: PathBuf,
    /// Chemin de `donnees.sqlite`.
    pub chemin_base: PathBuf,
    /// Dossier `fichiers/` : copies des fichiers importés.
    pub fichiers: PathBuf,
}

impl Etat {
    /// Ouvre (ou crée) la base dans le répertoire des données. Au premier lancement, la base neuve est vide (§ 14) :
    /// seuls les quatre modèles standards y sont créés. Une base déjà initialisée n'est ni vidée ni remplie.
    ///
    /// La variable d'environnement [`VAR_DOSSIER_DONNEES`] remplace `app_data_dir` : la suite de bout en bout
    /// (`tests/e2e`) s'en sert pour lancer l'application sur un dossier vierge sans toucher aux vraies données.
    pub fn ouvrir_dans(dossier_donnees: PathBuf) -> AppResult<Self> {
        fs::create_dir_all(&dossier_donnees)?;
        error::initialiser_journal(dossier_donnees.join("journal-erreurs.log"));
        let fichiers = dossier_donnees.join("fichiers");
        fs::create_dir_all(&fichiers)?;
        let chemin_base = dossier_donnees.join("donnees.sqlite");
        let base_existante = chemin_base.exists();
        let conn = db::ouvrir(&chemin_base)?;
        if db::est_neuve(&conn)? {
            // § 14 : une base neuve est vide (les données d'exemple se chargent à la demande, depuis Paramètres).
            donnees::initialiser(&conn)?;
        } else if base_existante {
            // Uniquement les copies provisoires (`import-…`, `supprime-…`) ; rien quand la base vient d'être créée.
            copies::nettoyer_provisoires(&conn, &fichiers)?;
        }
        Ok(Etat { conn: Mutex::new(conn), dossier_donnees, chemin_base, fichiers })
    }

    pub fn conn(&self) -> AppResult<MutexGuard<'_, Connection>> {
        // Une commande qui aurait paniqué laisse le verrou « empoisonné » : la connexion reste utilisable.
        Ok(self.conn.lock().unwrap_or_else(|e| e.into_inner()))
    }
}

#[cfg(test)]
mod tests {
    use super::{Etat, dossier_impose, message_echec_demarrage};
    use crate::error::AppError;
    use std::ffi::OsString;
    use std::fs;
    use std::path::{Path, PathBuf};

    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            Temp(std::env::temp_dir().join(format!("entites-dossiers-etat-{}", uuid::Uuid::new_v4())))
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    const A: &str = "0b1c2d3e-4f50-4617-8899-aabbccddee01.pdf";
    const B: &str = "0b1c2d3e-4f50-4617-8899-aabbccddee02.pdf";

    fn noms(dossier: &Path) -> Vec<String> {
        let mut v: Vec<String> =
            fs::read_dir(dossier).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        v.sort();
        v
    }

    fn referencer(etat: &Etat, stocke: &str) {
        let c = etat.conn().unwrap();
        // § 14 : la base neuve est vide ; le premier appel crée un dossier dans le thème des modèles standards.
        c.execute(
            "INSERT INTO dossiers (nom, annee, theme_id, statut_id, cree_le, maj_le)
             SELECT 'Dossier test', 2026, (SELECT MIN(id) FROM themes), (SELECT MIN(id) FROM statuts), 'x', 'x'
             WHERE NOT EXISTS (SELECT 1 FROM dossiers)",
            [],
        )
        .unwrap();
        let dossier_id: i64 = c.query_row("SELECT id FROM dossiers ORDER BY id LIMIT 1", [], |r| r.get(0)).unwrap();
        c.execute(
            "INSERT INTO documents (dossier_id, nom, origine, source, date_doc, fichier_stocke, fichier_nom, cree_le)
             VALUES (?1, ?2, 'import', 'x', '2026-01-01', ?2, 'x.pdf', 'x')",
            rusqlite::params![dossier_id, stocke],
        )
        .unwrap();
    }

    #[test]
    fn dossier_impose_exige_un_chemin_absolu_local() {
        assert_eq!(dossier_impose(None).unwrap(), None);
        assert_eq!(dossier_impose(Some(OsString::new())).unwrap(), None);
        let absolu = std::env::temp_dir().join("donnees-e2e");
        assert_eq!(dossier_impose(Some(absolu.clone().into_os_string())).unwrap(), Some(absolu));
        for refuse in ["relatif\\donnees", r"\\serveur\partage\donnees", r"\\?\C:\donnees", r"\\.\pipe\x", r"C:\donnees\NUL"] {
            let e = dossier_impose(Some(OsString::from(refuse))).unwrap_err();
            assert_eq!(e.code, "dossier_donnees_refuse", "{refuse}");
        }
    }

    #[test]
    fn base_absente_aucune_copie_supprimee() {
        let t = Temp::new();
        let fichiers = t.0.join("fichiers");
        fs::create_dir_all(&fichiers).unwrap();
        fs::write(fichiers.join(A), "a").unwrap();
        let _etat = Etat::ouvrir_dans(t.0.clone()).unwrap();
        assert!(fichiers.join(A).is_file(), "une copie est supprimée parce que la base est neuve");
    }

    #[test]
    fn copie_non_referencee_conservee_provisoires_nettoyes() {
        let t = Temp::new();
        let fichiers = t.0.join("fichiers");
        {
            let etat = Etat::ouvrir_dans(t.0.clone()).unwrap();
            referencer(&etat, A);
            fs::write(fichiers.join(A), "a").unwrap();
            // B n'est pas référencé (base restaurée plus ancienne, par exemple) : il doit rester.
            fs::write(fichiers.join(B), "b").unwrap();
            // Import interrompu, et copie d'un document supprimé dont l'effacement a échoué.
            fs::write(fichiers.join(format!("import-{B}")), "i").unwrap();
            fs::write(fichiers.join("supprime-0b1c2d3e-4f50-4617-8899-aabbccddee03.pdf"), "s").unwrap();
        }
        drop(Etat::ouvrir_dans(t.0.clone()).unwrap());
        assert_eq!(noms(&fichiers), [A, B]);
    }

    #[test]
    fn copie_mise_de_cote_remise_en_place() {
        let t = Temp::new();
        let fichiers = t.0.join("fichiers");
        {
            let etat = Etat::ouvrir_dans(t.0.clone()).unwrap();
            referencer(&etat, A);
            // Arrêt brutal au milieu d'une suppression : la copie mise de côté est encore référencée.
            fs::write(fichiers.join(format!("supprime-{A}")), "a").unwrap();
        }
        drop(Etat::ouvrir_dans(t.0.clone()).unwrap());
        assert_eq!(noms(&fichiers), [A]);
    }

    #[test]
    fn message_de_refus_avec_dossier_et_marche_a_suivre() {
        let e = AppError::refus("base_refusee", "La base est refusée.");
        let m = message_echec_demarrage(&e, Some(Path::new(r"C:\Users\x\AppData\Roaming\app")));
        assert!(m.contains(r"C:\Users\x\AppData\Roaming\app"));
        assert!(m.contains("sauvegardes"));
        assert!(m.contains("donnees.sqlite"));
        assert!(m.contains("Ouvrir le dossier"));
        let sans = message_echec_demarrage(&AppError::refus("dossier_donnees_refuse", "Variable invalide."), None);
        assert_eq!(sans, "Variable invalide.");
    }
}
