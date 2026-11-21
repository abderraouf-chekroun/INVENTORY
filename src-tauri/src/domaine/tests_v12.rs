//! Tests de la version 1.2 (§ 9) : migration 003 depuis une base en version 1 ou 2, affectations,
//! signatures cochées, structures et types de machine modifiables, libellés de l'historique.

use super::classement;
use super::documents;
use super::dossiers::{self, SaisieDossier};
use super::entites;
use super::journal::{self, Evenement};
use super::modeles::{self, Bloc, SaisieModele, TypeBloc};
use super::statuts::Role;
use super::tests::{employe, machine, st};
use super::tests_v11::creer_base_v1;
use super::Kind;
use crate::db;
use crate::etat::Etat;
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};

// ---------- outils ----------

struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!("entites-dossiers-v12-{}", uuid::Uuid::new_v4()));
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

/// Lignes d'une requête, chaque valeur rendue telle quelle (type compris) : pour comparer avant / après.
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

/// Tables dont le contenu ne doit pas changer aux migrations 003 à 005 (les fiches, les dossiers, les documents et le
/// journal sont comparés à part).
const TABLES_INCHANGEES: [&str; 7] = ["parametres", "themes", "categories", "magasin", "modeles", "sous_dossiers", "options"];

/// Vrai si la base est encore en version 3 ou avant (colonne `statut` des dossiers).
fn dossiers_avant_v4(c: &Connection) -> bool {
    compter(c, "SELECT COUNT(*) FROM pragma_table_info('dossiers') WHERE name = 'statut'") == 1
}

fn photo(c: &Connection) -> Vec<Vec<String>> {
    let mut v: Vec<Vec<String>> = TABLES_INCHANGEES.iter().map(|t| contenu(c, &format!("SELECT * FROM {t} ORDER BY 1"))).collect();
    // Fiches : tout sauf l'identifiant des employés, recalculé par la 004 (comparé à part).
    v.push(contenu(
        c,
        "SELECT id, kind, nom, CASE kind WHEN 'b' THEN code END, categorie_id, actif, cree_le, maj_le, libelle, prenom,
                date_naissance, poste, marque, cpu, ram, stockage FROM entites ORDER BY id",
    ));
    // Dossiers : l'état est comparé par son rôle (colonne `statut` jusqu'à la 3, état rattaché ensuite).
    v.push(contenu(
        c,
        if dossiers_avant_v4(c) {
            "SELECT id, nom, annee, theme_id, statut, cree_le, maj_le, clos_le FROM dossiers ORDER BY id"
        } else {
            "SELECT d.id, d.nom, d.annee, d.theme_id, s.role, d.cree_le, d.maj_le, d.clos_le
             FROM dossiers d JOIN statuts s ON s.id = d.statut_id ORDER BY d.id"
        },
    ));
    // Documents : tout sauf les blocs (la 005 y reporte le rattachement des dossiers, comparés à part) et le modèle
    // d'origine (ajouté par la 005).
    v.push(contenu(
        c,
        "SELECT id, dossier_id, sous_dossier_id, nom, origine, source, date_doc, fichier_stocke, fichier_nom, piece_finale,
                cree_le FROM documents ORDER BY id",
    ));
    // Journal : tout sauf le titre (réécrit pour les événements d'affectation), sans les lignes de la 004.
    v.push(contenu(
        c,
        "SELECT id, type, detail, a_id, b_id, dossier_id, date FROM evenements WHERE type <> 'identifiant_recalcule' ORDER BY id",
    ));
    v
}

fn sauvegardes(dossier: &Path, prefixe: &str) -> Vec<PathBuf> {
    let Ok(entrees) = fs::read_dir(dossier.join("sauvegardes")) else { return Vec::new() };
    entrees
        .map(|e| e.unwrap().path())
        .filter(|p| p.file_name().unwrap().to_string_lossy().starts_with(prefixe))
        .collect()
}

fn affectations_brutes(c: &Connection) -> Vec<(i64, i64, String, Option<String>)> {
    let mut s = c.prepare("SELECT a_id, b_id, debut, fin FROM affectations ORDER BY a_id, b_id, id").unwrap();
    s.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap().map(Result::unwrap).collect()
}

fn titres(ev: &[Evenement]) -> Vec<&str> {
    ev.iter().map(|e| e.titre.as_str()).collect()
}

// ---------- migration d'une base en version 2 ----------

/// Document de la version 1.1 : signatures sans `ok` (cadres vides à signer à la main).
const DOC_V2: &str = r#"[{"t":"titre","v":"Fiche d’intervention","niveau":1},{"t":"champ","v":"Motif","val":"Panne d’alimentation"},{"t":"employe","v":"Utilisateur","entiteId":1},{"t":"signature","v":"Visa du demandeur"},{"t":"signature","v":"Intervenant"}]"#;

