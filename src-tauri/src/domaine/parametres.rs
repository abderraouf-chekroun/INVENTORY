//! Paramètres d'affichage et indicateur « données d'exemple ».

use crate::error::{AppError, AppResult};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Parametres {
    pub theme: String,
    pub densite: String,
    pub donnees_exemple: bool,
}

pub const DONNEES_EXEMPLE: &str = "donnees_exemple";

pub fn lire_valeur(conn: &Connection, cle: &str) -> AppResult<Option<String>> {
    Ok(conn
        .query_row("SELECT valeur FROM parametres WHERE cle = ?1", [cle], |r| r.get(0))
        .optional()?)
}

pub fn ecrire(conn: &Connection, cle: &str, valeur: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO parametres (cle, valeur) VALUES (?1, ?2)
         ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur",
        params![cle, valeur],
    )?;
    Ok(())
}

pub fn lire(conn: &Connection) -> AppResult<Parametres> {
    let theme = lire_valeur(conn, "theme")?
        .filter(|v| matches!(v.as_str(), "system" | "light" | "dark"))
        .unwrap_or_else(|| "system".to_string());
    let densite = lire_valeur(conn, "densite")?
        .filter(|v| matches!(v.as_str(), "eq" | "compact"))
        .unwrap_or_else(|| "eq".to_string());
    let donnees_exemple = lire_valeur(conn, DONNEES_EXEMPLE)?.as_deref() == Some("1");
    Ok(Parametres { theme, densite, donnees_exemple })
}

pub fn definir(conn: &Connection, cle: &str, valeur: &str) -> AppResult<()> {
    let permis: &[&str] = match cle {
        "theme" => &["system", "light", "dark"],
        "densite" => &["eq", "compact"],
        _ => return Err(AppError::invalide(format!("Paramètre inconnu : « {cle} »."))),
    };
    if !permis.contains(&valeur) {
        return Err(AppError::invalide(format!("Valeur non permise pour « {cle} » : « {valeur} ».")));
    }
    ecrire(conn, cle, valeur)
}
