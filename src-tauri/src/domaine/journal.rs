//! Journal des événements (table `evenements`).

use super::Kind;
use crate::error::AppResult;
use rusqlite::{Connection, params};
use serde::Serialize;

pub const FICHE_CREEE: &str = "fiche_creee";
pub const FICHE_MODIFIEE: &str = "fiche_modifiee";
pub const CODE_SAISI: &str = "code_saisi";
pub const FICHE_ARCHIVEE: &str = "fiche_archivee";
pub const FICHE_REACTIVEE: &str = "fiche_reactivee";
pub const ASSOCIATION: &str = "association";
pub const DISSOCIATION: &str = "dissociation";
pub const DOSSIER_OUVERT: &str = "dossier_ouvert";
pub const DOSSIER_ROUVERT: &str = "dossier_rouvert";
pub const PIECE_MANQUANTE: &str = "piece_manquante";
pub const PIECE_AJOUTEE: &str = "piece_ajoutee";
pub const DOSSIER_CLOS: &str = "dossier_clos";
/// § 10.1 : changement d'état libre (hors passage en « Pièce manquante », clôture et réouverture).
pub const STATUT_MODIFIE: &str = "statut_modifie";
/// § 10.5 : identifiant d'un employé recalculé par la migration 004 (« Ancien identifiant : … »).
pub const IDENTIFIANT_RECALCULE: &str = "identifiant_recalcule";
/// § 11.2 : nomination d'une fiche dans un document, lue dans la table `nominations` et jamais écrite au journal.
pub const NOMINATION: &str = "nomination";
/// § 13.2 : employé ou machine supprimé (journal général ; rattaché à aucune fiche ni aucun dossier).
pub const FICHE_SUPPRIMEE: &str = "fiche_supprimee";
/// § 15 : dossier supprimé, vu depuis une fiche nommée dans l'un de ses documents (rattaché à la fiche seule, jamais
/// au dossier : son numéro peut être réattribué).
pub const DOSSIER_SUPPRIME: &str = "dossier_supprime";

/// Événements d'un dossier (§ 11.2) : ils apparaissent aussi dans l'historique des fiches nommées dans ses documents.
const EVENEMENTS_DE_DOSSIER: [&str; 6] =
    [DOSSIER_OUVERT, DOSSIER_ROUVERT, PIECE_MANQUANTE, PIECE_AJOUTEE, DOSSIER_CLOS, STATUT_MODIFIE];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Evenement {
    pub id: i64,
    pub r#type: String,
    pub classe: String,
    pub titre: String,
    pub detail: String,
    pub date: String,
    pub a_id: Option<i64>,
    pub b_id: Option<i64>,
    pub dossier_id: Option<i64>,
    /// Libellé actuel de l'employé cité (fiche archivée comprise), `None` sans employé ou s'il est introuvable (§ 9.4).
    pub a_libelle: Option<String>,
    /// Libellé actuel de la machine citée.
    pub b_libelle: Option<String>,
    /// Nom actuel du dossier cité.
    pub dossier_nom: Option<String>,
    /// Document où la fiche est nommée (événements `nomination`, § 11.2).
    pub document_id: Option<i64>,
    pub document_nom: Option<String>,
    /// Libellé du champ où la fiche est nommée (événements `nomination`).
    pub champ: Option<String>,
    /// § 13.2 : l'employé cité a été supprimé : `a_id` vaut `None` et `a_libelle` porte le libellé qu'il avait.
    pub a_supprime: bool,
    /// § 13.2 : la machine citée a été supprimée : `b_id` vaut `None` et `b_libelle` porte le libellé qu'elle avait.
    pub b_supprime: bool,
}

/// Classe d'affichage d'un type d'événement (§ 4, Journal).
pub fn classe(type_evenement: &str) -> &'static str {
    match type_evenement {
        ASSOCIATION | DISSOCIATION => "assoc",
        PIECE_MANQUANTE => "alerte",
        DOSSIER_CLOS => "clos",
        _ => "",
    }
}

