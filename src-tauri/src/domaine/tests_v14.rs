//! Tests de la version 1.4 (§ 11) : migration 005 sans perte depuis une base en version 4 ou 1, nominations datées,
//! variables lues dans le document, blocs des fichiers importés, suppression d'un modèle, événements.

use super::classement;
use super::copies::Apercu;
use super::documents;
use super::donnees::{self, ModeReinit};
use super::dossiers::{self, SaisieDossier};
use super::entites;
use super::journal;
use super::modeles::{self, Bloc, SaisieModele, TypeBloc};
use super::nominations::{self, Facon, Index};
use super::standards::{FICHE_IDENTIFICATION, FICHE_INTERVENTION};
use super::statuts::Role;
use super::tests::{employe, machine, st};
use super::tests_v11::creer_base_v1;
use super::Kind;
use crate::db;
use crate::etat::Etat;
use rusqlite::{Connection, params};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

// ---------- outils ----------

struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!("entites-dossiers-v14-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&p).unwrap();
        Temp(p)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn compter(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).expect(sql)
}

/// Lignes d'une requête, chaque valeur rendue telle quelle : pour comparer avant / après.
fn contenu(c: &Connection, sql: &str) -> Vec<String> {
    let mut s = c.prepare(sql).expect(sql);
    let n = s.column_count();
    s.query_map([], |r| {
        (0..n)
            .map(|i| r.get::<_, rusqlite::types::Value>(i).map(|v| format!("{v:?}")))
            .collect::<rusqlite::Result<Vec<_>>>()
            .map(|v| v.join(" | "))
    })
    .unwrap()
    .map(Result::unwrap)
    .collect()
}

fn sauvegardes(dossier: &Path, prefixe: &str) -> Vec<PathBuf> {
    let Ok(entrees) = fs::read_dir(dossier.join("sauvegardes")) else { return Vec::new() };
    entrees.map(|e| e.unwrap().path()).filter(|p| p.file_name().unwrap().to_string_lossy().starts_with(prefixe)).collect()
}

fn kinds(c: &Connection) -> BTreeMap<i64, Kind> {
    let mut s = c.prepare("SELECT id, kind FROM entites").unwrap();
    s.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().map(Result::unwrap).collect()
}

fn kind_du_bloc(t: &str) -> Option<Kind> {
    match t {
        "employe" => Some(Kind::A),
        "machine" => Some(Kind::B),
        _ => None,
    }
}

/// Fiche désignée par un bloc décodé, si elle existe et est du bon répertoire.
fn designee(b: &Value, kinds: &BTreeMap<i64, Kind>) -> Option<(Kind, i64)> {
    let kind = kind_du_bloc(b["t"].as_str()?)?;
    let id = b["entiteId"].as_i64()?;
    (kinds.get(&id) == Some(&kind)).then_some((kind, id))
}

/// Fiche du premier bloc de ce répertoire qui en désigne une (règle des variables, § 11.1).
fn premiere(blocs: &[Value], kind: Kind, kinds: &BTreeMap<i64, Kind>) -> Option<i64> {
    blocs.iter().filter_map(|b| designee(b, kinds)).find(|(k, _)| *k == kind).map(|(_, f)| f)
}

fn blocs_decodes(json: Option<&str>) -> Option<Vec<Value>> {
    match serde_json::from_str::<Value>(json?) {
        Ok(Value::Array(v)) => Some(v),
        _ => None,
    }
}

/// Liens d'une fiche : documents et dossiers.
type Liens = BTreeMap<i64, (BTreeSet<i64>, BTreeSet<i64>)>;

/// Liens tels que la version 1.3 les montrait sur les profils (§ 10.4) : employé / machine du dossier, bloc qui
/// désigne la fiche, nom écrit dans une valeur (`avec_texte` : base en version 2 au moins).
fn liens_v13(c: &Connection, avec_texte: bool) -> Liens {
    let kinds = kinds(c);
    let index = avec_texte.then(|| Index::complet(c).unwrap());
    let mut liens: Liens = BTreeMap::new();
    let mut ajouter = |f: i64, doc: Option<i64>, dossier: i64| {
        let e = liens.entry(f).or_default();
        e.0.extend(doc);
        e.1.insert(dossier);
    };
    let dossiers: Vec<(i64, Option<i64>, Option<i64>)> = {
        let mut s = c.prepare("SELECT id, a_id, b_id FROM dossiers").unwrap();
        s.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap().map(Result::unwrap).collect()
    };
    for (id, a, b) in &dossiers {
        for f in [a, b].into_iter().flatten() {
            ajouter(*f, None, *id);
        }
    }
    type Ligne = (i64, i64, Option<i64>, Option<i64>, Option<String>);
    let docs: Vec<Ligne> = {
        let mut s = c
            .prepare("SELECT x.id, x.dossier_id, d.a_id, d.b_id, x.blocs FROM documents x JOIN dossiers d ON d.id = x.dossier_id")
            .unwrap();
        s.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))).unwrap().map(Result::unwrap).collect()
    };
    for (doc, dossier, a, b, json) in docs {
        for f in [a, b].into_iter().flatten() {
            ajouter(f, Some(doc), dossier);
        }
        for bloc in blocs_decodes(json.as_deref()).unwrap_or_default() {
            if let Some((_, f)) = designee(&bloc, &kinds) {
                ajouter(f, Some(doc), dossier);
            }
        }
        if let (Some(index), Some(json)) = (&index, &json) {
            for n in nominations::dans_le_document(json, index, false) {
                ajouter(n.entite_id, Some(doc), dossier);
            }
        }
    }
    liens
}

/// Liens lus sur les profils après la migration.
fn liens_v14(c: &Connection, fichiers: &Path) -> Liens {
    kinds(c)
        .keys()
        .map(|id| {
            let f = entites::fiche(c, fichiers, *id).unwrap();
            (*id, (f.documents.iter().map(|d| d.document.id).collect(), f.dossiers.iter().map(|d| d.id).collect()))
        })
        .collect()
}

fn a_des_variables(blocs: &[Value], kind: Kind) -> bool {
    let prefixe = if kind == Kind::A { "Employé · " } else { "Machine · " };
    blocs.iter().any(|b| {
        b["t"] == "variable" && b["v"].as_str().and_then(modeles::variable_canonique).is_some_and(|v| v.starts_with(prefixe))
    })
}

/// Valeur des variables « Employé · … » / « Machine · … » de chaque document qui en a, en version 1.3 : la fiche du
/// dossier (`None` = « — »).
fn variables_v13(c: &Connection) -> BTreeMap<(i64, Kind), Option<i64>> {
    let kinds = kinds(c);
    type Ligne = (i64, Option<i64>, Option<i64>, Option<String>);
    let mut s = c.prepare("SELECT x.id, d.a_id, d.b_id, x.blocs FROM documents x JOIN dossiers d ON d.id = x.dossier_id").unwrap();
    let lignes: Vec<Ligne> =
        s.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap().map(Result::unwrap).collect();
    let mut v = BTreeMap::new();
    for (doc, a, b, json) in lignes {
        let blocs = blocs_decodes(json.as_deref()).unwrap_or_default();
        for (kind, f) in [(Kind::A, a), (Kind::B, b)] {
            if a_des_variables(&blocs, kind) {
                v.insert((doc, kind), f.filter(|f| kinds.get(f) == Some(&kind)));
            }
        }
    }
    v
}

/// Valeur des variables en version 1.4 (§ 11.1, `fichesDesVariables`) : la fiche du premier bloc qui en désigne une.
fn variables_v14(c: &Connection) -> BTreeMap<(i64, Kind), Option<i64>> {
    let kinds = kinds(c);
    let mut v = BTreeMap::new();
    for (doc, json) in blocs_bruts(c) {
        let blocs = blocs_decodes(json.as_deref()).unwrap_or_default();
        for kind in [Kind::A, Kind::B] {
            if a_des_variables(&blocs, kind) {
                v.insert((doc, kind), premiere(&blocs, kind, &kinds));
            }
        }
    }
    v
}

fn blocs_bruts(c: &Connection) -> BTreeMap<i64, Option<String>> {
    let mut s = c.prepare("SELECT id, blocs FROM documents").unwrap();
    s.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().map(Result::unwrap).collect()
}

fn modele_de(c: &Connection, doc: i64) -> Option<i64> {
    c.query_row("SELECT modele_id FROM documents WHERE id = ?1", [doc], |r| r.get(0)).unwrap()
}

/// Nombre de blocs qui désignent chaque fiche (fiches existantes du bon répertoire).
fn designations(blocs: &[Value], kinds: &BTreeMap<i64, Kind>) -> BTreeMap<i64, usize> {
    let mut n = BTreeMap::new();
    for (_, f) in blocs.iter().filter_map(|b| designee(b, kinds)) {
        *n.entry(f).or_default() += 1;
    }
    n
}

