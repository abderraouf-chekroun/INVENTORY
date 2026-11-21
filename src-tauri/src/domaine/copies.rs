//! Copies des fichiers importés (dossier `fichiers/`) : validation des chemins source et stockés,
//! types autorisés, aperçu décidé par le contenu, marque « venu d'Internet », mise de côté avant
//! suppression, ménage au démarrage.
//!
//! Règle unique : toute lecture, ouverture, exportation ou suppression d'une copie passe par [`chemin_copie`].

use crate::error::{AppError, AppResult, journaliser};
use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashSet;
use std::ffi::OsStr;
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

/// Extensions conservées à l'import et seules ouvrables avec l'application par défaut.
/// Aucune n'est exécutable par Windows (pas de .exe, .hta, .lnk, .js, .html, .svg…).
pub const EXTENSIONS_AUTORISEES: [&str; 25] = [
    "pdf", "png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "heic", "heif", "txt", "csv", "rtf", "doc",
    "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "msg", "eml",
];

/// Extension donnée à toute copie dont l'extension d'origine n'est pas autorisée (ou absente).
pub const EXTENSION_NEUTRE: &str = "bin";

/// Taille maximale d'un fichier importé : 200 Mo.
pub const TAILLE_MAX_IMPORT: u64 = 200 * 1024 * 1024;

/// Préfixe d'une copie mise de côté pendant une suppression (jamais servie ni ouverte).
const PREFIXE_CORBEILLE: &str = "supprime-";
/// Préfixe d'une copie en cours d'import, renommée au nom définitif juste avant l'insertion en base.
const PREFIXE_IMPORT: &str = "import-";

/// Type d'aperçu possible, décidé d'après les premiers octets du fichier stocké.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Apercu {
    Image,
    Pdf,
    Aucun,
}

// ---------- chemins ----------

/// Nom de périphérique réservé de Windows (`CON`, `NUL`, `COM1`, `LPT1.txt`…).
fn nom_reserve(nom: &OsStr) -> bool {
    let nom = nom.to_string_lossy();
    let base = nom.split('.').next().unwrap_or("").trim_end_matches([' ', '.']).to_ascii_uppercase();
    if matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$") {
        return true;
    }
    let mut car = base.chars();
    let prefixe: String = car.by_ref().take(3).collect();
    let reste: String = car.collect();
    (prefixe == "COM" || prefixe == "LPT")
        && reste.chars().count() == 1
        && reste.chars().all(|c| c.is_ascii_digit() || matches!(c, '¹' | '²' | '³'))
}

/// Composants après le préfixe et la racine : pas de nom réservé ni de flux de données alternatif (`a.txt:flux`).
fn composants_sains<'a>(mut composants: impl Iterator<Item = Component<'a>>) -> bool {
    matches!(composants.next(), Some(Component::RootDir))
        && composants.all(|c| match c {
            Component::Normal(n) => !nom_reserve(n) && !n.to_string_lossy().contains(':'),
            Component::CurDir | Component::ParentDir => true,
            Component::Prefix(_) | Component::RootDir => false,
        })
}

/// Chemin absolu sur un lecteur (`C:\…`) : ni partage réseau (`\\serveur\…`), ni chemin
/// `\\?\` (sauf si `accepter_verbatim`, pour un chemin issu de `canonicalize`), ni périphérique
/// (`\\.\pipe\…`, `NUL`, `COM1`…), ni flux de données alternatif (`fichier.txt:flux`).
/// Ne dit rien du type de lecteur (voir [`lecteur_local`]).
#[cfg(windows)]
pub fn chemin_disque_local(chemin: &Path, accepter_verbatim: bool) -> bool {
    use std::path::Prefix;
    let mut composants = chemin.components();
    let prefixe_ok = match composants.next() {
        Some(Component::Prefix(p)) => match p.kind() {
            Prefix::Disk(_) => true,
            Prefix::VerbatimDisk(_) => accepter_verbatim,
            _ => false,
        },
        _ => false,
    };
    prefixe_ok && composants_sains(composants)
}

#[cfg(not(windows))]
pub fn chemin_disque_local(chemin: &Path, _accepter_verbatim: bool) -> bool {
    chemin.is_absolute() && composants_sains(chemin.components())
}

