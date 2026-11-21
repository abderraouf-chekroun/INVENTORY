//! Dossiers, sous-dossiers et options à cocher.

use super::copies;
use super::documents::{self, DocumentFichier};
use super::entites::Entite;
use super::journal::{self, Cible};
use super::nominations;
use super::statuts::{self, COLONNES_STATUT, Role, StatutDossier};
use super::{OuIntrouvable, classement, maintenant, nom_requis, pad2};
use crate::error::{AppError, AppResult, journaliser};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DossierResume {
    pub id: i64,
    pub nom: String,
    pub annee: i64,
    pub theme_id: i64,
    pub theme: String,
    /// § 10.1 : l'état complet (nom, couleur, rôle, nombre de dossiers).
    pub statut: StatutDossier,
    pub nb_fichiers: i64,
    pub nb_sous_dossiers: i64,
    pub nb_options: i64,
    pub nb_options_cochees: i64,
    pub cree_le: String,
    pub maj_le: String,
    pub clos_le: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SousDossier {
    pub id: i64,
    pub dossier_id: i64,
    pub parent_id: Option<i64>,
    pub nom: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OptionDossier {
    pub id: i64,
    pub dossier_id: i64,
    pub nom: String,
    pub ok: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DossierDetail {
    pub dossier: DossierResume,
    pub sous_dossiers: Vec<SousDossier>,
    pub documents: Vec<DocumentFichier>,
    pub options: Vec<OptionDossier>,
    /// § 11.1 : fiches nommées dans au moins un document du dossier (employés puis machines, par libellé).
    pub entites_citees: Vec<Entite>,
}

/// § 11.6 : plus d'employé ni de machine (des champs `aId` / `bId` envoyés par une interface ancienne sont ignorés).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaisieDossier {
    pub nom: String,
    pub annee: i64,
    pub theme_id: i64,
    /// `None` : « En cours ».
    #[serde(default)]
    pub statut_id: Option<i64>,
}

/// Options créées avec chaque dossier.
pub const OPTIONS_PAR_DEFAUT: [&str; 2] = ["Dossier numérisé", "Contenu vérifié"];

fn select_resume() -> String {
    format!(
        "SELECT d.id, d.nom, d.annee, d.theme_id, t.nom,
            (SELECT COUNT(*) FROM documents x WHERE x.dossier_id = d.id),
            (SELECT COUNT(*) FROM sous_dossiers sd WHERE sd.dossier_id = d.id AND sd.parent_id IS NULL),
            (SELECT COUNT(*) FROM options o WHERE o.dossier_id = d.id),
            (SELECT COUNT(*) FROM options o WHERE o.dossier_id = d.id AND o.ok = 1),
            d.cree_le, d.maj_le, d.clos_le, {COLONNES_STATUT}
         FROM dossiers d
         JOIN themes t ON t.id = d.theme_id
         JOIN statuts s ON s.id = d.statut_id"
    )
}

const ORDRE: &str = " ORDER BY d.annee DESC, d.nom COLLATE NOCASE, d.id";

fn ligne_resume(r: &rusqlite::Row<'_>) -> rusqlite::Result<DossierResume> {
    Ok(DossierResume {
        id: r.get(0)?,
        nom: r.get(1)?,
        annee: r.get(2)?,
        theme_id: r.get(3)?,
        theme: r.get(4)?,
        nb_fichiers: r.get(5)?,
        nb_sous_dossiers: r.get(6)?,
        nb_options: r.get(7)?,
        nb_options_cochees: r.get(8)?,
        cree_le: r.get(9)?,
        maj_le: r.get(10)?,
        clos_le: r.get(11)?,
        statut: statuts::ligne_statut(r, 12)?,
    })
}

/// Dossiers filtrés par une clause SQL (`where_sql` peut être vide).
pub(crate) fn lister_ou<P: rusqlite::Params>(
    conn: &Connection,
    where_sql: &str,
    p: P,
) -> AppResult<Vec<DossierResume>> {
    let mut stmt = conn.prepare(&format!("{} {where_sql}{ORDRE}", select_resume()))?;
    let v = stmt.query_map(p, ligne_resume)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(v)
}

pub fn lister(conn: &Connection) -> AppResult<Vec<DossierResume>> {
    lister_ou(conn, "", [])
}

pub fn resume(conn: &Connection, id: i64) -> AppResult<DossierResume> {
    conn.query_row(&format!("{} WHERE d.id = ?1", select_resume()), [id], ligne_resume)
        .ou_introuvable("Dossier introuvable.")
}

pub fn detail(conn: &Connection, fichiers: &Path, id: i64) -> AppResult<DossierDetail> {
    let dossier = resume(conn, id)?;
    let sous_dossiers = sous_dossiers_lister(conn, id)?;
    let documents = documents::lister_dossier(conn, fichiers, id)?;
    let options = options_lister(conn, id)?;
    let entites_citees = nominations::fiches_du_dossier(conn, id)?;
    Ok(DossierDetail { dossier, sous_dossiers, documents, options, entites_citees })
}

/// Informations minimales sur un dossier, pour les vérifications et le journal.
#[derive(Debug, Clone)]
pub(crate) struct InfoDossier {
    pub id: i64,
    pub nom: String,
    /// Rôle et nom de l'état actuel.
    pub role: Role,
    pub statut_nom: String,
    pub theme: String,
}

impl InfoDossier {
    pub fn cible(&self) -> Cible {
        Cible::dossier(self.id)
    }
}

pub(crate) fn info(conn: &Connection, id: i64) -> AppResult<InfoDossier> {
    conn.query_row(
        "SELECT d.id, d.nom, s.role, s.nom, t.nom
         FROM dossiers d JOIN themes t ON t.id = d.theme_id JOIN statuts s ON s.id = d.statut_id WHERE d.id = ?1",
        [id],
        |r| Ok(InfoDossier { id: r.get(0)?, nom: r.get(1)?, role: r.get(2)?, statut_nom: r.get(3)?, theme: r.get(4)? }),
    )
    .ou_introuvable("Dossier introuvable.")
}

/// Refuse toute modification d'un dossier clôturé.
pub(crate) fn exiger_modifiable(conn: &Connection, id: i64) -> AppResult<InfoDossier> {
    let d = info(conn, id)?;
    if d.role == Role::Clos {
        return Err(AppError::dossier_clos());
    }
    Ok(d)
}

/// Met à jour la date de modification du dossier.
pub(crate) fn toucher(conn: &Connection, id: i64, date: &str) -> AppResult<()> {
    conn.execute("UPDATE dossiers SET maj_le = ?1 WHERE id = ?2", params![date, id])?;
    Ok(())
}

/// `Dossier {année}-{NN}`, NN = rang suivant dans l'année, augmenté tant que
/// ce nom est déjà porté par un dossier (de n'importe quelle année : un dossier
/// renommé peut porter le nom suggéré d'une autre année).
pub fn nom_suggere(conn: &Connection, annee: i64) -> AppResult<String> {
    let prefixe = format!("Dossier {annee}-");
    let mut stmt = conn.prepare("SELECT nom FROM dossiers WHERE annee = ?1")?;
    let noms = stmt.query_map([annee], |r| r.get::<_, String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    let rang_max = noms
        .iter()
        .filter_map(|n| n.strip_prefix(&prefixe))
        .filter_map(|s| s.trim().parse::<i64>().ok())
        .max()
        .unwrap_or(0);
    let apres_le_nombre = (noms.len() as i64).saturating_add(1);
    // Un rang démesuré (nom saisi à la main) ne fait pas déborder le calcul : on repart du nombre de dossiers.
    let mut rang = rang_max.max(noms.len() as i64).checked_add(1).unwrap_or(apres_le_nombre);
    let mut stmt = conn.prepare("SELECT nom FROM dossiers")?;
    let tous = stmt.query_map([], |r| r.get::<_, String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    loop {
        let nom = format!("{prefixe}{}", pad2(rang));
        if !tous.contains(&nom) {
            return Ok(nom);
        }
        rang = match rang.checked_add(1) {
            Some(r) => r,
            None if rang != apres_le_nombre => apres_le_nombre,
            None => return Err(AppError::refus("nom_indisponible", "Aucun nom de dossier libre n’a pu être proposé.")),
        };
    }
}

fn verifier_annee(annee: i64) -> AppResult<()> {
    if !(1900..=2200).contains(&annee) {
        return Err(AppError::invalide("L’année doit être comprise entre 1900 et 2200."));
    }
    Ok(())
}

pub fn creer(conn: &Connection, saisie: &SaisieDossier) -> AppResult<DossierResume> {
    let nom = nom_requis(&saisie.nom, "Le nom du dossier est obligatoire.")?;
    verifier_annee(saisie.annee)?;
    if saisie.theme_id <= 0 {
        return Err(AppError::invalide("La catégorie est obligatoire."));
    }
    let theme = classement::theme_lire(conn, saisie.theme_id)?;
    if !theme.actif {
        return Err(AppError::refus("theme_archive", format!("La catégorie {} est archivée.", theme.nom)));
    }
    let statut = match saisie.statut_id {
        None => statuts::fourni(conn, Role::Cours)?,
        Some(id) => statuts::lire(conn, id)?,
    };
    if statut.role == Role::Clos {
        return Err(AppError::invalide("Un dossier ne peut pas être créé clôturé : choisissez un état ouvert."));
    }

    let tx = conn.unchecked_transaction()?;
    let now = maintenant();
    tx.execute(
        "INSERT INTO dossiers (nom, annee, theme_id, statut_id, cree_le, maj_le) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![nom, saisie.annee, theme.id, statut.id, now],
    )?;
    let id = tx.last_insert_rowid();
    for (position, option) in OPTIONS_PAR_DEFAUT.iter().enumerate() {
        tx.execute(
            "INSERT INTO options (dossier_id, nom, ok, position) VALUES (?1, ?2, 0, ?3)",
            params![id, option, position as i64],
        )?;
    }
    let cible = Cible::dossier(id);
    journal::ajouter(&tx, journal::DOSSIER_OUVERT, &format!("{nom} ouvert"), &format!("{}.", theme.nom), cible, &now)?;
    match statut.role {
        Role::Piece => journal::ajouter(
            &tx,
            journal::PIECE_MANQUANTE,
            "Pièce finale manquante",
            &format!("{nom} en attente de sa pièce finale."),
            cible,
            &now,
        )?,
        Role::Perso => journal::ajouter(
            &tx,
            journal::STATUT_MODIFIE,
            &titre_etat(&nom, &statut.nom),
            &format!("État choisi à l’ouverture du dossier : « {} ».", statut.nom),
            cible,
            &now,
        )?,
        Role::Cours | Role::Clos => {}
    }
    tx.commit()?;
    resume(conn, id)
}

/// « Dossier 2026-01 : état « Attente fournisseur » ».
fn titre_etat(dossier: &str, etat: &str) -> String {
    format!("{dossier} : état « {etat} »")
}

pub fn renommer(conn: &Connection, id: i64, nom: &str) -> AppResult<()> {
    let nom = nom_requis(nom, "Le nom du dossier est obligatoire.")?;
    exiger_modifiable(conn, id)?;
    conn.execute(
        "UPDATE dossiers SET nom = ?1, maj_le = ?2 WHERE id = ?3",
        params![nom, maintenant(), id],
    )?;
    Ok(())
}

/// Change le thème (« catégorie » à l'écran, § 16) d'un dossier. Refusé pour un dossier clôturé (`dossier_clos`) et
/// vers un thème archivé (`theme_archive`) ; même thème : sans effet.
pub fn definir_theme(conn: &Connection, id: i64, theme_id: i64) -> AppResult<DossierResume> {
    exiger_modifiable(conn, id)?;
    let theme = classement::theme_lire(conn, theme_id)?;
    let actuel: i64 = conn.query_row("SELECT theme_id FROM dossiers WHERE id = ?1", [id], |r| r.get(0))?;
    if actuel == theme.id {
        return resume(conn, id);
    }
    if !theme.actif {
        return Err(AppError::refus("theme_archive", format!("La catégorie {} est archivée.", theme.nom)));
    }
    conn.execute(
        "UPDATE dossiers SET theme_id = ?1, maj_le = ?2 WHERE id = ?3",
        params![theme.id, maintenant(), id],
    )?;
    resume(conn, id)
}

/// Change l'état d'un dossier (§ 10.1) :
/// - entre états ouverts (`cours`, `piece`, `perso`), librement, y compris pour quitter « Pièce manquante » ;
/// - vers l'état `clos` : clôturer, refusé (`transition_interdite`) tant que l'état est « Pièce manquante » ;
/// - depuis un dossier clôturé : seul « En cours » est accepté (rouvrir), sinon `dossier_clos`.
///
/// Même état : sans effet. Chaque changement est inscrit au journal du dossier ; il apparaît dans l'historique des
/// fiches nommées dans ses documents (§ 11.2).
pub fn definir_statut(conn: &Connection, id: i64, statut_id: i64) -> AppResult<DossierResume> {
    let d = info(conn, id)?;
    let cible = statuts::lire(conn, statut_id)?;
    let actuel: i64 = conn.query_row("SELECT statut_id FROM dossiers WHERE id = ?1", [id], |r| r.get(0))?;
    if actuel == cible.id {
        return resume(conn, id);
    }
    let now = maintenant();
    let tx = conn.unchecked_transaction()?;
    match (d.role, cible.role) {
        (Role::Clos, Role::Cours) => {
            tx.execute(
                "UPDATE dossiers SET statut_id = ?1, clos_le = NULL, maj_le = ?2 WHERE id = ?3",
                params![cible.id, now, id],
            )?;
            journal::ajouter(&tx, journal::DOSSIER_ROUVERT, &format!("{} rouvert", d.nom), &format!("{}.", d.theme), d.cible(), &now)?;
        }
        (Role::Clos, _) => return Err(AppError::dossier_clos()),
        (Role::Piece, Role::Clos) => {
            return Err(AppError::refus(
                "transition_interdite",
                "Ce dossier est en « Pièce manquante » : ajoutez la pièce finale, ou choisissez un autre état, \
                 avant de le clôturer.",
            ));
        }
        (_, Role::Clos) => {
            tx.execute(
                "UPDATE dossiers SET statut_id = ?1, clos_le = ?2, maj_le = ?2 WHERE id = ?3",
                params![cible.id, now, id],
            )?;
            journal::ajouter(&tx, journal::DOSSIER_CLOS, &format!("{} clôturé", d.nom), &format!("{}.", d.theme), d.cible(), &now)?;
        }
        (_, Role::Piece) => {
            tx.execute("UPDATE dossiers SET statut_id = ?1, maj_le = ?2 WHERE id = ?3", params![cible.id, now, id])?;
            journal::ajouter(
                &tx,
                journal::PIECE_MANQUANTE,
                "Pièce finale manquante",
                &format!("{} en attente de sa pièce finale.", d.nom),
                d.cible(),
                &now,
            )?;
        }
        (_, Role::Cours | Role::Perso) => {
            tx.execute("UPDATE dossiers SET statut_id = ?1, maj_le = ?2 WHERE id = ?3", params![cible.id, now, id])?;
            journal::ajouter(
                &tx,
                journal::STATUT_MODIFIE,
                &titre_etat(&d.nom, &cible.nom),
                &format!("Ancien état : « {} ».", d.statut_nom),
                d.cible(),
                &now,
            )?;
        }
    }
    tx.commit()?;
    resume(conn, id)
}

// ---------- sous-dossiers ----------

fn ligne_sous_dossier(r: &rusqlite::Row<'_>) -> rusqlite::Result<SousDossier> {
    Ok(SousDossier { id: r.get(0)?, dossier_id: r.get(1)?, parent_id: r.get(2)?, nom: r.get(3)? })
}

pub fn sous_dossiers_lister(conn: &Connection, dossier_id: i64) -> AppResult<Vec<SousDossier>> {
    let mut stmt = conn.prepare(
        "SELECT id, dossier_id, parent_id, nom FROM sous_dossiers WHERE dossier_id = ?1 ORDER BY id",
    )?;
    let v = stmt.query_map([dossier_id], ligne_sous_dossier)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(v)
}

pub fn sous_dossier_lire(conn: &Connection, id: i64) -> AppResult<SousDossier> {
    conn.query_row(
        "SELECT id, dossier_id, parent_id, nom FROM sous_dossiers WHERE id = ?1",
        [id],
        ligne_sous_dossier,
    )
    .ou_introuvable("Sous-dossier introuvable.")
}

/// Vérifie qu'un sous-dossier facultatif appartient bien au dossier.
pub(crate) fn verifier_sous_dossier(conn: &Connection, dossier_id: i64, sous_dossier_id: Option<i64>) -> AppResult<()> {
    if let Some(sid) = sous_dossier_id {
        let s = sous_dossier_lire(conn, sid)?;
        if s.dossier_id != dossier_id {
            return Err(AppError::invalide("Ce sous-dossier n’appartient pas à ce dossier."));
        }
    }
    Ok(())
}

pub fn sous_dossier_creer(conn: &Connection, dossier_id: i64, parent_id: Option<i64>, nom: &str) -> AppResult<SousDossier> {
    let nom = nom_requis(nom, "Le nom du dossier est obligatoire.")?;
    exiger_modifiable(conn, dossier_id)?;
    verifier_sous_dossier(conn, dossier_id, parent_id)?;
    let now = maintenant();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO sous_dossiers (dossier_id, parent_id, nom, cree_le) VALUES (?1, ?2, ?3, ?4)",
        params![dossier_id, parent_id, nom, now],
    )?;
    let id = tx.last_insert_rowid();
    toucher(&tx, dossier_id, &now)?;
    tx.commit()?;
    sous_dossier_lire(conn, id)
}

pub fn sous_dossier_renommer(conn: &Connection, id: i64, nom: &str) -> AppResult<()> {
    let nom = nom_requis(nom, "Le nom du dossier est obligatoire.")?;
    let s = sous_dossier_lire(conn, id)?;
    exiger_modifiable(conn, s.dossier_id)?;
    let now = maintenant();
    let tx = conn.unchecked_transaction()?;
    tx.execute("UPDATE sous_dossiers SET nom = ?1 WHERE id = ?2", params![nom, id])?;
    toucher(&tx, s.dossier_id, &now)?;
    tx.commit()?;
    Ok(())
}

/// Supprime le sous-dossier, ses sous-dossiers et leurs documents, ainsi que les copies de fichiers.
///
/// L'arbre est parcouru avec `UNION` (un cycle éventuel ne fait pas boucler la requête) et sans sortir du dossier.
/// Les copies sont mises de côté d'abord : si l'une est verrouillée, rien n'est supprimé. Une copie que référence
/// aussi un document hors de l'arbre (base incohérente) est conservée pour lui.
pub fn sous_dossier_supprimer(conn: &Connection, fichiers: &Path, id: i64) -> AppResult<()> {
    let s = sous_dossier_lire(conn, id)?;
    exiger_modifiable(conn, s.dossier_id)?;
    let stockes: Vec<String> = {
        let mut stmt = conn.prepare(
            "WITH RECURSIVE arbre(id) AS (
                 SELECT id FROM sous_dossiers WHERE id = ?1 AND dossier_id = ?2
                 UNION
                 SELECT sd.id FROM sous_dossiers sd JOIN arbre ON sd.parent_id = arbre.id
                 WHERE sd.dossier_id = ?2
             )
             SELECT DISTINCT fichier_stocke FROM documents
             WHERE sous_dossier_id IN (SELECT id FROM arbre) AND dossier_id = ?2 AND fichier_stocke IS NOT NULL
               AND fichier_stocke NOT IN (
                   SELECT fichier_stocke FROM documents
                   WHERE fichier_stocke IS NOT NULL
                     AND (sous_dossier_id IS NULL OR sous_dossier_id NOT IN (SELECT id FROM arbre) OR dossier_id <> ?2))",
        )?;
        stmt.query_map(params![id, s.dossier_id], |r| r.get(0))?.collect::<rusqlite::Result<Vec<_>>>()?
    };
    let mise_de_cote = copies::mettre_de_cote(fichiers, stockes.iter().map(String::as_str))?;
    let effacer = || -> AppResult<()> {
        let now = maintenant();
        let tx = conn.unchecked_transaction()?;
        tx.execute("DELETE FROM sous_dossiers WHERE id = ?1", [id])?;
        toucher(&tx, s.dossier_id, &now)?;
        tx.commit()?;
        Ok(())
    };
    match effacer() {
        Ok(()) => {
            copies::purger(&mise_de_cote);
            Ok(())
        }
        Err(e) => {
            copies::restaurer(&mise_de_cote);
            Err(e)
        }
    }
}

// ---------- suppression d'un dossier (§ 15) ----------

/// Ce que supprimera [`supprimer`] (§ 15.4), avec les nombres réels (fenêtre de confirmation).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DossierSuppressionApercu {
    /// Sous-dossiers, tous niveaux.
    pub nb_sous_dossiers: i64,
    /// Documents, sous-dossiers compris.
    pub nb_documents: i64,
    /// Documents importés dont la copie sera supprimée du dossier `fichiers/`.
    pub nb_fichiers_importes: i64,
    /// Employés et machines distincts nommés dans ses documents.
    pub nb_fiches_nommees: i64,
}

/// Copies de fichiers importés du dossier à supprimer avec lui. Une copie que référence aussi un document d'un autre
/// dossier (base incohérente) n'en fait pas partie : elle reste sur le disque pour cet autre document.
fn copies_du_dossier(conn: &Connection, id: i64) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT fichier_stocke FROM documents
         WHERE dossier_id = ?1 AND fichier_stocke IS NOT NULL
           AND fichier_stocke NOT IN (SELECT fichier_stocke FROM documents WHERE dossier_id <> ?1 AND fichier_stocke IS NOT NULL)",
    )?;
    let v = stmt.query_map([id], |r| r.get(0))?.collect::<rusqlite::Result<Vec<String>>>()?;
    Ok(v)
}

