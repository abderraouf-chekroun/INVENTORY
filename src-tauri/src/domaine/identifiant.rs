//! Identifiant d'un employé (§ 10.5) : `EMP-XXXXX-XXXXX`, calculé à partir du nom, du prénom, de la date de
//! naissance et du poste, sans qu'on puisse le deviner ni en lire quoi que ce soit.
//!
//! - Les quatre informations sont normalisées (casse, accents, espaces et ponctuation ignorés), puis passées dans une
//!   empreinte à clé HMAC-SHA-256 dont la clé (32 octets) est tirée au hasard par le générateur du système à la
//!   création de la base, et conservée dans la table `cle_identifiant`.
//! - Les 50 premiers bits de l'empreinte s'écrivent en dix caractères de l'alphabet `0-9 A-Z` sans `I`, `L`, `O`, `U`.
//! - En cas de collision avec un autre employé, on prend les 50 bits suivants (cinq fenêtres par empreinte), puis
//!   ceux d'empreintes dérivées.
//!
//! La clé ne sort jamais de ce module : aucune fonction publique ne la renvoie, et elle n'apparaît dans aucun
//! message d'erreur ni dans le journal des erreurs.

use super::texte::replier;
use crate::error::{AppError, AppResult, journaliser};
use chrono::NaiveDate;
use hmac::{Hmac, Mac};
use rusqlite::{Connection, OptionalExtension};
use sha2::Sha256;
use std::collections::HashSet;

/// Alphabet de l'identifiant : 32 caractères sans `I`, `L`, `O`, `U` (lisibles sans ambiguïté).
pub const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/// Préfixe de l'identifiant d'un employé.
pub const PREFIXE: &str = "EMP-";
/// Bits retenus par identifiant (10 caractères de 5 bits).
const BITS: usize = 50;
/// Fenêtres de 50 bits dans une empreinte de 256 bits.
const FENETRES: usize = 256 / BITS;
/// Candidats examinés avant de considérer l'identifiant actuel comme périmé.
const CANDIDATS_EXAMINES: usize = 64;
/// Au-delà (jamais atteint en pratique), on renonce plutôt que de boucler.
const CANDIDATS_MAX: usize = 100_000;

/// Clé secrète : 32 octets.
type Cle = [u8; 32];

/// Informations normalisées d'un employé complet, prêtes à être signées.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Infos(String);

/// Un champ normalisé : lettres et chiffres seulement, en minuscules, sans accents (« N’Diaye-Lê » → « ndiayele »).
fn normaliser(s: &str) -> String {
    replier(s).chars().filter(|c| c.is_alphanumeric()).collect()
}

/// Informations normalisées, ou `None` s'il manque le nom, le prénom, la date de naissance (absente ou invalide)
/// ou le poste.
pub fn infos(nom: &str, prenom: &str, date_naissance: Option<&str>, poste: &str) -> Option<Infos> {
    let champs = [normaliser(nom), normaliser(prenom), normaliser(poste)];
    if champs.iter().any(String::is_empty) {
        return None;
    }
    let date = NaiveDate::parse_from_str(date_naissance?.trim(), "%Y-%m-%d").ok()?;
    let [n, p, f] = champs;
    // Séparateur 0x1F : absent des champs normalisés, aucune concaténation ambiguë.
    Some(Infos(format!("emp\u{1f}{n}\u{1f}{p}\u{1f}{}\u{1f}{f}", date.format("%Y-%m-%d"))))
}

fn empreinte(cle: &Cle, message: &[u8]) -> [u8; 32] {
    // Une clé de 32 octets est toujours acceptée par HMAC.
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(cle).expect("HMAC accepte toute longueur de clé");
    mac.update(message);
    mac.finalize().into_bytes().into()
}

/// `n` bits de `octets` à partir du bit `debut` (bit de poids fort en tête).
fn bits(octets: &[u8; 32], debut: usize, n: usize) -> u64 {
    (debut..debut + n).fold(0u64, |acc, i| (acc << 1) | u64::from((octets[i / 8] >> (7 - i % 8)) & 1))
}