/// Source d'import acceptable : chemin choisi par l'utilisateur dans le sélecteur natif, sur un lecteur
/// (local ou réseau mappé) ou un partage réseau (`\\serveur\partage\…`). Refusés : périphériques
/// (`\\.\…`), chemins `\\?\` saisis tels quels (sauf résultat de `canonicalize`), noms réservés, flux.
#[cfg(windows)]
pub fn chemin_source_acceptable(chemin: &Path, canonique: bool) -> bool {
    use std::path::Prefix;
    let mut composants = chemin.components();
    let prefixe_ok = match composants.next() {
        Some(Component::Prefix(p)) => match p.kind() {
            Prefix::Disk(_) | Prefix::UNC(..) => true,
            Prefix::VerbatimDisk(_) | Prefix::VerbatimUNC(..) => canonique,
            Prefix::Verbatim(_) | Prefix::DeviceNS(_) => false,
        },
        _ => false,
    };
    prefixe_ok && composants_sains(composants)
}

#[cfg(not(windows))]
pub fn chemin_source_acceptable(chemin: &Path, _canonique: bool) -> bool {
    chemin.is_absolute() && composants_sains(chemin.components())
}

/// Types de lecteur acceptés pour le dossier des données : amovible (2), fixe (3), disque virtuel en mémoire (6).
/// Refusés : inconnu (0), racine absente (1), réseau (4), CD-ROM (5).
pub fn type_lecteur_local(type_lecteur: u32) -> bool {
    matches!(type_lecteur, 2 | 3 | 6)
}

#[cfg(windows)]
#[link(name = "kernel32")]
unsafe extern "system" {
    fn GetDriveTypeW(racine: *const u16) -> u32;
}

/// Résout `chemin` (liens et lecteurs compris, via son plus proche ancêtre existant) et vérifie qu'il
/// mène à un lecteur local, non distant (`GetDriveTypeW`) : un lecteur réseau mappé ou un lien vers un
/// partage est refusé.
#[cfg(windows)]
pub fn lecteur_local(chemin: &Path) -> bool {
    use std::os::windows::ffi::OsStrExt;
    use std::path::Prefix;
    if !chemin_disque_local(chemin, false) {
        return false;
    }
    let Some(existant) = chemin.ancestors().find(|a| a.exists()) else { return false };
    let Ok(resolu) = fs::canonicalize(existant) else { return false };
    let lettre = match resolu.components().next() {
        Some(Component::Prefix(p)) => match p.kind() {
            Prefix::VerbatimDisk(l) | Prefix::Disk(l) => l,
            _ => return false,
        },
        _ => return false,
    };
    let racine: Vec<u16> = OsStr::new(&format!("{}:\\", lettre as char)).encode_wide().chain([0]).collect();
    // SAFETY : `racine` est une chaîne UTF-16 terminée par un zéro, valide pendant l'appel.
    let type_lecteur = unsafe { GetDriveTypeW(racine.as_ptr()) };
    type_lecteur_local(type_lecteur)
}

#[cfg(not(windows))]
pub fn lecteur_local(chemin: &Path) -> bool {
    chemin_disque_local(chemin, false)
}

/// Nom stocké valide : UUID en minuscules (8-4-4-4-12), suivi éventuellement de `.ext` (1 à 10 caractères a-z0-9).
pub fn nom_stocke_valide(stocke: &str) -> bool {
    let (uuid, ext) = match stocke.split_once('.') {
        Some((u, e)) => (u, Some(e)),
        None => (stocke, None),
    };
    let groupes: Vec<&str> = uuid.split('-').collect();
    let uuid_ok = groupes.len() == 5
        && groupes.iter().zip([8, 4, 4, 4, 12]).all(|(g, n)| {
            g.len() == n && g.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        });
    let ext_ok = ext.is_none_or(|e| {
        (1..=10).contains(&e.len()) && e.bytes().all(|b| b.is_ascii_digit() || b.is_ascii_lowercase())
    });
    uuid_ok && ext_ok
}