/// Crée `donnees.sqlite` en version 2 exactement (schémas 001 + 002, modèles standards comme la 1.1),
/// remplie : employés et machines (dont archivés), associations dont certaines reliées par un dossier,
/// dossiers, sous-dossier, documents avec des blocs `signature`, options, journal.
fn creer_base_v2(dossier: &Path) -> PathBuf {
    let chemin = dossier.join("donnees.sqlite");
    let c = Connection::open(&chemin).unwrap();
    c.execute_batch(include_str!("../../migrations/001_init.sql")).unwrap();
    c.execute_batch(include_str!("../../migrations/002_employes_machines.sql")).unwrap();
    modeles::assurer_standards(&c).unwrap();
    c.execute_batch(&format!(
        "INSERT INTO parametres (cle, valeur) VALUES ('donnees_exemple', '0'), ('theme', 'light'), ('densite', 'compact');
         INSERT INTO themes (id, nom, actif) VALUES (10, 'Maintenance', 1);
         INSERT INTO categories (id, kind, nom, actif) VALUES
           (1, 'a', 'Division informatique', 1), (2, 'a', 'Ancienne structure', 0),
           (3, 'b', 'PC de bureau', 1), (4, 'b', 'Ordinateur portable', 1);
         INSERT INTO magasin (id, nom, actif) VALUES (1, 'RAM', 1);
         INSERT INTO entites (id, kind, nom, code, categorie_id, actif, cree_le, maj_le, libelle, prenom, date_naissance, poste,
                              marque, cpu, ram, stockage) VALUES
           (1, 'a', 'Benali', 'BENSO-140590-TEC', 1, 1, '2025-01-02 10:00:00', '2025-01-02 10:00:00', 'BENALI Sofia', 'Sofia', '1990-05-14', 'Technicienne', '', '', '', ''),
           (2, 'a', 'Haddad', NULL, 2, 0, '2025-01-03 10:00:00', '2025-06-03 10:00:00', 'HADDAD Karim', 'Karim', NULL, '', '', '', '', ''),
           (3, 'b', 'PC accueil', 'PC-0101', 3, 1, '2025-01-04 10:00:00', '2025-01-04 10:00:00', 'PC accueil', '', NULL, '', 'Dell OptiPlex 7090', 'Intel Core i5', '16 Go', 'SSD 512 Go'),
           (4, 'b', 'Portable 01', NULL, 4, 1, '2025-01-05 10:00:00', '2025-01-05 10:00:00', 'Portable 01', '', NULL, '', 'HP ProBook', 'Intel Core i5', '8 Go', 'SSD 256 Go'),
           (5, 'b', 'Ancien PC', 'PC-0001', 3, 0, '2025-01-06 10:00:00', '2025-01-06 10:00:00', 'Ancien PC', '', NULL, '', '', '', '', '');
         INSERT INTO associations (a_id, b_id, cree_le) VALUES
           (1, 3, '2025-02-01 09:00:00'), (1, 4, '2025-02-02 09:00:00'), (2, 5, '2025-02-03 09:00:00');
         INSERT INTO dossiers (id, nom, annee, theme_id, statut, a_id, b_id, cree_le, maj_le, clos_le) VALUES
           (1, 'Dossier 2025-01', 2025, 10, 'cours', 1, 3, '2025-03-01 09:00:00', '2025-03-02 09:00:00', NULL),
           (2, 'Dossier 2025-02', 2025, 10, 'clos', 2, 5, '2025-03-03 09:00:00', '2025-04-01 09:00:00', '2025-04-01 09:00:00');
         INSERT INTO sous_dossiers (id, dossier_id, parent_id, nom, cree_le) VALUES (1, 1, NULL, 'Demandes', '2025-03-01 10:00:00');
         INSERT INTO documents (id, dossier_id, sous_dossier_id, nom, origine, source, date_doc, blocs, fichier_stocke, fichier_nom, piece_finale, cree_le) VALUES
           (1, 1, 1, 'Document_01', 'modele', 'Fiche d’intervention informatique', '2025-03-05', '{DOC_V2}', NULL, NULL, 0, '2025-03-05 10:00:00'),
           (2, 2, NULL, 'Document_01', 'modele', 'Fiche d’intervention informatique', '2025-03-06', '{DOC_V2}', NULL, NULL, 1, '2025-03-06 10:00:00');
         INSERT INTO options (id, dossier_id, nom, ok, position) VALUES
           (1, 1, 'Dossier numérisé', 1, 0), (2, 1, 'Contenu vérifié', 0, 1), (3, 2, 'Dossier numérisé', 1, 0);
         INSERT INTO evenements (type, titre, detail, a_id, b_id, dossier_id, date) VALUES
           ('fiche_creee', 'Fiche créée', 'Création de la fiche BENALI Sofia.', 1, NULL, NULL, '2025-01-02 10:00:00'),
           ('association', 'Association HADDAD Karim ↔ PC accueil', 'HADDAD Karim et PC accueil sont associés.', 2, 3, NULL, '2025-01-20 09:00:00'),
           ('dissociation', 'Dissociation HADDAD Karim ↔ PC accueil', 'HADDAD Karim et PC accueil ne sont plus associés.', 2, 3, NULL, '2025-01-25 09:00:00'),
           ('association', 'Association BENALI Sofia ↔ PC accueil', 'BENALI Sofia et PC accueil sont associés.', 1, 3, NULL, '2025-02-01 09:00:00'),
           ('association', 'Association BENALI Sofia ↔ Portable 01', 'BENALI Sofia et Portable 01 sont associés.', 1, 4, NULL, '2025-02-02 09:00:00'),
           ('association', 'Association HADDAD Karim ↔ Ancien PC', 'HADDAD Karim et Ancien PC sont associés.', 2, 5, NULL, '2025-02-03 09:00:00'),
           ('dossier_ouvert', 'Dossier 2025-01 ouvert', 'Maintenance.', 1, 3, 1, '2025-03-01 09:00:00'),
           ('dossier_ouvert', 'Dossier 2025-02 ouvert', 'Maintenance.', 2, 5, 2, '2025-03-03 09:00:00'),
           ('dossier_clos', 'Dossier 2025-02 clôturé', 'Maintenance.', 2, 5, 2, '2025-04-01 09:00:00'),
           ('fiche_archivee', 'Fiche archivée', 'La fiche HADDAD Karim est archivée. Rien n’est supprimé.', 2, NULL, NULL, '2025-06-03 10:00:00');
         PRAGMA user_version = 2;"
    ))
    .unwrap();
    chemin
}

