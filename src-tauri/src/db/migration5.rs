//! Migration 005 (§ 11.5), partie Rust : rien ne doit être perdu quand les dossiers cessent d'être rattachés à un
//! employé et à une machine.
//!
//! [`avant`] s'exécute avant le script SQL, tant que les colonnes `dossiers.a_id` / `b_id` existent :
//! - chaque document d'un dossier rattaché reçoit ce rattachement dans ses blocs (règles de [`reporter`]) ;
//! - chaque fichier importé reçoit ses deux blocs « Employé concerné » / « Machine concernée », renseignés avec les
//!   fiches de son dossier ;
//! - un dossier rattaché qui n'a aucun document en reçoit un, « Employé et machine du dossier », qui nomme ses fiches ;
//! - un document aux blocs illisibles n'est pas réécrit : son rattachement est gardé par une nomination enregistrée
//!   directement ;
//! - le modèle d'origine de chaque document est retrouvé (avant que des blocs ne soient ajoutés).
//!
//! [`apres`] s'exécute après le script : il pose `modele_id` et remplit la table des nominations, datées de la
//! création de chaque document.

use crate::domaine::documents::blocs_import;
use crate::domaine::modeles::{self, Bloc, TypeBloc};
use crate::domaine::nominations::{self, type_designant};
use crate::domaine::Kind;
use crate::error::AppResult;
use rusqlite::{Connection, params};
use std::collections::{BTreeSet, HashMap};

/// Nom et source du document créé pour un dossier rattaché sans document.
pub const DOCUMENT_RATTACHEMENT: &str = "Employé et machine du dossier";
pub const SOURCE_RATTACHEMENT: &str = "Reprise de la version 1.3";
const TEXTE_RATTACHEMENT: &str = "Ce document a été créé par la mise à jour 1.4 : il garde l’employé et la machine \
                                  auxquels ce dossier était rattaché, pour qu’il reste visible sur leurs fiches.";

/// Libellé des blocs ajoutés aux documents d'un dossier rattaché.
fn libelle_ajoute(kind: Kind) -> &'static str {
    match kind {
        Kind::A => "Employé",
        Kind::B => "Machine",
    }
}

