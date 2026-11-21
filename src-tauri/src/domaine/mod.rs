//! Logique métier : fonctions prenant `&Connection`, testables avec une base en mémoire.

pub mod classement;
pub mod copies;
pub mod documents;
pub mod donnees;
pub mod dossiers;
pub mod entites;
pub mod identifiant;
pub mod journal;
pub mod modeles;
pub mod nominations;
pub mod parametres;
pub mod recherche;
pub mod standards;
pub mod statuts;
pub mod tableau;
pub mod texte;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_v11;
#[cfg(test)]
mod tests_v12;
#[cfg(test)]
mod tests_v13;
#[cfg(test)]
mod tests_v14;
#[cfg(test)]
mod tests_v15;
#[cfg(test)]
mod tests_v151;
#[cfg(test)]
mod tests_v16;
#[cfg(test)]
mod tests_v17;
#[cfg(test)]
mod tests_v18;
#[cfg(test)]
mod tests_v181;
#[cfg(test)]
mod tests_v182;

use crate::error::{AppError, AppResult};
use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use serde::{Deserialize, Serialize};

/// Répertoire d'une fiche : 'a' (employé) ou 'b' (machine).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    A,
    B,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::A => "a",
            Kind::B => "b",
        }
    }

    /// « un employé » / « une machine ».
    pub fn un(self) -> &'static str {
        match self {
            Kind::A => "un employé",
            Kind::B => "une machine",
        }
    }
}

impl ToSql for Kind {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::from(self.as_str()))
    }
}

impl FromSql for Kind {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "a" => Ok(Kind::A),
            "b" => Ok(Kind::B),
            _ => Err(FromSqlError::InvalidType),
        }
    }
}

/// Horodatage local `AAAA-MM-JJ HH:MM:SS`.
pub fn maintenant() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

/// Date locale du jour `AAAA-MM-JJ`.
pub fn aujourd_hui() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

/// Année locale en cours.
pub fn annee_en_cours() -> i32 {
    use chrono::Datelike;
    chrono::Local::now().year()
}

/// Nom obligatoire : espaces retirés aux extrémités, non vide.
pub fn nom_requis(nom: &str, message: &str) -> AppResult<String> {
    let n = nom.trim();
    if n.is_empty() {
        return Err(AppError::invalide(message));
    }
    if n.chars().count() > 200 {
        return Err(AppError::invalide("Le nom ne doit pas dépasser 200 caractères."));
    }
    Ok(n.to_string())
}

/// Texte facultatif : espaces retirés aux extrémités, `max` caractères au plus.
pub fn texte_borne(s: &str, max: usize, quoi: &str) -> AppResult<String> {
    let t = s.trim();
    if t.chars().count() > max {
        return Err(AppError::invalide(format!("{quoi} ne doit pas dépasser {max} caractères.")));
    }
    Ok(t.to_string())
}

/// Nombre sur deux chiffres au moins (`7` → `07`).
pub fn pad2(n: i64) -> String {
    format!("{n:02}")
}

/// Convertit un « aucune ligne » de rusqlite en erreur « introuvable » lisible.
pub(crate) trait OuIntrouvable<T> {
    fn ou_introuvable(self, message: &str) -> AppResult<T>;
}

impl<T> OuIntrouvable<T> for rusqlite::Result<T> {
    fn ou_introuvable(self, message: &str) -> AppResult<T> {
        match self {
            Ok(v) => Ok(v),
            Err(rusqlite::Error::QueryReturnedNoRows) => Err(AppError::introuvable(message)),
            Err(e) => Err(e.into()),
        }
    }
}
