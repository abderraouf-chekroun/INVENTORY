//! Erreur unique renvoyée au front : `{ code, message }`, message en français affichable tel quel.
//!
//! Les détails techniques (chemins, messages de SQLite ou du système) ne partent jamais vers l'interface :
//! ils sont consignés dans `journal-erreurs.log`, dans le dossier des données.

use serde::Serialize;
use std::fmt;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        AppError { code: code.to_string(), message: message.into() }
    }

    /// Saisie refusée (champ vide, format incorrect…).
    pub fn invalide(message: impl Into<String>) -> Self {
        Self::new("saisie_invalide", message)
    }

    /// Élément demandé absent de la base.
    pub fn introuvable(message: impl Into<String>) -> Self {
        Self::new("introuvable", message)
    }

    /// Opération refusée par une règle métier.
    pub fn refus(code: &str, message: impl Into<String>) -> Self {
        Self::new(code, message)
    }

    /// Dossier clôturé : lecture seule.
    pub fn dossier_clos() -> Self {
        Self::new("dossier_clos", "Ce dossier est clôturé. Rouvrez le dossier pour le modifier.")
    }

    pub fn interne(message: impl Into<String>) -> Self {
        Self::new("interne", message)
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} ({})", self.message, self.code)
    }
}

impl std::error::Error for AppError {}

// ---------- journal des erreurs ----------

static JOURNAL: OnceLock<PathBuf> = OnceLock::new();

/// Au-delà, le journal courant devient `journal-erreurs.log.1` (une seule génération conservée).
const TAILLE_MAX_JOURNAL: u64 = 1024 * 1024;

/// Fixe l'emplacement du journal (une seule fois, au démarrage).
pub fn initialiser_journal(chemin: PathBuf) {
    let _ = JOURNAL.set(chemin);
}

/// Consigne un détail technique. Sans journal initialisé (tests), rien n'est écrit hors du mode debug.
pub fn journaliser(contexte: &str, detail: &dyn fmt::Display) {
    let detail = detail.to_string().replace(['\r', '\n'], " ");
    let ligne = format!("{} [{contexte}] {detail}\n", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"));
    let Some(chemin) = JOURNAL.get() else {
        #[cfg(debug_assertions)]
        eprint!("{ligne}");
        return;
    };
    if fs::metadata(chemin).is_ok_and(|m| m.len() > TAILLE_MAX_JOURNAL) {
        let _ = fs::rename(chemin, chemin.with_extension("log.1"));
    }
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(chemin) {
        let _ = f.write_all(ligne.as_bytes());
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        journaliser("base", &e);
        AppError::new("base_de_donnees", "Erreur de la base de données. Le détail est consigné dans le journal des erreurs.")
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        journaliser("fichier", &e);
        AppError::new("fichier", "Erreur d’accès à un fichier. Le détail est consigné dans le journal des erreurs.")
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        journaliser("json", &e);
        AppError::new("donnees_illisibles", "Données de blocs illisibles.")
    }
}

impl From<tauri::Error> for AppError {
    fn from(e: tauri::Error) -> Self {
        journaliser("tauri", &e);
        AppError::interne("Erreur interne de l’application. Le détail est consigné dans le journal des erreurs.")
    }
}

#[cfg(test)]
mod tests {
    use super::AppError;

    #[test]
    fn erreurs_sans_detail_interne() {
        let io = AppError::from(std::io::Error::other(r"C:\Users\secret\fichier introuvable"));
        assert!(!io.message.contains("secret"), "{}", io.message);
        let sql = AppError::from(rusqlite::Error::InvalidPath(r"C:\Users\secret\base.sqlite".into()));
        assert!(!sql.message.contains("secret"), "{}", sql.message);
        let json = AppError::from(serde_json::from_str::<u8>("\"C:\\\\secret\"").unwrap_err());
        assert!(!json.message.contains("secret"), "{}", json.message);
    }
}
