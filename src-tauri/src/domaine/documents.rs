//! Documents : créés depuis un modèle (instantané des blocs) ou importés (copie dans `fichiers/`).

use super::copies::{self, Apercu, CopiePreparee};
use super::dossiers::{self, InfoDossier};
use super::journal;
use super::modeles::{self, Bloc, TypeBloc};
use super::nominations::{self, Facon};
use super::statuts::{self, Role};
use super::{OuIntrouvable, aujourd_hui, maintenant, nom_requis, pad2};
use crate::error::{AppError, AppResult};
use rusqlite::{Connection, params};
use serde::Serialize;
use std::path::{Path, PathBuf};

pub const SOURCE_IMPORT: &str = "Fichier importé";
/// § 11.1 : libellés des deux blocs d'un fichier importé.
pub const BLOC_IMPORT_EMPLOYE: &str = "Employé concerné";
pub const BLOC_IMPORT_MACHINE: &str = "Machine concernée";

/// Blocs d'un fichier importé (§ 11.1) : « Employé concerné » et « Machine concernée », facultatifs.
pub fn blocs_import(a_id: Option<i64>, b_id: Option<i64>) -> Vec<Bloc> {
    let bloc = |t, v, id| Bloc { entite_id: Some(id), ..Bloc::nouveau(t, v) };
    vec![bloc(TypeBloc::Employe, BLOC_IMPORT_EMPLOYE, a_id), bloc(TypeBloc::Machine, BLOC_IMPORT_MACHINE, b_id)]
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentFichier {
    pub id: i64,
    pub dossier_id: i64,
    pub sous_dossier_id: Option<i64>,
    pub nom: String,
    pub origine: String,
    pub source: String,
    pub date_doc: String,
    pub blocs: Option<Vec<Bloc>>,
    pub fichier_nom: Option<String>,
    /// Chemin de la copie, `None` si aucune copie valide (absente, ou référence invalide en base).
    pub fichier_chemin: Option<String>,
    /// Aperçu possible, décidé d'après le contenu réel de la copie.
    pub apercu: Apercu,
    /// Vrai si `document_ouvrir_externe` accepterait d'ouvrir la copie.
    pub ouvrable: bool,
    pub piece_finale: bool,
    pub cree_le: String,
    /// § 11.4 : modèle d'origine ; `None` pour un import, ou s'il n'a pas été retrouvé à la migration 005.
    pub modele_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentLie {
    #[serde(flatten)]
    pub document: DocumentFichier,
    pub dossier_nom: String,
    /// Nom du modèle d'origine (la source du document), « Fichier importé » pour un import.
    pub modele_nom: String,
    /// Façons dont la fiche est nommée dans le document, sans doublon, dans l'ordre bloc, texte.
    pub facons: Vec<Facon>,
    /// § 11.2 : libellés des champs où la fiche est nommée, sans doublon, du plus ancien au plus récent.
    pub champs: Vec<String>,
    /// § 11.2 : moment de la plus ancienne nomination encore présente.
    pub depuis: String,
}

/// Colonnes lues par [`ligne`], dans l'ordre (alias `x` de la table `documents`).
pub(crate) const COLONNES_DOCUMENT: &str = "x.id, x.dossier_id, x.sous_dossier_id, x.nom, x.origine, x.source,
        x.date_doc, x.blocs, x.fichier_nom, x.fichier_stocke, x.piece_finale, x.cree_le, x.modele_id";
/// Nombre de colonnes de [`COLONNES_DOCUMENT`] : indice de la première colonne ajoutée après elles.
pub(crate) const NB_COLONNES_DOCUMENT: usize = 13;

fn select_document() -> String {
    format!("SELECT {COLONNES_DOCUMENT} FROM documents x")
}

pub(crate) fn ligne(r: &rusqlite::Row<'_>, fichiers: &Path) -> rusqlite::Result<DocumentFichier> {
    let stocke: Option<String> = r.get(9)?;
    let blocs_json: Option<String> = r.get(7)?;
    let chemin = stocke.as_deref().and_then(|s| copies::chemin_copie(fichiers, s));
    Ok(DocumentFichier {
        id: r.get(0)?,
        dossier_id: r.get(1)?,
        sous_dossier_id: r.get(2)?,
        nom: r.get(3)?,
        origine: r.get(4)?,
        source: r.get(5)?,
        date_doc: r.get(6)?,
        // Des blocs illisibles n'empêchent pas d'afficher le reste du dossier.
        blocs: blocs_json.map(|j| {
            let mut blocs = modeles::decoder_blocs(&j).unwrap_or_else(modeles::blocs_illisibles);
            modeles::completer_signatures(&mut blocs);
            blocs
        }),
        fichier_nom: r.get(8)?,
        fichier_chemin: chemin.as_ref().map(|c| c.to_string_lossy().into_owned()),
        apercu: copies::apercu(chemin.as_deref()),
        ouvrable: chemin.is_some() && stocke.as_deref().is_some_and(copies::extension_ouvrable),
        piece_finale: r.get(10)?,
        cree_le: r.get(11)?,
        modele_id: r.get(12)?,
    })
}

pub fn lister_dossier(conn: &Connection, fichiers: &Path, dossier_id: i64) -> AppResult<Vec<DocumentFichier>> {
    let mut stmt = conn.prepare(&format!("{} WHERE x.dossier_id = ?1 ORDER BY x.cree_le, x.id", select_document()))?;
    let v = stmt.query_map([dossier_id], |r| ligne(r, fichiers))?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(v)
}

pub fn lire(conn: &Connection, fichiers: &Path, id: i64) -> AppResult<DocumentFichier> {
    conn.query_row(&format!("{} WHERE x.id = ?1", select_document()), [id], |r| ligne(r, fichiers))
        .ou_introuvable("Document introuvable.")
}

/// Dossier, nom de fichier stocké et blocs (JSON brut) d'un document.
fn info_document(conn: &Connection, id: i64) -> AppResult<(i64, Option<String>, Option<String>)> {
    conn.query_row(
        "SELECT dossier_id, fichier_stocke, blocs FROM documents WHERE id = ?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )
    .ou_introuvable("Document introuvable.")
}

/// `Document_NN`, NN = nombre de documents du dossier + 1, augmenté tant que
/// ce nom est déjà porté par un document du dossier (sous-dossiers compris).
fn nom_par_defaut(conn: &Connection, dossier_id: i64) -> AppResult<String> {
    let mut stmt = conn.prepare("SELECT nom FROM documents WHERE dossier_id = ?1")?;
    let noms = stmt.query_map([dossier_id], |r| r.get::<_, String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    let mut n = noms.len().saturating_add(1);
    let mut nom = format!("Document_{}", pad2(n as i64));
    while noms.contains(&nom) {
        n = n.saturating_add(1);
        nom = format!("Document_{}", pad2(n as i64));
    }
    Ok(nom)
}

/// Après l'ajout d'une pièce finale : « Pièce manquante » → « En cours » (§ 10.1) et ligne de journal.
fn apres_ajout(conn: &Connection, d: &InfoDossier, nom_doc: &str, piece_finale: bool, date: &str) -> AppResult<()> {
    if piece_finale {
        if d.role == Role::Piece {
            let cours = statuts::fourni(conn, Role::Cours)?;
            conn.execute("UPDATE dossiers SET statut_id = ?1 WHERE id = ?2", params![cours.id, d.id])?;
        }
        journal::ajouter(
            conn,
            journal::PIECE_AJOUTEE,
            "Pièce finale ajoutée",
            &format!("{nom_doc} ajouté à {}.", d.nom),
            d.cible(),
            date,
        )?;
    }
    dossiers::toucher(conn, d.id, date)
}

/// Le document peut être ajouté à ce dossier (non clôturé) et à ce sous-dossier (qui lui appartient).
pub fn verifier_destination(conn: &Connection, dossier_id: i64, sous_dossier_id: Option<i64>) -> AppResult<InfoDossier> {
    let d = dossiers::exiger_modifiable(conn, dossier_id)?;
    dossiers::verifier_sous_dossier(conn, dossier_id, sous_dossier_id)?;
    Ok(d)
}

pub fn creer_depuis_modele(
    conn: &Connection,
    fichiers: &Path,
    dossier_id: i64,
    sous_dossier_id: Option<i64>,
    modele_id: i64,
    piece_finale: bool,
) -> AppResult<DocumentFichier> {
    let d = verifier_destination(conn, dossier_id, sous_dossier_id)?;
    let m = modeles::lire(conn, modele_id)?;
    if !m.actif {
        return Err(AppError::refus("modele_archive", format!("Le modèle {} est archivé.", m.nom)));
    }
    if m.blocs == modeles::blocs_illisibles() {
        return Err(AppError::refus("modele_illisible", format!("Le contenu du modèle {} est endommagé.", m.nom)));
    }
    // § 11.1 : les blocs « Employé » et « Machine » sont vides (un dossier n'a plus de fiches rattachées) et aucune
    // valeur n'est saisie : personne n'est encore nommé, aucune nomination à enregistrer.
    let blocs = modeles::instantane(&m.blocs);
    // Instantané d'un modèle déjà stocké : il n'est pas plus volumineux que lui, aucune borne de taille.
    let json = modeles::encoder_blocs(&blocs, usize::MAX)?;
    let nom = nom_par_defaut(conn, dossier_id)?;
    let now = maintenant();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO documents (dossier_id, sous_dossier_id, nom, origine, source, date_doc, blocs, piece_finale, cree_le,
                                modele_id)
         VALUES (?1, ?2, ?3, 'modele', ?4, ?5, ?6, ?7, ?8, ?9)",
        params![dossier_id, sous_dossier_id, nom, m.nom, aujourd_hui(), json, piece_finale, now, m.id],
    )?;
    let id = tx.last_insert_rowid();
    apres_ajout(&tx, &d, &nom, piece_finale, &now)?;
    tx.commit()?;
    lire(conn, fichiers, id)
}

/// Enregistre en base une copie déjà faite par [`copies::preparer_copie`] (hors du verrou de la base).
/// La destination est revérifiée, la copie reçoit son nom définitif juste avant l'insertion ;
/// en cas d'échec, la copie est supprimée.
pub fn enregistrer_import(
    conn: &Connection,
    fichiers: &Path,
    dossier_id: i64,
    sous_dossier_id: Option<i64>,
    copie: CopiePreparee,
    piece_finale: bool,
) -> AppResult<DocumentFichier> {
    let enregistrer = || -> AppResult<i64> {
        let d = verifier_destination(conn, dossier_id, sous_dossier_id)?;
        copies::finaliser_copie(fichiers, &copie)?;
        let nom = nom_par_defaut(conn, dossier_id)?;
        let now = maintenant();
        // § 11.1 : deux blocs vides ; personne n'est encore nommé, aucune nomination à enregistrer.
        let blocs = modeles::encoder_blocs(&blocs_import(None, None), usize::MAX)?;
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO documents (dossier_id, sous_dossier_id, nom, origine, source, date_doc, blocs,
                                    fichier_stocke, fichier_nom, piece_finale, cree_le)
             VALUES (?1, ?2, ?3, 'import', ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                dossier_id,
                sous_dossier_id,
                nom,
                SOURCE_IMPORT,
                aujourd_hui(),
                blocs,
                copie.stocke,
                copie.fichier_nom,
                piece_finale,
                now
            ],
        )?;
        let id = tx.last_insert_rowid();
        apres_ajout(&tx, &d, &nom, piece_finale, &now)?;
        tx.commit()?;
        Ok(id)
    };
    match enregistrer() {
        Ok(id) => lire(conn, fichiers, id),
        Err(e) => {
            copies::abandonner_copie(fichiers, &copie);
            Err(e)
        }
    }
}

/// Import complet depuis un chemin local (vérification, copie, enregistrement), pour les tests.
/// La commande Tauri enchaîne les mêmes étapes, mais fait la copie hors du verrou de la base.
#[cfg(test)]
pub fn importer(
    conn: &Connection,
    fichiers: &Path,
    dossier_id: i64,
    sous_dossier_id: Option<i64>,
    chemin_source: &Path,
    piece_finale: bool,
) -> AppResult<DocumentFichier> {
    verifier_destination(conn, dossier_id, sous_dossier_id)?;
    let copie = copies::preparer_copie(fichiers, chemin_source)?;
    enregistrer_import(conn, fichiers, dossier_id, sous_dossier_id, copie, piece_finale)
}

pub fn renommer(conn: &Connection, id: i64, nom: &str) -> AppResult<()> {
    let nom = nom_requis(nom, "Le nom du document est obligatoire.")?;
    let (dossier_id, _, _) = info_document(conn, id)?;
    dossiers::exiger_modifiable(conn, dossier_id)?;
    let now = maintenant();
    let tx = conn.unchecked_transaction()?;
    tx.execute("UPDATE documents SET nom = ?1 WHERE id = ?2", params![nom, id])?;
    dossiers::toucher(&tx, dossier_id, &now)?;
    tx.commit()?;
    Ok(())
}

/// Date `AAAA-MM-JJ` valide.
pub fn verifier_date(date: &str) -> AppResult<String> {
    let d = date.trim();
    chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d")
        .map(|n| n.format("%Y-%m-%d").to_string())
        .map_err(|_| AppError::invalide("La date du document est invalide (format attendu : AAAA-MM-JJ)."))
}

pub fn definir_date(conn: &Connection, id: i64, date: &str) -> AppResult<()> {
    let date = verifier_date(date)?;
    let (dossier_id, _, _) = info_document(conn, id)?;
    dossiers::exiger_modifiable(conn, dossier_id)?;
    let now = maintenant();
    let tx = conn.unchecked_transaction()?;
    tx.execute("UPDATE documents SET date_doc = ?1 WHERE id = ?2", params![date, id])?;
    dossiers::toucher(&tx, dossier_id, &now)?;
    tx.commit()?;
    Ok(())
}

pub fn enregistrer_blocs(conn: &Connection, id: i64, blocs: &[Bloc]) -> AppResult<()> {
    let (dossier_id, _, json) = info_document(conn, id)?;
    dossiers::exiger_modifiable(conn, dossier_id)?;
    // Depuis la migration 005, tout document a des blocs (un fichier importé en a deux) : seule une base modifiée
    // à la main peut encore en être dépourvue.
    let json = json.ok_or_else(|| AppError::refus("sans_blocs", "Ce document n’a pas de champs à remplir."))?;
    let stockes = modeles::decoder_blocs(&json).ok_or_else(|| {
        AppError::refus("donnees_illisibles", "Le contenu de ce document est endommagé : il ne peut pas être modifié.")
    })?;
    // Bornes relevées au niveau du contenu déjà stocké : un document ancien et volumineux reste modifiable.
    let bornes = modeles::Bornes::depuis(&stockes, json.len());
    let fusion = modeles::fusionner_saisie(conn, &stockes, blocs, &bornes)?;
    let encode = modeles::encoder_blocs(&fusion, bornes.json)?;
    // Enregistrement automatique sans changement (pause de frappe sans saisie nouvelle) : rien à écrire.
    if encode == json {
        return Ok(());
    }
    let now = maintenant();
    let tx = conn.unchecked_transaction()?;
    tx.execute("UPDATE documents SET blocs = ?1 WHERE id = ?2", params![encode, id])?;
    // § 11.2 : nominations apparues datées de maintenant, disparues retirées, les autres gardent leur date.
    nominations::mettre_a_jour_document(&tx, id, &encode, &nominations::Index::complet(&tx)?, &now)?;
    dossiers::toucher(&tx, dossier_id, &now)?;
    tx.commit()?;
    Ok(())
}

/// Vrai si un autre document que `id` référence la même copie (base incohérente : l'application donne à chaque
/// import une copie à lui). Cette copie n'est alors jamais supprimée avec `id` : elle reste pour l'autre document.
fn copie_partagee(conn: &Connection, stocke: &str, id: i64) -> AppResult<bool> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM documents WHERE fichier_stocke = ?1 AND id <> ?2",
        params![stocke, id],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

/// Supprime le document. Sa copie est d'abord mise de côté : si elle est verrouillée par une autre
/// application, rien n'est supprimé et l'erreur le dit ; si la base échoue, la copie est remise en place.
/// Une copie que référence aussi un autre document (base incohérente) est conservée.
pub fn supprimer(conn: &Connection, fichiers: &Path, id: i64) -> AppResult<()> {
    let (dossier_id, stocke, _) = info_document(conn, id)?;
    dossiers::exiger_modifiable(conn, dossier_id)?;
    let stocke = match stocke {
        Some(s) if !copie_partagee(conn, &s, id)? => Some(s),
        _ => None,
    };
    let mise_de_cote = copies::mettre_de_cote(fichiers, stocke.as_deref())?;
    let effacer = || -> AppResult<()> {
        let now = maintenant();
        let tx = conn.unchecked_transaction()?;
        tx.execute("DELETE FROM documents WHERE id = ?1", [id])?;
        dossiers::toucher(&tx, dossier_id, &now)?;
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

/// Copie valide d'un document : référence correcte en base et fichier présent directement dans `fichiers/`.
fn copie_valide(conn: &Connection, fichiers: &Path, id: i64) -> AppResult<(String, PathBuf)> {
    let (_, stocke, _) = info_document(conn, id)?;
    let stocke = stocke.ok_or_else(|| AppError::refus("sans_fichier", "Ce document n’a pas de fichier."))?;
    if !copies::nom_stocke_valide(&stocke) {
        return Err(AppError::refus(
            "fichier_invalide",
            "La référence du fichier de ce document est invalide : le fichier n’est pas accessible.",
        ));
    }
    let chemin = copies::chemin_copie(fichiers, &stocke).ok_or_else(|| {
        AppError::refus("fichier_introuvable", "Le fichier de ce document est introuvable dans le dossier des données.")
    })?;
    Ok((stocke, chemin))
}

/// Copie à enregistrer ailleurs (« Enregistrer une copie… ») et nom proposé : tout document importé qui a
/// une copie valide, quel que soit son type (y compris `.bin`).
pub fn source_export(conn: &Connection, fichiers: &Path, id: i64) -> AppResult<(PathBuf, String)> {
    let (_, chemin) = copie_valide(conn, fichiers, id)?;
    let fichier_nom: Option<String> =
        conn.query_row("SELECT fichier_nom FROM documents WHERE id = ?1", [id], |r| r.get(0))?;
    Ok((chemin, copies::nom_propose(fichier_nom.as_deref())))
}

/// Chemin de la copie à ouvrir avec l'application par défaut : référence valide, type autorisé,
/// fichier présent directement dans `fichiers/`. La marque « venu d'Internet » est posée si elle manque.
pub fn chemin_externe(conn: &Connection, fichiers: &Path, id: i64) -> AppResult<PathBuf> {
    let (_, stocke, _) = info_document(conn, id)?;
    let stocke = stocke.ok_or_else(|| AppError::refus("sans_fichier", "Ce document n’a pas de fichier à ouvrir."))?;
    if !copies::nom_stocke_valide(&stocke) {
        return Err(AppError::refus(
            "fichier_invalide",
            "La référence du fichier de ce document est invalide : il ne peut pas être ouvert.",
        ));
    }
    if !copies::extension_ouvrable(&stocke) {
        return Err(AppError::refus(
            "type_interdit",
            "Par sécurité, ce type de fichier ne s’ouvre pas depuis l’application. Seuls les PDF, images, \
             textes et documents bureautiques courants peuvent être ouverts avec l’application par défaut. \
             Utilisez « Enregistrer une copie… » pour le récupérer.",
        ));
    }
    let (_, chemin) = copie_valide(conn, fichiers, id)?;
    copies::marquer_ou_journaliser(&chemin);
    Ok(chemin)
}