/// Ce que [`avant`] transmet à [`apres`].
#[derive(Debug, Default)]
pub(super) struct Report {
    /// Modèle d'origine retrouvé : (document, modèle).
    modeles: Vec<(i64, i64)>,
    /// Rattachements des documents aux blocs illisibles : (document, fiche, champ, date de création du document).
    nominations: Vec<(i64, i64, &'static str, String)>,
}

/// Vrai si le document a une variable « Employé · … » (`Kind::A`) ou « Machine · … » (`Kind::B`).
fn a_des_variables(blocs: &[Bloc], kind: Kind) -> bool {
    let prefixe = match kind {
        Kind::A => "Employé · ",
        Kind::B => "Machine · ",
    };
    blocs
        .iter()
        .any(|b| b.t == TypeBloc::Variable && modeles::variable_canonique(&b.v).is_some_and(|v| v.starts_with(prefixe)))
}

/// Reporte la fiche `f` d'un dossier (répertoire `kind`) dans les blocs d'un de ses documents ; vrai si les blocs
/// ont changé.
///
/// Un bloc « désigne » une fiche quand il est du bon type et que son `entiteId` est une fiche existante de ce
/// répertoire ; il est « vide » quand il n'a pas d'`entiteId`. Règle du § 11.5 : rien à faire si un bloc désigne déjà
/// `f` ; sinon le premier bloc vide est renseigné ; sinon un bloc est ajouté à la fin.
///
/// Les variables du document doivent garder la valeur qu'elles avaient (la fiche du dossier). Elles se lisent
/// désormais dans le premier bloc qui désigne une fiche (§ 11.1, `fichesDesVariables`) : quand le document a des
/// variables de ce répertoire et qu'un bloc désignant une autre fiche précède, le bloc de `f` est placé juste avant
/// lui (le bloc existant qui désigne `f` y est déplacé, ou le nouveau bloc y est inséré au lieu de la fin).
fn reporter(blocs: &mut Vec<Bloc>, kind: Kind, f: i64, kinds: &HashMap<i64, Kind>) -> bool {
    let t = type_designant(kind);
    let designe = |b: &Bloc| b.t == t && b.entite_id.flatten().is_some_and(|id| kinds.get(&id) == Some(&kind));
    let premier_designe = blocs.iter().position(designe);
    let variables = a_des_variables(blocs, kind);
    if let Some(pf) = blocs.iter().position(|b| designe(b) && b.entite_id.flatten() == Some(f)) {
        return match premier_designe {
            Some(d) if variables && d < pf => {
                let b = blocs.remove(pf);
                blocs.insert(d, b);
                true
            }
            _ => false,
        };
    }
    let nouveau = || Bloc { entite_id: Some(Some(f)), ..Bloc::nouveau(t, libelle_ajoute(kind)) };
    let premier_vide = blocs.iter().position(|b| b.t == t && b.entite_id.flatten().is_none());
    match (premier_vide, premier_designe) {
        (Some(v), Some(d)) if variables && d < v => blocs.insert(d, nouveau()),
        (Some(v), _) => blocs[v].entite_id = Some(Some(f)),
        (None, Some(d)) if variables => blocs.insert(d, nouveau()),
        (None, _) => blocs.push(nouveau()),
    }
    true
}

/// Modèle d'origine d'un document, quand il est sans ambiguïté : parmi les modèles qui portent le nom du document
/// (sa source) et qui existaient à sa création, le seul ; s'il y en a plusieurs, le seul dont la structure (types et
/// libellés des blocs) est celle du document. Un modèle créé après le document ne peut pas en être l'origine, même s'il
/// porte aujourd'hui ce nom : un modèle renommé n'est donc jamais confondu avec celui qui a pris son ancien nom.
fn modele_d_origine(
    modeles_existants: &[ModeleExistant],
    source: &str,
    cree_le: &str,
    structure: Option<&[(TypeBloc, String)]>,
) -> Option<i64> {
    let candidats: Vec<_> =
        modeles_existants.iter().filter(|(_, nom, cree, _)| nom == source && cree.as_str() <= cree_le).collect();
    match candidats.as_slice() {
        [(id, ..)] => Some(*id),
        [] => None,
        _ => {
            let structure = structure?;
            let memes: Vec<_> = candidats.iter().filter(|(_, _, _, s)| s.as_deref() == Some(structure)).collect();
            match memes.as_slice() {
                [(id, ..)] => Some(*id),
                _ => None,
            }
        }
    }
}

/// Modèle existant : identifiant, nom, date de création, structure (absente si ses blocs sont illisibles).
type ModeleExistant = (i64, String, String, Option<Vec<(TypeBloc, String)>>);

fn structure(blocs: &[Bloc]) -> Vec<(TypeBloc, String)> {
    blocs.iter().map(|b| (b.t, b.v.clone())).collect()
}

/// Avant le script SQL (voir le module). Sans transaction (celle de la migration).
pub(super) fn avant(conn: &Connection) -> AppResult<Report> {
    let mut report = Report::default();
    let kinds: HashMap<i64, Kind> = {
        let mut stmt = conn.prepare("SELECT id, kind FROM entites")?;
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?
    };
    // Rattachement de chaque dossier ; une référence vers une fiche absente ou de l'autre répertoire est ignorée.
    let valide = |id: Option<i64>, kind: Kind| id.filter(|i| kinds.get(i) == Some(&kind));
    type Dossier = (i64, Option<i64>, Option<i64>, String);
    let dossiers: Vec<Dossier> = {
        let mut stmt = conn.prepare("SELECT id, a_id, b_id, cree_le FROM dossiers ORDER BY id")?;
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
            .collect::<rusqlite::Result<_>>()?
    };
    let rattachement: HashMap<i64, (Option<i64>, Option<i64>)> =
        dossiers.iter().map(|(id, a, b, _)| (*id, (valide(*a, Kind::A), valide(*b, Kind::B)))).collect();
    let modeles_existants: Vec<ModeleExistant> = {
        let mut stmt = conn.prepare("SELECT id, nom, cree_le, blocs FROM modeles ORDER BY id")?;
        let lignes = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get::<_, String>(3)?)))?
            .collect::<rusqlite::Result<Vec<(i64, String, String, String)>>>()?;
        lignes
            .into_iter()
            .map(|(id, nom, cree, json)| (id, nom, cree, modeles::decoder_blocs(&json).map(|b| structure(&b))))
            .collect()
    };

    type Document = (i64, i64, String, String, String, Option<String>);
    let documents: Vec<Document> = {
        let mut stmt =
            conn.prepare("SELECT id, dossier_id, origine, source, cree_le, blocs FROM documents ORDER BY id")?;
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))?
            .collect::<rusqlite::Result<_>>()?
    };
    let mut dossiers_avec_document = BTreeSet::new();
    for (id, dossier_id, origine, source, cree_le, json) in documents {
        dossiers_avec_document.insert(dossier_id);
        let (a, b) = rattachement.get(&dossier_id).copied().unwrap_or_default();
        let blocs = json.as_deref().and_then(modeles::decoder_blocs);
        if origine == "modele"
            && let Some(m) = modele_d_origine(&modeles_existants, &source, &cree_le, blocs.as_deref().map(structure).as_deref())
        {
            report.modeles.push((id, m));
        }
        let nouveaux = match (origine.as_str(), json, blocs) {
            // Fichier importé : ses deux blocs, renseignés avec les fiches du dossier.
            ("import", None, _) => Some(blocs_import(a, b)),
            (_, _, Some(mut blocs)) => {
                let mut change = false;
                for (kind, f) in [(Kind::A, a), (Kind::B, b)] {
                    if let Some(f) = f {
                        change |= reporter(&mut blocs, kind, f, &kinds);
                    }
                }
                change.then_some(blocs)
            }
            // Blocs illisibles (ou absents d'un document issu d'un modèle) : rien n'est réécrit, le rattachement
            // est gardé par une nomination.
            (_, _, None) => {
                for (kind, f) in [(Kind::A, a), (Kind::B, b)] {
                    if let Some(f) = f {
                        report.nominations.push((id, f, libelle_ajoute(kind), cree_le.clone()));
                    }
                }
                None
            }
        };
        if let Some(blocs) = nouveaux {
            conn.execute(
                "UPDATE documents SET blocs = ?1 WHERE id = ?2",
                params![modeles::encoder_blocs(&blocs, usize::MAX)?, id],
            )?;
        }
    }

    // Dossier rattaché sans aucun document : un document qui nomme ses fiches.
    for (dossier_id, a, b, cree_le) in &dossiers {
        let (a, b) = (valide(*a, Kind::A), valide(*b, Kind::B));
        if dossiers_avec_document.contains(dossier_id) || (a.is_none() && b.is_none()) {
            continue;
        }
        let blocs = [
            vec![Bloc::nouveau(TypeBloc::Texte, TEXTE_RATTACHEMENT)],
            [(TypeBloc::Employe, Kind::A, a), (TypeBloc::Machine, Kind::B, b)]
                .into_iter()
                .map(|(t, kind, f)| Bloc { entite_id: Some(f), ..Bloc::nouveau(t, libelle_ajoute(kind)) })
                .collect(),
        ]
        .concat();
        let date_doc: String = cree_le.chars().take(10).collect();
        conn.execute(
            "INSERT INTO documents (dossier_id, sous_dossier_id, nom, origine, source, date_doc, blocs, piece_finale, cree_le)
             VALUES (?1, NULL, ?2, 'modele', ?3, ?4, ?5, 0, ?6)",
            params![
                dossier_id,
                DOCUMENT_RATTACHEMENT,
                SOURCE_RATTACHEMENT,
                date_doc,
                modeles::encoder_blocs(&blocs, usize::MAX)?,
                cree_le
            ],
        )?;
    }
    Ok(report)
}