/// `EMP-XXXXX-XXXXX` à partir de 50 bits.
fn ecrire(valeur: u64) -> String {
    let car: Vec<char> = (0..10).map(|i| ALPHABET[((valeur >> (45 - 5 * i)) & 31) as usize] as char).collect();
    let (a, b) = car.split_at(5);
    format!("{PREFIXE}{}-{}", a.iter().collect::<String>(), b.iter().collect::<String>())
}

/// Candidats successifs : les cinq fenêtres de 50 bits de l'empreinte, puis celles d'empreintes dérivées
/// (message suivi d'un compteur).
fn candidats<'a>(cle: &'a Cle, infos: &'a Infos) -> impl Iterator<Item = String> + 'a {
    (0u64..).flat_map(move |rang| {
        let message = if rang == 0 {
            infos.0.clone().into_bytes()
        } else {
            format!("{}\u{1f}{rang}", infos.0).into_bytes()
        };
        let e = empreinte(cle, &message);
        (0..FENETRES).map(move |f| ecrire(bits(&e, f * BITS, BITS)))
    })
}

/// Clé secrète de la base ; tirée et enregistrée si elle manque (base modifiée à la main).
fn cle(conn: &Connection) -> AppResult<Cle> {
    let lire = |conn: &Connection| -> AppResult<Option<Cle>> {
        let v: Option<Vec<u8>> =
            conn.query_row("SELECT cle FROM cle_identifiant WHERE id = 1", [], |r| r.get(0)).optional()?;
        Ok(v.and_then(|v| Cle::try_from(v.as_slice()).ok()))
    };
    if let Some(c) = lire(conn)? {
        return Ok(c);
    }
    assurer_cle(conn)?;
    lire(conn)?.ok_or_else(|| AppError::interne("La clé des identifiants est introuvable."))
}

/// Tire la clé secrète si la base n'en a pas encore (sans transaction). Rien n'est journalisé de la clé.
pub fn assurer_cle(conn: &Connection) -> AppResult<()> {
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM cle_identifiant WHERE id = 1", [], |r| r.get(0))?;
    if n > 0 {
        return Ok(());
    }
    let mut c: Cle = [0; 32];
    getrandom::fill(&mut c).map_err(|e| {
        journaliser("clé", &e);
        AppError::interne("Le générateur aléatoire du système est indisponible.")
    })?;
    conn.execute("INSERT INTO cle_identifiant (id, cle) VALUES (1, ?1)", [&c[..]])?;
    Ok(())
}

/// Identifiant à attribuer à un employé, ou `None` si ses informations sont incomplètes.
///
/// `actuel` : l'identifiant actuel de la fiche ; il est conservé tant qu'il correspond aux mêmes informations (il fait
/// partie de leurs candidats). Sinon, le premier candidat qu'aucun autre employé ne porte (`sauf` : la fiche elle-même).
pub(crate) fn attribuer(
    conn: &Connection,
    infos: Option<&Infos>,
    actuel: Option<&str>,
    sauf: Option<i64>,
) -> AppResult<Option<String>> {
    let Some(infos) = infos else { return Ok(None) };
    let cle = cle(conn)?;
    let pris: HashSet<String> = {
        let mut stmt =
            conn.prepare("SELECT code FROM entites WHERE kind = 'a' AND code IS NOT NULL AND id IS NOT ?1")?;
        stmt.query_map([sauf], |r| r.get::<_, String>(0))?
            .map(|c| c.map(|c| c.to_uppercase()))
            .collect::<rusqlite::Result<_>>()?
    };
    let premiers: Vec<String> = candidats(&cle, infos).take(CANDIDATS_EXAMINES).collect();
    if let Some(a) = actuel
        && premiers.iter().any(|c| c == a)
        && !pris.contains(a)
    {
        return Ok(Some(a.to_string()));
    }
    candidats(&cle, infos)
        .take(CANDIDATS_MAX)
        .find(|c| !pris.contains(c))
        .map(Some)
        .ok_or_else(|| AppError::interne("Aucun identifiant libre n’a pu être calculé."))
}

