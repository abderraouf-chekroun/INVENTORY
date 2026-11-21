//! États de dossier (§ 10.1) : trois états fournis (« En cours », « Pièce manquante », « Clôturé »), qui ne se
//! renomment ni ne se suppriment, et les états ajoutés par l'utilisateur (rôle `perso`), avec une couleur prise dans
//! une palette fermée.

use super::texte::replier;
use super::{OuIntrouvable, nom_requis};
use crate::error::{AppError, AppResult};
use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

/// Rôle d'un état : ce qu'il permet.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    /// En cours : dossier ouvert, modifiable.
    Cours,
    /// Pièce manquante : dossier ouvert, modifiable, clôture interdite.
    Piece,
    /// Clôturé : lecture seule.
    Clos,
    /// État ajouté par l'utilisateur : dossier ouvert, modifiable.
    Perso,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::Cours => "cours",
            Role::Piece => "piece",
            Role::Clos => "clos",
            Role::Perso => "perso",
        }
    }
}

impl ToSql for Role {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::from(self.as_str()))
    }
}

impl FromSql for Role {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "cours" => Ok(Role::Cours),
            "piece" => Ok(Role::Piece),
            "clos" => Ok(Role::Clos),
            "perso" => Ok(Role::Perso),
            _ => Err(FromSqlError::InvalidType),
        }
    }
}