#[test]
fn base_v2_remplie_migree_sans_perte_par_l_ouverture_normale() {
    let t = Temp::new();
    let chemin = creer_base_v2(&t.0);
    let fichiers = t.0.join("fichiers");
    let avant = {
        let c = Connection::open(&chemin).unwrap();
        // La base de test est bien une version 2 acceptée telle quelle par le contrôle d'ouverture.
        db::verifier_base(&c).expect("base v2 conforme");
        photo(&c)
    };
    let nb_evenements = avant.last().unwrap().len() as i64;

    let etat = Etat::ouvrir_dans(t.0.clone()).expect("une base 1.1 conforme est acceptée et migrée");
    let c = etat.conn().unwrap();
    assert_eq!(compter(&c, "PRAGMA user_version"), 6);
    assert_eq!(compter(&c, "PRAGMA foreign_keys"), 1, "clés étrangères réactivées après migration");
    db::verifier_base(&c).expect("la base migrée passe le contrôle d'ouverture");

    // Sauvegarde préalable : la base 1.1 telle quelle.
    let sv = sauvegardes(&t.0, "avant-version-3_");
    assert_eq!(sv.len(), 1);
    let ancienne = Connection::open(sv[0].join("donnees.sqlite")).unwrap();
    assert_eq!(compter(&ancienne, "PRAGMA user_version"), 2);
    assert_eq!(photo(&ancienne), avant);
    assert_eq!(compter(&ancienne, "SELECT COUNT(*) FROM associations"), 3);
    drop(ancienne);

    // Rien n'est perdu ni modifié : fiches, catégories, dossiers, documents (JSON compris), options, journal.
    assert_eq!(photo(&c), avant);
    // § 11.5 : chaque fiche rattachée à un dossier y est désormais nommée (le rattachement lui-même a disparu).
    for (fiche, dossier) in [(1, 1), (3, 1), (2, 2), (5, 2)] {
        let lies = entites::fiche(&c, &fichiers, fiche).unwrap().dossiers;
        assert!(lies.iter().any(|d| d.id == dossier), "fiche {fiche}, dossier {dossier}");
    }

    // Les associations sont devenues des affectations en cours, datées de leur création.
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM sqlite_master WHERE name = 'associations'"), 0);
    assert_eq!(
        affectations_brutes(&c),
        [
            (1, 3, "2025-02-01 09:00:00".to_string(), None),
            (1, 4, "2025-02-02 09:00:00".to_string(), None),
            (2, 5, "2025-02-03 09:00:00".to_string(), None),
        ]
    );
    let f1 = entites::fiche(&c, &fichiers, 1).unwrap();
    assert_eq!(
        f1.affectations.iter().map(|x| (x.entite.id, x.debut.as_str(), x.fin.is_none())).collect::<Vec<_>>(),
        [(4, "2025-02-02 09:00:00", true), (3, "2025-02-01 09:00:00", true)]
    );
    assert_eq!(f1.associees.iter().map(|e| e.libelle.as_str()).collect::<Vec<_>>(), ["PC accueil", "Portable 01"]);
    // § 10.4 : son dossier, et celui de Haddad dont un document la désigne par un bloc « Utilisateur ».
    assert_eq!((f1.dossiers.len(), f1.documents.len()), (2, 2));
    // Fiches archivées : leurs affectations reprises restent visibles.
    let f5 = entites::fiche(&c, &fichiers, 5).unwrap();
    assert_eq!(f5.affectations.iter().map(|x| (x.entite.id, x.entite.actif)).collect::<Vec<_>>(), [(2, false)]);
    for id in 1..=5 {
        entites::fiche(&c, &fichiers, id).unwrap();
    }

    // Journal : intitulés de la 1.2, y compris pour les événements déjà présents, et libellés des liens.
    let ev_b3 = journal::pour_entite(&c, Kind::B, 3).unwrap();
    assert_eq!(
        titres(&ev_b3),
        ["Dossier 2025-01 ouvert", "Affectation de BENALI Sofia", "Fin de l’affectation de HADDAD Karim", "Affectation de HADDAD Karim"]
    );
    assert!(ev_b3.iter().all(|e| e.b_libelle.as_deref() == Some("PC accueil")));
    assert_eq!(ev_b3[2].a_libelle.as_deref(), Some("HADDAD Karim"), "fiche archivée : libellé renseigné");
    assert_eq!((ev_b3[0].dossier_id, ev_b3[0].dossier_nom.as_deref()), (Some(1), Some("Dossier 2025-01")));
    assert!(ev_b3[1..].iter().all(|e| e.dossier_nom.is_none()));
    let ev_a2 = journal::pour_entite(&c, Kind::A, 2).unwrap();
    assert!(titres(&ev_a2).contains(&"Affectation d’Ancien PC"), "{:?}", titres(&ev_a2));
    assert!(titres(&ev_a2).contains(&"Fin de l’affectation de PC accueil"));
    let fiche_creee = journal::pour_entite(&c, Kind::A, 1).unwrap().into_iter().find(|e| e.r#type == "fiche_creee").unwrap();
    assert_eq!((fiche_creee.a_libelle.as_deref(), fiche_creee.b_libelle.as_deref(), fiche_creee.dossier_nom.as_deref()), (Some("BENALI Sofia"), None, None));
    // Titres enregistrés réécrits : plus aucun « Association … ↔ … ».
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM evenements WHERE titre LIKE '%↔%'"), 0);
    let stocke: String = c
        .query_row("SELECT titre FROM evenements WHERE type = 'association' AND a_id = 1 AND b_id = 3", [], |r| r.get(0))
        .unwrap();
    assert_eq!(stocke, "Affectation de PC accueil à BENALI Sofia");

    // Signatures des documents existants : non cochées, sans date ; le JSON stocké n'a pas été touché.
    let d1 = dossiers::detail(&c, &fichiers, 1).unwrap();
    let blocs = d1.documents[0].blocs.clone().unwrap();
    let signatures: Vec<(Option<bool>, Option<&str>)> =
        blocs.iter().filter(|b| b.t == TypeBloc::Signature).map(|b| (b.ok, b.val.as_deref())).collect();
    assert_eq!(signatures, [(Some(false), None), (Some(false), None)]);
    assert_eq!(blocs[1].val.as_deref(), Some("Panne d’alimentation"));
    assert_eq!(blocs[2].entite_id, Some(Some(1)));
    // Le JSON stocké n'a reçu que la machine du dossier (§ 11.5), ajoutée à la fin.
    let json: String = c.query_row("SELECT blocs FROM documents WHERE id = 1", [], |r| r.get(0)).unwrap();
    assert_eq!(json, DOC_V2.replacen("]", ",{\"t\":\"machine\",\"v\":\"Machine\",\"entiteId\":3}]", 1));
    // … et se cochent normalement.
    let mut saisie = blocs.clone();
    saisie[3].ok = Some(true);
    documents::enregistrer_blocs(&c, 1, &saisie).unwrap();
    let relu = documents::lire(&c, &fichiers, 1).unwrap().blocs.unwrap();
    assert_eq!(relu[3].ok, Some(true));
    assert!(relu[3].val.is_some());

    // Retirer une affectation dont la paire est nommée dans un dossier : possible ; le dossier reste lié.
    entites::dissocier(&c, 1, 3).unwrap();
    let citees: Vec<i64> = dossiers::detail(&c, &fichiers, 1).unwrap().entites_citees.iter().map(|e| e.id).collect();
    assert_eq!(citees, [1, 3]);
    let nb_modeles = compter(&c, "SELECT COUNT(*) FROM modeles");
    drop(c);
    drop(etat);

    // Relance : la version 5 est acceptée telle quelle, rien n'est refait.
    let etat = Etat::ouvrir_dans(t.0.clone()).expect("la base migrée est acceptée au lancement suivant");
    let c = etat.conn().unwrap();
    assert_eq!(compter(&c, "PRAGMA user_version"), 6);
    assert_eq!(sauvegardes(&t.0, "avant-version-").len(), 1, "aucune nouvelle sauvegarde");
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM affectations"), 3);
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM affectations WHERE fin IS NULL"), 2);
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM modeles"), nb_modeles);
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM entites"), 5);
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM documents"), 2);
    // + 1 : l'ancien identifiant de Benali (migration 004) ; + 1 : la fin d'affectation ci-dessus.
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM evenements"), nb_evenements + 2);
    assert_eq!(documents::lire(&c, &fichiers, 1).unwrap().blocs.unwrap()[3].ok, Some(true));
}

#[test]
fn base_v1_migree_jusqu_a_la_version_courante() {
    let t = Temp::new();
    creer_base_v1(&t.0);
    let fichiers = t.0.join("fichiers");
    let etat = Etat::ouvrir_dans(t.0.clone()).expect("une base 1.0 conforme est acceptée et migrée");
    let c = etat.conn().unwrap();
    assert_eq!(compter(&c, "PRAGMA user_version"), 6);
    // Une seule sauvegarde, celle de la base 1.0 avant toute migration.
    let sv = sauvegardes(&t.0, "avant-version-");
    assert_eq!(sv.len(), 1);
    assert_eq!(compter(&Connection::open(sv[0].join("donnees.sqlite")).unwrap(), "PRAGMA user_version"), 1);
    assert_eq!(
        affectations_brutes(&c),
        [(1, 3, "2025-01-10 10:00:00".to_string(), None), (2, 4, "2025-01-11 10:00:00".to_string(), None)]
    );
    let f = entites::fiche(&c, &fichiers, 1).unwrap();
    assert_eq!(f.associees.iter().map(|e| e.id).collect::<Vec<_>>(), [3]);
    assert_eq!(f.affectations.len(), 1);
    let ev = journal::pour_entite(&c, Kind::A, 1).unwrap();
    let assoc = ev.iter().find(|e| e.r#type == "association").unwrap();
    assert_eq!((assoc.titre.as_str(), assoc.b_libelle.as_deref()), ("Affectation de Poste 01", Some("Poste 01")));
    let ouvert = ev.iter().find(|e| e.r#type == "dossier_ouvert").unwrap();
    assert_eq!(ouvert.dossier_nom.as_deref(), Some("Dossier 2025-01"));
    // Le dossier clôturé de la paire (2, 4) n'empêche pas de retirer l'affectation.
    entites::dissocier(&c, 2, 4).unwrap();
    drop(c);
    drop(etat);

    let etat = Etat::ouvrir_dans(t.0.clone()).unwrap();
    let c = etat.conn().unwrap();
    assert_eq!(compter(&c, "PRAGMA user_version"), 6);
    assert_eq!(sauvegardes(&t.0, "avant-version-").len(), 1);
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM affectations"), 2);
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM affectations WHERE fin IS NULL"), 1);
}

#[test]
fn base_v2_non_conforme_refusee_et_v3_modifiee_refusee() {
    // Version 2 avec une table inconnue : refusée, fichier intact, aucune sauvegarde ni migration.
    let t = Temp::new();
    let chemin = creer_base_v2(&t.0);
    Connection::open(&chemin).unwrap().execute_batch("CREATE TABLE intruse (x);").unwrap();
    let avant = fs::read(&chemin).unwrap();
    assert_eq!(Etat::ouvrir_dans(t.0.clone()).err().unwrap().code, "base_refusee");
    assert_eq!(fs::read(&chemin).unwrap(), avant);
    assert!(sauvegardes(&t.0, "avant-version-").is_empty());
    // Version 3 dont la table des affectations a perdu son index d'unicité : refusée.
    let t = Temp::new();
    creer_base_v2(&t.0);
    drop(Etat::ouvrir_dans(t.0.clone()).unwrap());
    Connection::open(t.0.join("donnees.sqlite")).unwrap().execute_batch("DROP INDEX affectations_en_cours;").unwrap();
    assert_eq!(Etat::ouvrir_dans(t.0.clone()).err().unwrap().code, "base_refusee");
    // Version 3 où la table des associations réapparaît : refusée.
    let t = Temp::new();
    creer_base_v2(&t.0);
    drop(Etat::ouvrir_dans(t.0.clone()).unwrap());
    Connection::open(t.0.join("donnees.sqlite"))
        .unwrap()
        .execute_batch("CREATE TABLE associations (a_id INTEGER, b_id INTEGER, cree_le TEXT);")
        .unwrap();
    assert_eq!(Etat::ouvrir_dans(t.0.clone()).err().unwrap().code, "base_refusee");
}

// ---------- structures et types de machine (§ 9.1) ----------

#[test]
fn categories_renommees_et_supprimees() {
    let c = db::ouvrir_memoire().unwrap();
    let s1 = classement::categorie_creer(&c, Kind::A, "Division informatique").unwrap();
    let s2 = classement::categorie_creer(&c, Kind::A, "Département maintenance").unwrap();
    let t1 = classement::categorie_creer(&c, Kind::B, "PC de bureau").unwrap();
    assert_eq!(s1.nb_fiches, 0);
    let e1 = entites::creer(&c, &employe(s1.id, "Benali", "Sofia", Some("1990-05-14"), "Technicienne")).unwrap();
    let e2 = entites::creer(&c, &employe(s1.id, "Haddad", "Karim", Some("1985-11-02"), "Ingénieur")).unwrap();
    let e3 = entites::creer(&c, &employe(s1.id, "Cherif", "Amine", Some("1991-02-03"), "Agent")).unwrap();
    entites::basculer(&c, e3.id).unwrap();
    entites::creer(&c, &machine(t1.id, "PC accueil", None)).unwrap();

    // nbFiches : actives et archivées, par catégorie.
    let liste = classement::categories_lister(&c, Kind::A).unwrap();
    assert_eq!(liste.iter().map(|x| (x.id, x.nb_fiches)).collect::<Vec<_>>(), [(s1.id, 3), (s2.id, 0)]);
    assert_eq!(classement::categories_lister(&c, Kind::B).unwrap()[0].nb_fiches, 1);
    let v = serde_json::to_value(&liste[0]).unwrap();
    assert_eq!(v["nbFiches"], 3);

    // Renommer : s'applique partout ; doublon refusé dans le même répertoire (casse ignorée), permis ailleurs.
    let r = classement::categorie_renommer(&c, s1.id, "  Division des systèmes d’information ").unwrap();
    assert_eq!((r.nom.as_str(), r.nb_fiches, r.actif), ("Division des systèmes d’information", 3, true));
    assert_eq!(entites::lire(&c, e1.id).unwrap().categorie, "Division des systèmes d’information");
    // Casse ignorée, lettres accentuées comprises.
    let e = classement::categorie_renommer(&c, s2.id, "DIVISION DES SYSTÈMES D’INFORMATION").unwrap_err();
    assert_eq!((e.code.as_str(), e.message.as_str()), ("doublon", "Cette structure existe déjà."));
    assert_eq!(classement::categorie_creer(&c, Kind::A, "division des systèmes d’information").unwrap_err().code, "doublon");
    let e = classement::categorie_renommer(&c, t1.id, "Département maintenance");
    assert!(e.is_ok(), "un type de machine peut porter le nom d'une structure");
    let e = classement::categorie_creer(&c, Kind::B, "département MAINTENANCE").unwrap_err();
    assert_eq!((e.code.as_str(), e.message.as_str()), ("doublon", "Ce type de machine existe déjà."));
    // Changer la casse de son propre nom, ou le garder : permis.
    assert_eq!(classement::categorie_renommer(&c, s2.id, "DÉPARTEMENT maintenance").unwrap().nom, "DÉPARTEMENT maintenance");
    assert_eq!(classement::categorie_renommer(&c, s2.id, "DÉPARTEMENT maintenance").unwrap().nom, "DÉPARTEMENT maintenance");
    assert_eq!(classement::categorie_renommer(&c, s2.id, " ").unwrap_err().code, "saisie_invalide");
    assert_eq!(classement::categorie_renommer(&c, 999, "X").unwrap_err().code, "introuvable");
    // Une catégorie archivée se renomme aussi.
    classement::categorie_basculer(&c, s2.id).unwrap();
    assert!(!classement::categorie_renommer(&c, s2.id, "Maintenance").unwrap().actif);

    // Supprimer : refusé tant qu'une fiche, active ou archivée, y appartient ; le message dit combien.
    let e = classement::categorie_supprimer(&c, s1.id).unwrap_err();
    assert_eq!(e.code, "categorie_utilisee");
    assert_eq!(
        e.message,
        "Cette structure contient encore 3 employés, dont 1 archivé. Déplacez-les dans une autre structure avant de la supprimer."
    );
    let e = classement::categorie_supprimer(&c, t1.id).unwrap_err();
    assert_eq!(
        e.message,
        "Ce type de machine contient encore 1 machine. Déplacez-la dans un autre type de machine avant de le supprimer."
    );
    // Déplacer les fiches (l'archivée comprise) vide la structure.
    let s3 = classement::categorie_creer(&c, Kind::A, "Accueil").unwrap();
    entites::modifier(&c, e1.id, &employe(s3.id, "Benali", "Sofia", Some("1990-05-14"), "Technicienne")).unwrap();
    entites::modifier(&c, e2.id, &employe(s3.id, "Haddad", "Karim", Some("1985-11-02"), "Ingénieur")).unwrap();
    let e = classement::categorie_supprimer(&c, s1.id).unwrap_err();
    assert_eq!(
        e.message,
        "Cette structure contient encore 1 employé, dont 1 archivé. Déplacez-le dans une autre structure avant de la supprimer."
    );
    entites::modifier(&c, e3.id, &employe(s3.id, "Cherif", "Amine", Some("1991-02-03"), "Agent")).unwrap();
    classement::categorie_supprimer(&c, s1.id).unwrap();
    assert_eq!(classement::categorie_lire(&c, s1.id).unwrap_err().code, "introuvable");
    assert_eq!(classement::categories_lister(&c, Kind::A).unwrap().len(), 2);
    // Une catégorie vide et archivée se supprime aussi ; une catégorie inconnue : introuvable.
    classement::categorie_supprimer(&c, s2.id).unwrap();
    assert_eq!(classement::categorie_supprimer(&c, s2.id).unwrap_err().code, "introuvable");
    assert_eq!(classement::categorie_lire(&c, s3.id).unwrap().nb_fiches, 3);
}

// ---------- signatures (§ 9.2) ----------

#[test]
fn signature_cochee_datee_par_le_back() {
    let c = db::ouvrir_memoire().unwrap();
    let tmp = Temp::new();
    let theme = classement::theme_creer(&c, "Thème").unwrap().id;
    let m = modeles::creer(&c).unwrap();
    let m = modeles::enregistrer(
        &c,
        m.id,
        &SaisieModele {
            nom: "Visas".into(),
            theme_id: m.theme_id,
            blocs: vec![
                Bloc::nouveau(TypeBloc::Champ, "Motif"),
                // Une valeur envoyée dans le modèle est ignorée.
                Bloc { ok: Some(true), val: Some("2020-01-01".into()), ..Bloc::nouveau(TypeBloc::Signature, "Visa du demandeur") },
                Bloc::nouveau(TypeBloc::Signature, "Intervenant"),
            ],
        },
    )
    .unwrap();
    assert!(m.blocs[1].ok.is_none() && m.blocs[1].val.is_none());
    let d = dossiers::creer(
        &c,
        &SaisieDossier { nom: "D".into(), annee: 2026, theme_id: theme, statut_id: None },
    )
    .unwrap();
    let doc = documents::creer_depuis_modele(&c, &tmp.0, d.id, None, m.id, false).unwrap();
    let blocs = doc.blocs.unwrap();
    assert_eq!((blocs[1].ok, blocs[1].val.as_deref()), (Some(false), None), "nouveau document : non signé");
    let json = serde_json::to_value(&blocs).unwrap();
    assert_eq!(json[1]["ok"], false);

    let relu = || documents::lire(&c, &tmp.0, doc.id).unwrap().blocs.unwrap();
    let enregistrer = |f: &dyn Fn(&mut Vec<Bloc>)| {
        let mut b = relu();
        f(&mut b);
        documents::enregistrer_blocs(&c, doc.id, &b)
    };

    // Cocher : le back pose la date, celle envoyée par le front est ignorée.
    let avant = super::maintenant();
    enregistrer(&|b| {
        b[1].ok = Some(true);
        b[1].val = Some("1999-12-31 00:00:00".into());
    })
    .unwrap();
    let apres = super::maintenant();
    let date = relu()[1].val.clone().expect("date de signature");
    assert!(date >= avant && date <= apres, "{date}");
    assert_eq!(relu()[2].ok, Some(false));

    // Date conservée tant que la case reste cochée, même si le front envoie autre chose ou rien.
    c.execute(
        "UPDATE documents SET blocs = json_set(blocs, '$[1].val', '2026-01-15 09:30:00') WHERE id = ?1",
        [doc.id],
    )
    .unwrap();
    enregistrer(&|b| {
        b[0].val = Some("Autre saisie".into());
        b[1].val = Some("2000-01-01 00:00:00".into());
    })
    .unwrap();
    assert_eq!(relu()[1].val.as_deref(), Some("2026-01-15 09:30:00"));
    enregistrer(&|b| b[1].val = None).unwrap();
    assert_eq!((relu()[1].ok, relu()[1].val.as_deref()), (Some(true), Some("2026-01-15 09:30:00")));
    assert_eq!(relu()[0].val.as_deref(), Some("Autre saisie"));

    // Décocher : date effacée ; une date envoyée avec une case décochée est ignorée.
    enregistrer(&|b| {
        b[1].ok = Some(false);
        b[2].val = Some("2026-01-01 00:00:00".into());
    })
    .unwrap();
    let r = relu();
    assert_eq!((r[1].ok, r[1].val.as_deref(), r[2].ok, r[2].val.as_deref()), (Some(false), None, Some(false), None));
    let stocke: String = c.query_row("SELECT blocs FROM documents WHERE id = ?1", [doc.id], |r| r.get(0)).unwrap();
    assert!(!stocke.contains("2026-01-15"), "{stocke}");

    // Recocher : nouvelle date.
    enregistrer(&|b| b[1].ok = Some(true)).unwrap();
    assert!(relu()[1].val.as_deref().is_some_and(|d| d >= avant.as_str()));

    // `ok` absent dans la saisie : non signé.
    enregistrer(&|b| b[1].ok = None).unwrap();
    assert_eq!((relu()[1].ok, relu()[1].val.as_deref()), (Some(false), None));

    // Dossier clôturé : lecture seule, signature comprise.
    dossiers::definir_statut(&c, d.id, st(&c, Role::Clos)).unwrap();
    assert_eq!(enregistrer(&|b| b[1].ok = Some(true)).unwrap_err().code, "dossier_clos");
}

// ---------- historique cliquable (§ 9.4) ----------

#[test]
fn evenements_portent_les_libelles_actuels() {
    let c = db::ouvrir_memoire().unwrap();
    let theme = classement::theme_creer(&c, "Thème").unwrap().id;
    let sa = classement::categorie_creer(&c, Kind::A, "S").unwrap().id;
    let tb = classement::categorie_creer(&c, Kind::B, "T").unwrap().id;
    let a = entites::creer(&c, &employe(sa, "Benali", "Sofia", Some("1990-05-14"), "Technicienne")).unwrap().id;
    let b = entites::creer(&c, &machine(tb, "Ordinateur 01", Some("PC-01"))).unwrap().id;
    entites::associer(&c, a, b).unwrap();
    let d = dossiers::creer(
        &c,
        &SaisieDossier { nom: "Dossier 2026-01".into(), annee: 2026, theme_id: theme, statut_id: None },
    )
    .unwrap();
    // § 11.2 : l'employé est nommé dans un document du dossier, dont les événements entrent dans son historique.
    super::tests::document_nommant(&c, d.id, Some(a), None);
    entites::dissocier(&c, a, b).unwrap();
    // Renommages et archivage après coup : les libellés suivent l'état actuel.
    entites::modifier(&c, b, &machine(tb, "Ordinateur 02", Some("PC-01"))).unwrap();
    dossiers::renommer(&c, d.id, "Dossier renommé").unwrap();
    entites::basculer(&c, b).unwrap();

    let ev_a = journal::pour_entite(&c, Kind::A, a).unwrap();
    let paire: Vec<&Evenement> = ev_a.iter().filter(|e| e.b_id == Some(b)).collect();
    assert!(!paire.is_empty());
    for e in &paire {
        assert_eq!((e.a_libelle.as_deref(), e.b_libelle.as_deref()), (Some("BENALI Sofia"), Some("Ordinateur 02")), "{e:?}");
    }
    let t: Vec<&str> = titres(&ev_a);
    assert!(t.contains(&"Affectation d’Ordinateur 02"), "{t:?}");
    assert!(t.contains(&"Fin de l’affectation d’Ordinateur 02"), "{t:?}");
    let fin = ev_a.iter().find(|e| e.r#type == journal::DISSOCIATION).unwrap();
    assert_eq!(fin.detail, "Fin de l’affectation (identifiant PC-01).");
    assert_eq!(fin.classe, "assoc");
    let ouvert = ev_a.iter().find(|e| e.r#type == journal::DOSSIER_OUVERT).unwrap();
    assert_eq!((ouvert.dossier_id, ouvert.dossier_nom.as_deref()), (Some(d.id), Some("Dossier renommé")));
    // Fiche archivée : son historique et ses libellés restent lisibles.
    let ev_b = journal::pour_entite(&c, Kind::B, b).unwrap();
    assert!(ev_b.iter().all(|e| e.b_libelle.as_deref() == Some("Ordinateur 02")));
    assert!(titres(&ev_b).contains(&"Affectation de BENALI Sofia"));
    // Sérialisation camelCase, null quand rien n'est cité.
    let v = serde_json::to_value(&ev_b).unwrap();
    let creee = v.as_array().unwrap().iter().find(|e| e["type"] == "fiche_creee").unwrap();
    assert_eq!(creee["bLibelle"], "Ordinateur 02");
    assert!(creee["aLibelle"].is_null() && creee["dossierNom"].is_null());
    assert!(creee.get("dossierId").is_some());
}