/// Candidats d'un employé dans cette base, dans l'ordre (tests : collision provoquée).
#[cfg(test)]
pub(crate) fn candidats_pour(conn: &Connection, infos: &Infos, n: usize) -> AppResult<Vec<String>> {
    let cle = cle(conn)?;
    Ok(candidats(&cle, infos).take(n).collect())
}

/// Vrai si `code` a la forme d'un identifiant d'employé (`EMP-XXXXX-XXXXX`, alphabet de l'identifiant).
#[cfg(test)]
pub fn forme_valide(code: &str) -> bool {
    let Some(reste) = code.strip_prefix(PREFIXE) else { return false };
    let b = reste.as_bytes();
    b.len() == 11
        && b[5] == b'-'
        && b.iter().enumerate().all(|(i, c)| i == 5 || ALPHABET.contains(c))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// RFC 4231, cas 2 : la construction HMAC-SHA-256 utilisée est la bonne.
    #[test]
    fn hmac_sha256_vecteur_de_reference() {
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(b"Jefe").unwrap();
        mac.update(b"what do ya want for nothing?");
        let hex: String = mac.finalize().into_bytes().iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(hex, "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
    }

    #[test]
    fn extraction_des_bits_et_ecriture() {
        let mut e = [0u8; 32];
        e[0] = 0b1000_0000;
        assert_eq!(bits(&e, 0, 1), 1);
        assert_eq!(bits(&e, 1, 7), 0);
        e[31] = 0xFF;
        assert_eq!(bits(&e, 250, 6), 0b11_1111);
        assert_eq!(ecrire(0), "EMP-00000-00000");
        assert_eq!(ecrire((1 << 50) - 1), "EMP-ZZZZZ-ZZZZZ");
        assert_eq!(ecrire(1), "EMP-00000-00001");
        assert_eq!(ecrire(31 << 45), "EMP-Z0000-00000");
        assert!(forme_valide("EMP-0A9ZB-XYTRS"));
        for faux in ["EMP-0A9ZB-XYTR", "EMP-0A9ZBXXYTRS", "EMP-0A9IB-XYTRS", "EMP-0a9zb-xytrs", "BENSO-140590-TEC"] {
            assert!(!forme_valide(faux), "{faux}");
        }
    }

    #[test]
    fn normalisation_des_informations() {
        let a = infos("Benali", "Sofia", Some("1990-05-14"), "Technicienne");
        assert_eq!(a, infos(" BÉNALI ", "sofia", Some(" 1990-05-14 "), "TECHNICIENNE"));
        assert_eq!(infos("N’Diaye-Lê", "A", Some("1990-05-14"), "X"), infos("ndiaye le", "a", Some("1990-05-14"), "x"));
        assert_ne!(a, infos("Benali", "Sofia", Some("1990-05-15"), "Technicienne"));
        // Les champs ne se mélangent pas : « AB » + « C » ≠ « A » + « BC ».
        assert_ne!(infos("Ab", "C", Some("1990-05-14"), "X"), infos("A", "Bc", Some("1990-05-14"), "X"));
        // Caractères non latins gardés.
        assert!(infos("علي", "Karim", Some("1990-05-14"), "Technicien").is_some());
        for (n, p, d, f) in [
            ("", "Sofia", Some("1990-05-14"), "T"),
            ("Benali", " - ", Some("1990-05-14"), "T"),
            ("Benali", "Sofia", None, "T"),
            ("Benali", "Sofia", Some("1990-02-30"), "T"),
            ("Benali", "Sofia", Some("14/05/1990"), "T"),
            ("Benali", "Sofia", Some("1990-05-14"), ""),
        ] {
            assert_eq!(infos(n, p, d, f), None, "{n} {p} {d:?} {f}");
        }
    }
}