/// Palette fermée des couleurs d'état, dans l'ordre d'affichage.
pub const COULEURS: [&str; 9] = ["gris", "bleu", "turquoise", "vert", "ambre", "orange", "rouge", "rose", "violet"];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StatutDossier {
    pub id: i64,
    pub nom: String,
    pub couleur: String,
    pub role: Role,
    /// Nombre de dossiers qui portent cet état.
    pub nb_dossiers: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaisieStatut {
    pub nom: String,
    pub couleur: String,
}

/// Colonnes d'un état, à joindre sous l'alias `s` (utilisé aussi par le résumé d'un dossier).
pub(crate) const COLONNES_STATUT: &str =
    "s.id, s.nom, s.couleur, s.role, (SELECT COUNT(*) FROM dossiers n WHERE n.statut_id = s.id)";

/// Ordre d'affichage : les trois états fournis, puis les états ajoutés par ordre de création.
const ORDRE: &str = " ORDER BY CASE s.role WHEN 'cours' THEN 0 WHEN 'piece' THEN 1 WHEN 'clos' THEN 2 ELSE 3 END, s.id";

/// Lit un état à partir de la colonne `debut` (5 colonnes : voir [`COLONNES_STATUT`]).
pub(crate) fn ligne_statut(r: &rusqlite::Row<'_>, debut: usize) -> rusqlite::Result<StatutDossier> {
    Ok(StatutDossier {
        id: r.get(debut)?,
        nom: r.get(debut + 1)?,
        couleur: r.get(debut + 2)?,
        role: r.get(debut + 3)?,
        nb_dossiers: r.get(debut + 4)?,
    })
}

pub fn lister(conn: &Connection) -> AppResult<Vec<StatutDossier>> {
    let mut stmt = conn.prepare(&format!("SELECT {COLONNES_STATUT} FROM statuts s{ORDRE}"))?;
    let v = stmt.query_map([], |r| ligne_statut(r, 0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(v)
}

pub fn lire(conn: &Connection, id: i64) -> AppResult<StatutDossier> {
    conn.query_row(&format!("SELECT {COLONNES_STATUT} FROM statuts s WHERE s.id = ?1"), [id], |r| ligne_statut(r, 0))
        .ou_introuvable("État introuvable.")
}

/// L'état fourni qui porte ce rôle (`cours`, `piece` ou `clos`).
pub fn fourni(conn: &Connection, role: Role) -> AppResult<StatutDossier> {
    conn.query_row(
        &format!("SELECT {COLONNES_STATUT} FROM statuts s WHERE s.role = ?1 ORDER BY s.id LIMIT 1"),
        [role],
        |r| ligne_statut(r, 0),
    )
    .ou_introuvable("État introuvable.")
}

fn verifier_couleur(couleur: &str) -> AppResult<String> {
    let c = couleur.trim();
    if COULEURS.contains(&c) {
        Ok(c.to_string())
    } else {
        Err(AppError::invalide("Choisissez une couleur de la palette."))
    }
}

/// Deux états ne portent pas le même nom (sans tenir compte de la casse ni des accents).
fn verifier_nom_libre(conn: &Connection, nom: &str, sauf: Option<i64>) -> AppResult<()> {
    let cherche = replier(nom.trim());
    let mut stmt = conn.prepare("SELECT nom FROM statuts WHERE id IS NOT ?1")?;
    let noms = stmt.query_map([sauf], |r| r.get::<_, String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    if noms.iter().any(|n| replier(n.trim()) == cherche) {
        return Err(AppError::refus("doublon", "Un état porte déjà ce nom."));
    }
    Ok(())
}

const MSG_NOM: &str = "Le nom de l’état est obligatoire.";

pub fn creer(conn: &Connection, nom: &str, couleur: &str) -> AppResult<StatutDossier> {
    let nom = nom_requis(nom, MSG_NOM)?;
    let couleur = verifier_couleur(couleur)?;
    verifier_nom_libre(conn, &nom, None)?;
    conn.execute(
        "INSERT INTO statuts (nom, couleur, role) VALUES (?1, ?2, ?3)",
        params![nom, couleur, Role::Perso],
    )?;
    lire(conn, conn.last_insert_rowid())
}

fn refus_fourni(quoi: &str) -> AppError {
    AppError::refus("statut_fourni", format!("Cet état est fourni avec l’application : il ne peut pas être {quoi}."))
}

/// Renomme un état ajouté et change sa couleur ; les trois états fournis sont refusés (`statut_fourni`).
pub fn modifier(conn: &Connection, id: i64, saisie: &SaisieStatut) -> AppResult<StatutDossier> {
    let s = lire(conn, id)?;
    if s.role != Role::Perso {
        return Err(refus_fourni("modifié"));
    }
    let nom = nom_requis(&saisie.nom, MSG_NOM)?;
    let couleur = verifier_couleur(&saisie.couleur)?;
    if nom == s.nom && couleur == s.couleur {
        return Ok(s);
    }
    verifier_nom_libre(conn, &nom, Some(id))?;
    conn.execute("UPDATE statuts SET nom = ?1, couleur = ?2 WHERE id = ?3", params![nom, couleur, id])?;
    lire(conn, id)
}

/// Supprime un état ajouté, seulement si aucun dossier ne le porte (`statut_utilise` sinon, avec le nombre).
pub fn supprimer(conn: &Connection, id: i64) -> AppResult<()> {
    let s = lire(conn, id)?;
    if s.role != Role::Perso {
        return Err(refus_fourni("supprimé"));
    }
    let utilise = |n: i64| {
        AppError::refus(
            "statut_utilise",
            if n > 1 {
                format!("{n} dossiers sont dans cet état. Donnez-leur un autre état avant de le supprimer.")
            } else {
                "1 dossier est dans cet état. Donnez-lui un autre état avant de le supprimer.".to_string()
            },
        )
    };
    if s.nb_dossiers > 0 {
        return Err(utilise(s.nb_dossiers));
    }
    // Contrôle et suppression dans la même transaction ; la clé étrangère de `dossiers` reste le dernier garde-fou.
    let tx = conn.unchecked_transaction()?;
    let n: i64 = tx.query_row("SELECT COUNT(*) FROM dossiers WHERE statut_id = ?1", [id], |r| r.get(0))?;
    if n > 0 {
        return Err(utilise(n));
    }
    tx.execute("DELETE FROM statuts WHERE id = ?1", [id])?;
    tx.commit()?;
    Ok(())
}