/// Rattachements d'un événement.
#[derive(Debug, Clone, Copy, Default)]
pub struct Cible {
    pub a_id: Option<i64>,
    pub b_id: Option<i64>,
    pub dossier_id: Option<i64>,
}

impl Cible {
    pub fn fiche(kind: Kind, id: i64) -> Self {
        match kind {
            Kind::A => Cible { a_id: Some(id), ..Default::default() },
            Kind::B => Cible { b_id: Some(id), ..Default::default() },
        }
    }

    pub fn paire(a_id: i64, b_id: i64) -> Self {
        Cible { a_id: Some(a_id), b_id: Some(b_id), dossier_id: None }
    }

    /// Événement d'un dossier (§ 11.2 : il apparaît dans l'historique des fiches nommées dans ses documents).
    pub fn dossier(dossier_id: i64) -> Self {
        Cible { dossier_id: Some(dossier_id), ..Default::default() }
    }
}

pub fn ajouter(
    conn: &Connection,
    type_evenement: &str,
    titre: &str,
    detail: &str,
    cible: Cible,
    date: &str,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO evenements (type, titre, detail, a_id, b_id, dossier_id, date)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![type_evenement, titre, detail, cible.a_id, cible.b_id, cible.dossier_id, date],
    )?;
    Ok(())
}

/// § 13.2 : événement qui cite une fiche supprimée, par son libellé (`a_libelle_supprime` pour un employé,
/// `b_libelle_supprime` pour une machine) ; l'identifiant correspondant de `cible` doit être `None`.
#[allow(clippy::too_many_arguments)]
pub fn ajouter_avec_supprimee(
    conn: &Connection,
    type_evenement: &str,
    titre: &str,
    detail: &str,
    cible: Cible,
    a_libelle_supprime: Option<&str>,
    b_libelle_supprime: Option<&str>,
    date: &str,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO evenements (type, titre, detail, a_id, b_id, dossier_id, date, a_libelle_supprime, b_libelle_supprime)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            type_evenement,
            titre,
            detail,
            cible.a_id,
            cible.b_id,
            cible.dossier_id,
            date,
            a_libelle_supprime,
            b_libelle_supprime
        ],
    )?;
    Ok(())
}

/// Mention ajoutée au nom d'une fiche supprimée dans un titre : « (supprimé) » / « (supprimée) ».
pub fn mention_supprimee(kind: Kind) -> &'static str {
    match kind {
        Kind::A => "(supprimé)",
        Kind::B => "(supprimée)",
    }
}

/// « de » élidé devant une voyelle : « d’Ordinateur 01 », « de Martin ».
pub fn de(nom: &str) -> String {
    let voyelle = nom
        .chars()
        .next()
        .is_some_and(|c| "aeiouyàâäéèêëîïôöùûüAEIOUYÀÂÄÉÈÊËÎÏÔÖÙÛÜ".contains(c));
    if voyelle { format!("d’{nom}") } else { format!("de {nom}") }
}

/// Titre d'un début d'affectation vu depuis une fiche : « Affectation de {nom} » (« d’ » devant une voyelle).
pub fn titre_affectation(nom_autre: &str) -> String {
    format!("Affectation {}", de(nom_autre))
}

/// Titre d'une fin d'affectation vue depuis une fiche : « Fin de l’affectation de {nom} ».
pub fn titre_fin_affectation(nom_autre: &str) -> String {
    format!("Fin de l’affectation {}", de(nom_autre))
}