/// Extension d'un nom stocké, si le nom est valide.
fn extension_stockee(stocke: &str) -> Option<&str> {
    if !nom_stocke_valide(stocke) {
        return None;
    }
    stocke.split_once('.').map(|(_, e)| e)
}

/// Vrai si la copie peut être ouverte avec l'application par défaut (nom valide, extension autorisée).
pub fn extension_ouvrable(stocke: &str) -> bool {
    extension_stockee(stocke).is_some_and(|e| EXTENSIONS_AUTORISEES.contains(&e))
}

/// Extension donnée à la copie d'un fichier source : la sienne si elle est autorisée, sinon `bin`.
pub fn extension_pour_stockage(source: &Path) -> &'static str {
    let ext = source.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase);
    ext.and_then(|e| EXTENSIONS_AUTORISEES.iter().copied().find(|a| *a == e)).unwrap_or(EXTENSION_NEUTRE)
}

/// Chemin d'une copie stockée, ou `None` si la valeur lue en base est invalide, si le fichier n'existe pas,
/// n'est pas un fichier ordinaire (lien, dossier) ou ne se trouve pas directement dans `fichiers/`
/// une fois les liens résolus.
pub fn chemin_copie(fichiers: &Path, stocke: &str) -> Option<PathBuf> {
    if !nom_stocke_valide(stocke) {
        return None;
    }
    let chemin = fichiers.join(stocke);
    let meta = fs::symlink_metadata(&chemin).ok()?;
    if !meta.file_type().is_file() {
        return None;
    }
    let canonique = fs::canonicalize(&chemin).ok()?;
    let fichiers_canonique = fs::canonicalize(fichiers).ok()?;
    (canonique.parent() == Some(fichiers_canonique.as_path())).then_some(chemin)
}

// ---------- aperçu ----------

fn est_bmp(o: &[u8]) -> bool {
    o.len() >= 18
        && o.starts_with(b"BM")
        && matches!(u32::from_le_bytes([o[14], o[15], o[16], o[17]]), 12 | 40 | 52 | 56 | 64 | 108 | 124)
}

/// Type MIME d'une image reconnue à ses octets de signature (PNG, JPEG, GIF, WebP, BMP).
pub fn type_image(o: &[u8]) -> Option<&'static str> {
    if o.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if o.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if o.starts_with(b"GIF87a") || o.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if o.len() >= 12 && o.starts_with(b"RIFF") && &o[8..12] == b"WEBP" {
        Some("image/webp")
    } else if est_bmp(o) {
        Some("image/bmp")
    } else {
        None
    }
}

/// Aperçu d'après les octets de signature : PNG, JPEG, GIF, WebP, BMP → image ; `%PDF-` → pdf ; le reste → aucun.
pub fn apercu_des_octets(o: &[u8]) -> Apercu {
    if type_image(o).is_some() {
        Apercu::Image
    } else if o.starts_with(b"%PDF-") {
        Apercu::Pdf
    } else {
        Apercu::Aucun
    }
}

/// Premiers octets d'un fichier (32 au plus).
pub fn entete(chemin: &Path) -> std::io::Result<Vec<u8>> {
    let mut tampon = Vec::with_capacity(32);
    fs::File::open(chemin)?.take(32).read_to_end(&mut tampon)?;
    Ok(tampon)
}

/// Aperçu d'une copie (déjà validée par [`chemin_copie`]) ; `aucun` sans fichier ou s'il est illisible.
pub fn apercu(chemin: Option<&Path>) -> Apercu {
    chemin.and_then(|c| entete(c).ok()).map_or(Apercu::Aucun, |o| apercu_des_octets(&o))
}

// ---------- marque « venu d'Internet » ----------

/// Pose sur un fichier la marque Windows « venu d'Internet » (flux `Zone.Identifier`, `ZoneId=3`), sauf si une
/// marque au moins aussi stricte est déjà présente. Les applications qui ouvrent le fichier (Office : mode
/// protégé, macros bloquées ; lecteurs PDF) le traitent alors avec méfiance. Sans effet hors de Windows ;
/// échoue sur un volume qui ne gère pas les flux (FAT).
pub fn marquer_provenance_internet(chemin: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        let mut flux = chemin.as_os_str().to_owned();
        flux.push(":Zone.Identifier");
        if let Ok(existant) = fs::read_to_string(&flux)
            && existant.lines().any(|l| matches!(l.trim(), "ZoneId=3" | "ZoneId=4"))
        {
            return Ok(());
        }
        fs::write(&flux, "[ZoneTransfer]\r\nZoneId=3\r\n")
    }
    #[cfg(not(windows))]
    {
        let _ = chemin;
        Ok(())
    }
}