/// Après le script SQL (voir le module). Sans transaction (celle de la migration).
pub(super) fn apres(conn: &Connection, report: &Report) -> AppResult<()> {
    for (document_id, modele_id) in &report.modeles {
        conn.execute("UPDATE documents SET modele_id = ?1 WHERE id = ?2", params![modele_id, document_id])?;
    }
    nominations::remplir_tout(conn)?;
    for (document_id, entite_id, champ, depuis) in &report.nominations {
        conn.execute(
            "INSERT OR IGNORE INTO nominations (document_id, entite_id, facon, champ, depuis)
             VALUES (?1, ?2, 'bloc', ?3, ?4)",
            params![document_id, entite_id, champ, depuis],
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn employe(id: Option<i64>) -> Bloc {
        Bloc { entite_id: Some(id), ..Bloc::nouveau(TypeBloc::Employe, "Utilisateur") }
    }

    fn variable() -> Bloc {
        Bloc::nouveau(TypeBloc::Variable, "Employé · Nom")
    }

    fn ids(blocs: &[Bloc]) -> Vec<Option<i64>> {
        blocs.iter().filter(|b| b.t == TypeBloc::Employe).map(|b| b.entite_id.flatten()).collect()
    }

    #[test]
    fn report_du_rattachement_dans_les_blocs() {
        let kinds: HashMap<i64, Kind> = [(1, Kind::A), (2, Kind::A), (9, Kind::B)].into();
        // Déjà désigné : rien.
        let mut b = vec![employe(Some(1))];
        assert!(!reporter(&mut b, Kind::A, 1, &kinds));
        // Bloc vide : renseigné.
        let mut b = vec![employe(None), employe(None)];
        assert!(reporter(&mut b, Kind::A, 1, &kinds));
        assert_eq!(ids(&b), [Some(1), None]);
        // Aucun bloc : ajouté à la fin.
        let mut b = vec![Bloc::nouveau(TypeBloc::Champ, "x")];
        assert!(reporter(&mut b, Kind::A, 1, &kinds));
        assert_eq!((b.len(), b[1].v.as_str(), b[1].entite_id), (2, "Employé", Some(Some(1))));
        // Autre fiche désignée, sans variable : ajouté à la fin.
        let mut b = vec![employe(Some(2))];
        reporter(&mut b, Kind::A, 1, &kinds);
        assert_eq!(ids(&b), [Some(2), Some(1)]);
        // Autre fiche désignée, avec une variable : placé avant elle.
        let mut b = vec![variable(), employe(Some(2))];
        reporter(&mut b, Kind::A, 1, &kinds);
        assert_eq!(ids(&b), [Some(1), Some(2)]);
        // Bloc vide après la fiche d'un autre, avec une variable : nouveau bloc avant l'autre, le vide reste vide.
        let mut b = vec![variable(), employe(Some(2)), employe(None)];
        reporter(&mut b, Kind::A, 1, &kinds);
        assert_eq!(ids(&b), [Some(1), Some(2), None]);
        // Fiche déjà désignée mais après une autre, avec une variable : déplacée, pas dupliquée.
        let mut b = vec![variable(), employe(Some(2)), employe(Some(1))];
        assert!(reporter(&mut b, Kind::A, 1, &kinds));
        assert_eq!(ids(&b), [Some(1), Some(2)]);
        // Une fiche inconnue ou de l'autre répertoire ne compte ni comme désignée ni comme vide.
        let mut b = vec![variable(), employe(Some(9)), employe(Some(77))];
        reporter(&mut b, Kind::A, 1, &kinds);
        assert_eq!(ids(&b), [Some(9), Some(77), Some(1)]);
    }

    #[test]
    fn modele_d_origine_sans_ambiguite() {
        let s = |v: &str| Some(vec![(TypeBloc::Champ, v.to_string())]);
        let m = vec![
            (1, "Fiche".to_string(), "2025-01-01 00:00:00".to_string(), s("a")),
            (2, "Fiche".to_string(), "2025-06-01 00:00:00".to_string(), s("b")),
            (3, "Autre".to_string(), "2025-01-01 00:00:00".to_string(), s("a")),
        ];
        let st = |v: &str| vec![(TypeBloc::Champ, v.to_string())];
        // Seul le modèle 1 existait.
        assert_eq!(modele_d_origine(&m, "Fiche", "2025-03-01 00:00:00", Some(&st("z"))), Some(1));
        // Deux modèles du même nom : départagés par la structure, sinon aucun.
        assert_eq!(modele_d_origine(&m, "Fiche", "2025-07-01 00:00:00", Some(&st("b"))), Some(2));
        assert_eq!(modele_d_origine(&m, "Fiche", "2025-07-01 00:00:00", Some(&st("z"))), None);
        assert_eq!(modele_d_origine(&m, "Fiche", "2025-07-01 00:00:00", None), None);
        // Modèle créé après le document, ou nom inconnu : aucun.
        assert_eq!(modele_d_origine(&m, "Fiche", "2024-01-01 00:00:00", Some(&st("a"))), None);
        assert_eq!(modele_d_origine(&m, "Ancien nom", "2025-07-01 00:00:00", Some(&st("a"))), None);
    }
}
