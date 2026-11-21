//! Recherche globale (§ 8.4) : employés par nom, prénom ou identifiant ; machines par nom, marque ou identifiant ;
//! dossiers par nom. Sans tenir compte de la casse ni des accents ; 50 résultats au plus par groupe, avec le nombre
//! total de correspondances de chaque groupe (§ 10.2).
//! Une fiche dont l'identifiant est saisi exactement passe en tête de son groupe (le front la présélectionne).
//! Les formes `#0412` et `code 0412` de la version 1.0 restent comprises.

use super::Kind;
use super::dossiers::{self, DossierResume};
use super::entites::{self, Entite, texte_cherchable};
use super::texte::replier;
use crate::error::AppResult;
use rusqlite::Connection;
use serde::Serialize;

pub const MAX_PAR_GROUPE: usize = 50;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultatsRecherche {
    pub a: Vec<Entite>,
    pub b: Vec<Entite>,
    pub dossiers: Vec<DossierResume>,
    /// Nombre total de correspondances de chaque groupe (supérieur à la longueur du groupe s'il y en a davantage).
    pub a_total: usize,
    pub b_total: usize,
    pub dossiers_total: usize,
}

/// Les `MAX_PAR_GROUPE` premiers éléments, et le nombre total.
fn borner<T>(v: Vec<T>) -> (Vec<T>, usize) {
    let total = v.len();
    (v.into_iter().take(MAX_PAR_GROUPE).collect(), total)
}

/// Identifiant saisi sous la forme `#0412`, `code 0412` ou `code#0412` : `0412`. Sinon `None`.
fn identifiant_prefixe(t: &str) -> Option<&str> {
    let reste = if let Some(r) = t.strip_prefix("code") {
        let r2 = r.trim_start();
        if r2.len() == r.len() && !r2.starts_with('#') {
            return None; // « codeur »…
        }
        r2.strip_prefix('#').unwrap_or(r2)
    } else {
        t.strip_prefix('#')?
    };
    (!reste.is_empty()).then_some(reste)
}

/// Longueur maximale prise en compte pour la saisie de recherche (au-delà, elle est tronquée).
pub const MAX_RECHERCHE: usize = 200;

pub fn rechercher(conn: &Connection, q: &str) -> AppResult<ResultatsRecherche> {
    let t = replier(q.trim().chars().take(MAX_RECHERCHE).collect::<String>().trim());
    if t.is_empty() {
        return Ok(ResultatsRecherche { a: vec![], b: vec![], dossiers: vec![], a_total: 0, b_total: 0, dossiers_total: 0 });
    }
    let ident = identifiant_prefixe(&t);
    let filtrer = |kind: Kind| -> AppResult<(Vec<Entite>, usize)> {
        let mut v: Vec<(bool, Entite)> = entites::lister(conn, kind)?
            .into_iter()
            .filter_map(|e| {
                let code = e.code.as_deref().map(replier);
                let exact = code.as_deref().is_some_and(|c| c == t || Some(c) == ident);
                let trouve = exact
                    || texte_cherchable(&e).contains(&t)
                    || ident.is_some_and(|i| code.as_deref().is_some_and(|c| c.contains(i)));
                trouve.then_some((exact, e))
            })
            .collect();
        // Tri stable : les identifiants exacts d'abord, puis l'ordre alphabétique de la liste.
        v.sort_by_key(|(exact, _)| !exact);
        Ok(borner(v.into_iter().map(|(_, e)| e).collect()))
    };
    let (a, a_total) = filtrer(Kind::A)?;
    let (b, b_total) = filtrer(Kind::B)?;
    let (dossiers, dossiers_total) =
        borner(dossiers::lister(conn)?.into_iter().filter(|d| replier(&d.nom).contains(&t)).collect());
    Ok(ResultatsRecherche { a, b, dossiers, a_total, b_total, dossiers_total })
}

#[cfg(test)]
mod tests {
    use super::identifiant_prefixe;

    #[test]
    fn formes_d_identifiant() {
        assert_eq!(identifiant_prefixe("#0412"), Some("0412"));
        assert_eq!(identifiant_prefixe("code 0412"), Some("0412"));
        assert_eq!(identifiant_prefixe("code#0412"), Some("0412"));
        assert_eq!(identifiant_prefixe("0412"), None);
        assert_eq!(identifiant_prefixe("code"), None);
        assert_eq!(identifiant_prefixe("codeur"), None);
        assert_eq!(identifiant_prefixe("#"), None);
    }
}