/// Fiches nommées dans les documents du dossier, avec le nombre de documents où chacune est nommée.
fn fiches_nommees(conn: &Connection, id: i64) -> AppResult<Vec<(i64, super::Kind, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT e.id, e.kind, COUNT(DISTINCT n.document_id)
         FROM nominations n JOIN documents x ON x.id = n.document_id JOIN entites e ON e.id = n.entite_id
         WHERE x.dossier_id = ?1
         GROUP BY e.id ORDER BY e.id",
    )?;
    let v = stmt.query_map([id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(v)
}

/// Aperçu de la suppression d'un dossier, quel que soit son état. Dossier inexistant : `introuvable`.
pub fn apercu_suppression(conn: &Connection, fichiers: &Path, id: i64) -> AppResult<DossierSuppressionApercu> {
    info(conn, id)?;
    let nb_sous_dossiers: i64 = conn.query_row("SELECT COUNT(*) FROM sous_dossiers WHERE dossier_id = ?1", [id], |r| r.get(0))?;
    let nb_documents: i64 = conn.query_row("SELECT COUNT(*) FROM documents WHERE dossier_id = ?1", [id], |r| r.get(0))?;
    // Seules les copies réellement présentes dans `fichiers/` seront supprimées du disque.
    let nb_fichiers_importes = copies_du_dossier(conn, id)?.iter().filter(|s| copies::chemin_copie(fichiers, s).is_some()).count() as i64;
    let nb_fiches_nommees = fiches_nommees(conn, id)?.len() as i64;
    Ok(DossierSuppressionApercu { nb_sous_dossiers, nb_documents, nb_fichiers_importes, nb_fiches_nommees })
}

/// « Il contenait 3 documents où cet employé était nommé. » / « … où cette machine était nommée. »
fn detail_dossier_supprime(kind: super::Kind, nb_documents: i64) -> String {
    let documents = if nb_documents == 1 { "1 document".to_string() } else { format!("{nb_documents} documents") };
    let qui = match kind {
        super::Kind::A => "cet employé était nommé",
        super::Kind::B => "cette machine était nommée",
    };
    format!("Il contenait {documents} où {qui}.")
}

/// Supprime un dossier avec tout son contenu, quel que soit son état (clôturé compris), en une seule transaction
/// (§ 15.1) :
/// 1. chaque employé ou machine nommé dans au moins un de ses documents reçoit à son historique un événement
///    `dossier_supprime`, rattaché à la fiche seule ;
/// 2. les événements rattachés au dossier sont supprimés : aucun événement ne garde son numéro, qu'un nouveau dossier
///    pourrait recevoir ;
/// 3. ses nominations, ses documents, ses sous-dossiers (tous niveaux), ses options, puis le dossier sont supprimés.
///
/// Les copies des fichiers importés sont mises de côté d'abord, comme pour un document ou un sous-dossier : si l'une
/// est verrouillée par une autre application, rien n'est supprimé ; si la base échoue, elles sont remises en place.
/// Les fiches, les affectations, les modèles, les thèmes et les états ne sont pas touchés. Si une suppression en
/// cascade atteignait un autre dossier (base incohérente), tout est annulé.
pub fn supprimer(conn: &Connection, fichiers: &Path, id: i64) -> AppResult<()> {
    let d = info(conn, id)?;
    let stockes = copies_du_dossier(conn, id)?;
    let mise_de_cote = copies::mettre_de_cote(fichiers, stockes.iter().map(String::as_str)).map_err(|e| {
        if e.code == "fichier_ouvert" {
            AppError::refus(
                "fichier_ouvert",
                "Un fichier importé de ce dossier est utilisé par une autre application. Fermez-le, puis réessayez.",
            )
        } else {
            e
        }
    })?;
    let effacer = || -> AppResult<()> {
        let now = maintenant();
        let tx = conn.unchecked_transaction()?;
        let ailleurs = |tx: &Connection| -> AppResult<(i64, i64, i64)> {
            Ok(tx.query_row(
                "SELECT (SELECT COUNT(*) FROM documents WHERE dossier_id <> ?1),
                        (SELECT COUNT(*) FROM sous_dossiers WHERE dossier_id <> ?1),
                        (SELECT COUNT(*) FROM nominations n JOIN documents x ON x.id = n.document_id WHERE x.dossier_id <> ?1)",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )?)
        };
        let avant = ailleurs(&tx)?;

        // 1. Trace dans l'historique des fiches nommées.
        let titre = format!("Dossier « {} » supprimé", d.nom);
        for (entite_id, kind, nb) in fiches_nommees(&tx, id)? {
            journal::ajouter(
                &tx,
                journal::DOSSIER_SUPPRIME,
                &titre,
                &detail_dossier_supprime(kind, nb),
                Cible::fiche(kind, entite_id),
                &now,
            )?;
        }
        // 2. Journal du dossier.
        tx.execute("DELETE FROM evenements WHERE dossier_id = ?1", [id])?;
        // 3. Contenu, puis le dossier.
        tx.execute("DELETE FROM nominations WHERE document_id IN (SELECT id FROM documents WHERE dossier_id = ?1)", [id])?;
        tx.execute("DELETE FROM documents WHERE dossier_id = ?1", [id])?;
        tx.execute("DELETE FROM sous_dossiers WHERE dossier_id = ?1", [id])?;
        tx.execute("DELETE FROM options WHERE dossier_id = ?1", [id])?;
        tx.execute("DELETE FROM dossiers WHERE id = ?1", [id])?;

        if ailleurs(&tx)? != avant {
            journaliser("suppression", &format!("dossier {id} : la suppression aurait atteint le contenu d’un autre dossier"));
            return Err(AppError::refus(
                "donnees_incoherentes",
                "Ce dossier partage du contenu avec un autre dossier : il n’a pas été supprimé. Le détail est consigné dans \
                 le journal des erreurs.",
            ));
        }
        tx.commit()?;
        Ok(())
    };
    match effacer() {
        Ok(()) => {
            copies::purger(&mise_de_cote);
            Ok(())
        }
        Err(e) => {
            copies::restaurer(&mise_de_cote);
            Err(e)
        }
    }
}

// ---------- options à cocher ----------

fn ligne_option(r: &rusqlite::Row<'_>) -> rusqlite::Result<OptionDossier> {
    Ok(OptionDossier { id: r.get(0)?, dossier_id: r.get(1)?, nom: r.get(2)?, ok: r.get(3)? })
}

pub fn options_lister(conn: &Connection, dossier_id: i64) -> AppResult<Vec<OptionDossier>> {
    let mut stmt = conn.prepare(
        "SELECT id, dossier_id, nom, ok FROM options WHERE dossier_id = ?1 ORDER BY position, id",
    )?;
    let v = stmt.query_map([dossier_id], ligne_option)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(v)
}

fn option_lire(conn: &Connection, id: i64) -> AppResult<OptionDossier> {
    conn.query_row("SELECT id, dossier_id, nom, ok FROM options WHERE id = ?1", [id], ligne_option)
        .ou_introuvable("Option introuvable.")
}

pub fn option_creer(conn: &Connection, dossier_id: i64, nom: &str) -> AppResult<OptionDossier> {
    let nom = nom_requis(nom, "Le nom de l’option est obligatoire.")?;
    exiger_modifiable(conn, dossier_id)?;
    let now = maintenant();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO options (dossier_id, nom, ok, position)
         VALUES (?1, ?2, 0, (SELECT COALESCE(MAX(position), -1) + 1 FROM options WHERE dossier_id = ?1))",
        params![dossier_id, nom],
    )?;
    let id = tx.last_insert_rowid();
    toucher(&tx, dossier_id, &now)?;
    tx.commit()?;
    option_lire(conn, id)
}

pub fn option_cocher(conn: &Connection, id: i64, ok: bool) -> AppResult<()> {
    let o = option_lire(conn, id)?;
    exiger_modifiable(conn, o.dossier_id)?;
    let now = maintenant();
    let tx = conn.unchecked_transaction()?;
    tx.execute("UPDATE options SET ok = ?1 WHERE id = ?2", params![ok, id])?;
    toucher(&tx, o.dossier_id, &now)?;
    tx.commit()?;
    Ok(())
}

pub fn option_supprimer(conn: &Connection, id: i64) -> AppResult<()> {
    let o = option_lire(conn, id)?;
    exiger_modifiable(conn, o.dossier_id)?;
    let now = maintenant();
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM options WHERE id = ?1", [id])?;
    toucher(&tx, o.dossier_id, &now)?;
    tx.commit()?;
    Ok(())
}
