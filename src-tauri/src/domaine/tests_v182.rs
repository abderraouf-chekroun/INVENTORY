//! Tests de la version 1.8.2 (revue de sécurité des versions 1.1 à 1.8.1, `docs/audit-securite.md`) :
//! - SEC-182-01 : une copie que référence aussi un autre document (base incohérente) n'est pas supprimée avec un
//!   document ou un sous-dossier ;
//! - SEC-182-02 : un contenu démesuré n'est ni décodé ni réécrit par le Magasin ;
//! - SEC-182-03 : un numéro de ligne extrême dans la base n'arrête pas l'application (débordement arithmétique) ;
//! - SEC-182-04 : l'aperçu de l'identifiant d'un employé ne calcule rien sur un texte démesuré ;
//! - non-régression : aucune suppression ne sort de `fichiers/`, quel que soit le nom de copie écrit dans la base.
//! (SEC-182-05, crochet de l'installateur : tests/installateur/crochet-preinstall.mjs.)

use super::classement;
use super::documents;
use super::dossiers::{self, SaisieDossier};
use super::entites::{self, SaisieIdentifiant, MAX_CHAMP};
use super::modeles::MAX_JSON_LECTURE;
use super::tests::employe;
use super::Kind;
use crate::db;
use rusqlite::{Connection, params};
use std::fs;
use std::path::{Path, PathBuf};

struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!("entites-dossiers-v182-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&p).unwrap();
        Temp(p)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Base en mémoire, un thème, un dossier de données temporaire (`fichiers/` et sources des imports à côté).
struct Banc {
    c: Connection,
    theme: i64,
    racine: Temp,
}

impl Banc {
    fn new() -> Self {
        let c = db::ouvrir_memoire().unwrap();
        let theme = classement::theme_creer(&c, "Thème").unwrap().id;
        let racine = Temp::new();
        fs::create_dir_all(racine.0.join("fichiers")).unwrap();
        fs::create_dir_all(racine.0.join("sources")).unwrap();
        Banc { c, theme, racine }
    }
    fn f(&self) -> PathBuf {
        self.racine.0.join("fichiers")
    }
    fn dossier(&self, nom: &str) -> i64 {
        dossiers::creer(&self.c, &SaisieDossier { nom: nom.into(), annee: 2026, theme_id: self.theme, statut_id: None })
            .unwrap()
            .id
    }
    /// Importe un petit PDF ; renvoie le document, son nom stocké et le chemin de sa copie.
    fn importer(&self, dossier: i64, sous: Option<i64>, nom: &str) -> (i64, String, PathBuf) {
        let source = self.racine.0.join("sources").join(nom);
        fs::write(&source, b"%PDF-1.4\n%%EOF\n").unwrap();
        let d = documents::importer(&self.c, &self.f(), dossier, sous, &source, false).unwrap();
        let stocke: String =
            self.c.query_row("SELECT fichier_stocke FROM documents WHERE id = ?1", [d.id], |r| r.get(0)).unwrap();
        let copie = PathBuf::from(d.fichier_chemin.unwrap());
        assert!(copie.is_file());
        (d.id, stocke, copie)
    }
    /// Document importé écrit directement en base (base fabriquée), avec ce nom de copie.
    fn document_brut(&self, dossier: i64, sous: Option<i64>, stocke: &str) -> i64 {
        self.c
            .execute(
                "INSERT INTO documents (dossier_id, sous_dossier_id, nom, origine, source, date_doc, blocs, fichier_stocke,
                                        fichier_nom, cree_le)
                 VALUES (?1, ?2, 'Document fabriqué', 'import', 'Fichier importé', '2026-01-01', '[]', ?3, 'x.pdf',
                         '2026-01-01 09:00:00')",
                params![dossier, sous, stocke],
            )
            .unwrap();
        self.c.last_insert_rowid()
    }
}

fn existe(p: &Path) -> bool {
    p.exists()
}

// ---------- SEC-182-01 ----------

