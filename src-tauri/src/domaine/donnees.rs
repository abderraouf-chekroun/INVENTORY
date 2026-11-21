//! Réinitialisation des données : base vide ou données d'exemple, précédée d'une sauvegarde automatique.

use super::{modeles, parametres};
use crate::db::exemple;
use crate::error::{AppError, AppResult, journaliser};
use chrono::{NaiveDate, NaiveDateTime};
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};

/// Nombre de sauvegardes conservées dans `sauvegardes/` (les plus récentes).
pub const SAUVEGARDES_CONSERVEES: usize = 3;
/// Une sauvegarde plus récente que cela n'est jamais supprimée, même au-delà des 3 plus récentes.
pub const AGE_MINIMAL_SUPPRESSION_JOURS: i64 = 7;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModeReinit {
    Vide,
    Exemple,
}

impl ModeReinit {
    pub fn depuis(mode: &str) -> AppResult<Self> {
        match mode {
            "vide" => Ok(ModeReinit::Vide),
            "exemple" => Ok(ModeReinit::Exemple),
            _ => Err(AppError::invalide("Mode de réinitialisation inconnu.")),
        }
    }
}

/// Nom d'un dossier de sauvegarde : `AAAA-MM-JJ_HH-MM-SS`, suivi de `-N` si plusieurs dans la même seconde.
/// Renvoie la clé de tri (horodatage, N) ou `None` si le nom n'est pas celui d'une sauvegarde.
fn cle_sauvegarde(nom: &str) -> Option<(String, u32)> {
    let (base, n) = match nom.get(19..) {
        Some("") => (nom, 0),
        Some(reste) => (&nom[..19], reste.strip_prefix('-')?.parse().ok()?),
        None => return None,
    };
    chrono::NaiveDateTime::parse_from_str(base, "%Y-%m-%d_%H-%M-%S").ok()?;
    Some((base.to_string(), n))
}

/// Crée un dossier de sauvegarde neuf dans `sauvegardes/`.
fn nouveau_dossier_sauvegarde(sauvegardes: &Path) -> AppResult<PathBuf> {
    fs::create_dir_all(sauvegardes)?;
    let horodatage = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    for n in 0..1000 {
        let nom = if n == 0 { horodatage.clone() } else { format!("{horodatage}-{n}") };
        let chemin = sauvegardes.join(nom);
        match fs::create_dir(&chemin) {
            Ok(()) => return Ok(chemin),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.into()),
        }
    }
    Err(AppError::refus("sauvegarde_impossible", "Impossible de créer le dossier de sauvegarde."))
}

/// Sauvegardes à supprimer : au-delà des `garder` plus récentes, et seulement si elles ont au moins
/// [`AGE_MINIMAL_SUPPRESSION_JOURS`] jours. Plusieurs réinitialisations d'affilée ne chassent donc jamais
/// la sauvegarde d'avant la première.
fn sauvegardes_a_supprimer(mut cles: Vec<(String, u32)>, garder: usize, maintenant: NaiveDateTime) -> Vec<(String, u32)> {
    cles.sort();
    let surplus = cles.len().saturating_sub(garder);
    let limite = maintenant - chrono::TimeDelta::days(AGE_MINIMAL_SUPPRESSION_JOURS);
    cles.into_iter()
        .take(surplus)
        .filter(|(horodatage, _)| {
            NaiveDateTime::parse_from_str(horodatage, "%Y-%m-%d_%H-%M-%S").is_ok_and(|d| d <= limite)
        })
        .collect()
}

/// Élague `sauvegardes/` (seuls les dossiers au nom de sauvegarde sont touchés).
fn elaguer_sauvegardes(sauvegardes: &Path, garder: usize) {
    let Ok(entrees) = fs::read_dir(sauvegardes) else { return };
    let liste: Vec<((String, u32), PathBuf)> = entrees
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .filter_map(|e| Some((cle_sauvegarde(&e.file_name().to_string_lossy())?, e.path())))
        .collect();
    let a_supprimer =
        sauvegardes_a_supprimer(liste.iter().map(|(c, _)| c.clone()).collect(), garder, chrono::Local::now().naive_local());
    for (cle, chemin) in liste {
        if a_supprimer.contains(&cle)
            && let Err(e) = fs::remove_dir_all(&chemin)
        {
            journaliser("sauvegarde", &e);
        }
    }
}

/// État « base vide » (§ 14), écrit sans ouvrir de transaction dans une base dont les données métier sont effacées
/// (ou n'ont jamais existé) : `donnees_exemple = 0` et les quatre modèles standards (§ 8.6) avec leur thème.
/// Commun au premier lancement ([`initialiser`]) et à « Effacer toutes les données » ([`reinitialiser`]).
fn etat_vide(conn: &Connection) -> AppResult<()> {
    parametres::ecrire(conn, parametres::DONNEES_EXEMPLE, "0")?;
    modeles::assurer_standards(conn)?;
    Ok(())
}

/// Premier lancement (§ 14) : une base neuve reçoit l'état vide, comme après « Effacer toutes les données »
/// (aucun employé, aucune machine, aucun dossier ; seulement les quatre modèles standards). Rien n'est effacé :
/// l'appelant ne l'utilise que sur une base jamais initialisée ([`crate::db::est_neuve`]).
pub fn initialiser(conn: &Connection) -> AppResult<()> {
    let tx = conn.unchecked_transaction()?;
    etat_vide(&tx)?;
    tx.commit()?;
    Ok(())
}