/// Événements d'une fiche, du plus récent au plus ancien.
///
/// Les lignes `association` (début d'affectation) et `dissociation` (fin d'affectation) sont communes aux
/// deux fiches : leur titre et leur détail sont formulés ici du point de vue de la fiche consultée
/// (« Affectation de … », « Fin de l’affectation de … »), y compris pour les lignes écrites par une version
/// antérieure. Les libellés des fiches et le nom du dossier cités sont lus dans leur état actuel (§ 9.4).
///
/// § 11.2 : s'y ajoutent les événements des dossiers (ouverture, changement d'état, clôture…) qui contiennent un
/// document où la fiche est nommée.
pub fn pour_entite(conn: &Connection, kind: Kind, id: i64) -> AppResult<Vec<Evenement>> {
    let (col, autre) = match kind {
        Kind::A => ("a_id", "b"),
        Kind::B => ("b_id", "a"),
    };
    let types_dossier = EVENEMENTS_DE_DOSSIER.map(|t| format!("'{t}'")).join(", ");
    let dossiers_de_la_fiche = super::nominations::DOSSIERS_DE_LA_FICHE;
    let sql = format!(
        "SELECT ev.id, ev.type, ev.titre, ev.detail, ev.date, ev.a_id, ev.b_id, ev.dossier_id,
                COALESCE(ea.libelle, CASE WHEN ev.a_id IS NULL THEN ev.a_libelle_supprime END),
                COALESCE(eb.libelle, CASE WHEN ev.b_id IS NULL THEN ev.b_libelle_supprime END),
                d.nom, {autre}.code,
                ev.a_id IS NULL AND ev.a_libelle_supprime IS NOT NULL,
                ev.b_id IS NULL AND ev.b_libelle_supprime IS NOT NULL
         FROM evenements ev
         LEFT JOIN entites ea ON ea.id = ev.a_id AND ea.kind = 'a'
         LEFT JOIN entites eb ON eb.id = ev.b_id AND eb.kind = 'b'
         LEFT JOIN dossiers d ON d.id = ev.dossier_id
         LEFT JOIN entites {autre} ON {autre}.id = ev.{autre}_id AND {autre}.kind = '{autre}'
         WHERE ev.{col} = ?1
            OR (ev.type IN ({types_dossier}) AND ev.dossier_id IN ({dossiers_de_la_fiche}))
         ORDER BY ev.date DESC, ev.id DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let lignes = stmt.query_map([id], |r| {
        let type_evenement: String = r.get(1)?;
        let mut titre: String = r.get(2)?;
        let mut detail: String = r.get(3)?;
        let a_libelle: Option<String> = r.get(8)?;
        let b_libelle: Option<String> = r.get(9)?;
        let autre_code: Option<String> = r.get(11)?;
        let a_supprime: bool = r.get(12)?;
        let b_supprime: bool = r.get(13)?;
        let (autre_nom, autre_supprime, autre_kind) = match kind {
            Kind::A => (b_libelle.as_deref(), b_supprime, Kind::B),
            Kind::B => (a_libelle.as_deref(), a_supprime, Kind::A),
        };
        if let Some(nom) = autre_nom {
            let identifiant = match &autre_code {
                Some(c) => format!(" (identifiant {c})"),
                None => String::new(),
            };
            // § 13.2 : fiche de l'autre côté supprimée : son nom reste, suivi de la mention ; le détail enregistré
            // (qui cite les deux noms) est gardé, l'identifiant de la fiche supprimée n'étant plus lisible.
            if autre_supprime {
                let nom = format!("{nom} {}", mention_supprimee(autre_kind));
                if type_evenement == ASSOCIATION {
                    titre = titre_affectation(&nom);
                } else if type_evenement == DISSOCIATION {
                    titre = titre_fin_affectation(&nom);
                }
            } else if type_evenement == ASSOCIATION {
                titre = titre_affectation(nom);
                detail = format!("Début de l’affectation{identifiant}.");
            } else if type_evenement == DISSOCIATION {
                titre = titre_fin_affectation(nom);
                detail = format!("Fin de l’affectation{identifiant}.");
            }
        }
        Ok(Evenement {
            id: r.get(0)?,
            classe: classe(&type_evenement).to_string(),
            r#type: type_evenement,
            titre,
            detail,
            date: r.get(4)?,
            a_id: r.get(5)?,
            b_id: r.get(6)?,
            dossier_id: r.get(7)?,
            a_libelle,
            b_libelle,
            dossier_nom: r.get(10)?,
            document_id: None,
            document_nom: None,
            champ: None,
            a_supprime,
            b_supprime,
        })
    })?;
    Ok(lignes.collect::<rusqlite::Result<Vec<_>>>()?)
}
