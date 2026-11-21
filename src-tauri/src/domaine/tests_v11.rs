//! Tests de la version 1.1 (§ 8) : migration d'une base 1.0, employés et identifiant, machines,
//! aide à la saisie, nouveaux blocs, modèles standards, vocabulaire et données d'exemple.

use super::classement;
use super::documents;
use super::dossiers::{self, SaisieDossier};
use super::entites::{self, libelle_employe};
use super::identifiant::forme_valide;
use super::journal;
use super::modeles::{self, Bloc, SaisieModele, TypeBloc};
use super::parametres;
use super::standards::{self, ETAT_DES_BESOINS, FICHE_FORMATAGE, FICHE_IDENTIFICATION, FICHE_INTERVENTION};
use super::statuts::Role;
use super::tableau;
use super::tests::{employe, employe_incomplet, machine};
use super::Kind;
use crate::db;
use crate::etat::Etat;
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};

// ---------- outils ----------

fn base() -> Connection {
    db::ouvrir_memoire().expect("base en mémoire")
}

fn base_exemple() -> Connection {
    let c = base();
    db::exemple::initialiser(&c, chrono::Local::now().date_naive()).expect("données d'exemple");
    c
}

fn compter(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).expect(sql)
}

struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!("entites-dossiers-v11-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&p).unwrap();
        Temp(p)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Base minimale : un thème, une structure, un type de machine.
struct Mini {
    c: Connection,
    theme: i64,
    cat_a: i64,
    cat_b: i64,
}

fn mini() -> Mini {
    let c = base();
    let theme = classement::theme_creer(&c, "Thème").unwrap().id;
    let cat_a = classement::categorie_creer(&c, Kind::A, "Division informatique").unwrap().id;
    let cat_b = classement::categorie_creer(&c, Kind::B, "PC de bureau").unwrap().id;
    Mini { c, theme, cat_a, cat_b }
}

fn id_modele(c: &Connection, nom: &str) -> i64 {
    c.query_row("SELECT id FROM modeles WHERE nom = ?1", [nom], |r| r.get(0)).unwrap_or_else(|_| panic!("{nom}"))
}

// ---------- migration d'une base 1.0 ----------

const MODELE_V1: &str = r#"[{"t":"texte","v":"Bonjour"},{"t":"variable","v":"Entité A · Nom"},{"t":"variable","v":"Entité A · Code"},{"t":"variable","v":"Entité B · Nom"},{"t":"variable","v":"Entité B · Code unique"},{"t":"variable","v":"Date du jour"},{"t":"champ","v":"Champ"},{"t":"case","v":"Validé"},{"t":"magasin","v":"Matériel"},{"t":"tableau","v":"","cols":["Qté","Désignation","Colonne 3"]}]"#;
const DOCUMENT_V1: &str = r#"[{"t":"texte","v":"Bonjour"},{"t":"variable","v":"Entité A · Nom"},{"t":"variable","v":"Entité A · Code"},{"t":"variable","v":"Entité B · Nom"},{"t":"variable","v":"Entité B · Code unique"},{"t":"variable","v":"Date du jour"},{"t":"champ","v":"Champ","val":"Valeur saisie"},{"t":"case","v":"Validé","ok":true},{"t":"magasin","v":"Matériel","val":"RAM"},{"t":"tableau","v":"","cols":["Qté","Désignation","Colonne 3"],"rows":[["2","Clavier",""]]}]"#;
const COPIE_V1: &str = "0b1c2d3e-4f50-4617-8899-aabbccddee01.pdf";

/// Crée `donnees.sqlite` en version 1 exactement (schéma 001), avec des données de toutes sortes.
pub(super) fn creer_base_v1(dossier: &Path) -> PathBuf {
    let chemin = dossier.join("donnees.sqlite");
    let c = Connection::open(&chemin).unwrap();
    c.execute_batch(include_str!("../../migrations/001_init.sql")).unwrap();
    c.execute_batch(&format!(
        "INSERT INTO parametres (cle, valeur) VALUES ('donnees_exemple', '0'), ('theme', 'dark'), ('densite', 'compact');
         INSERT INTO themes (id, nom, actif) VALUES (1, 'Thème A', 1), (2, 'Thème X', 0);
         INSERT INTO categories (id, kind, nom, actif) VALUES (1, 'a', 'Groupe 1', 1), (2, 'b', 'Type 1', 1), (3, 'a', 'Groupe 2', 0);
         INSERT INTO magasin (id, nom, actif) VALUES (1, 'RAM', 1), (2, 'Stockage', 0);
         INSERT INTO entites (id, kind, nom, code, categorie_id, actif, cree_le, maj_le) VALUES
           (1, 'a', 'Martin Durand', '0412', 1, 1, '2025-01-02 10:00:00', '2025-01-03 10:00:00'),
           (2, 'a', 'Sans code', NULL, 3, 0, '2025-01-04 10:00:00', '2025-01-05 10:00:00'),
           (3, 'b', 'Poste 01', '0101', 2, 1, '2025-01-06 10:00:00', '2025-01-06 10:00:00'),
           (4, 'b', 'Poste 02', NULL, 2, 1, '2025-01-07 10:00:00', '2025-01-07 10:00:00'),
           (5, 'a', 'Autre code', '0101', 1, 1, '2025-01-08 10:00:00', '2025-01-08 10:00:00');
         INSERT INTO associations (a_id, b_id, cree_le) VALUES (1, 3, '2025-01-10 10:00:00'), (2, 4, '2025-01-11 10:00:00');
         INSERT INTO modeles (id, nom, theme_id, actif, blocs, cree_le, maj_le) VALUES
           (1, 'Modèle Type 01', 1, 1, '{MODELE_V1}', '2025-01-01 09:00:00', '2025-01-01 09:00:00'),
           (2, 'Modèle archivé', 2, 0, '[{{\"t\":\"texte\",\"v\":\"Ancien\"}}]', '2025-01-01 09:00:00', '2025-01-01 09:00:00');
         INSERT INTO dossiers (id, nom, annee, theme_id, statut, a_id, b_id, cree_le, maj_le, clos_le) VALUES
           (1, 'Dossier 2025-01', 2025, 1, 'cours', 1, 3, '2025-02-01 09:00:00', '2025-02-02 09:00:00', NULL),
           (2, 'Dossier 2025-02', 2025, 1, 'clos', 2, 4, '2025-02-03 09:00:00', '2025-03-01 09:00:00', '2025-03-01 09:00:00');
         INSERT INTO sous_dossiers (id, dossier_id, parent_id, nom, cree_le) VALUES
           (1, 1, NULL, 'Sous-dossier A', '2025-02-01 10:00:00'), (2, 1, 1, 'Niveau 2', '2025-02-01 10:00:00');
         INSERT INTO documents (id, dossier_id, sous_dossier_id, nom, origine, source, date_doc, blocs, fichier_stocke, fichier_nom, piece_finale, cree_le) VALUES
           (1, 1, 2, 'Document_01', 'modele', 'Modèle Type 01', '2025-02-05', '{DOCUMENT_V1}', NULL, NULL, 0, '2025-02-05 10:00:00'),
           (2, 1, NULL, 'Facture', 'import', 'Fichier importé', '2025-02-06', NULL, '{COPIE_V1}', 'scan.pdf', 1, '2025-02-06 10:00:00');
         INSERT INTO options (id, dossier_id, nom, ok, position) VALUES (1, 1, 'Dossier numérisé', 1, 0), (2, 1, 'Contenu vérifié', 0, 1);
         INSERT INTO evenements (type, titre, detail, a_id, b_id, dossier_id, date) VALUES
           ('fiche_creee', 'Fiche créée', 'Création de la fiche Martin Durand.', 1, NULL, NULL, '2025-01-02 10:00:00'),
           ('association', 'Association Martin Durand ↔ Poste 01', 'x', 1, 3, NULL, '2025-01-10 10:00:00'),
           ('dossier_ouvert', 'Dossier 2025-01 ouvert', 'Thème A.', 1, 3, 1, '2025-02-01 09:00:00');
         PRAGMA user_version = 1;"
    ))
    .unwrap();
    chemin
}

fn sauvegardes_avant_migration(dossier: &Path) -> Vec<PathBuf> {
    let Ok(entrees) = fs::read_dir(dossier.join("sauvegardes")) else { return Vec::new() };
    entrees
        .map(|e| e.unwrap().path())
        .filter(|p| p.file_name().unwrap().to_string_lossy().starts_with("avant-version-2_"))
        .collect()
}

#[test]
fn base_v1_migree_sans_perte_par_l_ouverture_normale() {
    let t = Temp::new();
    creer_base_v1(&t.0);
    let fichiers = t.0.join("fichiers");
    let etat = Etat::ouvrir_dans(t.0.clone()).expect("une base 1.0 conforme est acceptée et migrée");
    let c = etat.conn().unwrap();
    assert_eq!(compter(&c, "PRAGMA user_version"), 6);
    let fk: i64 = c.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
    assert_eq!(fk, 1, "clés étrangères réactivées après migration");

    // Sauvegarde de la base 1.0, intacte.
    let sauvegardes = sauvegardes_avant_migration(&t.0);
    assert_eq!(sauvegardes.len(), 1);
    let ancienne = Connection::open(sauvegardes[0].join("donnees.sqlite")).unwrap();
    assert_eq!(compter(&ancienne, "PRAGMA user_version"), 1);
    assert_eq!(compter(&ancienne, "SELECT COUNT(*) FROM entites WHERE code IS NOT NULL"), 3);
    drop(ancienne);

    // Paramètres conservés ; la base n'est pas re-remplie d'exemples.
    let p = parametres::lire(&c).unwrap();
    assert_eq!((p.theme.as_str(), p.densite.as_str(), p.donnees_exemple), ("dark", "compact", false));
    assert!(!db::est_neuve(&c).unwrap());

    // Fiches A → employés à compléter (ancien nom gardé, identifiant absent, ancien code dans le journal).
    let a1 = entites::lire(&c, 1).unwrap();
    assert_eq!((a1.kind, a1.nom.as_str(), a1.libelle.as_str()), (Kind::A, "Martin Durand", "Martin Durand"));
    assert_eq!((a1.code.as_deref(), a1.prenom.as_str(), a1.date_naissance.as_deref(), a1.poste.as_str()), (None, "", None, ""));
    assert_eq!((a1.categorie.as_str(), a1.actif, a1.cree_le.as_str()), ("Groupe 1", true, "2025-01-02 10:00:00"));
    let a2 = entites::lire(&c, 2).unwrap();
    assert!(!a2.actif);
    assert_eq!(a2.categorie, "Groupe 2");
    let ev = journal::pour_entite(&c, Kind::A, 1).unwrap();
    assert!(ev.iter().any(|e| e.detail.contains("Ancien code : 0412")), "{ev:?}");
    assert!(journal::pour_entite(&c, Kind::A, 5).unwrap().iter().any(|e| e.detail.contains("Ancien code : 0101")));
    assert!(!journal::pour_entite(&c, Kind::A, 2).unwrap().iter().any(|e| e.detail.contains("Ancien code")));
    assert!(ev.iter().any(|e| e.titre == "Fiche créée"), "journal d'origine conservé");
    // Fiches B → machines qui gardent leur code comme identifiant.
    let b1 = entites::lire(&c, 3).unwrap();
    assert_eq!((b1.kind, b1.code.as_deref(), b1.libelle.as_str(), b1.marque.as_str()), (Kind::B, Some("0101"), "Poste 01", ""));
    assert_eq!(entites::lire(&c, 4).unwrap().code, None);
    let t_ = tableau::calculer(&c).unwrap();
    assert_eq!(t_.sans_code_a.len(), 3, "tous les employés repris sont à compléter");
    assert_eq!(t_.sans_code_b.len(), 1);

    // Associations (devenues affectations en cours, datées de leur création), dossiers, sous-dossiers,
    // documents, options : tout est là et lisible.
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM affectations WHERE fin IS NULL"), 2);
    assert_eq!(
        compter(&c, "SELECT COUNT(*) FROM affectations WHERE (a_id, b_id, debut) IN (VALUES (1, 3, '2025-01-10 10:00:00'), (2, 4, '2025-01-11 10:00:00'))"),
        2
    );
    let d = dossiers::detail(&c, &fichiers, 1).unwrap();
    // § 11.5 : le rattachement du dossier (Martin Durand, Poste 01) est reporté dans ses documents.
    assert_eq!(d.entites_citees.iter().map(|e| e.id).collect::<Vec<_>>(), [1, 3]);
    assert_eq!((d.sous_dossiers.len(), d.documents.len(), d.options.len()), (2, 2, 2));
    let doc = d.documents.iter().find(|x| x.id == 1).unwrap();
    let mut attendu: Vec<Bloc> = serde_json::from_str(DOCUMENT_V1).unwrap();
    attendu.push(Bloc { entite_id: Some(Some(1)), ..Bloc::nouveau(TypeBloc::Employe, "Employé") });
    attendu.push(Bloc { entite_id: Some(Some(3)), ..Bloc::nouveau(TypeBloc::Machine, "Machine") });
    assert_eq!(doc.modele_id, Some(1));
    assert_eq!(doc.blocs.as_ref().unwrap(), &attendu);
    assert_eq!(doc.blocs.as_ref().unwrap()[6].val.as_deref(), Some("Valeur saisie"));
    let import = d.documents.iter().find(|x| x.id == 2).unwrap();
    assert_eq!((import.fichier_nom.as_deref(), import.piece_finale), (Some("scan.pdf"), true));
    assert_eq!(import.blocs.as_ref().unwrap(), &documents::blocs_import(Some(1), Some(3)));
    let stocke: String = c.query_row("SELECT fichier_stocke FROM documents WHERE id = 2", [], |r| r.get(0)).unwrap();
    assert_eq!(stocke, COPIE_V1);
    let d2 = dossiers::detail(&c, &fichiers, 2).unwrap();
    assert_eq!(d2.dossier.statut.role, Role::Clos);
    // § 11.5 : le dossier clôturé, rattaché à (2, 4) sans aucun document, en a reçu un qui nomme ses fiches.
    assert_eq!(d2.documents.iter().map(|x| x.nom.as_str()).collect::<Vec<_>>(), [db::migration5::DOCUMENT_RATTACHEMENT]);
    assert_eq!(d2.entites_citees.iter().map(|e| e.id).collect::<Vec<_>>(), [2, 4]);
    for id in 1..=5 {
        entites::fiche(&c, &fichiers, id).unwrap();
    }

    // Anciennes variables : toujours reconnues dans le modèle et le document existants.
    for (ancien, nouveau) in modeles::VARIABLES_ANCIENNES {
        assert_eq!(modeles::variable_canonique(ancien), Some(nouveau));
    }
    let m1 = modeles::lire(&c, 1).unwrap();
    assert_eq!(m1.blocs, serde_json::from_str::<Vec<Bloc>>(MODELE_V1).unwrap());
    let reenregistre = modeles::enregistrer(&c, 1, &SaisieModele { nom: m1.nom.clone(), theme_id: m1.theme_id, blocs: m1.blocs.clone() }).unwrap();
    assert_eq!(reenregistre.blocs, m1.blocs, "les anciennes variables sont acceptées telles quelles");
    documents::enregistrer_blocs(&c, 1, &attendu).unwrap();
    assert_eq!(documents::lire(&c, &fichiers, 1).unwrap().blocs.unwrap(), attendu);
    // Un nouveau document depuis l'ancien modèle fonctionne.
    let nouveau = documents::creer_depuis_modele(&c, &fichiers, 1, None, 1, false).unwrap();
    assert_eq!(nouveau.blocs.unwrap().len(), 10);
    assert!(!modeles::lire(&c, 2).unwrap().actif);

    // Modèles standards ajoutés, dans le thème « Support informatique ».
    let liste = modeles::lister(&c).unwrap();
    assert_eq!(liste.len(), 6);
    let std: Vec<&str> = liste.iter().filter(|m| m.standard).map(|m| m.nom.as_str()).collect();
    assert_eq!(std, [ETAT_DES_BESOINS, FICHE_INTERVENTION, FICHE_IDENTIFICATION, FICHE_FORMATAGE]);
    assert!(liste.iter().filter(|m| m.standard).all(|m| m.theme == standards::THEME && m.actif));

    // Un employé repris, complété, reçoit son identifiant.
    let complete = entites::modifier(&c, 1, &employe(1, "Durand", "Martin", Some("1980-06-15"), "Ingénieur")).unwrap();
    let code = complete.code.clone().unwrap();
    assert!(forme_valide(&code), "{code}");
    assert_eq!(complete.libelle, "DURAND Martin");
    drop(c);
    drop(etat);

    // Relance : le schéma version 4 est accepté, rien n'est dupliqué, aucune nouvelle sauvegarde.
    let etat = Etat::ouvrir_dans(t.0.clone()).expect("la base migrée est acceptée au lancement suivant");
    let c = etat.conn().unwrap();
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM modeles"), 6, "modèles standards sans doublon");
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM themes"), 3);
    assert_eq!(sauvegardes_avant_migration(&t.0).len(), 1);
    assert!(modeles::restaurer_standards(&c).unwrap().is_empty());
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM entites"), 5);
    // 2 documents de la 1.0, celui de la migration 005 (dossier 2) et celui créé ci-dessus.
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM documents"), 4);
    assert_eq!(entites::lire(&c, 1).unwrap().code, Some(code));
}

#[test]
fn journal_v1_reecrit_dans_le_vocabulaire_v11() {
    let t = Temp::new();
    let chemin = creer_base_v1(&t.0);
    // Textes exacts produits par la version 1.0 (src-tauri/src/domaine/entites.rs de la 1.0).
    let c = Connection::open(&chemin).unwrap();
    c.execute_batch(
        "INSERT INTO evenements (type, titre, detail, a_id, b_id, dossier_id, date) VALUES
           ('code_saisi', 'Code unique saisi', 'Code #0412 attribué à la fiche.', 1, NULL, NULL, '2025-01-03 10:00:00'),
           ('code_saisi', 'Code unique saisi', 'Code #0101 attribué à la fiche.', NULL, 3, NULL, '2025-01-06 11:00:00'),
           ('fiche_modifiee', 'Fiche modifiée', 'Modification : nom, groupe, code unique.', 1, NULL, NULL, '2025-01-03 11:00:00'),
           ('fiche_modifiee', 'Fiche modifiée', 'Modification : type, code unique.', NULL, 3, NULL, '2025-01-06 12:00:00');",
    )
    .unwrap();
    drop(c);
    let etat = Etat::ouvrir_dans(t.0.clone()).expect("base 1.0 migrée");
    let c = etat.conn().unwrap();
    let textes = |kind, id| -> Vec<(String, String)> {
        journal::pour_entite(&c, kind, id).unwrap().into_iter().map(|e| (e.titre, e.detail)).collect()
    };
    let a = textes(Kind::A, 1);
    assert!(a.contains(&("Ancien code saisi".into(), "Code 0412 attribué à la fiche (version 1.0).".into())), "{a:?}");
    assert!(a.contains(&("Fiche modifiée".into(), "Modification : nom, structure, identifiant.".into())), "{a:?}");
    let b = textes(Kind::B, 3);
    assert!(b.contains(&("Identifiant saisi".into(), "Identifiant 0101 attribué à la fiche.".into())), "{b:?}");
    assert!(b.contains(&("Fiche modifiée".into(), "Modification : type de machine, identifiant.".into())), "{b:?}");
    // Plus aucun ancien libellé dans le journal repris.
    let tout: String = c
        .prepare("SELECT titre || ' ' || detail FROM evenements")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .map(Result::unwrap)
        .collect::<Vec<_>>()
        .join("\n");
    for ancien in ["Code unique", "code unique", "Code #", "groupe", "Entité A", "Entité B"] {
        assert!(!tout.contains(ancien), "« {ancien} » reste dans le journal :\n{tout}");
    }
}

#[test]
fn base_v1_non_conforme_toujours_refusee_sans_modification() {
    for piege in [
        "CREATE TABLE intruse (x);",
        "CREATE VIEW v AS SELECT * FROM documents;",
        "CREATE TRIGGER t AFTER INSERT ON documents BEGIN SELECT 1; END;",
        "CREATE INDEX entites_nom ON entites (nom);",
    ] {
        let t = Temp::new();
        let chemin = creer_base_v1(&t.0);
        Connection::open(&chemin).unwrap().execute_batch(piege).unwrap();
        let avant = fs::read(&chemin).unwrap();
        let e = Etat::ouvrir_dans(t.0.clone()).err().unwrap_or_else(|| panic!("base acceptée : {piege}"));
        assert_eq!(e.code, "base_refusee", "{piege}");
        assert_eq!(fs::read(&chemin).unwrap(), avant, "fichier modifié : {piege}");
        assert!(sauvegardes_avant_migration(&t.0).is_empty(), "aucune migration tentée : {piege}");
    }
    // Une base en version 2 au schéma modifié est refusée aussi.
    let t = Temp::new();
    creer_base_v1(&t.0);
    drop(Etat::ouvrir_dans(t.0.clone()).unwrap());
    Connection::open(t.0.join("donnees.sqlite")).unwrap().execute_batch("CREATE TABLE intruse (x);").unwrap();
    assert_eq!(Etat::ouvrir_dans(t.0.clone()).err().unwrap().code, "base_refusee");
}

#[test]
fn base_neuve_creee_en_version_courante_avec_exemples_et_standards() {
    let t = Temp::new();
    let etat = Etat::ouvrir_dans(t.0.clone()).unwrap();
    let c = etat.conn().unwrap();
    assert_eq!(compter(&c, "PRAGMA user_version"), db::VERSION_SCHEMA);
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM modeles WHERE standard IS NOT NULL"), 4);
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM modeles"), 4);
    assert!(sauvegardes_avant_migration(&t.0).is_empty());
    drop(c);
    drop(etat);
    let etat = Etat::ouvrir_dans(t.0.clone()).unwrap();
    assert_eq!(compter(&etat.conn().unwrap(), "SELECT COUNT(*) FROM modeles"), 4);
}

// ---------- fiche d'un employé (§ 8.2, 10.6) ----------
// L'identifiant (§ 10.5) est testé dans tests_v13.

#[test]
fn libelle_et_saisie_d_un_employe() {
    // Libellé « NOM Prénom ».
    assert_eq!(libelle_employe("Lefèvre", "Thomas"), "LEFÈVRE Thomas");
    assert_eq!(libelle_employe("Ould Ali", "Nadia"), "OULD ALI Nadia");
    assert_eq!(libelle_employe("Sans prénom", ""), "Sans prénom");
    let m = mini();
    // Date de naissance contrôlée.
    for faux in ["14/05/1990", "1990-13-01", "1899-12-31", "2999-01-01"] {
        let e = entites::creer(&m.c, &employe(m.cat_a, "X", "Y", Some(faux), "Z")).unwrap_err();
        assert_eq!(e.code, "saisie_invalide", "{faux}");
    }
    // Champs bornés.
    let e = entites::creer(&m.c, &employe(m.cat_a, "X", &"p".repeat(201), Some("1990-01-01"), "Z")).unwrap_err();
    assert_eq!(e.code, "saisie_invalide");
    let e = entites::creer(&m.c, &employe(m.cat_a, "X", "Y", Some("1990-01-01"), &"p".repeat(201))).unwrap_err();
    assert_eq!(e.code, "saisie_invalide");
}
#[test]
fn machine_complete() {
    let m = mini();
    let s = super::entites::SaisieEntite::Machine(super::entites::SaisieMachine {
        nom: " Poste labo ".into(),
        code: Some(" LAB-01 ".into()),
        marque: " Dell OptiPlex 7090 ".into(),
        cpu: "Intel Core i5".into(),
        ram: "16 Go".into(),
        stockage: "SSD 512 Go".into(),
        categorie_id: m.cat_b,
    });
    let pc = entites::creer(&m.c, &s).unwrap();
    assert_eq!(
        (pc.nom.as_str(), pc.libelle.as_str(), pc.code.as_deref(), pc.marque.as_str(), pc.cpu.as_str(), pc.ram.as_str(), pc.stockage.as_str()),
        ("Poste labo", "Poste labo", Some("LAB-01"), "Dell OptiPlex 7090", "Intel Core i5", "16 Go", "SSD 512 Go")
    );
    assert_eq!((pc.prenom.as_str(), pc.date_naissance.as_deref(), pc.poste.as_str()), ("", None, ""));
    // Le même identifiant qu'un employé est permis (répertoires distincts).
    let e = entites::creer(&m.c, &employe(m.cat_a, "Lab", "Oscar", Some("2000-01-01"), "Agent")).unwrap();
    entites::definir_code(&m.c, pc.id, e.code.as_deref().unwrap()).unwrap();
    // Modification journalisée avec le nouveau vocabulaire.
    let s = super::entites::SaisieEntite::Machine(super::entites::SaisieMachine {
        nom: "Poste labo".into(),
        code: None,
        ram: "32 Go".into(),
        categorie_id: m.cat_b,
        ..Default::default()
    });
    entites::modifier(&m.c, pc.id, &s).unwrap();
    let ev = journal::pour_entite(&m.c, Kind::B, pc.id).unwrap();
    assert_eq!(ev[0].detail, "Modification : identifiant, marque et modèle, processeur, RAM, stockage.");
}

// ---------- aide à la saisie (§ 8.4) ----------

#[test]
fn aide_a_la_saisie() {
    let m = mini();
    // Fiches à compléter (sans identifiant) : seuls le nom et le prénom sont cherchés.
    let creer = |n: &str, p: &str| entites::lire(&m.c, employe_incomplet(&m.c, m.cat_a, n, p)).unwrap();
    let benali = creer("Benali", "Sofia");
    let sobhi = creer("Sobhi", "Karim");
    let lasorde = creer("Lasorde", "Paul");
    creer("Martin", "Jean");
    let archive = creer("Soltani", "Rym");
    entites::basculer(&m.c, archive.id).unwrap();
    let ids = |q: &str| -> Vec<i64> { entites::suggerer(&m.c, Kind::A, q).unwrap().into_iter().map(|e| e.id).collect() };

    // Un mot qui commence par la saisie d'abord (ordre alphabétique), puis ceux qui la contiennent ; archivées exclues.
    assert_eq!(ids("so"), [benali.id, sobhi.id, lasorde.id]);
    // Casse et accents ignorés.
    assert_eq!(ids("SÔ"), [benali.id, sobhi.id, lasorde.id]);
    let elodie = creer("Éloi", "Élodie");
    assert_eq!(ids("elo"), [elodie.id]);
    assert_eq!(ids("ÉLO"), [elodie.id]);
    // Plusieurs mots.
    assert_eq!(ids("benali so"), [benali.id]);
    // Saisie vide : aucune proposition.
    assert!(ids("").is_empty());
    assert!(ids("   ").is_empty());
    assert!(ids("zz").is_empty());
    // Par identifiant.
    let complet = entites::creer(&m.c, &employe(m.cat_a, "Haddad", "Karim", Some("1985-11-02"), "Ingénieur")).unwrap();
    assert_eq!(ids(&complet.code.clone().unwrap().to_lowercase()), [complet.id]);
    // 8 propositions au plus.
    for i in 0..10 {
        creer(&format!("Durand {i}"), "Zoé");
    }
    assert_eq!(ids("zoe").len(), entites::MAX_SUGGESTIONS);
    // Machines : nom, marque, identifiant ; jamais un employé.
    let s = super::entites::SaisieEntite::Machine(super::entites::SaisieMachine {
        nom: "Poste accueil".into(),
        code: Some("PC-0101".into()),
        marque: "Dell OptiPlex".into(),
        categorie_id: m.cat_b,
        ..Default::default()
    });
    let pc = entites::creer(&m.c, &s).unwrap();
    let ids_b = |q: &str| -> Vec<i64> { entites::suggerer(&m.c, Kind::B, q).unwrap().into_iter().map(|e| e.id).collect() };
    assert_eq!(ids_b("dell"), [pc.id]);
    assert_eq!(ids_b("pc-01"), [pc.id]);
    assert_eq!(ids_b("accueil"), [pc.id]);
    assert!(ids_b("sofia").is_empty());
}

// ---------- blocs (§ 8.5) ----------

fn tous_les_blocs() -> Vec<Bloc> {
    let mut v = vec![
        Bloc { niveau: Some(1), ..Bloc::nouveau(TypeBloc::Titre, "Titre") },
        Bloc::nouveau(TypeBloc::Texte, "Paragraphe"),
        Bloc::nouveau(TypeBloc::Champ, "Champ"),
        Bloc::nouveau(TypeBloc::Zone, "Zone"),
        Bloc { heure: Some(true), ..Bloc::nouveau(TypeBloc::Date, "Début") },
        Bloc::nouveau(TypeBloc::Date, "Jour"),
        Bloc::nouveau(TypeBloc::Case, "Case"),
        Bloc { options: Some(vec!["Oui".into(), "Non".into()]), ..Bloc::nouveau(TypeBloc::Choix, "Unique") },
        Bloc {
            options: Some(vec!["A".into(), "B".into(), "C".into()]),
            multiple: Some(true),
            ..Bloc::nouveau(TypeBloc::Choix, "Multiple")
        },
        Bloc { cols: Some(vec!["N°".into(), "Désignation".into(), "Qté".into(), "Observations".into()]), ..Bloc::nouveau(TypeBloc::Tableau, "") },
        Bloc::nouveau(TypeBloc::Magasin, "Matériel"),
        Bloc::nouveau(TypeBloc::Variable, "Employé · Poste"),
        Bloc::nouveau(TypeBloc::Employe, "Utilisateur"),
        Bloc::nouveau(TypeBloc::Machine, "Matériel"),
        Bloc::nouveau(TypeBloc::Signature, "Visa"),
    ];
    // Valeurs de document envoyées par erreur dans un modèle : ignorées.
    v[2].val = Some("ignoré".into());
    v[12].entite_id = Some(Some(1));
    v[7].choisis = Some(vec!["Oui".into()]);
    v
}

fn enregistrer_modele(c: &Connection, blocs: Vec<Bloc>) -> crate::error::AppResult<modeles::Modele> {
    let m = modeles::creer(c)?;
    modeles::enregistrer(c, m.id, &SaisieModele { nom: "Modèle complet".into(), theme_id: m.theme_id, blocs })
}

#[test]
fn validation_des_blocs_de_modele() {
    let m = mini();
    let enr = enregistrer_modele(&m.c, tous_les_blocs()).unwrap();
    assert_eq!(enr.blocs.len(), 15);
    assert_eq!(enr.blocs[0].niveau, Some(1));
    assert_eq!(enr.blocs[4].heure, Some(true));
    assert_eq!(enr.blocs[5].heure, Some(false), "heure : non par défaut");
    assert_eq!(enr.blocs[7].multiple, Some(false), "choix unique par défaut");
    assert_eq!(enr.blocs[8].multiple, Some(true));
    assert_eq!(enr.blocs[9].cols.as_ref().unwrap().len(), 4);
    assert!(enr.blocs[2].val.is_none() && enr.blocs[12].entite_id.is_none() && enr.blocs[7].choisis.is_none());
    // Titre sans niveau : 1.
    let t = enregistrer_modele(&m.c, vec![Bloc::nouveau(TypeBloc::Titre, "T")]).unwrap();
    assert_eq!(t.blocs[0].niveau, Some(1));

    let refus = |modifier: &dyn Fn(&mut Bloc), t: TypeBloc| {
        let mut b = tous_les_blocs().into_iter().find(|b| b.t == t).unwrap();
        modifier(&mut b);
        enregistrer_modele(&m.c, vec![b]).unwrap_err().code
    };
    assert_eq!(refus(&|b| b.niveau = Some(3), TypeBloc::Titre), "saisie_invalide");
    assert_eq!(refus(&|b| b.options = Some(vec!["Seule".into()]), TypeBloc::Choix), "saisie_invalide");
    assert_eq!(refus(&|b| b.options = None, TypeBloc::Choix), "saisie_invalide");
    assert_eq!(refus(&|b| b.options = Some((0..13).map(|i| format!("O{i}")).collect()), TypeBloc::Choix), "saisie_invalide");
    assert_eq!(refus(&|b| b.options = Some(vec!["A".into(), " ".into()]), TypeBloc::Choix), "saisie_invalide");
    assert_eq!(refus(&|b| b.options = Some(vec!["A".into(), " A ".into()]), TypeBloc::Choix), "saisie_invalide");
    assert_eq!(refus(&|b| b.options = Some(vec!["A".into(), "x".repeat(201)]), TypeBloc::Choix), "saisie_invalide");
    assert_eq!(refus(&|b| b.cols = Some(vec!["c".into(); 9]), TypeBloc::Tableau), "saisie_invalide");
    assert_eq!(refus(&|b| b.v = "Inconnue".into(), TypeBloc::Variable), "saisie_invalide");
    assert_eq!(refus(&|b| b.v = "x".repeat(modeles::MAX_TEXTE + 1), TypeBloc::Signature), "saisie_invalide");
    // Limites acceptées : 12 options de 200 caractères, 8 colonnes, 1 colonne.
    let mut c12 = Bloc::nouveau(TypeBloc::Choix, "Douze");
    c12.options = Some((0..12).map(|i| format!("{i:0>200}")).collect());
    let mut t8 = Bloc::nouveau(TypeBloc::Tableau, "");
    t8.cols = Some(vec!["c".into(); 8]);
    let mut t1 = Bloc::nouveau(TypeBloc::Tableau, "");
    t1.cols = Some(vec!["Seule".into()]);
    let ok = enregistrer_modele(&m.c, vec![c12, t8, t1, Bloc::nouveau(TypeBloc::Tableau, "")]).unwrap();
    assert_eq!(ok.blocs[2].cols.as_ref().unwrap(), &vec!["Seule"]);
    assert_eq!(ok.blocs[3].cols.as_ref().unwrap(), &vec!["Colonne 1", "Colonne 2", "Colonne 3"]);
    // Toutes les variables, nouvelles et anciennes.
    let vars: Vec<Bloc> = modeles::VARIABLES
        .iter()
        .chain(modeles::VARIABLES_ANCIENNES.iter().map(|(a, _)| a))
        .map(|v| Bloc::nouveau(TypeBloc::Variable, v))
        .collect();
    assert_eq!(enregistrer_modele(&m.c, vars).unwrap().blocs.len(), 16);
}

/// Dossier (employé A, machine B) et document créé depuis un modèle à tous les blocs.
struct Doc {
    m: Mini,
    a: i64,
    b: i64,
    dossier: i64,
    doc: documents::DocumentFichier,
    tmp: Temp,
}

fn doc_complet() -> Doc {
    let m = mini();
    let a = entites::creer(&m.c, &employe(m.cat_a, "Benali", "Sofia", Some("1990-05-14"), "Technicienne")).unwrap().id;
    let b = entites::creer(&m.c, &machine(m.cat_b, "PC accueil", Some("PC-0101"))).unwrap().id;
    let modele = enregistrer_modele(&m.c, tous_les_blocs()).unwrap().id;
    let dossier = dossiers::creer(&m.c, &SaisieDossier { nom: "Dossier 2026-01".into(), annee: 2026, theme_id: m.theme, statut_id: None })
        .unwrap()
        .id;
    let tmp = Temp::new();
    let cree = documents::creer_depuis_modele(&m.c, &tmp.0, dossier, None, modele, false).unwrap();
    // § 11.1 : blocs employé / machine vides à la création ; on y nomme les deux fiches.
    let mut blocs = cree.blocs.clone().unwrap();
    assert_eq!((blocs[12].entite_id, blocs[13].entite_id), (Some(None), Some(None)));
    blocs[12].entite_id = Some(Some(a));
    blocs[13].entite_id = Some(Some(b));
    documents::enregistrer_blocs(&m.c, cree.id, &blocs).unwrap();
    let doc = documents::lire(&m.c, &tmp.0, cree.id).unwrap();
    Doc { m, a, b, dossier, doc, tmp }
}

#[test]
fn document_prerempli_et_saisie_validee() {
    let d = doc_complet();
    let c = &d.m.c;
    let blocs = d.doc.blocs.clone().unwrap();
    // Fiches nommées par les blocs.
    assert_eq!(blocs[12].entite_id, Some(Some(d.a)));
    assert_eq!(blocs[13].entite_id, Some(Some(d.b)));
    assert_eq!((blocs[4].val.as_deref(), blocs[7].choisis.as_deref()), (Some(""), Some(&[][..])));
    assert_eq!(blocs[9].rows.as_deref(), Some(&[][..]));
    assert!(blocs[14].val.is_none() && blocs[11].val.is_none());
    let json = serde_json::to_value(&blocs).unwrap();
    assert_eq!(json[12]["entiteId"], d.a);
    assert_eq!(json[13]["t"], "machine");
    // entitesCitees dans le détail du dossier.
    let det = dossiers::detail(c, &d.tmp.0, d.dossier).unwrap();
    assert_eq!(det.entites_citees.iter().map(|e| e.id).collect::<Vec<_>>(), [d.a, d.b]);
    let det_json = serde_json::to_value(&det).unwrap();
    assert!(det_json["entitesCitees"].is_array());

    let avec = |f: &dyn Fn(&mut Vec<Bloc>)| {
        let mut b = blocs.clone();
        f(&mut b);
        documents::enregistrer_blocs(c, d.doc.id, &b)
    };
    let relu = || documents::lire(c, &d.tmp.0, d.doc.id).unwrap().blocs.unwrap();

    // Dates.
    avec(&|b| {
        b[4].val = Some("2026-03-01T14:05:30".into());
        b[5].val = Some("2026-03-01".into());
    })
    .unwrap();
    assert_eq!(relu()[4].val.as_deref(), Some("2026-03-01T14:05"));
    assert_eq!(relu()[5].val.as_deref(), Some("2026-03-01"));
    assert_eq!(avec(&|b| b[5].val = Some("2026-03-01T14:05".into())).unwrap_err().code, "saisie_invalide");
    assert_eq!(avec(&|b| b[4].val = Some("01/03/2026".into())).unwrap_err().code, "saisie_invalide");
    assert_eq!(avec(&|b| b[5].val = Some("2026-02-30".into())).unwrap_err().code, "saisie_invalide");
    // Choix : options connues, une seule pour un choix unique, ordre des options.
    avec(&|b| b[8].choisis = Some(vec!["C".into(), "A".into(), "C".into()])).unwrap();
    assert_eq!(relu()[8].choisis.as_ref().unwrap(), &vec!["A", "C"]);
    assert_eq!(avec(&|b| b[7].choisis = Some(vec!["Oui".into(), "Non".into()])).unwrap_err().code, "saisie_invalide");
    assert_eq!(avec(&|b| b[7].choisis = Some(vec!["Peut-être".into()])).unwrap_err().code, "saisie_invalide");
    // Zone, tableau à 4 colonnes.
    avec(&|b| {
        b[3].val = Some("ligne 1\nligne 2".into());
        b[9].rows = Some(vec![vec!["1".into(), "Clavier".into(), "2".into(), "".into(), "en trop".into()]]);
    })
    .unwrap();
    assert_eq!(relu()[9].rows.as_ref().unwrap(), &vec![vec!["1", "Clavier", "2", ""]]);
    assert_eq!(relu()[3].val.as_deref(), Some("ligne 1\nligne 2"));
    // Structure protégée : options et colonnes ne se changent pas par la saisie.
    avec(&|b| b[7].options = Some(vec!["Piraté".into(), "X".into()])).unwrap();
    assert_eq!(relu()[7].options.as_ref().unwrap(), &vec!["Oui", "Non"]);

    // Blocs employé / machine : la bonne sorte de fiche seulement.
    let autre = entites::creer(c, &employe(d.m.cat_a, "Haddad", "Karim", Some("1985-11-02"), "Ingénieur")).unwrap().id;
    avec(&|b| b[12].entite_id = Some(Some(autre))).unwrap();
    assert_eq!(relu()[12].entite_id, Some(Some(autre)));
    let e = avec(&|b| b[12].entite_id = Some(Some(d.b))).unwrap_err();
    assert_eq!((e.code.as_str(), e.message.as_str()), ("fiche_incompatible", "Le bloc « Utilisateur » doit désigner un employé."));
    let e = avec(&|b| b[13].entite_id = Some(Some(d.a))).unwrap_err();
    assert_eq!(e.message, "Le bloc « Matériel » doit désigner une machine.");
    assert_eq!(avec(&|b| b[13].entite_id = Some(Some(9999))).unwrap_err().code, "introuvable");
    // Une fiche archivée ne peut pas être choisie… mais celle déjà choisie reste acceptée.
    let archivee = entites::creer(c, &employe(d.m.cat_a, "Ancien", "Agent", Some("1960-01-01"), "Retraité")).unwrap().id;
    entites::basculer(c, archivee).unwrap();
    assert_eq!(avec(&|b| b[12].entite_id = Some(Some(archivee))).unwrap_err().code, "fiche_archivee");
    entites::basculer(c, autre).unwrap();
    let mut actuels = relu();
    actuels[2].val = Some("toujours modifiable".into());
    documents::enregistrer_blocs(c, d.doc.id, &actuels).unwrap();
    // Vider le choix.
    actuels[12].entite_id = Some(None);
    actuels[13].entite_id = None;
    documents::enregistrer_blocs(c, d.doc.id, &actuels).unwrap();
    let r = relu();
    assert_eq!((r[12].entite_id, r[13].entite_id), (Some(None), Some(None)));
    assert_eq!(serde_json::to_value(&r).unwrap()[12]["entiteId"], serde_json::Value::Null);
    assert!(dossiers::detail(c, &d.tmp.0, d.dossier).unwrap().entites_citees.is_empty());
}

#[test]
fn entites_citees_sans_doublon() {
    let d = doc_complet();
    let c = &d.m.c;
    let modele = id_modele(c, "Modèle complet");
    let doc2 = documents::creer_depuis_modele(c, &d.tmp.0, d.dossier, None, modele, false).unwrap();
    let autre = entites::creer(c, &machine(d.m.cat_b, "Portable", None)).unwrap().id;
    let mut b = doc2.blocs.unwrap();
    b[13].entite_id = Some(Some(autre));
    documents::enregistrer_blocs(c, doc2.id, &b).unwrap();
    let det = dossiers::detail(c, &d.tmp.0, d.dossier).unwrap();
    assert_eq!(det.entites_citees.iter().map(|e| e.id).collect::<Vec<_>>(), [d.a, d.b, autre]);
}

// ---------- modèles standards (§ 8.6) ----------

fn resume_blocs(blocs: &[Bloc]) -> Vec<String> {
    blocs.iter().map(|b| format!("{:?}:{}", b.t, b.v)).collect()
}

#[test]
fn modeles_standards_transcrits() {
    let c = base_exemple();
    let liste = modeles::lister(&c).unwrap();
    let modele = |nom: &str| liste.iter().find(|m| m.nom == nom).unwrap_or_else(|| panic!("{nom}")).clone();
    let compte = |m: &modeles::Modele, t: TypeBloc| m.blocs.iter().filter(|b| b.t == t).count();
    let bloc = |m: &modeles::Modele, v: &str| m.blocs.iter().find(|b| b.v == v).unwrap_or_else(|| panic!("{v}")).clone();

    let eb = modele(ETAT_DES_BESOINS);
    assert_eq!(eb.theme, standards::THEME);
    let tab = eb.blocs.iter().find(|b| b.t == TypeBloc::Tableau).unwrap();
    assert_eq!(tab.cols.as_ref().unwrap(), &vec!["N°", "Désignation", "Qté", "Observations"]);
    let nature = bloc(&eb, "Nature de la demande");
    assert_eq!((nature.options.as_ref().unwrap().join("/"), nature.multiple), ("Achat/Magasin/Prestation/Travaux".into(), Some(true)));
    let sens = bloc(&eb, "Départ ou arrivée");
    assert_eq!((sens.options.as_ref().unwrap().join("/"), sens.multiple), ("Départ/Arrivée".into(), Some(false)));
    assert_eq!(compte(&eb, TypeBloc::Signature), 3);

    let fi = modele(FICHE_INTERVENTION);
    assert_eq!(bloc(&fi, "Utilisateur").t, TypeBloc::Employe);
    assert_eq!(bloc(&fi, "Matériel").t, TypeBloc::Machine);
    assert_eq!(bloc(&fi, "Début d’intervention").heure, Some(true));
    assert_eq!(bloc(&fi, "Fin d’intervention").heure, Some(true));
    assert_eq!(bloc(&fi, "Ouverture de la session (domaine)").t, TypeBloc::Champ);

    let fid = modele(FICHE_IDENTIFICATION);
    assert_eq!(bloc(&fid, "Bénéficiaire").t, TypeBloc::Employe);
    assert!(compte(&fid, TypeBloc::Texte) >= 3);

    let ff = modele(FICHE_FORMATAGE);
    assert_eq!((compte(&ff, TypeBloc::Employe), compte(&ff, TypeBloc::Machine)), (1, 1));
    assert!(ff.blocs.iter().any(|b| b.t == TypeBloc::Titre && b.niveau == Some(2)));
    for (v, multiple) in [("Demandeur", false), ("PC connecté au réseau", false), ("Mode de connexion", false), ("Données sauvegardées", true)] {
        assert_eq!(bloc(&ff, v).multiple, Some(multiple), "{v}");
    }
    let licences: Vec<Option<bool>> = ff.blocs.iter().filter(|b| b.t == TypeBloc::Choix && b.v == "Licence").map(|b| b.multiple).collect();
    assert_eq!(licences, [Some(false)]);
    assert_eq!(ff.blocs.iter().find(|b| b.v.starts_with("Formatage nécessaire")).unwrap().multiple, Some(true));

    // Aucune information déjà portée par les fiches n'est redemandée.
    for m in [&eb, &fi, &fid, &ff] {
        for interdit in ["Nom", "Prénom", "Structure", "Grade/poste", "Marque et modèle", "Processeur", "RAM", "Disque dur/SSD"] {
            assert!(!m.blocs.iter().any(|b| b.v == interdit), "{} redemande « {interdit} »", m.nom);
        }
        // Tous les blocs passent la validation du Studio.
        assert_eq!(modeles::normaliser_blocs_modele(&m.blocs, &modeles::Bornes::default()).unwrap(), m.blocs);
    }
    // Un document se crée depuis chacun, blocs employé / machine vides (§ 11.1).
    let tmp = Temp::new();
    let dossier = dossiers::lister(&c).unwrap().into_iter().find(|d| d.statut.role != Role::Clos).unwrap();
    for m in [&eb, &fi, &fid, &ff] {
        let doc = documents::creer_depuis_modele(&c, &tmp.0, dossier.id, None, m.id, false).unwrap();
        let blocs = doc.blocs.unwrap();
        assert_eq!(resume_blocs(&blocs), resume_blocs(&m.blocs));
        for b in blocs.iter().filter(|b| b.t.kind_designe().is_some()) {
            assert_eq!(b.entite_id, Some(None));
        }
        assert_eq!(doc.modele_id, Some(m.id));
    }
}

#[test]
fn restauration_des_modeles_standards_sans_doublon_ni_retouche() {
    let c = base_exemple();
    assert!(modeles::restaurer_standards(&c).unwrap().is_empty());
    // Modifié sans changer de nom : présent, ni recréé ni retouché.
    let fid = id_modele(&c, FICHE_IDENTIFICATION);
    let m_fid = modeles::lire(&c, fid).unwrap();
    let blocs_fid = vec![Bloc::nouveau(TypeBloc::Texte, "Version locale")];
    modeles::enregistrer(&c, fid, &SaisieModele { nom: m_fid.nom.clone(), theme_id: m_fid.theme_id, blocs: blocs_fid.clone() }).unwrap();
    assert!(modeles::restaurer_standards(&c).unwrap().is_empty());
    assert_eq!(modeles::lire(&c, fid).unwrap().blocs, blocs_fid);

    // Renommé ou archivé : il n'est plus proposé sous son nom, il est recréé à neuf ; l'ancien n'est pas retouché
    // (nom, blocs, état), il cède seulement sa marque « standard ».
    let eb = id_modele(&c, ETAT_DES_BESOINS);
    let saisie = SaisieModele { nom: "Mes besoins".into(), theme_id: modeles::lire(&c, eb).unwrap().theme_id, blocs: vec![Bloc::nouveau(TypeBloc::Texte, "À moi")] };
    modeles::enregistrer(&c, eb, &saisie).unwrap();
    let fi = id_modele(&c, FICHE_INTERVENTION);
    modeles::basculer(&c, fi).unwrap();
    let crees = modeles::restaurer_standards(&c).unwrap();
    assert_eq!(crees.iter().map(|m| m.nom.as_str()).collect::<Vec<_>>(), [ETAT_DES_BESOINS, FICHE_INTERVENTION]);
    assert!(crees.iter().all(|m| m.standard && m.actif && m.theme == standards::THEME));
    let definitions = standards::definitions();
    assert_eq!(crees[0].blocs.len(), definitions[0].blocs.len(), "recréé à neuf");
    let relu = modeles::lire(&c, eb).unwrap();
    assert_eq!((relu.nom.as_str(), relu.blocs.len(), relu.actif, relu.standard), ("Mes besoins", 1, true, false));
    let archive = modeles::lire(&c, fi).unwrap();
    assert_eq!((archive.nom.as_str(), archive.actif, archive.standard), (FICHE_INTERVENTION, false, false));
    assert!(modeles::restaurer_standards(&c).unwrap().is_empty());
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM modeles WHERE standard IS NOT NULL"), 4);

    // Un modèle standard disparu (base modifiée à la main) est recréé, seul.
    let eb2 = crees[0].id;
    c.execute("DELETE FROM modeles WHERE id = ?1", [eb2]).unwrap();
    let crees = modeles::restaurer_standards(&c).unwrap();
    assert_eq!(crees.iter().map(|m| m.nom.as_str()).collect::<Vec<_>>(), [ETAT_DES_BESOINS]);
    assert!(crees[0].standard && crees[0].actif);
    assert_eq!(crees[0].theme, standards::THEME);
    assert!(modeles::restaurer_standards(&c).unwrap().is_empty());
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM modeles WHERE standard IS NOT NULL"), 4);

    // Un modèle de l'utilisateur au même nom (sans la clé) vaut présence : pas de doublon.
    let vide = base();
    let theme = classement::theme_creer(&vide, "Mon thème").unwrap();
    let mien = modeles::creer(&vide).unwrap();
    modeles::enregistrer(&vide, mien.id, &SaisieModele { nom: "fiche d’identification".into(), theme_id: theme.id, blocs: vec![] }).unwrap();
    let crees = modeles::restaurer_standards(&vide).unwrap();
    assert_eq!(crees.len(), 3);
    assert!(!crees.iter().any(|m| m.nom == FICHE_IDENTIFICATION));
    // Le thème « Support informatique » est créé s'il manque, réutilisé sinon.
    assert_eq!(compter(&vide, "SELECT COUNT(*) FROM themes WHERE nom = 'Support informatique'"), 1);
    assert!(modeles::lire(&vide, mien.id).unwrap().blocs.is_empty());
}

#[test]
fn reinitialisations_gardent_les_standards() {
    use super::donnees::{self, ModeReinit};
    let c = base_exemple();
    let t = Temp::new();
    let fichiers = t.0.join("fichiers");
    for mode in [ModeReinit::Vide, ModeReinit::Exemple, ModeReinit::Exemple, ModeReinit::Vide] {
        donnees::reinitialiser(&c, &t.0, &fichiers, mode, chrono::Local::now().date_naive()).unwrap();
        assert_eq!(compter(&c, "SELECT COUNT(*) FROM modeles WHERE standard IS NOT NULL"), 4, "{mode:?}");
        assert_eq!(compter(&c, "SELECT COUNT(*) FROM modeles"), 4, "{mode:?}");
        assert_eq!(compter(&c, "SELECT COUNT(*) FROM themes WHERE nom = 'Support informatique'"), 1);
    }
}

// ---------- vocabulaire (§ 8.1) et données d'exemple (§ 8.7) ----------

#[test]
fn plus_aucune_entite_a_ou_b() {
    let c = base_exemple();
    let textes: Vec<String> = {
        let mut s = c
            .prepare(
                "SELECT nom FROM entites UNION ALL SELECT libelle FROM entites UNION ALL SELECT nom FROM categories
                 UNION ALL SELECT nom FROM themes UNION ALL SELECT nom || blocs FROM modeles
                 UNION ALL SELECT titre || detail FROM evenements UNION ALL SELECT COALESCE(blocs, '') || source FROM documents
                 UNION ALL SELECT nom FROM dossiers UNION ALL SELECT nom FROM sous_dossiers",
            )
            .unwrap();
        s.query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect()
    };
    for t in &textes {
        for interdit in ["Entité A", "Entité B", "Entités A", "Entités B", "Groupe ", "Code #"] {
            assert!(!t.contains(interdit), "« {interdit} » dans les données d'exemple : {t}");
        }
    }
    // Messages d'erreur du back : aucun « Entité A / B » hors des anciens noms de variables.
    for (fichier, source, permis) in [
        ("entites.rs", include_str!("entites.rs"), 0),
        ("classement.rs", include_str!("classement.rs"), 0),
        ("journal.rs", include_str!("journal.rs"), 0),
        ("dossiers.rs", include_str!("dossiers.rs"), 0),
        ("documents.rs", include_str!("documents.rs"), 0),
        ("recherche.rs", include_str!("recherche.rs"), 0),
        ("standards.rs", include_str!("standards.rs"), 0),
        ("exemple.rs", include_str!("../db/exemple.rs"), 0),
        ("modeles.rs", include_str!("modeles.rs"), 4),
    ] {
        let n = source.lines().filter(|l| l.contains("Entité A") || l.contains("Entité B")).count();
        assert_eq!(n, permis, "{fichier}");
    }
}

#[test]
fn donnees_d_exemple_fictives_et_completes() {
    let c = base_exemple();
    let employes = entites::lister(&c, Kind::A).unwrap();
    let machines = entites::lister(&c, Kind::B).unwrap();
    assert_eq!((employes.len(), machines.len()), (8, 8));
    // Fiches complètes, sauf deux de chaque.
    assert_eq!(employes.iter().filter(|e| e.code.is_none()).count(), 2);
    assert!(employes.iter().filter(|e| e.code.is_some()).all(|e| !e.prenom.is_empty() && e.date_naissance.is_some() && !e.poste.is_empty()));
    assert!(employes.iter().all(|e| e.libelle == libelle_employe(&e.nom, &e.prenom)));
    assert_eq!(machines.iter().filter(|e| e.code.is_none()).count(), 2);
    assert!(machines.iter().all(|e| !e.marque.is_empty() && !e.cpu.is_empty() && !e.ram.is_empty() && !e.stockage.is_empty()));
    let sofia = employes.iter().find(|e| e.nom == "Benali").unwrap();
    assert!(sofia.code.as_deref().is_some_and(forme_valide));
    // Documents issus des quatre modèles standards, préremplis.
    let sources: std::collections::BTreeSet<String> = {
        let mut s = c.prepare("SELECT DISTINCT source FROM documents WHERE origine = 'modele'").unwrap();
        s.query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect()
    };
    let attendu: std::collections::BTreeSet<String> =
        [ETAT_DES_BESOINS, FICHE_INTERVENTION, FICHE_IDENTIFICATION, FICHE_FORMATAGE].iter().map(|s| s.to_string()).collect();
    assert_eq!(sources, attendu);
    let tmp = Temp::new();
    for d in dossiers::lister(&c).unwrap() {
        let det = dossiers::detail(&c, &tmp.0, d.id).unwrap();
        assert!(!det.entites_citees.is_empty(), "{}", d.nom);
        // Les documents d'exemple restent modifiables tels quels.
        if d.statut.role != Role::Clos {
            for doc in det.documents.iter().filter(|x| x.blocs.is_some()) {
                documents::enregistrer_blocs(&c, doc.id, doc.blocs.as_deref().unwrap()).unwrap();
            }
        }
    }
}