// ---------- migration 005 depuis une base en version 4 remplie ----------

const DOC1: &str = r#"[{"t":"titre","v":"Fiche d’intervention","niveau":1},{"t":"employe","v":"Utilisateur","entiteId":1},{"t":"machine","v":"Matériel","entiteId":10},{"t":"champ","v":"Intervenant","val":"Karim Haddad"},{"t":"signature","v":"Visa","ok":true,"val":"2025-03-05 11:00:00"}]"#;
/// Variables, et un bloc employé qui désigne une autre fiche que l'employé du dossier : le bloc de l'employé du dossier
/// est placé avant lui pour que les variables gardent leur valeur ; le bloc machine vide est renseigné.
const DOC2: &str = r#"[{"t":"variable","v":"Employé · Nom"},{"t":"variable","v":"Entité B · Nom"},{"t":"employe","v":"Utilisateur","entiteId":2},{"t":"machine","v":"Matériel","entiteId":null},{"t":"champ","v":"Demandeur","val":""}]"#;
const DOC5: &str = r#"[{"t":"champ","v":"x","val":"Demande de Sofia Benali"}]"#;
const DOC6: &str = r#"[{"t":"employe","v":"Bénéficiaire","entiteId":null},{"t":"champ","v":"Adresse mail","val":"benali.sofia@exemple.org"}]"#;
const DOC7: &str = r#"[{"t":"zone","v":"Notes","val":"Voir PC-0101."}]"#;
const DOC8: &str = r#"[{"t":"variable","v":"Employé · Prénom"},{"t":"champ","v":"z","val":""}]"#;
const DOC9: &str = r#"[{"t":"variable","v":"Machine · RAM"},{"t":"employe","v":"Utilisateur","entiteId":3},{"t":"machine","v":"Matériel"}]"#;
const DOC11_ILLISIBLE: &str = r#"[{"t":"#;
const DOC13: &str = r#"[{"t":"tableau","v":"","cols":["Qui","Quoi"],"rows":[["Leïla Mansouri","PC-0101"]]}]"#;
/// L'employé du dossier est déjà désigné, mais après un autre, avec une variable : déplacé, pas dupliqué.
const DOC14: &str = r#"[{"t":"variable","v":"Employé · Identifiant"},{"t":"employe","v":"Témoin","entiteId":3},{"t":"employe","v":"Utilisateur","entiteId":1},{"t":"machine","v":"Matériel","entiteId":10}]"#;
const COPIE: &str = "0b1c2d3e-4f50-4617-8899-aabbccddee01.pdf";

/// Identifiants des modèles de la base v4 de test.
struct ModelesV4 {
    intervention: i64,
    identification: i64,
    maison: i64,
    double_x: i64,
}

/// Crée `donnees.sqlite` en version 4 exactement (schémas 001 à 004, modèles standards, clé), remplie de tous les
/// cas : dossiers avec employé et machine, avec l'un des deux, sans aucun, clôturé, rattaché sans document ;
/// documents issus de modèles avec des blocs déjà renseignés, vides, absents ; documents avec seulement des
/// variables ; fichiers importés avec et sans fichier ; blocs illisibles ; noms écrits dans des champs et un tableau ;
/// deux modèles du même nom ; modèle renommé dont l'ancien nom a été repris par un modèle plus récent.
fn creer_base_v4(dossier: &Path) -> (PathBuf, ModelesV4) {
    let chemin = dossier.join("donnees.sqlite");
    let c = Connection::open(&chemin).unwrap();
    for sql in [
        include_str!("../../migrations/001_init.sql"),
        include_str!("../../migrations/002_employes_machines.sql"),
        include_str!("../../migrations/003_affectations.sql"),
        include_str!("../../migrations/004_etats_citations_identifiants.sql"),
    ] {
        c.execute_batch(sql).unwrap();
    }
    modeles::assurer_standards(&c).unwrap();
    super::identifiant::assurer_cle(&c).unwrap();
    c.execute_batch(
        "UPDATE modeles SET cree_le = '2024-12-01 09:00:00', maj_le = '2024-12-01 09:00:00';
         INSERT INTO parametres (cle, valeur) VALUES ('donnees_exemple', '0'), ('theme', 'dark'), ('densite', 'eq');
         INSERT INTO themes (id, nom, actif) VALUES (10, 'Maintenance', 1);
         INSERT INTO categories (id, kind, nom, actif) VALUES (100, 'a', 'Division informatique', 1), (101, 'b', 'PC de bureau', 1);
         INSERT INTO entites (id, kind, nom, code, categorie_id, actif, cree_le, maj_le, libelle, prenom, date_naissance, poste,
                              marque, cpu, ram, stockage) VALUES
           (1, 'a', 'Benali', NULL, 100, 1, '2025-01-02 10:00:00', '2025-01-02 10:00:00', 'BENALI Sofia', 'Sofia', '1990-05-14', 'Technicienne', '', '', '', ''),
           (2, 'a', 'Haddad', NULL, 100, 1, '2025-01-03 10:00:00', '2025-01-03 10:00:00', 'HADDAD Karim', 'Karim', '1985-11-02', 'Ingénieur', '', '', '', ''),
           (3, 'a', 'Cherif', NULL, 100, 1, '2025-01-04 10:00:00', '2025-01-04 10:00:00', 'CHERIF Amine', 'Amine', NULL, '', '', '', '', ''),
           (4, 'a', 'Mansouri', NULL, 100, 0, '2025-01-05 10:00:00', '2025-01-05 10:00:00', 'MANSOURI Leïla', 'Leïla', '1992-03-27', 'Assistante', '', '', '', ''),
           (10, 'b', 'PC accueil', 'PC-0101', 101, 1, '2025-01-06 10:00:00', '2025-01-06 10:00:00', 'PC accueil', '', NULL, '', 'Dell', 'i5', '16 Go', 'SSD'),
           (11, 'b', 'Portable 01', 'LT-0105', 101, 1, '2025-01-07 10:00:00', '2025-01-07 10:00:00', 'Portable 01', '', NULL, '', 'HP', 'i5', '8 Go', 'SSD'),
           (12, 'b', 'Station', 'ST-0001', 101, 1, '2025-01-08 10:00:00', '2025-01-08 10:00:00', 'Station', '', NULL, '', 'HP', 'Xeon', '64 Go', 'SSD');
         INSERT INTO affectations (a_id, b_id, debut, fin) VALUES (1, 10, '2025-02-01 09:00:00', NULL);
         INSERT INTO modeles (id, nom, theme_id, actif, blocs, cree_le, maj_le) VALUES
           (20, 'Fiche maison', 10, 1, '[{\"t\":\"champ\",\"v\":\"Demandeur\"}]', '2025-01-01 09:00:00', '2025-01-01 09:00:00'),
           (21, 'Fiche double', 10, 1, '[{\"t\":\"champ\",\"v\":\"x\"}]', '2025-01-01 09:00:00', '2025-01-01 09:00:00'),
           (22, 'Fiche double', 10, 0, '[{\"t\":\"champ\",\"v\":\"y\"}]', '2025-01-01 09:00:00', '2025-01-01 09:00:00'),
           (23, 'Nouveau nom', 10, 1, '[{\"t\":\"zone\",\"v\":\"Notes\"}]', '2025-01-01 09:00:00', '2025-01-01 09:00:00'),
           (24, 'Ancien nom', 10, 1, '[{\"t\":\"zone\",\"v\":\"Notes\"}]', '2026-01-01 09:00:00', '2026-01-01 09:00:00');
         INSERT INTO dossiers (id, nom, annee, theme_id, statut_id, a_id, b_id, cree_le, maj_le, clos_le) VALUES
           (1, 'Dossier complet', 2025, 10, 1, 1, 10, '2025-03-01 09:00:00', '2025-03-02 09:00:00', NULL),
           (2, 'Dossier employé', 2025, 10, 2, 2, NULL, '2025-03-02 09:00:00', '2025-03-02 09:00:00', NULL),
           (3, 'Dossier machine', 2025, 10, 1, NULL, 11, '2025-03-03 09:00:00', '2025-03-03 09:00:00', NULL),
           (4, 'Dossier libre', 2025, 10, 1, NULL, NULL, '2025-03-04 09:00:00', '2025-03-04 09:00:00', NULL),
           (5, 'Dossier clôturé', 2025, 10, 3, 3, 12, '2025-03-05 09:00:00', '2025-04-01 09:00:00', '2025-04-01 09:00:00'),
           (6, 'Dossier vide', 2025, 10, 1, 1, 11, '2025-03-06 09:00:00', '2025-03-06 09:00:00', NULL),
           (7, 'Dossier abîmé', 2025, 10, 1, 4, 10, '2025-03-07 09:00:00', '2025-03-07 09:00:00', NULL);
         INSERT INTO sous_dossiers (id, dossier_id, parent_id, nom, cree_le) VALUES (1, 1, NULL, 'Demandes', '2025-03-01 10:00:00');
         INSERT INTO options (dossier_id, nom, ok, position) VALUES (1, 'Dossier numérisé', 1, 0), (5, 'Contenu vérifié', 1, 0);
         INSERT INTO evenements (type, titre, detail, a_id, b_id, dossier_id, date) VALUES
           ('fiche_creee', 'Fiche créée', 'Création de la fiche BENALI Sofia.', 1, NULL, NULL, '2025-01-02 10:00:00'),
           ('association', 'Affectation de PC accueil à BENALI Sofia', 'x', 1, 10, NULL, '2025-02-01 09:00:00'),
           ('dossier_ouvert', 'Dossier complet ouvert', 'Maintenance.', 1, 10, 1, '2025-03-01 09:00:00'),
           ('dossier_fiches', 'HADDAD Karim rattaché à Dossier employé', 'Employé du dossier.', 2, NULL, 2, '2025-03-02 09:30:00'),
           ('dossier_clos', 'Dossier clôturé clôturé', 'Maintenance.', 3, 12, 5, '2025-04-01 09:00:00');
         PRAGMA user_version = 4;",
    )
    .unwrap();
    let id = |nom: &str| -> i64 {
        c.query_row("SELECT id FROM modeles WHERE nom = ?1 AND standard IS NOT NULL", [nom], |r| r.get(0)).unwrap()
    };
    let m = ModelesV4 { intervention: id(FICHE_INTERVENTION), identification: id(FICHE_IDENTIFICATION), maison: 20, double_x: 21 };
    // (id, dossier, sous-dossier, origine, source, blocs, fichier, jour)
    type Doc<'a> = (i64, i64, Option<i64>, &'a str, &'a str, Option<&'a str>, Option<&'a str>, &'a str);
    let docs: [Doc<'_>; 14] = [
        (1, 1, Some(1), "modele", FICHE_INTERVENTION, Some(DOC1), None, "2025-03-05"),
        (2, 1, None, "modele", "Fiche maison", Some(DOC2), None, "2025-03-06"),
        (3, 1, Some(1), "import", documents::SOURCE_IMPORT, None, Some(COPIE), "2025-03-07"),
        (4, 1, None, "import", documents::SOURCE_IMPORT, None, None, "2025-03-08"),
        (5, 2, None, "modele", "Fiche double", Some(DOC5), None, "2025-03-09"),
        (6, 2, None, "modele", FICHE_IDENTIFICATION, Some(DOC6), None, "2025-03-10"),
        (7, 3, None, "modele", "Ancien nom", Some(DOC7), None, "2025-03-11"),
        (8, 4, None, "modele", "Fiche double", Some(DOC8), None, "2025-03-12"),
        (9, 5, None, "modele", "Fiche maison", Some(DOC9), None, "2025-03-13"),
        (10, 5, None, "import", documents::SOURCE_IMPORT, None, None, "2025-03-14"),
        (11, 7, None, "modele", "Fiche maison", Some(DOC11_ILLISIBLE), None, "2025-03-15"),
        (12, 4, None, "import", documents::SOURCE_IMPORT, None, None, "2025-03-16"),
        (13, 1, None, "modele", "Fiche maison", Some(DOC13), None, "2025-03-17"),
        (14, 1, None, "modele", "Fiche maison", Some(DOC14), None, "2025-03-18"),
    ];
    for (id, dossier, sd, origine, source, blocs, fichier, jour) in docs {
        c.execute(
            "INSERT INTO documents (id, dossier_id, sous_dossier_id, nom, origine, source, date_doc, blocs, fichier_stocke,
                                    fichier_nom, piece_finale, cree_le)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, ?11)",
            params![
                id,
                dossier,
                sd,
                format!("Document_{id:02}"),
                origine,
                source,
                jour,
                blocs,
                fichier,
                fichier.map(|_| "scan.pdf"),
                format!("{jour} 10:00:00")
            ],
        )
        .unwrap();
    }
    (chemin, m)
}