/// Efface toutes les données métier (les préférences d'affichage, les trois états fournis et la clé des identifiants
/// sont conservés ; les états ajoutés par l'utilisateur sont effacés) et recharge
/// éventuellement les données d'exemple. Les modèles standards sont recréés dans les deux cas.
///
/// Avant tout effacement : la base est copiée dans `sauvegardes/<horodatage>/donnees.sqlite` (`VACUUM INTO`)
/// et le dossier `fichiers/` y est déplacé. Si l'une de ces étapes échoue, rien n'est effacé.
/// Au-delà des [`SAUVEGARDES_CONSERVEES`] plus récentes, une sauvegarde n'est supprimée qu'après
/// [`AGE_MINIMAL_SUPPRESSION_JOURS`] jours.
pub fn reinitialiser(
    conn: &Connection,
    dossier_donnees: &Path,
    fichiers: &Path,
    mode: ModeReinit,
    aujourd_hui: NaiveDate,
) -> AppResult<()> {
    let sauvegardes = dossier_donnees.join("sauvegardes");
    let cible = nouveau_dossier_sauvegarde(&sauvegardes)?;
    let abandonner = |e: AppError| {
        let _ = fs::remove_dir_all(&cible);
        e
    };
    let copie_base = cible.join("donnees.sqlite").to_string_lossy().into_owned();
    conn.execute("VACUUM INTO ?1", [copie_base]).map_err(|e| abandonner(e.into()))?;
    let fichiers_sauves = cible.join("fichiers");
    if fichiers.exists() {
        fs::rename(fichiers, &fichiers_sauves).map_err(|e| {
            journaliser("sauvegarde", &e);
            abandonner(AppError::refus(
                "fichier_ouvert",
                "Un fichier importé est utilisé par une autre application. Fermez-le, puis réessayez.",
            ))
        })?;
    }
    let remettre_fichiers = || {
        let _ = fs::remove_dir_all(fichiers);
        if fichiers_sauves.exists() && fs::rename(&fichiers_sauves, fichiers).is_err() {
            journaliser("sauvegarde", &"impossible de remettre le dossier fichiers en place");
        }
        let _ = fs::create_dir_all(fichiers);
    };
    if let Err(e) = fs::create_dir_all(fichiers) {
        remettre_fichiers();
        return Err(e.into());
    }

    let effacer = || -> AppResult<()> {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(
            "DELETE FROM evenements;
             DELETE FROM nominations;
             DELETE FROM options;
             DELETE FROM documents;
             DELETE FROM sous_dossiers;
             DELETE FROM dossiers;
             DELETE FROM statuts WHERE role = 'perso';
             DELETE FROM affectations;
             DELETE FROM modeles;
             DELETE FROM entites;
             DELETE FROM categories;
             DELETE FROM magasin;
             DELETE FROM themes;",
        )?;
        match mode {
            ModeReinit::Exemple => exemple::inserer(&tx, aujourd_hui)?,
            // Les modèles standards (§ 8.6) survivent à « Effacer toutes les données ».
            ModeReinit::Vide => etat_vide(&tx)?,
        }
        tx.commit()?;
        Ok(())
    };
    if let Err(e) = effacer() {
        remettre_fichiers();
        return Err(e);
    }
    elaguer_sauvegardes(&sauvegardes, SAUVEGARDES_CONSERVEES);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{cle_sauvegarde, sauvegardes_a_supprimer};

    #[test]
    fn rotation_des_sauvegardes() {
        let maintenant = chrono::NaiveDateTime::parse_from_str("2026-11-20_12-00-00", "%Y-%m-%d_%H-%M-%S").unwrap();
        let cle = |s: &str| cle_sauvegarde(s).unwrap();
        // Cinq sauvegardes récentes : aucune n'est supprimée, même au-delà de trois.
        let recentes: Vec<_> = (0..5).map(|n| cle(&format!("2026-11-20_11-00-0{n}"))).collect();
        assert!(sauvegardes_a_supprimer(recentes.clone(), 3, maintenant).is_empty());
        // Deux anciennes et trois récentes : les anciennes, hors des trois plus récentes, partent.
        let mut melange = vec![cle("2026-01-01_10-00-00"), cle("2026-11-01_10-00-00")];
        melange.extend(recentes.iter().take(3).cloned());
        assert_eq!(
            sauvegardes_a_supprimer(melange, 3, maintenant),
            [cle("2026-01-01_10-00-00"), cle("2026-11-01_10-00-00")]
        );
        // Une ancienne parmi les trois plus récentes reste.
        assert!(sauvegardes_a_supprimer(vec![cle("2020-01-01_10-00-00")], 3, maintenant).is_empty());
    }

    #[test]
    fn noms_de_sauvegarde() {
        assert_eq!(cle_sauvegarde("2026-11-20_14-03-05"), Some(("2026-11-20_14-03-05".into(), 0)));
        assert_eq!(cle_sauvegarde("2026-11-20_14-03-05-12"), Some(("2026-11-20_14-03-05".into(), 12)));
        assert!(cle_sauvegarde("2026-11-20_14-03-05-12") > cle_sauvegarde("2026-11-20_14-03-05-2"));
        for autre in ["mes documents", "2026-11-20", "2026-11-20_14-03-05x", "2026-13-20_14-03-05", "é"] {
            assert_eq!(cle_sauvegarde(autre), None, "{autre}");
        }
    }
}
