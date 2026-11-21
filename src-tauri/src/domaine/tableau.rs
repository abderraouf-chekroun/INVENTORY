//! Tableau de bord : compteurs, répartition, inventaire à compléter, volume mensuel.

use super::dossiers::{self, DossierResume};
use super::entites::{Entite, ORDRE_ENTITES, SELECT_ENTITE, ligne_entite};
use super::statuts::{self, Role, StatutDossier};
use super::{Kind, annee_en_cours};
use crate::error::AppResult;
use rusqlite::Connection;
use serde::Serialize;

/// Nombre de dossiers d'un état (§ 10.7) : un élément par état existant, dans l'ordre de la liste des états.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Repartition {
    pub statut: StatutDossier,
    pub nb: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Volume {
    pub annee: i64,
    pub mois: Vec<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableauDeBord {
    pub a_actives: i64,
    pub a_total: i64,
    pub b_actives: i64,
    pub b_total: i64,
    pub dossiers_total: i64,
    pub dossiers_ouverts: i64,
    pub dossiers_piece: i64,
    pub repartition: Vec<Repartition>,
    pub sans_code_a: Vec<Entite>,
    pub sans_code_b: Vec<Entite>,
    pub dossiers_en_cours: Vec<DossierResume>,
    pub volume: Volume,
}

fn compter(conn: &Connection, sql: &str) -> AppResult<i64> {
    Ok(conn.query_row(sql, [], |r| r.get(0))?)
}

fn sans_code(conn: &Connection, kind: Kind) -> AppResult<Vec<Entite>> {
    let mut stmt = conn.prepare(&format!(
        "{SELECT_ENTITE} WHERE e.kind = ?1 AND e.code IS NULL{ORDRE_ENTITES}"
    ))?;
    let v = stmt.query_map([kind], ligne_entite)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(v)
}

/// Nombre de documents ajoutés par mois (janvier → décembre) pour `annee`.
pub fn volume(conn: &Connection, annee: i64) -> AppResult<Volume> {
    let mut mois = vec![0_i64; 12];
    let mut stmt = conn.prepare(
        "SELECT CAST(substr(cree_le, 6, 2) AS INTEGER), COUNT(*)
         FROM documents WHERE substr(cree_le, 1, 4) = ?1 GROUP BY 1",
    )?;
    let lignes = stmt
        .query_map([format!("{annee:04}")], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (m, n) in lignes {
        if (1..=12).contains(&m) {
            mois[(m - 1) as usize] = n;
        }
    }
    Ok(Volume { annee, mois })
}

pub fn calculer_pour(conn: &Connection, annee: i64) -> AppResult<TableauDeBord> {
    // § 10.1 : la répartition suit la liste réelle des états ; « ouverts » = tous les dossiers non clôturés.
    let repartition: Vec<Repartition> =
        statuts::lister(conn)?.into_iter().map(|s| Repartition { nb: s.nb_dossiers, statut: s }).collect();
    let somme = |garder: &dyn Fn(Role) -> bool| -> i64 {
        repartition.iter().filter(|r| garder(r.statut.role)).map(|r| r.nb).sum()
    };
    Ok(TableauDeBord {
        a_actives: compter(conn, "SELECT COUNT(*) FROM entites WHERE kind = 'a' AND actif = 1")?,
        a_total: compter(conn, "SELECT COUNT(*) FROM entites WHERE kind = 'a'")?,
        b_actives: compter(conn, "SELECT COUNT(*) FROM entites WHERE kind = 'b' AND actif = 1")?,
        b_total: compter(conn, "SELECT COUNT(*) FROM entites WHERE kind = 'b'")?,
        dossiers_total: compter(conn, "SELECT COUNT(*) FROM dossiers")?,
        dossiers_ouverts: somme(&|r| r != Role::Clos),
        dossiers_piece: somme(&|r| r == Role::Piece),
        sans_code_a: sans_code(conn, Kind::A)?,
        sans_code_b: sans_code(conn, Kind::B)?,
        dossiers_en_cours: dossiers::lister_ou(conn, "WHERE s.role <> 'clos'", [])?,
        volume: volume(conn, annee)?,
        repartition,
    })
}

pub fn calculer(conn: &Connection) -> AppResult<TableauDeBord> {
    calculer_pour(conn, annee_en_cours() as i64)
}