/// Pose la marque et consigne un éventuel échec (sans bloquer l'opération).
pub fn marquer_ou_journaliser(chemin: &Path) {
    if let Err(e) = marquer_provenance_internet(chemin) {
        journaliser("marque Internet", &e);
    }
}

// ---------- import ----------

/// Copie faite dans `fichiers/` sous un nom temporaire `import-…`, pas encore enregistrée en base.
#[derive(Debug, Clone)]
pub struct CopiePreparee {
    pub temporaire: String,
    pub stocke: String,
    pub fichier_nom: String,
}

fn source_refusee() -> AppError {
    AppError::refus(
        "source_refusee",
        "Seul un fichier ordinaire peut être importé (pas de périphérique, de flux ni de nom réservé).",
    )
}

fn trop_volumineux() -> AppError {
    AppError::refus("fichier_trop_volumineux", "Le fichier dépasse la taille maximale de 200 Mo.")
}

/// Vérifie le fichier à importer et renvoie son chemin canonique : fichier ordinaire (liens suivis puis
/// revérifiés), 200 Mo au plus une fois résolu.
pub fn verifier_source(source: &Path) -> AppResult<PathBuf> {
    if !chemin_source_acceptable(source, false) {
        return Err(source_refusee());
    }
    let introuvable = || AppError::refus("fichier_introuvable", "Le fichier à importer est introuvable.");
    let canonique = fs::canonicalize(source).map_err(|_| introuvable())?;
    if !chemin_source_acceptable(&canonique, true) {
        return Err(source_refusee());
    }
    let meta = fs::metadata(&canonique).map_err(|_| introuvable())?;
    if !meta.is_file() {
        return Err(introuvable());
    }
    if meta.len() > TAILLE_MAX_IMPORT {
        return Err(trop_volumineux());
    }
    Ok(canonique)
}

/// Copie le fichier source dans `fichiers/import-<uuid>.<ext>` (extension autorisée, sinon `bin`) et pose la
/// marque « venu d'Internet ». Sans accès à la base : à appeler hors du verrou de la connexion.
pub fn preparer_copie(fichiers: &Path, source: &Path) -> AppResult<CopiePreparee> {
    let canonique = verifier_source(source)?;
    let fichier_nom = source
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "fichier".to_string());
    let stocke = format!("{}.{}", uuid::Uuid::new_v4(), extension_pour_stockage(source));
    let temporaire = format!("{PREFIXE_IMPORT}{stocke}");
    fs::create_dir_all(fichiers)?;
    let destination = fichiers.join(&temporaire);
    // `fs::copy` (CopyFileExW) conserve les flux de la source, dont une éventuelle marque plus précise.
    if let Err(e) = fs::copy(&canonique, &destination) {
        journaliser("import", &e);
        let _ = fs::remove_file(&destination);
        return Err(AppError::new("fichier", format!("Impossible de copier le fichier « {fichier_nom} ».")));
    }
    // Le fichier a pu grossir entre la vérification et la copie.
    if fs::metadata(&destination).map(|m| m.len()).unwrap_or(u64::MAX) > TAILLE_MAX_IMPORT {
        let _ = fs::remove_file(&destination);
        return Err(trop_volumineux());
    }
    marquer_ou_journaliser(&destination);
    Ok(CopiePreparee { temporaire, stocke, fichier_nom })
}

/// Donne à la copie préparée son nom définitif (juste avant l'insertion en base).
pub fn finaliser_copie(fichiers: &Path, copie: &CopiePreparee) -> AppResult<()> {
    fs::rename(fichiers.join(&copie.temporaire), fichiers.join(&copie.stocke))?;
    Ok(())
}