#[test]
fn copie_partagee_conservee_document_et_sous_dossier() {
    let b = Banc::new();
    let d1 = b.dossier("Dossier un");
    let d2 = b.dossier("Dossier deux");

    // Témoin : une copie qui n'est pas partagée part avec son document.
    let (seul, _, copie_seule) = b.importer(d1, None, "seul.pdf");
    documents::supprimer(&b.c, &b.f(), seul).unwrap();
    assert!(!existe(&copie_seule), "la copie d'un document supprimé doit être supprimée");

    // Document : sa copie est aussi référencée par un document d'un autre dossier.
    let (a, stocke, copie) = b.importer(d1, None, "partage.pdf");
    let autre = b.document_brut(d2, None, &stocke);
    documents::supprimer(&b.c, &b.f(), a).unwrap();
    assert!(existe(&copie), "une copie référencée par un autre document ne doit pas être supprimée");
    assert!(documents::lire(&b.c, &b.f(), autre).unwrap().fichier_chemin.is_some(), "l'autre document garde son fichier");

    // Sous-dossier : la copie d'un de ses documents est aussi référencée hors de son arbre.
    let s = dossiers::sous_dossier_creer(&b.c, d1, None, "Sous-dossier").unwrap().id;
    let s2 = dossiers::sous_dossier_creer(&b.c, d1, Some(s), "Niveau 2").unwrap().id;
    let (_, stocke_s, copie_s) = b.importer(d1, Some(s2), "dans-l-arbre.pdf");
    let (_, _, copie_propre) = b.importer(d1, Some(s), "propre.pdf");
    let hors_arbre = b.document_brut(d1, None, &stocke_s);
    dossiers::sous_dossier_supprimer(&b.c, &b.f(), s).unwrap();
    assert!(existe(&copie_s), "une copie référencée hors du sous-dossier ne doit pas être supprimée");
    assert!(!existe(&copie_propre), "les autres copies du sous-dossier sont supprimées");
    assert!(documents::lire(&b.c, &b.f(), hors_arbre).unwrap().fichier_chemin.is_some());

    // Deux documents du même arbre partagent une copie : elle part une seule fois, sans erreur.
    let s3 = dossiers::sous_dossier_creer(&b.c, d1, None, "Doublon").unwrap().id;
    let (_, stocke_d, copie_d) = b.importer(d1, Some(s3), "doublon.pdf");
    b.document_brut(d1, Some(s3), &stocke_d);
    dossiers::sous_dossier_supprimer(&b.c, &b.f(), s3).unwrap();
    assert!(!existe(&copie_d));
    db::verifier_base(&b.c).unwrap();
}

// ---------- non-régression : confinement à fichiers/ ----------

#[test]
fn aucune_suppression_hors_de_fichiers_quel_que_soit_le_nom_en_base() {
    let b = Banc::new();
    // Fichiers témoins hors de `fichiers/` : à côté (dossier des données) et dans un dossier voisin.
    let cible_donnees = b.racine.0.join("donnees.sqlite");
    let cible_voisine = b.racine.0.join("sources").join("0b1c2d3e-4f50-4617-8899-aabbccddeeff.pdf");
    fs::write(&cible_donnees, b"base").unwrap();
    fs::write(&cible_voisine, b"voisin").unwrap();
    // Un sous-dossier de `fichiers/` qui porte un nom de copie valide : ce n'est pas un fichier ordinaire.
    let dossier_piege = b.f().join("0b1c2d3e-4f50-4617-8899-aabbccddee01.pdf");
    fs::create_dir_all(&dossier_piege).unwrap();
    fs::write(dossier_piege.join("dedans.txt"), b"x").unwrap();

    let absolu = cible_voisine.to_string_lossy().into_owned();
    let verbatim = format!(r"\\?\{absolu}");
    let hostiles = [
        r"..\donnees.sqlite".to_string(),
        r"..\sources\0b1c2d3e-4f50-4617-8899-aabbccddeeff.pdf".to_string(),
        "../sources/0b1c2d3e-4f50-4617-8899-aabbccddeeff.pdf".to_string(),
        absolu,
        verbatim,
        r"\\localhost\c$\Windows\win.ini".to_string(),
        "0b1c2d3e-4f50-4617-8899-aabbccddeeff.pdf:flux".to_string(),
        "0b1c2d3e-4f50-4617-8899-aabbccddee01.pdf".to_string(),
        "NUL".to_string(),
    ];
    let d = b.dossier("Dossier piégé");
    let s = dossiers::sous_dossier_creer(&b.c, d, None, "Sous-dossier piégé").unwrap().id;
    let mut docs = Vec::new();
    for h in &hostiles {
        docs.push(b.document_brut(d, None, h));
        b.document_brut(d, Some(s), h);
    }
    // Lecture : aucun chemin de copie n'est renvoyé, rien n'est ouvrable ni exportable.
    for id in &docs {
        let doc = documents::lire(&b.c, &b.f(), *id).unwrap();
        assert_eq!((doc.fichier_chemin, doc.ouvrable), (None, false));
        assert!(documents::chemin_externe(&b.c, &b.f(), *id).is_err());
        assert!(documents::source_export(&b.c, &b.f(), *id).is_err());
    }
    // Suppressions : document, sous-dossier, dossier entier.
    documents::supprimer(&b.c, &b.f(), docs[0]).unwrap();
    dossiers::sous_dossier_supprimer(&b.c, &b.f(), s).unwrap();
    dossiers::supprimer(&b.c, &b.f(), d).unwrap();
    assert_eq!(fs::read(&cible_donnees).unwrap(), b"base");
    assert_eq!(fs::read(&cible_voisine).unwrap(), b"voisin");
    assert!(dossier_piege.join("dedans.txt").is_file(), "un dossier de fichiers/ n'est jamais supprimé");
}