const COLONNES_DOCUMENTS: &str =
    "SELECT id, dossier_id, sous_dossier_id, nom, origine, source, date_doc, fichier_stocke, fichier_nom, piece_finale, cree_le FROM documents ORDER BY id";

#[test]
fn base_v4_remplie_migree_sans_perte_par_l_ouverture_normale() {
    let t = Temp::new();
    let (chemin, m) = creer_base_v4(&t.0);
    let fichiers = t.0.join("fichiers");
    let (liens_avant, variables_avant, blocs_avant, kinds_avant, autres_avant) = {
        let c = Connection::open(&chemin).unwrap();
        db::verifier_base(&c).expect("base v4 conforme");
        (
            liens_v13(&c, true),
            variables_v13(&c),
            blocs_bruts(&c),
            kinds(&c),
            [
                contenu(&c, "SELECT * FROM evenements ORDER BY id"),
                contenu(&c, "SELECT id, nom, annee, theme_id, statut_id, cree_le, maj_le, clos_le FROM dossiers ORDER BY id"),
                contenu(&c, COLONNES_DOCUMENTS),
                contenu(&c, "SELECT * FROM entites ORDER BY id"),
                contenu(&c, "SELECT * FROM modeles ORDER BY id"),
                contenu(&c, "SELECT * FROM affectations ORDER BY id"),
                contenu(&c, "SELECT * FROM options ORDER BY id"),
                contenu(&c, "SELECT * FROM sous_dossiers ORDER BY id"),
            ],
        )
    };
    // Le cas « dossier rattaché sans document » est bien présent, et la 1.3 le montrait sur les profils.
    assert!(liens_avant[&1].1.contains(&6) && liens_avant[&11].1.contains(&6));

    let etat = Etat::ouvrir_dans(t.0.clone()).expect("une base 1.3 conforme est acceptée et migrée");
    let c = etat.conn().unwrap();
    assert_eq!(compter(&c, "PRAGMA user_version"), 6);
    assert_eq!(compter(&c, "PRAGMA foreign_keys"), 1);
    db::verifier_base(&c).expect("la base migrée passe le contrôle d'ouverture");
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM pragma_table_info('dossiers') WHERE name IN ('a_id', 'b_id')"), 0);

    // Sauvegarde préalable : la base 1.3 telle quelle.
    let sv = sauvegardes(&t.0, "avant-version-5_");
    assert_eq!(sv.len(), 1);
    let ancienne = Connection::open(sv[0].join("donnees.sqlite")).unwrap();
    assert_eq!(compter(&ancienne, "PRAGMA user_version"), 4);
    assert_eq!(blocs_bruts(&ancienne), blocs_avant);
    drop(ancienne);

    // Rien d'autre ne change : journal, dossiers (hors rattachement), documents (hors blocs), fiches, modèles,
    // affectations, options, sous-dossiers. Seul ajout : le document du dossier rattaché sans document.
    let docs_apres = contenu(&c, COLONNES_DOCUMENTS);
    assert_eq!(docs_apres[..14], autres_avant[2][..]);
    assert_eq!(docs_apres.len(), 15);
    // § 13.3 : la migration 006 ajoute deux colonnes, NULL pour toutes les lignes existantes.
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM evenements WHERE a_libelle_supprime IS NOT NULL OR b_libelle_supprime IS NOT NULL"), 0);
    assert_eq!(contenu(&c, "SELECT id, type, titre, detail, a_id, b_id, dossier_id, date FROM evenements ORDER BY id"), autres_avant[0]);
    assert_eq!(contenu(&c, "SELECT id, nom, annee, theme_id, statut_id, cree_le, maj_le, clos_le FROM dossiers ORDER BY id"), autres_avant[1]);
    assert_eq!(contenu(&c, "SELECT * FROM entites ORDER BY id"), autres_avant[3]);
    assert_eq!(contenu(&c, "SELECT * FROM modeles ORDER BY id"), autres_avant[4]);
    assert_eq!(contenu(&c, "SELECT * FROM affectations ORDER BY id"), autres_avant[5]);
    assert_eq!(contenu(&c, "SELECT * FROM options ORDER BY id"), autres_avant[6]);
    assert_eq!(contenu(&c, "SELECT * FROM sous_dossiers ORDER BY id"), autres_avant[7]);

    // 1. Fiche par fiche : tous les documents et dossiers liés avant le sont encore, et rien d'autre que le document
    //    créé pour le dossier rattaché sans document.
    let liens_apres = liens_v14(&c, &fichiers);
    for (f, (docs, dossiers)) in &liens_avant {
        let (docs_ap, dossiers_ap) = &liens_apres[f];
        assert!(docs.is_subset(docs_ap), "fiche {f} : documents {docs:?} ⊄ {docs_ap:?}");
        assert!(dossiers.is_subset(dossiers_ap), "fiche {f} : dossiers {dossiers:?} ⊄ {dossiers_ap:?}");
    }
    for (f, (docs_ap, dossiers_ap)) in &liens_apres {
        let (docs, dossiers) = liens_avant.get(f).cloned().unwrap_or_default();
        assert!(docs_ap.difference(&docs).all(|d| *d == 15), "fiche {f} : {docs_ap:?} / {docs:?}");
        assert_eq!(dossiers_ap, &dossiers, "fiche {f}");
    }

    // 2. Les variables de chaque document affichent la même valeur qu'avant.
    let variables_apres = variables_v14(&c);
    assert_eq!(variables_avant.len(), 5);
    for (cle, avant) in &variables_avant {
        let apres = variables_apres[cle];
        match avant {
            Some(f) => assert_eq!(apres, Some(*f), "document {} ({:?})", cle.0, cle.1),
            // « — » en 1.3 (dossier sans cette fiche) : « — », ou la fiche que le document désignait déjà lui-même.
            None => {
                let propre = premiere(&blocs_decodes(blocs_avant[&cle.0].as_deref()).unwrap(), cle.1, &kinds_avant);
                assert!(apres.is_none() || apres == propre, "document {}", cle.0);
            }
        }
    }
    assert_eq!(variables_apres[&(2, Kind::A)], Some(1));
    assert_eq!(variables_apres[&(2, Kind::B)], Some(10));
    assert_eq!(variables_apres[&(14, Kind::A)], Some(1));
    assert_eq!(variables_apres[&(9, Kind::B)], Some(12));
    assert_eq!(variables_apres[&(8, Kind::A)], None);

    // 3. Aucun bloc en double ; seules les fiches du dossier sont ajoutées ; le reste des blocs est intact.
    let blocs_apres = blocs_bruts(&c);
    let rattachement: BTreeMap<i64, (Option<i64>, Option<i64>)> = [
        (1, (Some(1), Some(10))),
        (2, (Some(2), None)),
        (3, (None, Some(11))),
        (4, (None, None)),
        (5, (Some(3), Some(12))),
        (6, (Some(1), Some(11))),
        (7, (Some(4), Some(10))),
    ]
    .into();
    let dossier_de = |doc: i64| -> i64 { c.query_row("SELECT dossier_id FROM documents WHERE id = ?1", [doc], |r| r.get(0)).unwrap() };
    for (doc, avant) in &blocs_avant {
        let apres = &blocs_apres[doc];
        let (a, b) = rattachement[&dossier_de(*doc)];
        let Some(av) = blocs_decodes(avant.as_deref()) else {
            if avant.is_none() {
                // Fichier importé : ses deux blocs, renseignés avec les fiches du dossier.
                let blocs: Vec<Bloc> = serde_json::from_str(apres.as_deref().unwrap()).unwrap();
                assert_eq!(blocs, documents::blocs_import(a, b), "document {doc}");
            } else {
                assert_eq!(apres, avant, "blocs illisibles non réécrits");
            }
            continue;
        };
        let ap = blocs_decodes(apres.as_deref()).unwrap();
        let (dav, dap) = (designations(&av, &kinds_avant), designations(&ap, &kinds_avant));
        for (f, n) in &dap {
            let avant_n = dav.get(f).copied().unwrap_or(0);
            assert!(*n == avant_n || (avant_n == 0 && *n == 1 && (Some(*f) == a || Some(*f) == b)), "document {doc}, fiche {f}");
        }
        assert!(dav.iter().all(|(f, n)| dap.get(f) == Some(n)), "document {doc} : désignation perdue");
        assert!(ap.len() >= av.len() && ap.len() <= av.len() + 2, "document {doc}");
        let hors_fiches =
            |v: &[Value]| -> Vec<Value> { v.iter().filter(|b| kind_du_bloc(b["t"].as_str().unwrap_or("")).is_none()).cloned().collect() };
        assert_eq!(hors_fiches(&ap), hors_fiches(&av), "document {doc} : contenu modifié");
        for f in [a, b].into_iter().flatten() {
            assert!(dap.contains_key(&f), "document {doc} : fiche {f} du dossier non reportée");
        }
    }
    // Cas précis.
    let blocs = |doc: i64| -> Vec<Bloc> { serde_json::from_str(blocs_apres[&doc].as_deref().unwrap()).unwrap() };
    assert_eq!(blocs_apres[&1].as_deref(), Some(DOC1), "déjà renseigné : intact");
    assert_eq!(
        blocs(2).iter().map(|b| (b.t, b.v.clone(), b.entite_id)).collect::<Vec<_>>()[2..],
        [
            (TypeBloc::Employe, "Employé".to_string(), Some(Some(1))),
            (TypeBloc::Employe, "Utilisateur".to_string(), Some(Some(2))),
            (TypeBloc::Machine, "Matériel".to_string(), Some(Some(10))),
            (TypeBloc::Champ, "Demandeur".to_string(), None),
        ]
    );
    assert_eq!(blocs(6)[0].entite_id, Some(Some(2)), "bloc vide renseigné");
    assert_eq!((blocs(7).len(), blocs(7)[1].t, blocs(7)[1].v.as_str()), (2, TypeBloc::Machine, "Machine"));
    assert_eq!(blocs_apres[&8].as_deref(), Some(DOC8), "dossier sans fiche : intact");
    assert_eq!(blocs(9)[2].entite_id, Some(Some(12)), "dossier clôturé : bloc renseigné");
    assert_eq!(blocs(14).iter().filter_map(Bloc::fiche_designee).collect::<Vec<_>>(), [1, 3, 10], "déplacé, pas dupliqué");
    // Le document créé pour le dossier rattaché sans document.
    let (nom, source, dossier, cree_le, date_doc): (String, String, i64, String, String) = c
        .query_row("SELECT nom, source, dossier_id, cree_le, date_doc FROM documents WHERE id = 15", [], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
        })
        .unwrap();
    assert_eq!((nom.as_str(), source.as_str(), dossier), (db::migration5::DOCUMENT_RATTACHEMENT, db::migration5::SOURCE_RATTACHEMENT, 6));
    assert_eq!((cree_le.as_str(), date_doc.as_str()), ("2025-03-06 09:00:00", "2025-03-06"));
    assert_eq!(blocs(15).iter().filter_map(Bloc::fiche_designee).collect::<Vec<_>>(), [1, 11]);
    // Document illisible : son rattachement est gardé par une nomination.
    assert_eq!(
        contenu(&c, "SELECT entite_id, facon, champ, depuis FROM nominations WHERE document_id = 11 ORDER BY entite_id"),
        [
            "Integer(4) | Text(\"bloc\") | Text(\"Employé\") | Text(\"2025-03-15 10:00:00\")",
            "Integer(10) | Text(\"bloc\") | Text(\"Machine\") | Text(\"2025-03-15 10:00:00\")"
        ]
    );

    // 4. Nominations datées de la création du document, avec le champ (colonne pour une cellule de tableau).
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM nominations n JOIN documents x ON x.id = n.document_id WHERE n.depuis <> x.cree_le"), 0);
    assert_eq!(
        contenu(&c, "SELECT entite_id, facon, champ FROM nominations WHERE document_id = 13 ORDER BY entite_id, facon, champ"),
        [
            "Integer(1) | Text(\"bloc\") | Text(\"Employé\")",
            "Integer(4) | Text(\"texte\") | Text(\"Qui\")",
            "Integer(10) | Text(\"bloc\") | Text(\"Machine\")",
            "Integer(10) | Text(\"texte\") | Text(\"Quoi\")",
        ]
    );
    let f2 = entites::fiche(&c, &fichiers, 2).unwrap();
    let doc1 = f2.documents.iter().find(|d| d.document.id == 1).unwrap();
    assert_eq!(
        (doc1.facons.clone(), doc1.champs.clone(), doc1.depuis.as_str()),
        (vec![Facon::Texte], vec!["Intervenant".to_string()], "2025-03-05 10:00:00")
    );

    // 5. Modèle d'origine : retrouvé quand il est sans ambiguïté.
    for (doc, attendu) in [
        (1, Some(m.intervention)),
        (2, Some(m.maison)),
        (5, Some(m.double_x)),
        (6, Some(m.identification)),
        (7, None),
        (8, None),
        (9, Some(m.maison)),
        (3, None),
        (11, Some(m.maison)),
        (15, None),
    ] {
        assert_eq!(modele_de(&c, doc), attendu, "document {doc}");
    }
    assert_eq!(modeles::lire(&c, m.maison).unwrap().nb_documents, 5);
    assert_eq!(modeles::lire(&c, 24).unwrap().nb_documents, 0, "modèle créé après le document : jamais son origine");
    assert_eq!(modeles::supprimer(&c, m.maison).unwrap_err().code, "modele_utilise");

    // 6. Historique : nominations et événements des dossiers liés ; journal d'origine conservé.
    let f1 = entites::fiche(&c, &fichiers, 1).unwrap();
    let nomination = f1.evenements.iter().find(|e| e.r#type == journal::NOMINATION && e.document_id == Some(1)).unwrap();
    assert_eq!(nomination.titre, format!("Nommé dans {FICHE_INTERVENTION} : Document_01"));
    assert_eq!((nomination.champ.as_deref(), nomination.detail.as_str()), (Some("Utilisateur"), "Champ « Utilisateur »"));
    assert_eq!((nomination.dossier_id, nomination.date.as_str()), (Some(1), "2025-03-05 10:00:00"));
    assert!(f1.evenements.iter().any(|e| e.r#type == journal::DOSSIER_OUVERT && e.dossier_id == Some(1)));
    let f3 = entites::fiche(&c, &fichiers, 3).unwrap();
    assert!(f3.evenements.iter().any(|e| e.r#type == journal::DOSSIER_CLOS && e.dossier_id == Some(5)));
    let f2_types: Vec<&str> = f2.evenements.iter().map(|e| e.r#type.as_str()).collect();
    assert!(f2_types.contains(&"dossier_fiches"), "ancien événement de rattachement conservé");
    assert!(!f2_types.contains(&"document_cite"));
    // Tout se lit, et les documents migrés restent modifiables (sauf dans le dossier clôturé, en lecture seule).
    for id in 1..=7 {
        dossiers::detail(&c, &fichiers, id).unwrap();
    }
    for doc in [1, 2, 4, 5, 6, 7, 8, 12, 13, 14, 15] {
        documents::enregistrer_blocs(&c, doc, &blocs(doc)).unwrap();
    }
    assert_eq!(documents::enregistrer_blocs(&c, 9, &blocs(9)).unwrap_err().code, "dossier_clos");
    let import = documents::lire(&c, &fichiers, 3).unwrap();
    assert_eq!((import.origine.as_str(), import.fichier_nom.as_deref()), ("import", Some("scan.pdf")));

    let photo = |c: &Connection| -> Vec<Vec<String>> {
        ["documents", "nominations", "dossiers", "evenements", "modeles", "entites"]
            .iter()
            .map(|t| contenu(c, &format!("SELECT * FROM {t} ORDER BY 1, 2")))
            .collect()
    };
    let apres = photo(&c);
    drop(c);
    drop(etat);

    // 7. Relance : la version 5 est acceptée telle quelle, rien n'est refait.
    let etat = Etat::ouvrir_dans(t.0.clone()).expect("la base migrée est acceptée au lancement suivant");
    let c = etat.conn().unwrap();
    assert_eq!(compter(&c, "PRAGMA user_version"), 6);
    assert_eq!(sauvegardes(&t.0, "avant-version-").len(), 1, "aucune nouvelle sauvegarde");
    assert_eq!(photo(&c), apres);
}

#[test]
fn base_v1_migree_jusqu_a_la_version_5_sans_perte() {
    let t = Temp::new();
    let chemin = creer_base_v1(&t.0);
    let fichiers = t.0.join("fichiers");
    let avant = liens_v13(&Connection::open(&chemin).unwrap(), false);
    let etat = Etat::ouvrir_dans(t.0.clone()).expect("une base 1.0 conforme est acceptée et migrée");
    let c = etat.conn().unwrap();
    assert_eq!(compter(&c, "PRAGMA user_version"), 6);
    db::verifier_base(&c).unwrap();
    assert_eq!(sauvegardes(&t.0, "avant-version-").len(), 1);
    let apres = liens_v14(&c, &fichiers);
    assert!(!avant.is_empty());
    for (f, (docs, dossiers)) in &avant {
        assert!(docs.is_subset(&apres[f].0), "fiche {f}");
        assert!(dossiers.is_subset(&apres[f].1), "fiche {f}");
    }
    // Variables de la 1.0 (« Entité A · Nom »…) : toujours les fiches du dossier.
    let variables = variables_v14(&c);
    assert_eq!((variables[&(1, Kind::A)], variables[&(1, Kind::B)]), (Some(1), Some(3)));
    assert_eq!(modele_de(&c, 1), Some(1));
    drop(c);
    drop(etat);
    let etat = Etat::ouvrir_dans(t.0.clone()).unwrap();
    assert_eq!(compter(&etat.conn().unwrap(), "PRAGMA user_version"), 6);
    assert_eq!(sauvegardes(&t.0, "avant-version-").len(), 1);
}

// ---------- nominations (§ 11.2) ----------

struct Mini {
    c: Connection,
    theme: i64,
    cat_a: i64,
    cat_b: i64,
    tmp: Temp,
}

fn mini() -> Mini {
    let c = db::ouvrir_memoire().unwrap();
    let theme = classement::theme_creer(&c, "Thème").unwrap().id;
    let cat_a = classement::categorie_creer(&c, Kind::A, "Division informatique").unwrap().id;
    let cat_b = classement::categorie_creer(&c, Kind::B, "PC de bureau").unwrap().id;
    Mini { c, theme, cat_a, cat_b, tmp: Temp::new() }
}

/// (fiche, façon, champ).
type Nom = (i64, String, String);

fn n(f: i64, facon: &str, champ: &str) -> Nom {
    (f, facon.into(), champ.into())
}

impl Mini {
    fn employe(&self, nom: &str, prenom: &str) -> i64 {
        entites::creer(&self.c, &employe(self.cat_a, nom, prenom, Some("1990-05-14"), "Technicienne")).unwrap().id
    }
    fn machine(&self, nom: &str, code: Option<&str>) -> i64 {
        entites::creer(&self.c, &machine(self.cat_b, nom, code)).unwrap().id
    }
    fn dossier(&self, nom: &str) -> i64 {
        dossiers::creer(&self.c, &SaisieDossier { nom: nom.into(), annee: 2026, theme_id: self.theme, statut_id: None }).unwrap().id
    }
    /// Modèle « Fiche test » : 0 titre, 1 employé « Utilisateur », 2 machine « Matériel », 3 champ « Intervenant »,
    /// 4 zone « Observations », 5 tableau « Qui » / « Quoi », 6 mot-clé.
    fn modele(&self) -> i64 {
        if let Ok(id) = self.c.query_row("SELECT id FROM modeles WHERE nom = 'Fiche test'", [], |r| r.get(0)) {
            return id;
        }
        let m = modeles::creer(&self.c).unwrap();
        let blocs = vec![
            Bloc::nouveau(TypeBloc::Titre, "Fiche test"),
            Bloc::nouveau(TypeBloc::Employe, "Utilisateur"),
            Bloc::nouveau(TypeBloc::Machine, "Matériel"),
            Bloc::nouveau(TypeBloc::Champ, "Intervenant"),
            Bloc::nouveau(TypeBloc::Zone, "Observations"),
            Bloc { cols: Some(vec!["Qui".into(), "Quoi".into()]), ..Bloc::nouveau(TypeBloc::Tableau, "") },
            Bloc::nouveau(TypeBloc::Magasin, "Mot-clé"),
        ];
        modeles::enregistrer(&self.c, m.id, &SaisieModele { nom: "Fiche test".into(), theme_id: m.theme_id, blocs }).unwrap().id
    }
    fn document(&self, dossier: i64) -> i64 {
        documents::creer_depuis_modele(&self.c, &self.tmp.0, dossier, None, self.modele(), false).unwrap().id
    }
    /// Enregistre les valeurs : fiches des blocs 1 et 2, champ, zone, une ligne de tableau (aucune si vide).
    fn remplir(&self, doc: i64, fiches: (Option<i64>, Option<i64>), champ: &str, zone: &str, ligne: [&str; 2]) {
        let mut b = documents::lire(&self.c, &self.tmp.0, doc).unwrap().blocs.unwrap();
        b[1].entite_id = Some(fiches.0);
        b[2].entite_id = Some(fiches.1);
        b[3].val = Some(champ.into());
        b[4].val = Some(zone.into());
        b[5].rows = Some(if ligne == ["", ""] { vec![] } else { vec![ligne.iter().map(|s| s.to_string()).collect()] });
        documents::enregistrer_blocs(&self.c, doc, &b).unwrap();
    }
    /// Nominations d'un document : (fiche, façon, champ, depuis), triées.
    fn nominations(&self, doc: i64) -> Vec<(i64, String, String, String)> {
        let mut s = self
            .c
            .prepare("SELECT entite_id, facon, champ, depuis FROM nominations WHERE document_id = ?1 ORDER BY entite_id, facon, champ")
            .unwrap();
        s.query_map([doc], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap().map(Result::unwrap).collect()
    }
    fn sans_date(&self, doc: i64) -> Vec<Nom> {
        self.nominations(doc).into_iter().map(|(f, fa, ch, _)| (f, fa, ch)).collect()
    }
    fn docs_de(&self, fiche: i64) -> Vec<i64> {
        let mut v: Vec<i64> = entites::fiche(&self.c, &self.tmp.0, fiche).unwrap().documents.iter().map(|d| d.document.id).collect();
        v.sort();
        v
    }
}

#[test]
fn nominations_tenues_a_jour_avec_champ_et_date() {
    let m = mini();
    let sofia = m.employe("Bénali", "Sofia");
    let karim = m.employe("Haddad", "Karim");
    let pc = m.machine("PC accueil", Some("PC-0412"));
    let pc_b = m.machine("PC accueil B", Some("PC-0412-B"));
    let d1 = m.dossier("Dossier 1");
    let doc = m.document(d1);
    // Création : blocs vides, personne n'est nommé.
    assert!(m.nominations(doc).is_empty());

    // Apparition : bloc, champ, zone, cellule (champ = colonne) ; une fiche nommée dans plusieurs champs.
    m.remplir(doc, (Some(sofia), None), "Karim Haddad", "Demande de SOFIA benali.", ["Sofia Benali", "PC-0412"]);
    assert_eq!(
        m.sans_date(doc),
        [
            n(sofia, "bloc", "Utilisateur"),
            n(sofia, "texte", "Observations"),
            n(sofia, "texte", "Qui"),
            n(karim, "texte", "Intervenant"),
            n(pc, "texte", "Quoi")
        ]
    );
    let lie = entites::fiche(&m.c, &m.tmp.0, sofia).unwrap().documents.into_iter().next().unwrap();
    assert_eq!(lie.facons, [Facon::Bloc, Facon::Texte]);
    assert_eq!(lie.champs, ["Observations", "Qui", "Utilisateur"]);
    assert!(lie.document.blocs.is_none());
    let v = serde_json::to_value(&lie).unwrap();
    assert_eq!(v["facons"], serde_json::json!(["bloc", "texte"]));
    assert_eq!(v["champs"][2], "Utilisateur");
    assert!(v["depuis"].is_string() && v["modeleId"].is_i64());

    // Persistance : la date est conservée à travers plusieurs enregistrements ; disparition ; nouvelle apparition.
    m.c.execute("UPDATE nominations SET depuis = '2020-01-01 00:00:00'", []).unwrap();
    m.remplir(doc, (Some(sofia), None), "", "Demande de Sofia Benali, à rappeler.", ["Sofia Benali", "PC-0412"]);
    m.remplir(doc, (Some(sofia), Some(pc)), "", "Demande de Sofia Benali, à rappeler.", ["Sofia Benali", "PC-0412"]);
    let noms = m.nominations(doc);
    assert!(!noms.iter().any(|x| x.0 == karim), "disparue : retirée");
    let date = |f: i64, facon: &str, champ: &str| {
        noms.iter().find(|x| (x.0, x.1.as_str(), x.2.as_str()) == (f, facon, champ)).unwrap().3.clone()
    };
    assert_eq!(date(sofia, "bloc", "Utilisateur"), "2020-01-01 00:00:00");
    assert_eq!(date(sofia, "texte", "Observations"), "2020-01-01 00:00:00");
    assert_eq!(date(pc, "texte", "Quoi"), "2020-01-01 00:00:00");
    assert!(date(pc, "bloc", "Matériel").as_str() > "2020-01-01 00:00:00", "apparue : heure courante");
    // Enregistrement identique : rien n'est réécrit.
    let avant = m.nominations(doc);
    let b = documents::lire(&m.c, &m.tmp.0, doc).unwrap().blocs.unwrap();
    documents::enregistrer_blocs(&m.c, doc, &b).unwrap();
    assert_eq!(m.nominations(doc), avant);

    // Règles anti-faux-positifs du § 10.4 inchangées.
    let doc2 = m.document(d1);
    m.remplir(doc2, (None, None), "Bénali", "Sofiane Benali ; Sofia Benalia ; benali.sofia@exemple.org", ["x", "PC-0412-B"]);
    assert_eq!(m.sans_date(doc2), [n(pc_b, "texte", "Quoi")]);

    // Fiche créée après coup : son nom déjà écrit dans un document plus ancien est retrouvé.
    let doc3 = m.document(d1);
    m.remplir(doc3, (None, None), "Amine Cherif", "Poste LT-0999", ["", ""]);
    assert!(m.nominations(doc3).is_empty());
    let amine = m.employe("Cherif", "Amine");
    assert_eq!(m.sans_date(doc3), [n(amine, "texte", "Intervenant")]);
    // Renommée : la nomination disparaît, puis revient avec le nom d'origine.
    entites::modifier(&m.c, amine, &employe(m.cat_a, "Cherifi", "Amine", Some("1990-05-14"), "Technicienne")).unwrap();
    assert!(m.nominations(doc3).is_empty());
    entites::modifier(&m.c, amine, &employe(m.cat_a, "Cherif", "Amine", Some("1990-05-14"), "Technicienne")).unwrap();
    assert_eq!(m.sans_date(doc3), [n(amine, "texte", "Intervenant")]);
    // Modification sans changement de nom : la date est conservée.
    m.c.execute("UPDATE nominations SET depuis = '2021-01-01 00:00:00' WHERE entite_id = ?1", [amine]).unwrap();
    entites::modifier(&m.c, amine, &employe(m.cat_a, "Cherif", "Amine", Some("1990-05-14"), "Ingénieur")).unwrap();
    assert_eq!(m.nominations(doc3)[0].3, "2021-01-01 00:00:00");
    // Identifiant de machine changé : nominations par l'ancien identifiant retirées, par le nouveau ajoutées ; le bloc
    // qui la désigne reste.
    entites::definir_code(&m.c, pc, "LT-0999").unwrap();
    assert_eq!(m.sans_date(doc3), [n(pc, "texte", "Observations"), n(amine, "texte", "Intervenant")]);
    assert!(!m.nominations(doc).iter().any(|x| x.0 == pc && x.1 == "texte"));
    assert!(m.nominations(doc).iter().any(|x| x.0 == pc && x.1 == "bloc"));
    entites::modifier(&m.c, pc, &machine(m.cat_b, "PC accueil", Some("PC-0412"))).unwrap();
    assert!(m.sans_date(doc).contains(&n(pc, "texte", "Quoi")));
    assert_eq!(m.sans_date(doc3), [n(amine, "texte", "Intervenant")]);

    // Événements : une nomination par document et par champ, à sa date, cliquables ; jamais écrites au journal.
    let nb = compter(&m.c, "SELECT COUNT(*) FROM evenements");
    let ev = entites::fiche(&m.c, &m.tmp.0, sofia).unwrap().evenements;
    let noms_ev: Vec<&journal::Evenement> = ev.iter().filter(|e| e.r#type == journal::NOMINATION).collect();
    assert_eq!(noms_ev.len(), 3, "{noms_ev:?}");
    let e = noms_ev.iter().find(|e| e.champ.as_deref() == Some("Utilisateur")).unwrap();
    assert_eq!((e.titre.as_str(), e.detail.as_str()), ("Nommé dans Fiche test : Document_01", "Champ « Utilisateur »"));
    assert_eq!(
        (e.document_id, e.document_nom.as_deref(), e.dossier_id, e.dossier_nom.as_deref()),
        (Some(doc), Some("Document_01"), Some(d1), Some("Dossier 1"))
    );
    assert_eq!((e.a_id, e.b_id, e.a_libelle.as_deref(), e.date.as_str()), (Some(sofia), None, Some("BÉNALI Sofia"), "2020-01-01 00:00:00"));
    assert!(e.id < 0);
    let ids: BTreeSet<i64> = ev.iter().map(|e| e.id).collect();
    assert_eq!(ids.len(), ev.len(), "identifiants uniques");
    assert!(ev.windows(2).all(|w| w[0].date >= w[1].date));
    assert_eq!(compter(&m.c, "SELECT COUNT(*) FROM evenements"), nb);
    assert_eq!(compter(&m.c, "SELECT COUNT(*) FROM evenements WHERE type IN ('nomination', 'document_cite')"), 0);
    let v = serde_json::to_value(e).unwrap();
    assert_eq!((v["type"].as_str(), v["champ"].as_str()), (Some("nomination"), Some("Utilisateur")));
    let creee = ev.iter().find(|e| e.r#type == journal::FICHE_CREEE).unwrap();
    assert!(serde_json::to_value(creee).unwrap()["champ"].is_null());
    // Événements du dossier dans l'historique des fiches nommées dans ses documents, pas des autres.
    dossiers::definir_statut(&m.c, d1, st(&m.c, Role::Piece)).unwrap();
    let a_l_evenement = |f: i64| {
        entites::fiche(&m.c, &m.tmp.0, f).unwrap().evenements.iter().any(|e| e.r#type == journal::PIECE_MANQUANTE && e.dossier_id == Some(d1))
    };
    assert!(a_l_evenement(sofia) && a_l_evenement(pc) && a_l_evenement(amine));
    let isolee = m.employe("Seule", "Fiche");
    assert!(!a_l_evenement(isolee));
    assert!(entites::fiche(&m.c, &m.tmp.0, sofia).unwrap().evenements.iter().any(|e| e.r#type == journal::DOSSIER_OUVERT));

    // Dossiers liés et fiches nommées du dossier.
    let d2 = m.dossier("Dossier 2");
    let doc4 = m.document(d2);
    m.remplir(doc4, (None, None), "Sofia Benali", "", ["", ""]);
    let lies: BTreeSet<i64> = entites::fiche(&m.c, &m.tmp.0, sofia).unwrap().dossiers.iter().map(|d| d.id).collect();
    assert_eq!(lies, [d1, d2].into());
    assert!(entites::fiche(&m.c, &m.tmp.0, isolee).unwrap().dossiers.is_empty());
    let citees: Vec<i64> = dossiers::detail(&m.c, &m.tmp.0, d1).unwrap().entites_citees.iter().map(|e| e.id).collect();
    assert_eq!(citees, [sofia, amine, pc, pc_b], "employés puis machines, par libellé");
    // Une fiche archivée reste nommée.
    entites::basculer(&m.c, sofia).unwrap();
    assert_eq!(m.docs_de(sofia), [doc, doc4]);

    // Suppression d'un document, puis d'un sous-dossier : leurs nominations partent avec eux.
    documents::supprimer(&m.c, &m.tmp.0, doc4).unwrap();
    assert_eq!(compter(&m.c, &format!("SELECT COUNT(*) FROM nominations WHERE document_id = {doc4}")), 0);
    assert!(!entites::fiche(&m.c, &m.tmp.0, sofia).unwrap().dossiers.iter().any(|d| d.id == d2));
    dossiers::definir_statut(&m.c, d1, st(&m.c, Role::Cours)).unwrap();
    let sd = dossiers::sous_dossier_creer(&m.c, d1, None, "Archives").unwrap();
    let doc5 = documents::creer_depuis_modele(&m.c, &m.tmp.0, d1, Some(sd.id), m.modele(), false).unwrap().id;
    m.remplir(doc5, (Some(karim), None), "", "", ["", ""]);
    assert_eq!(m.docs_de(karim), [doc5]);
    dossiers::sous_dossier_supprimer(&m.c, &m.tmp.0, sd.id).unwrap();
    assert!(m.docs_de(karim).is_empty());
    assert_eq!(compter(&m.c, "SELECT COUNT(*) FROM nominations WHERE document_id NOT IN (SELECT id FROM documents)"), 0);
}

#[test]
fn fichier_importe_porte_deux_blocs() {
    let m = mini();
    let karim = m.employe("Haddad", "Karim");
    let pc = m.machine("PC accueil", Some("PC-0101"));
    let d = m.dossier("Dossier");
    let fichiers = m.tmp.0.join("fichiers");
    fs::create_dir_all(&fichiers).unwrap();
    let src = m.tmp.0.join("scan.pdf");
    fs::write(&src, b"%PDF-1.4\n%%EOF").unwrap();
    let imp = documents::importer(&m.c, &fichiers, d, None, &src, false).unwrap();
    assert_eq!(imp.blocs.as_ref().unwrap(), &documents::blocs_import(None, None));
    assert_eq!(
        serde_json::to_value(imp.blocs.as_ref().unwrap()).unwrap(),
        serde_json::json!([
            {"t": "employe", "v": "Employé concerné", "entiteId": null},
            {"t": "machine", "v": "Machine concernée", "entiteId": null}
        ])
    );
    assert_eq!(imp.modele_id, None);
    // Aperçu, ouverture et export inchangés.
    assert_eq!(imp.apercu, Apercu::Pdf);
    assert!(imp.ouvrable);
    documents::chemin_externe(&m.c, &fichiers, imp.id).unwrap();
    documents::source_export(&m.c, &fichiers, imp.id).unwrap();
    // Les blocs s'enregistrent comme ceux d'un document issu d'un modèle : mêmes contrôles, nominations.
    let mut b = imp.blocs.clone().unwrap();
    b[0].entite_id = Some(Some(karim));
    b[1].entite_id = Some(Some(pc));
    documents::enregistrer_blocs(&m.c, imp.id, &b).unwrap();
    assert_eq!(m.sans_date(imp.id), [n(karim, "bloc", "Employé concerné"), n(pc, "bloc", "Machine concernée")]);
    let mut faux = b.clone();
    faux[0].entite_id = Some(Some(pc));
    assert_eq!(documents::enregistrer_blocs(&m.c, imp.id, &faux).unwrap_err().code, "fiche_incompatible");
    assert_eq!(documents::enregistrer_blocs(&m.c, imp.id, &b[..1]).unwrap_err().code, "blocs_incompatibles");
    let f = entites::fiche(&m.c, &fichiers, karim).unwrap();
    let lie = &f.documents[0];
    assert_eq!((lie.modele_nom.as_str(), lie.champs.clone()), (documents::SOURCE_IMPORT, vec!["Employé concerné".to_string()]));
    assert!(f.evenements.iter().any(|e| e.titre == format!("Nommé dans {} : {}", documents::SOURCE_IMPORT, imp.nom)));
    // Suppression : la copie part, les nominations aussi.
    let copie = PathBuf::from(imp.fichier_chemin.clone().unwrap());
    documents::supprimer(&m.c, &fichiers, imp.id).unwrap();
    assert!(!copie.exists());
    assert!(m.nominations(imp.id).is_empty());
}

#[test]
fn dossier_sans_rattachement() {
    let m = mini();
    let a = m.employe("Benali", "Sofia");
    let b = m.machine("PC accueil", Some("PC-0101"));
    let d = m.dossier("Dossier");
    // Ni affectation, ni fiche dans le journal du dossier ; les blocs d'un nouveau document sont vides.
    assert_eq!(compter(&m.c, "SELECT COUNT(*) FROM affectations"), 0);
    assert_eq!(compter(&m.c, "SELECT COUNT(*) FROM evenements WHERE dossier_id IS NOT NULL AND (a_id IS NOT NULL OR b_id IS NOT NULL)"), 0);
    let doc = documents::creer_depuis_modele(&m.c, &m.tmp.0, d, None, m.modele(), false).unwrap();
    assert!(doc.blocs.unwrap().iter().filter(|x| x.t.kind_designe().is_some()).all(|x| x.entite_id == Some(None)));
    assert_eq!(doc.modele_id, Some(m.modele()));
    // Sérialisation : plus de aId / bId / aNom / bNom ni de a / b.
    let det = serde_json::to_value(dossiers::detail(&m.c, &m.tmp.0, d).unwrap()).unwrap();
    for k in ["a", "b"] {
        assert!(det.get(k).is_none(), "DossierDetail.{k}");
    }
    for k in ["aId", "aNom", "bId", "bNom"] {
        assert!(det["dossier"].get(k).is_none(), "DossierResume.{k}");
    }
    assert!(det["entitesCitees"].as_array().unwrap().is_empty());
    // Une machine ne s'affecte plus que depuis une fiche.
    entites::associer(&m.c, a, b).unwrap();
    assert!(entites::sont_associees(&m.c, a, b).unwrap());
    // La commande retirée ne subsiste nulle part ; la nouvelle est enregistrée.
    assert!(!include_str!("../commandes/mod.rs").contains("definir_fiches"));
    let lib = include_str!("../lib.rs");
    assert!(!lib.contains("dossier_definir_fiches") && lib.contains("commandes::modele_supprimer"));
}

// ---------- suppression d'un modèle (§ 11.4) ----------

#[test]
fn suppression_d_un_modele() {
    let m = mini();
    let d = m.dossier("Dossier");
    let modele = m.modele();
    assert_eq!(modeles::lire(&m.c, modele).unwrap().nb_documents, 0);
    let docs: Vec<i64> = (0..3).map(|_| m.document(d)).collect();
    assert_eq!(modeles::lire(&m.c, modele).unwrap().nb_documents, 3);
    assert!(modeles::lister(&m.c).unwrap().iter().any(|x| x.id == modele && x.nb_documents == 3));
    // Refus avec le nombre, même archivé ; les documents ne sont pas touchés.
    let e = modeles::supprimer(&m.c, modele).unwrap_err();
    assert_eq!(e.code, "modele_utilise");
    assert_eq!(e.message, "3 documents ont été créés à partir de ce modèle. Archivez-le si vous ne voulez plus l’utiliser.");
    modeles::basculer(&m.c, modele).unwrap();
    assert_eq!(modeles::supprimer(&m.c, modele).unwrap_err().code, "modele_utilise");
    documents::supprimer(&m.c, &m.tmp.0, docs[0]).unwrap();
    documents::supprimer(&m.c, &m.tmp.0, docs[1]).unwrap();
    let e = modeles::supprimer(&m.c, modele).unwrap_err();
    assert_eq!(e.message, "1 document a été créé à partir de ce modèle. Archivez-le si vous ne voulez plus l’utiliser.");
    assert_eq!(documents::lire(&m.c, &m.tmp.0, docs[2]).unwrap().modele_id, Some(modele));
    documents::supprimer(&m.c, &m.tmp.0, docs[2]).unwrap();
    // Plus aucun document : supprimé, définitivement.
    modeles::supprimer(&m.c, modele).unwrap();
    assert_eq!(modeles::lire(&m.c, modele).unwrap_err().code, "introuvable");
    assert_eq!(modeles::supprimer(&m.c, modele).unwrap_err().code, "introuvable");
    // La suppression d'un modèle inutilisé ne touche pas les documents des autres modèles.
    let autre = modeles::creer(&m.c).unwrap();
    let doc_autre = documents::creer_depuis_modele(&m.c, &m.tmp.0, d, None, autre.id, false).unwrap();
    let vide = modeles::creer(&m.c).unwrap();
    modeles::supprimer(&m.c, vide.id).unwrap();
    assert_eq!(documents::lire(&m.c, &m.tmp.0, doc_autre.id).unwrap(), doc_autre);
    // Un modèle standard se supprime dans les mêmes conditions ; « Restaurer » le recrée.
    let c = db::ouvrir_memoire().unwrap();
    db::exemple::initialiser(&c, chrono::Local::now().date_naive()).unwrap();
    let standards: Vec<modeles::Modele> = modeles::lister(&c).unwrap().into_iter().filter(|x| x.standard).collect();
    let total: i64 = standards.iter().map(|x| x.nb_documents).sum();
    assert_eq!(total, compter(&c, "SELECT COUNT(*) FROM documents WHERE origine = 'modele'"));
    let utilise = standards.iter().find(|x| x.nb_documents > 0).unwrap();
    assert_eq!(modeles::supprimer(&c, utilise.id).unwrap_err().code, "modele_utilise");
    c.execute("DELETE FROM documents WHERE modele_id = ?1", [utilise.id]).unwrap();
    modeles::supprimer(&c, utilise.id).unwrap();
    let recrees = modeles::restaurer_standards(&c).unwrap();
    assert_eq!(recrees.iter().map(|x| x.nom.as_str()).collect::<Vec<_>>(), [utilise.nom.as_str()]);
    assert_eq!(recrees[0].nb_documents, 0);
    assert_eq!(serde_json::to_value(&recrees[0]).unwrap()["nbDocuments"], 0);
}

// ---------- données d'exemple et réinitialisation ----------

#[test]
fn donnees_d_exemple_nommees_et_reinitialisation() {
    let c = db::ouvrir_memoire().unwrap();
    let jour = chrono::Local::now().date_naive();
    db::exemple::initialiser(&c, jour).unwrap();
    assert!(compter(&c, "SELECT COUNT(*) FROM nominations") > 0);
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM nominations n JOIN documents x ON x.id = n.document_id WHERE n.depuis <> x.cree_le"), 0);
    // Karim Haddad est nommé par son nom écrit dans des documents.
    assert!(
        compter(&c, "SELECT COUNT(*) FROM nominations n JOIN entites e ON e.id = n.entite_id WHERE e.nom = 'Haddad' AND n.facon = 'texte'") > 0
    );
    let t = Temp::new();
    donnees::reinitialiser(&c, &t.0, &t.0.join("fichiers"), ModeReinit::Vide, jour).unwrap();
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM nominations"), 0);
    donnees::reinitialiser(&c, &t.0, &t.0.join("fichiers"), ModeReinit::Exemple, jour).unwrap();
    assert!(compter(&c, "SELECT COUNT(*) FROM nominations") > 0);
}

// ---------- coût ----------

#[test]
fn nominations_rapides_avec_des_milliers_de_documents_et_de_fiches() {
    let m = mini();
    let d = m.dossier("Gros dossier");
    // 2 000 employés et 1 000 machines.
    {
        let tx = m.c.unchecked_transaction().unwrap();
        for i in 0..2000 {
            tx.execute(
                "INSERT INTO entites (kind, nom, categorie_id, actif, cree_le, maj_le, libelle, prenom) VALUES ('a', ?1, ?2, 1, 'x', 'x', ?1, ?3)",
                params![format!("Nom{i}"), m.cat_a, format!("Prenom{i}")],
            )
            .unwrap();
        }
        for i in 0..1000 {
            tx.execute(
                "INSERT INTO entites (kind, nom, code, categorie_id, actif, cree_le, maj_le, libelle) VALUES ('b', ?1, ?2, ?3, 1, 'x', 'x', ?1)",
                params![format!("Poste {i}"), format!("PC-{i:04}"), m.cat_b],
            )
            .unwrap();
        }
        tx.commit().unwrap();
    }
    let sofia = m.employe("Benali", "Sofia");
    let doc = m.document(d);
    let mut b = documents::lire(&m.c, &m.tmp.0, doc).unwrap().blocs.unwrap();
    b[3].val = Some("Intervention réalisée par l’équipe support, rien à signaler.".into());
    b[4].val = Some("Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(20));
    b[5].rows = Some((0..15).map(|i| vec![format!("{i}"), format!("Pièce détachée numéro {i}")]).collect());
    let json = serde_json::to_string(&b).unwrap();
    // 3 000 documents d'environ 4 Ko.
    {
        let tx = m.c.unchecked_transaction().unwrap();
        let mut ins = tx
            .prepare(
                "INSERT INTO documents (dossier_id, nom, origine, source, date_doc, blocs, piece_finale, cree_le)
                 VALUES (?1, ?2, 'modele', 'Fiche test', '2026-01-01', ?3, 0, '2026-01-01 00:00:00')",
            )
            .unwrap();
        for i in 0..3000 {
            ins.execute(params![d, format!("Doc {i}"), json]).unwrap();
        }
        drop(ins);
        tx.commit().unwrap();
    }
    // Enregistrement automatique d'un document (pause de frappe) : 20 saisies successives.
    let debut = Instant::now();
    for i in 0..20 {
        b[3].val = Some(format!("Saisie {i} : Sofia Benali sur PC-0042, Prenom7 Nom7."));
        documents::enregistrer_blocs(&m.c, doc, &b).unwrap();
    }
    let par_enregistrement = debut.elapsed() / 20;
    assert_eq!(m.sans_date(doc).len(), 3);
    // Profil : lecture directe de la table des nominations.
    let debut = Instant::now();
    let f = entites::fiche(&m.c, &m.tmp.0, sofia).unwrap();
    let profil = debut.elapsed();
    assert_eq!(f.documents.len(), 1);
    // Fiche renommée : recalcul sur les 3 001 documents.
    let debut = Instant::now();
    entites::modifier(&m.c, sofia, &employe(m.cat_a, "Benalii", "Sofia", Some("1990-05-14"), "Technicienne")).unwrap();
    let renommage = debut.elapsed();
    assert_eq!(m.sans_date(doc).len(), 2);
    eprintln!("nominations : enregistrement {par_enregistrement:?}, profil {profil:?}, renommage {renommage:?}");
    // Bornes larges : les tests sont compilés sans optimisation.
    assert!(par_enregistrement < Duration::from_millis(500), "{par_enregistrement:?}");
    assert!(profil < Duration::from_millis(500), "{profil:?}");
    assert!(renommage < Duration::from_secs(10), "{renommage:?}");
}