/// Supprime une copie préparée (temporaire ou déjà renommée) dont l'enregistrement a échoué.
pub fn abandonner_copie(fichiers: &Path, copie: &CopiePreparee) {
    let _ = fs::remove_file(fichiers.join(&copie.temporaire));
    if let Some(chemin) = chemin_copie(fichiers, &copie.stocke) {
        let _ = fs::remove_file(chemin);
    }
}

// ---------- exportation ----------

/// Nom proposé à l'enregistrement d'une copie : nom d'origine nettoyé (aucun séparateur ni caractère
/// interdit par Windows), `document` à défaut.
pub fn nom_propose(fichier_nom: Option<&str>) -> String {
    let nom: String = fichier_nom
        .unwrap_or("")
        .chars()
        .map(|c| if c.is_control() || r#"<>:"/\|?*"#.contains(c) { '_' } else { c })
        .collect();
    let nom = nom.trim_matches([' ', '.']).to_string();
    if nom.is_empty() || nom_reserve(OsStr::new(&nom)) { "document".to_string() } else { nom }
}

/// Copie une copie stockée vers la destination choisie par l'utilisateur et y pose la marque « venu d'Internet ».
/// La destination ne peut pas être un périphérique ni le dossier `fichiers/` lui-même.
pub fn exporter_copie(fichiers: &Path, source: &Path, destination: &Path) -> AppResult<()> {
    let refus = || AppError::refus("destination_refusee", "Choisissez un autre emplacement pour enregistrer la copie.");
    if !chemin_source_acceptable(destination, false) {
        return Err(refus());
    }
    let dossier = destination.parent().and_then(|p| fs::canonicalize(p).ok()).ok_or_else(refus)?;
    if fs::canonicalize(fichiers).is_ok_and(|f| f == dossier) {
        return Err(refus());
    }
    if let Err(e) = fs::copy(source, destination) {
        journaliser("exportation", &e);
        return Err(AppError::new("fichier", "Impossible d’enregistrer la copie à cet emplacement."));
    }
    marquer_ou_journaliser(destination);
    Ok(())
}

// ---------- suppression ----------

/// Copies renommées en `supprime-<nom>` en attendant la validation de la suppression en base.
#[derive(Debug, Default)]
pub struct MiseDeCote(Vec<(PathBuf, PathBuf)>);

/// Met de côté les copies (renommage). Si une copie ne peut pas l'être (fichier ouvert dans une autre
/// application), tout est remis en place et la suppression est refusée : rien n'a changé.
pub fn mettre_de_cote<'a>(fichiers: &Path, stockes: impl IntoIterator<Item = &'a str>) -> AppResult<MiseDeCote> {
    let mut faites = MiseDeCote::default();
    for stocke in stockes {
        let Some(chemin) = chemin_copie(fichiers, stocke) else { continue };
        let corbeille = fichiers.join(format!("{PREFIXE_CORBEILLE}{stocke}"));
        if let Err(e) = fs::rename(&chemin, &corbeille) {
            journaliser("suppression", &e);
            restaurer(&faites);
            return Err(AppError::refus(
                "fichier_ouvert",
                "Un fichier importé de ce document est utilisé par une autre application. Fermez-le, puis réessayez.",
            ));
        }
        faites.0.push((chemin, corbeille));
    }
    Ok(faites)
}

/// Remet les copies à leur place (la suppression en base a échoué).
pub fn restaurer(m: &MiseDeCote) {
    for (origine, corbeille) in &m.0 {
        if let Err(e) = fs::rename(corbeille, origine) {
            journaliser("suppression", &e);
        }
    }
}

/// Supprime définitivement les copies mises de côté. Un échec est consigné ; le ménage du démarrage s'en charge.
pub fn purger(m: &MiseDeCote) {
    for (_, corbeille) in &m.0 {
        if let Err(e) = fs::remove_file(corbeille) {
            journaliser("suppression", &e);
        }
    }
}