// ---------- SEC-182-02 ----------

#[test]
fn magasin_contenu_demesure_ni_decode_ni_reecrit() {
    let b = Banc::new();
    let d = b.dossier("Dossier Magasin");
    let mot = classement::magasin_creer(&b.c, "Clavier").unwrap();
    let normal = r#"[{"t":"magasin","v":"Article","val":"Clavier"}]"#;
    let remplissage = "x".repeat(MAX_JSON_LECTURE);
    let geant = format!(r#"[{{"t":"magasin","v":"Article","val":"Clavier"}},{{"t":"texte","v":"{remplissage}"}}]"#);
    assert!(geant.len() > MAX_JSON_LECTURE);
    let inserer = |json: &str| {
        b.c.execute(
            "INSERT INTO documents (dossier_id, nom, origine, source, date_doc, blocs, cree_le)
             VALUES (?1, 'Doc', 'modele', 'Modèle', '2026-01-01', ?2, '2026-01-01 09:00:00')",
            params![d, json],
        )
        .unwrap();
        b.c.last_insert_rowid()
    };
    let doc_normal = inserer(normal);
    let doc_geant = inserer(&geant);
    let liste = classement::magasin_lister(&b.c).unwrap();
    assert_eq!(liste.iter().find(|m| m.id == mot.id).unwrap().nb_documents, 1, "le contenu démesuré n'est pas compté");
    classement::magasin_renommer(&b.c, mot.id, "Clavier USB").unwrap();
    let blocs = |id: i64| -> String { b.c.query_row("SELECT blocs FROM documents WHERE id = ?1", [id], |r| r.get(0)).unwrap() };
    assert!(blocs(doc_normal).contains("Clavier USB"));
    assert_eq!(blocs(doc_geant), geant, "le contenu démesuré n'est pas réécrit");
}

// ---------- SEC-182-03 ----------

#[test]
fn numero_de_ligne_extreme_sans_arret() {
    let b = Banc::new();
    let cat = classement::categorie_creer(&b.c, Kind::A, "Structure").unwrap().id;
    let e = entites::creer(&b.c, &employe(cat, "Benali", "Sofia", Some("1990-05-14"), "Technicienne")).unwrap();
    let d = b.dossier("Dossier extrême");
    b.c.execute(
        "INSERT INTO documents (id, dossier_id, nom, origine, source, date_doc, blocs, cree_le)
         VALUES (900, ?1, 'Doc', 'modele', 'Modèle', '2026-01-01', '[]', '2026-01-01 09:00:00')",
        [d],
    )
    .unwrap();
    // rowid minimal : sa négation déborde (arrêt de l'application avec overflow-checks et panic = abort).
    b.c.execute(
        "INSERT INTO nominations (rowid, document_id, entite_id, facon, champ, depuis)
         VALUES (?1, 900, ?2, 'texte', 'Champ', '2026-01-01 09:00:00')",
        params![i64::MIN, e.id],
    )
    .unwrap();
    let fiche = entites::fiche(&b.c, &b.f(), e.id).unwrap();
    assert!(fiche.evenements.iter().any(|ev| ev.r#type == "nomination"));
}

// ---------- SEC-182-04 ----------

#[test]
fn apercu_de_l_identifiant_borne() {
    let b = Banc::new();
    let saisie = |nom: String| SaisieIdentifiant {
        nom,
        prenom: "Sofia".into(),
        date_naissance: Some("1990-05-14".into()),
        poste: "Technicienne".into(),
    };
    assert!(entites::apercu_identifiant(&b.c, &saisie("B".repeat(MAX_CHAMP)), None).unwrap().is_some());
    assert_eq!(entites::apercu_identifiant(&b.c, &saisie("B".repeat(MAX_CHAMP + 1)), None).unwrap(), None);
    assert_eq!(entites::apercu_identifiant(&b.c, &saisie("B".repeat(5_000_000)), None).unwrap(), None);
    let mut longue_date = saisie("Benali".into());
    longue_date.date_naissance = Some("1".repeat(1_000_000));
    assert_eq!(entites::apercu_identifiant(&b.c, &longue_date, None).unwrap(), None);
}