/// Ménage au démarrage, limité aux fichiers que l'application a elle-même nommés comme provisoires :
/// - `import-…` : copie d'un import interrompu, supprimée ;
/// - `supprime-<nom>` : si `<nom>` est encore référencé (arrêt brutal pendant une suppression), la copie est
///   remise en place ; sinon elle est supprimée.
///
/// Une copie ordinaire n'est JAMAIS supprimée, même non référencée (base neuve, restaurée ou plus ancienne).
/// Renvoie le nombre de fichiers supprimés.
pub fn nettoyer_provisoires(conn: &Connection, fichiers: &Path) -> AppResult<usize> {
    let references: HashSet<String> = {
        let mut stmt = conn.prepare("SELECT fichier_stocke FROM documents WHERE fichier_stocke IS NOT NULL")?;
        stmt.query_map([], |r| r.get::<_, String>(0))?.collect::<rusqlite::Result<_>>()?
    };
    let Ok(entrees) = fs::read_dir(fichiers) else { return Ok(0) };
    let mut supprimes = 0;
    for entree in entrees.flatten() {
        if !entree.file_type().is_ok_and(|t| t.is_file()) {
            continue;
        }
        let nom = entree.file_name().to_string_lossy().into_owned();
        let a_supprimer = if nom.starts_with(PREFIXE_IMPORT) {
            true
        } else if let Some(origine) = nom.strip_prefix(PREFIXE_CORBEILLE) {
            if references.contains(origine) && nom_stocke_valide(origine) && !fichiers.join(origine).exists() {
                if let Err(e) = fs::rename(entree.path(), fichiers.join(origine)) {
                    journaliser("ménage", &e);
                }
                false
            } else {
                !references.contains(origine)
            }
        } else {
            false
        };
        if a_supprimer {
            match fs::remove_file(entree.path()) {
                Ok(()) => supprimes += 1,
                Err(e) => journaliser("ménage", &e),
            }
        }
    }
    Ok(supprimes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn noms_stockes_valides_et_invalides() {
        assert!(nom_stocke_valide("0b1c2d3e-4f50-4617-8899-aabbccddeeff.pdf"));
        assert!(nom_stocke_valide("0b1c2d3e-4f50-4617-8899-aabbccddeeff"));
        for n in [
            "..\\x.exe",
            "../x",
            "C:\\Windows\\System32\\cmd.exe",
            "\\\\h\\s\\x",
            "C:x",
            "0B1C2D3E-4F50-4617-8899-AABBCCDDEEFF.pdf",
            "0b1c2d3e-4f50-4617-8899-aabbccddeeff.p.df",
            "0b1c2d3e-4f50-4617-8899-aabbccddeeff.pdf:flux",
            "0b1c2d3e-4f50-4617-8899-aabbccddeeff.",
            "supprime-0b1c2d3e-4f50-4617-8899-aabbccddeeff.pdf",
            "import-0b1c2d3e-4f50-4617-8899-aabbccddeeff.pdf",
            "",
        ] {
            assert!(!nom_stocke_valide(n), "{n}");
        }
    }

    #[test]
    fn extensions_autorisees_a_l_import() {
        assert_eq!(extension_pour_stockage(Path::new("C:\\a\\Devis.PDF")), "pdf");
        for ext in ["msg", "eml", "heic", "heif"] {
            assert_eq!(extension_pour_stockage(Path::new(&format!("x.{ext}"))), ext);
        }
        for dangereux in ["x.exe", "x.hta", "x.lnk", "x.bat", "x.js", "x.html", "x.svg", "x.url", "sans_extension"] {
            assert_eq!(extension_pour_stockage(Path::new(dangereux)), "bin", "{dangereux}");
        }
        assert!(extension_ouvrable("0b1c2d3e-4f50-4617-8899-aabbccddeeff.docx"));
        assert!(!extension_ouvrable("0b1c2d3e-4f50-4617-8899-aabbccddeeff.bin"));
        assert!(!extension_ouvrable("0b1c2d3e-4f50-4617-8899-aabbccddeeff.hta"));
        assert!(!extension_ouvrable("0b1c2d3e-4f50-4617-8899-aabbccddeeff"));
    }

    #[test]
    fn apercu_selon_le_contenu() {
        assert_eq!(apercu_des_octets(b"\x89PNG\r\n\x1a\n...."), Apercu::Image);
        assert_eq!(type_image(b"\x89PNG\r\n\x1a\n...."), Some("image/png"));
        assert_eq!(type_image(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("image/jpeg"));
        assert_eq!(type_image(b"GIF89a.."), Some("image/gif"));
        assert_eq!(type_image(b"RIFF\0\0\0\0WEBPVP8 "), Some("image/webp"));
        let mut bmp = b"BM".to_vec();
        bmp.extend_from_slice(&[0; 12]);
        bmp.extend_from_slice(&40u32.to_le_bytes());
        assert_eq!(type_image(&bmp), Some("image/bmp"));
        assert_eq!(apercu_des_octets(b"BMalors ceci est du texte"), Apercu::Aucun);
        assert_eq!(apercu_des_octets(b"%PDF-1.7"), Apercu::Pdf);
        assert_eq!(apercu_des_octets(b"<svg xmlns='http://www.w3.org/2000/svg'><script/>"), Apercu::Aucun);
        assert_eq!(apercu_des_octets(b"<!doctype html><script>"), Apercu::Aucun);
        assert_eq!(apercu_des_octets(b""), Apercu::Aucun);
        assert_eq!(apercu(None), Apercu::Aucun);
    }

    #[test]
    fn nom_propose_a_l_exportation() {
        assert_eq!(nom_propose(Some("Devis 2026.pdf")), "Devis 2026.pdf");
        assert_eq!(nom_propose(Some(r"..\..\a:b?.pdf")), "_.._a_b_.pdf");
        assert_eq!(nom_propose(Some("NUL.txt")), "document");
        assert_eq!(nom_propose(Some(" . ")), "document");
        assert_eq!(nom_propose(None), "document");
    }

    #[cfg(windows)]
    #[test]
    fn chemins_acceptes() {
        assert!(chemin_disque_local(Path::new(r"C:\Users\x\Documents\a.pdf"), false));
        assert!(chemin_disque_local(Path::new(r"D:\a\..\b.pdf"), false));
        for p in [
            r"\\serveur\partage\a.pdf",
            r"\\hote@SSL\dav\x.hta",
            r"\\?\C:\a.pdf",
            r"\\?\UNC\serveur\partage\a.pdf",
            r"\\.\pipe\tube",
            r"\\.\PhysicalDrive0",
            r"C:\dossier\NUL",
            r"C:\dossier\com1.txt",
            r"C:\dossier\LPT¹",
            r"C:\dossier\CONIN$",
            r"C:\a.txt:flux",
            r"C:relatif.pdf",
            r"relatif\a.pdf",
            "",
        ] {
            assert!(!chemin_disque_local(Path::new(p), false), "{p}");
        }
        assert!(chemin_disque_local(Path::new(r"\\?\C:\a.pdf"), true));
        assert!(!chemin_disque_local(Path::new(r"\\?\UNC\serveur\partage\a.pdf"), true));

        // Source d'import : partages réseau acceptés (chemin choisi dans le sélecteur natif).
        assert!(chemin_source_acceptable(Path::new(r"\\serveur\partage\a.pdf"), false));
        assert!(chemin_source_acceptable(Path::new(r"Z:\scans\a.pdf"), false));
        assert!(chemin_source_acceptable(Path::new(r"\\?\UNC\serveur\partage\a.pdf"), true));
        for p in [r"\\.\pipe\tube", r"\\?\C:\a.pdf", r"\\?\GLOBALROOT\Device\x", r"\\serveur\partage\NUL", r"C:\a.txt:flux", "relatif.pdf"] {
            assert!(!chemin_source_acceptable(Path::new(p), false), "{p}");
        }
    }

    #[test]
    fn types_de_lecteur() {
        assert!(type_lecteur_local(3) && type_lecteur_local(2) && type_lecteur_local(6));
        for refuse in [0, 1, 4, 5] {
            assert!(!type_lecteur_local(refuse), "{refuse}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn dossier_temporaire_sur_lecteur_local() {
        let tmp = std::env::temp_dir();
        assert!(lecteur_local(&tmp));
        assert!(lecteur_local(&tmp.join("pas-encore-cree").join("donnees")));
        assert!(!lecteur_local(Path::new(r"\\localhost\c$\donnees")));
    }
}
