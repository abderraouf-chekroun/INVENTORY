//! Tests des règles métier (§ 4) sur une base SQLite en mémoire.

use super::classement;
use super::copies::{self, Apercu};
use super::documents;
use super::donnees::{self, ModeReinit};
use super::dossiers::{self, SaisieDossier};
use super::entites::{self, SaisieEmploye, SaisieEntite, SaisieMachine};
use super::journal;
use super::modeles::{self, Bloc, SaisieModele, TypeBloc};
use super::parametres;
use super::recherche;
use super::statuts::{self, Role};
use super::tableau;
use super::Kind;
use crate::db;
use chrono::{Datelike, NaiveDate};
use rusqlite::Connection;
use std::fs;
use std::path::PathBuf;

// ---------- outils ----------

fn aujourd_hui() -> NaiveDate {
    chrono::Local::now().date_naive()
}

fn base() -> Connection {
    db::ouvrir_memoire().expect("base en mémoire")
}

fn base_exemple() -> Connection {
    let c = base();
    db::exemple::initialiser(&c, aujourd_hui()).expect("données d'exemple");
    c
}

struct DossierTemp(PathBuf);
impl DossierTemp {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!("entites-dossiers-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&p).expect("dossier temporaire");
        DossierTemp(p)
    }
}
impl Drop for DossierTemp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn compter(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).expect(sql)
}

fn id_par_nom(c: &Connection, table: &str, nom: &str) -> i64 {
    c.query_row(&format!("SELECT id FROM {table} WHERE nom = ?1"), [nom], |r| r.get(0))
        .unwrap_or_else(|_| panic!("{nom} introuvable dans {table}"))
}

fn evenements(c: &Connection, type_evenement: &str) -> i64 {
    c.query_row("SELECT COUNT(*) FROM evenements WHERE type = ?1", [type_evenement], |r| r.get(0))
        .expect("comptage")
}

/// Base minimale : un thème, une catégorie par répertoire, une fiche A et une fiche B.
struct Mini {
    c: Connection,
    theme: i64,
    cat_a: i64,
    cat_b: i64,
    a: i64,
    b: i64,
}

/// Saisie d'un employé.
pub(super) fn employe(cat: i64, nom: &str, prenom: &str, naissance: Option<&str>, poste: &str) -> SaisieEntite {
    SaisieEntite::Employe(SaisieEmploye {
        nom: nom.into(),
        prenom: prenom.into(),
        date_naissance: naissance.map(Into::into),
        poste: poste.into(),
        categorie_id: cat,
    })
}

/// Saisie d'une machine.
pub(super) fn machine(cat: i64, nom: &str, code: Option<&str>) -> SaisieEntite {
    SaisieEntite::Machine(SaisieMachine { nom: nom.into(), code: code.map(Into::into), categorie_id: cat, ..Default::default() })
}

/// Employé « à compléter » tel qu'une version précédente a pu l'enregistrer (§ 10.6 : la création exige désormais
/// une fiche complète) : écrit directement en base, avec sa ligne « Fiche créée ». Son libellé est son nom seul
/// tant que le prénom manque.
pub(super) fn employe_incomplet(c: &Connection, cat: i64, nom: &str, prenom: &str) -> i64 {
    let now = super::maintenant();
    let libelle = entites::libelle_employe(nom, prenom);
    c.execute(
        "INSERT INTO entites (kind, nom, code, categorie_id, actif, cree_le, maj_le, libelle, prenom)
         VALUES ('a', ?1, NULL, ?2, 1, ?3, ?3, ?4, ?5)",
        rusqlite::params![nom, cat, now, libelle, prenom],
    )
    .unwrap();
    let id = c.last_insert_rowid();
    journal::ajouter(c, journal::FICHE_CREEE, "Fiche créée", &format!("Création de la fiche {libelle}."), journal::Cible::fiche(Kind::A, id), &now)
        .unwrap();
    id
}

/// Identifiant de l'état fourni qui porte ce rôle.
pub(super) fn st(c: &Connection, role: Role) -> i64 {
    statuts::fourni(c, role).unwrap().id
}

fn mini() -> Mini {
    let c = base();
    let theme = classement::theme_creer(&c, "Thème A").unwrap().id;
    let cat_a = classement::categorie_creer(&c, Kind::A, "Structure 1").unwrap().id;
    let cat_b = classement::categorie_creer(&c, Kind::B, "Type 1").unwrap().id;
    // Employé « à compléter » : son libellé est son nom seul.
    let a = employe_incomplet(&c, cat_a, "Alpha", "");
    let b = entites::creer(&c, &machine(cat_b, "Bravo", None)).unwrap().id;
    Mini { c, theme, cat_a, cat_b, a, b }
}

fn saisie_dossier(m: &Mini, piece: bool) -> SaisieDossier {
    SaisieDossier {
        nom: "Dossier 2026-01".into(),
        annee: 2026,
        theme_id: m.theme,
        statut_id: piece.then(|| st(&m.c, Role::Piece)),
    }
}

fn modele_simple(c: &Connection) -> i64 {
    let m = modeles::creer(c).unwrap();
    modeles::enregistrer(
        c,
        m.id,
        &SaisieModele {
            nom: "Modèle test".into(),
            theme_id: m.theme_id,
            blocs: vec![
                Bloc::nouveau(TypeBloc::Texte, "Bonjour"),
                Bloc::nouveau(TypeBloc::Variable, "Entité A · Nom"),
                Bloc::nouveau(TypeBloc::Champ, "Champ"),
                Bloc::nouveau(TypeBloc::Case, "Validé"),
                Bloc::nouveau(TypeBloc::Magasin, "Matériel"),
                Bloc::nouveau(TypeBloc::Tableau, ""),
            ],
        },
    )
    .unwrap()
    .id
}

/// Modèle « Fiche test » (créé au premier appel) : bloc `employe` « Utilisateur », bloc `machine` « Matériel ».
pub(super) fn modele_fiches(c: &Connection) -> i64 {
    if let Ok(id) = c.query_row("SELECT id FROM modeles WHERE nom = 'Fiche test'", [], |r| r.get(0)) {
        return id;
    }
    let m = modeles::creer(c).unwrap();
    let blocs = vec![Bloc::nouveau(TypeBloc::Employe, "Utilisateur"), Bloc::nouveau(TypeBloc::Machine, "Matériel")];
    modeles::enregistrer(c, m.id, &SaisieModele { nom: "Fiche test".into(), theme_id: m.theme_id, blocs }).unwrap().id
}

/// § 11.1 : document du dossier qui nomme ces fiches dans ses blocs `employe` / `machine` ; renvoie son identifiant.
pub(super) fn document_nommant(c: &Connection, dossier_id: i64, a: Option<i64>, b: Option<i64>) -> i64 {
    let tmp = std::env::temp_dir();
    let doc = documents::creer_depuis_modele(c, &tmp, dossier_id, None, modele_fiches(c), false).unwrap();
    let mut blocs = doc.blocs.unwrap();
    blocs[0].entite_id = Some(a);
    blocs[1].entite_id = Some(b);
    documents::enregistrer_blocs(c, doc.id, &blocs).unwrap();
    doc.id
}

// ---------- migrations et données d'exemple ----------

#[test]
fn migrations_idempotentes() {
    let c = base();
    let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(v, db::VERSION_SCHEMA);
    assert_eq!(v, 6);
    db::migrer(&c).unwrap();
    assert!(db::est_neuve(&c).unwrap());
    let fk: i64 = c.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
    assert_eq!(fk, 1);
}

/// Données d'exemple chargées (« Recharger les données d'exemple » ; depuis la 1.5.1, plus au premier lancement).
#[test]
fn donnees_exemple_chargees() {
    let c = base_exemple();
    assert!(!db::est_neuve(&c).unwrap());
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM entites WHERE kind = 'a'"), 8);
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM entites WHERE kind = 'b'"), 8);
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM affectations"), 16);
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM affectations WHERE fin IS NOT NULL"), 2);
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM affectations WHERE fin IS NOT NULL AND fin < debut"), 0);
    assert_eq!(evenements(&c, journal::DISSOCIATION), 2);
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM themes"), 3);
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM themes WHERE actif = 0"), 1);
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM magasin"), 3);
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM modeles"), 4);
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM modeles WHERE standard IS NOT NULL"), 4);
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM dossiers"), 7);
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM sous_dossiers"), 14);
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM documents"), 28);
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM documents WHERE fichier_stocke IS NOT NULL"), 0);
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM options"), 14);
    assert!(parametres::lire(&c).unwrap().donnees_exemple);

    // § 11.1 : chaque dossier nomme son employé et sa machine dans ses documents ; chaque document vient d'un modèle
    // standard ou est un fichier importé, avec ses deux blocs.
    let tmp = DossierTemp::new();
    for d in dossiers::lister(&c).unwrap() {
        let kinds: Vec<Kind> = dossiers::detail(&c, &tmp.0, d.id).unwrap().entites_citees.iter().map(|e| e.kind).collect();
        assert!(kinds.contains(&Kind::A) && kinds.contains(&Kind::B), "{}", d.nom);
    }
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM documents WHERE origine = 'modele' AND modele_id IS NULL"), 0);
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM documents WHERE blocs IS NULL"), 0);

    // Dates réparties sur l'année en cours et la précédente, jamais dans le futur.
    let y = aujourd_hui().year();
    let min = format!("{}-01-01 00:00:00", y - 1);
    let max = format!("{} 23:59:59", aujourd_hui().format("%Y-%m-%d"));
    for (table, col) in [("entites", "cree_le"), ("entites", "maj_le"), ("dossiers", "cree_le"), ("documents", "cree_le"), ("evenements", "date")] {
        let hors: i64 = c
            .query_row(
                &format!("SELECT COUNT(*) FROM {table} WHERE {col} < ?1 OR {col} > ?2"),
                [&min, &max],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(hors, 0, "{table}.{col} hors de l'intervalle");
    }
    let annees: Vec<i64> = {
        let mut s = c.prepare("SELECT DISTINCT annee FROM dossiers ORDER BY annee").unwrap();
        s.query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect()
    };
    assert_eq!(annees, vec![y as i64 - 2, y as i64 - 1, y as i64]);

    // Les fiches et les dossiers se lisent sans erreur (JSON des blocs compris).
    for d in dossiers::lister(&c).unwrap() {
        let det = dossiers::detail(&c, &tmp.0, d.id).unwrap();
        assert_eq!(det.documents.len(), 4);
        assert_eq!(det.dossier.nb_sous_dossiers, 2);
    }
    let a1 = id_par_nom(&c, "entites", "Benali");
    let f = entites::fiche(&c, &tmp.0, a1).unwrap();
    assert_eq!(f.associees.len(), 2);
    assert_eq!(f.dossiers.len(), 1);
    assert_eq!(f.documents.len(), 4);
    assert!(!f.evenements.is_empty());
}

#[test]
fn donnees_exemple_en_debut_d_annee() {
    // Données d'exemple chargées un 1er janvier ou un 29 février : dates valides et cohérentes.
    for jour in [NaiveDate::from_ymd_opt(2026, 1, 1), NaiveDate::from_ymd_opt(2024, 2, 29)] {
        let jour = jour.unwrap();
        let c = base();
        db::exemple::initialiser(&c, jour).unwrap();
        let max = format!("{} 23:59:59", jour.format("%Y-%m-%d"));
        assert_eq!(
            compter(&c, &format!("SELECT COUNT(*) FROM documents WHERE cree_le > '{max}'")),
            0
        );
        assert_eq!(
            compter(&c, "SELECT COUNT(*) FROM dossiers WHERE clos_le IS NOT NULL AND clos_le < cree_le"),
            0
        );
        assert_eq!(compter(&c, "SELECT COUNT(*) FROM documents d JOIN dossiers x ON x.id = d.dossier_id WHERE d.cree_le < x.cree_le"), 0);
    }
}

#[test]
fn serialisation_camel_case() {
    let c = base_exemple();
    let tmp = DossierTemp::new();
    let a1 = id_par_nom(&c, "entites", "Benali");
    let v = serde_json::to_value(entites::fiche(&c, &tmp.0, a1).unwrap()).unwrap();
    assert_eq!(v["entite"]["kind"], "a");
    assert!(v["entite"]["categorieId"].is_i64());
    assert!(v["entite"]["creeLe"].is_string());
    assert_eq!(v["entite"]["libelle"], "BENALI Sofia");
    assert!(super::identifiant::forme_valide(v["entite"]["code"].as_str().unwrap()), "{}", v["entite"]["code"]);
    assert_eq!(v["entite"]["dateNaissance"], "1990-05-14");
    for k in ["prenom", "poste", "marque", "cpu", "ram", "stockage"] {
        assert!(v["entite"][k].is_string(), "Entite.{k}");
    }
    let d = &v["dossiers"][0];
    for k in ["aId", "aNom", "bId", "bNom"] {
        assert!(d.get(k).is_none(), "DossierResume.{k} retiré");
    }
    for k in ["themeId", "nbFichiers", "nbSousDossiers", "nbOptions", "nbOptionsCochees", "closLe", "majLe"] {
        assert!(d.get(k).is_some(), "DossierResume.{k}");
    }
    for k in ["id", "nom", "couleur", "role", "nbDossiers"] {
        assert!(d["statut"].get(k).is_some(), "DossierResume.statut.{k}");
    }
    let doc = &v["documents"][0];
    for k in ["dossierNom", "modeleNom", "facons", "champs", "depuis", "modeleId", "sousDossierId", "dateDoc", "fichierNom", "fichierChemin", "apercu", "ouvrable", "pieceFinale", "origine", "blocs"] {
        assert!(doc.get(k).is_some(), "DocumentLie.{k}");
    }
    let ev = &v["evenements"][0];
    for k in ["type", "classe", "titre", "detail", "date", "aId", "bId", "dossierId", "aLibelle", "bLibelle", "dossierNom", "documentId", "documentNom", "champ"] {
        assert!(ev.get(k).is_some(), "Evenement.{k}");
    }
    let t = serde_json::to_value(tableau::calculer(&c).unwrap()).unwrap();
    for k in ["aActives", "aTotal", "bActives", "bTotal", "dossiersTotal", "dossiersOuverts", "dossiersPiece", "repartition", "sansCodeA", "sansCodeB", "dossiersEnCours", "volume"] {
        assert!(t.get(k).is_some(), "TableauDeBord.{k}");
    }
    let p = serde_json::to_value(parametres::lire(&c).unwrap()).unwrap();
    assert_eq!(p["donneesExemple"], true);
    // Saisies : camelCase en entrée.
    let s: SaisieDossier = serde_json::from_str(
        r#"{"nom":"D","annee":2026,"themeId":1,"aId":null,"bId":2,"statutId":null}"#,
    )
    .unwrap();
    // Une interface ancienne qui envoie encore aId / bId n'est pas refusée : ils sont ignorés.
    assert_eq!((s.nom.as_str(), s.statut_id), ("D", None));
    let s: SaisieEntite = serde_json::from_str(
        r#"{"kind":"b","nom":"N","code":null,"marque":"Dell","cpu":"i5","ram":"8 Go","stockage":"SSD","categorieId":3}"#,
    )
    .unwrap();
    assert_eq!(s.kind(), Kind::B);
    let s: SaisieEntite = serde_json::from_str(
        r#"{"kind":"a","nom":"N","prenom":"P","dateNaissance":null,"poste":"","categorieId":3}"#,
    )
    .unwrap();
    assert!(matches!(&s, SaisieEntite::Employe(e) if e.prenom == "P" && e.categorie_id == 3));
    let blocs: Vec<Bloc> = serde_json::from_str(r#"[{"t":"tableau"},{"t":"case","v":"Ok","ok":true}]"#).unwrap();
    assert_eq!(blocs[0].v, "");
    assert_eq!(serde_json::to_string(&blocs[1]).unwrap(), r#"{"t":"case","v":"Ok","ok":true}"#);
}

// ---------- machines : identifiant saisi ----------

#[test]
fn code_format() {
    let m = mini();
    let long = "x".repeat(entites::MAX_IDENTIFIANT_MACHINE + 1);
    for faux in ["", "   ", long.as_str(), "PC\u{0007}01"] {
        let e = entites::definir_code(&m.c, m.b, faux).unwrap_err();
        assert_eq!(e.code, "code_invalide", "{faux:?}");
    }
    let e = entites::creer(&m.c, &machine(m.cat_b, "X", Some(&long))).unwrap_err();
    assert_eq!(e.code, "code_invalide");
    // Identifiant vide à la création = pas d'identifiant ; 40 caractères acceptés.
    let x = entites::creer(&m.c, &machine(m.cat_b, "Sans identifiant", Some("  "))).unwrap();
    assert_eq!(x.code, None);
    let quarante = "y".repeat(entites::MAX_IDENTIFIANT_MACHINE);
    assert_eq!(entites::definir_code(&m.c, x.id, &quarante).unwrap().code.as_deref(), Some(quarante.as_str()));
    let b = entites::definir_code(&m.c, m.b, " 0412 ").unwrap();
    assert_eq!(b.code.as_deref(), Some("0412"));
    // L'identifiant d'un employé n'est jamais saisi.
    assert_eq!(entites::definir_code(&m.c, m.a, "0001").unwrap_err().code, "identifiant_automatique");
}

#[test]
fn code_unique_par_repertoire() {
    let m = mini();
    entites::definir_code(&m.c, m.b, "PC-01").unwrap();
    // Sans tenir compte de la casse.
    let e = entites::creer(&m.c, &machine(m.cat_b, "Autre", Some("pc-01"))).unwrap_err();
    assert_eq!(e.code, "code_doublon");
    assert_eq!(e.message, "Cet identifiant est déjà utilisé par Bravo.");

    // Une fiche garde son propre identifiant en modification.
    let b = entites::modifier(&m.c, m.b, &machine(m.cat_b, "Bravo bis", Some("PC-01"))).unwrap();
    assert_eq!(b.nom, "Bravo bis");
    assert_eq!(b.libelle, "Bravo bis");

    // Doublon en modification et via definir_code.
    let x = entites::creer(&m.c, &machine(m.cat_b, "X", None)).unwrap();
    let e = entites::definir_code(&m.c, x.id, "Pc-01").unwrap_err();
    assert_eq!(e.message, "Cet identifiant est déjà utilisé par Bravo bis.");
    let e = entites::modifier(&m.c, x.id, &machine(m.cat_b, "X", Some("PC-01"))).unwrap_err();
    assert_eq!(e.code, "code_doublon");
}

#[test]
fn fiche_validations_et_archivage() {
    let m = mini();
    let e = entites::creer(&m.c, &employe(m.cat_a, "   ", "", None, "")).unwrap_err();
    assert_eq!(e.code, "saisie_invalide");
    // Catégorie de l'autre répertoire.
    let e = entites::creer(&m.c, &employe(m.cat_b, "Y", "Z", Some("1990-01-01"), "P")).unwrap_err();
    assert_eq!(e.code, "saisie_invalide");
    assert_eq!(e.message, "Choisissez une structure.");
    let e = entites::creer(&m.c, &machine(m.cat_a, "Y", None)).unwrap_err();
    assert_eq!(e.message, "Choisissez un type de machine.");
    // Modifier une machine avec une saisie d'employé : refusé.
    let e = entites::modifier(&m.c, m.b, &employe(m.cat_a, "Y", "Z", Some("1990-01-01"), "P")).unwrap_err();
    assert_eq!(e.code, "saisie_invalide");
    // Catégorie archivée refusée à la création.
    classement::categorie_basculer(&m.c, m.cat_a).unwrap();
    let e = entites::creer(&m.c, &employe(m.cat_a, "Y", "Z", Some("1990-01-01"), "P")).unwrap_err();
    assert_eq!(e.code, "categorie_archivee");
    // … mais une fiche peut garder sa catégorie archivée (ici une fiche incomplète renvoyée telle quelle).
    entites::modifier(&m.c, m.a, &employe(m.cat_a, "Alpha", "", None, "")).unwrap();

    // Archiver ne supprime rien ; réactivable.
    let a = entites::basculer(&m.c, m.a).unwrap();
    assert!(!a.actif);
    assert_eq!(entites::lister(&m.c, Kind::A).unwrap().len(), 1);
    let a = entites::basculer(&m.c, m.a).unwrap();
    assert!(a.actif);
    assert_eq!(evenements(&m.c, journal::FICHE_ARCHIVEE), 1);
    assert_eq!(evenements(&m.c, journal::FICHE_REACTIVEE), 1);
}

// ---------- affectations (§ 9.3) ----------

#[test]
fn affectation_et_retrait() {
    let m = mini();
    entites::associer(&m.c, m.a, m.b).unwrap();
    assert!(entites::sont_associees(&m.c, m.a, m.b).unwrap());
    let e = entites::associer(&m.c, m.a, m.b).unwrap_err();
    assert_eq!(e.code, "deja_associees");
    assert_eq!(e.message, "La machine Bravo est déjà affectée à Alpha.");
    // Ordre employé puis machine imposé.
    assert!(entites::associer(&m.c, m.b, m.a).is_err());
    entites::dissocier(&m.c, m.a, m.b).unwrap();
    assert!(!entites::sont_associees(&m.c, m.a, m.b).unwrap());
    let e = entites::dissocier(&m.c, m.a, m.b).unwrap_err();
    assert_eq!((e.code.as_str(), e.message.as_str()), ("non_associees", "La machine Bravo n’est pas affectée à Alpha."));
    assert_eq!(evenements(&m.c, journal::ASSOCIATION), 1);
    assert_eq!(evenements(&m.c, journal::DISSOCIATION), 1);
    // Rien n'est supprimé : la période terminée reste.
    assert_eq!(compter(&m.c, "SELECT COUNT(*) FROM affectations WHERE fin IS NOT NULL"), 1);
    // Fiche archivée : nouvelle affectation refusée, des deux côtés.
    entites::basculer(&m.c, m.b).unwrap();
    assert_eq!(entites::associer(&m.c, m.a, m.b).unwrap_err().code, "fiche_archivee");
    entites::basculer(&m.c, m.b).unwrap();
    entites::basculer(&m.c, m.a).unwrap();
    assert_eq!(entites::associer(&m.c, m.a, m.b).unwrap_err().code, "fiche_archivee");
    assert_eq!(compter(&m.c, "SELECT COUNT(*) FROM affectations"), 1);
}

#[test]
fn affectations_successives_et_ordre_sur_la_fiche() {
    let m = mini();
    let tmp = DossierTemp::new();
    let b2 = entites::creer(&m.c, &machine(m.cat_b, "Charlie", Some("PC-02"))).unwrap().id;
    let b3 = entites::creer(&m.c, &machine(m.cat_b, "Delta", None)).unwrap().id;
    // Affecter, retirer, réaffecter : deux périodes pour la paire, une seule en cours.
    entites::associer(&m.c, m.a, m.b).unwrap();
    entites::dissocier(&m.c, m.a, m.b).unwrap();
    entites::associer(&m.c, m.a, m.b).unwrap();
    entites::associer(&m.c, m.a, b2).unwrap();
    entites::associer(&m.c, m.a, b3).unwrap();
    entites::dissocier(&m.c, m.a, b3).unwrap();
    assert_eq!(compter(&m.c, "SELECT COUNT(*) FROM affectations"), 4);
    assert_eq!(compter(&m.c, "SELECT COUNT(*) FROM affectations WHERE fin IS NULL"), 2);
    // L'index unique interdit deux périodes en cours pour la même paire, même en SQL direct.
    assert!(
        m.c.execute(&format!("INSERT INTO affectations (a_id, b_id, debut) VALUES ({}, {}, 'x')", m.a, m.b), [])
            .is_err()
    );
    // Les opérations ci-dessus tombent dans la même seconde : dates fixées à la main pour vérifier l'ordre.
    m.c.execute_batch(&format!(
        "UPDATE affectations SET debut = '2026-01-01 08:00:00', fin = '2026-01-05 08:00:00' WHERE b_id = {b} AND fin IS NOT NULL;
         UPDATE affectations SET debut = '2026-02-01 08:00:00' WHERE b_id = {b} AND fin IS NULL;
         UPDATE affectations SET debut = '2026-03-01 08:00:00' WHERE b_id = {b2};
         UPDATE affectations SET debut = '2026-01-10 08:00:00', fin = '2026-04-01 08:00:00' WHERE b_id = {b3};",
        b = m.b
    ))
    .unwrap();

    let f = entites::fiche(&m.c, &tmp.0, m.a).unwrap();
    let vue: Vec<(i64, &str, Option<&str>)> =
        f.affectations.iter().map(|x| (x.entite.id, x.debut.as_str(), x.fin.as_deref())).collect();
    assert_eq!(
        vue,
        [
            // En cours d'abord (la plus récente en tête)…
            (b2, "2026-03-01 08:00:00", None),
            (m.b, "2026-02-01 08:00:00", None),
            // … puis terminées, de la plus récente à la plus ancienne.
            (b3, "2026-01-10 08:00:00", Some("2026-04-01 08:00:00")),
            (m.b, "2026-01-01 08:00:00", Some("2026-01-05 08:00:00")),
        ]
    );
    // `associees` : les fiches des affectations en cours seulement.
    let mut associees: Vec<i64> = f.associees.iter().map(|e| e.id).collect();
    associees.sort();
    assert_eq!(associees, [m.b, b2]);
    // Vue depuis la machine : l'employé de l'autre côté.
    let fb = entites::fiche(&m.c, &tmp.0, m.b).unwrap();
    assert_eq!(fb.affectations.iter().map(|x| (x.entite.id, x.fin.is_some())).collect::<Vec<_>>(), [(m.a, false), (m.a, true)]);
    assert_eq!(fb.associees.iter().map(|e| e.id).collect::<Vec<_>>(), [m.a]);
    // Une fiche archivée depuis reste visible dans les affectations de l'autre côté.
    entites::basculer(&m.c, b3).unwrap();
    let f = entites::fiche(&m.c, &tmp.0, m.a).unwrap();
    assert!(f.affectations.iter().any(|x| x.entite.id == b3 && !x.entite.actif));
    // Sérialisation camelCase.
    let v = serde_json::to_value(&f).unwrap();
    let x = &v["affectations"][0];
    assert!(x["id"].is_i64() && x["debut"].is_string() && x["fin"].is_null() && x["entite"]["libelle"].is_string());
    // Plusieurs employés pour une même machine.
    let a2 = employe_incomplet(&m.c, m.cat_a, "Echo", "");
    entites::associer(&m.c, a2, m.b).unwrap();
    assert_eq!(entites::fiche(&m.c, &tmp.0, m.b).unwrap().associees.len(), 2);
}

#[test]
fn journal_des_affectations_vu_depuis_chaque_fiche() {
    let m = mini();
    entites::associer(&m.c, m.a, m.b).unwrap();
    entites::dissocier(&m.c, m.a, m.b).unwrap();
    let titres = |kind, id| -> Vec<String> {
        journal::pour_entite(&m.c, kind, id).unwrap().into_iter().take(2).map(|e| e.titre).collect()
    };
    // « de » s'élide devant une voyelle (« d’Alpha »), pas devant une consonne (« de Bravo »).
    assert_eq!(titres(Kind::A, m.a), ["Fin de l’affectation de Bravo", "Affectation de Bravo"]);
    assert_eq!(titres(Kind::B, m.b), ["Fin de l’affectation d’Alpha", "Affectation d’Alpha"]);
    assert_eq!(journal::de("Ordinateur 01"), "d’Ordinateur 01");
    assert_eq!(journal::de("Martin"), "de Martin");
}

#[test]
fn retrait_toujours_possible_meme_si_un_dossier_nomme_la_paire() {
    let m = mini();
    let tmp = DossierTemp::new();
    entites::associer(&m.c, m.a, m.b).unwrap();
    let d = dossiers::creer(&m.c, &saisie_dossier(&m, false)).unwrap();
    document_nommant(&m.c, d.id, Some(m.a), Some(m.b));
    entites::dissocier(&m.c, m.a, m.b).unwrap();
    assert!(!entites::sont_associees(&m.c, m.a, m.b).unwrap());
    // Le dossier reste lié aux deux fiches, nommées dans son document.
    let det = dossiers::detail(&m.c, &tmp.0, d.id).unwrap();
    assert_eq!(det.entites_citees.iter().map(|e| e.id).collect::<Vec<_>>(), [m.a, m.b]);
    assert_eq!(entites::fiche(&m.c, &tmp.0, m.a).unwrap().dossiers.len(), 1);
    assert_eq!(entites::fiche(&m.c, &tmp.0, m.b).unwrap().dossiers.len(), 1);
    // Retrait possible aussi avec une fiche archivée, et avec un dossier clôturé.
    entites::associer(&m.c, m.a, m.b).unwrap();
    dossiers::definir_statut(&m.c, d.id, st(&m.c, Role::Clos)).unwrap();
    entites::basculer(&m.c, m.b).unwrap();
    entites::dissocier(&m.c, m.a, m.b).unwrap();
    assert_eq!(compter(&m.c, "SELECT COUNT(*) FROM affectations"), 2);
    assert_eq!(compter(&m.c, "SELECT COUNT(*) FROM affectations WHERE fin IS NULL"), 0);
}

#[test]
fn aucune_affectation_a_la_creation_d_un_dossier() {
    let m = mini();
    let d = dossiers::creer(&m.c, &saisie_dossier(&m, false)).unwrap();
    // § 11.1 : une machine ne s'affecte plus que depuis une fiche.
    assert!(!entites::sont_associees(&m.c, m.a, m.b).unwrap());
    assert_eq!(evenements(&m.c, journal::ASSOCIATION), 0);
    assert_eq!(d.statut.role, Role::Cours);
    assert_eq!(d.nb_options, 2);
    assert_eq!(d.nb_options_cochees, 0);
    let opts: Vec<String> = dossiers::options_lister(&m.c, d.id).unwrap().into_iter().map(|o| o.nom).collect();
    assert_eq!(opts, vec!["Dossier numérisé", "Contenu vérifié"]);
    let mut s = saisie_dossier(&m, true);
    s.nom = "Dossier 2026-02".into();
    let d2 = dossiers::creer(&m.c, &s).unwrap();
    assert_eq!(d2.statut.role, Role::Piece);
    assert_eq!(evenements(&m.c, journal::ASSOCIATION), 0);
    assert_eq!(evenements(&m.c, journal::DOSSIER_OUVERT), 2);
    assert_eq!(evenements(&m.c, journal::PIECE_MANQUANTE), 1);
    // Les événements d'un dossier ne sont rattachés à aucune fiche.
    assert_eq!(compter(&m.c, "SELECT COUNT(*) FROM evenements WHERE dossier_id IS NOT NULL AND (a_id IS NOT NULL OR b_id IS NOT NULL)"), 0);
}

#[test]
fn creation_de_dossier_refusee_avec_theme_archive() {
    let m = mini();
    classement::theme_basculer(&m.c, m.theme).unwrap();
    assert_eq!(dossiers::creer(&m.c, &saisie_dossier(&m, false)).unwrap_err().code, "theme_archive");
    classement::theme_basculer(&m.c, m.theme).unwrap();
    let mut s = saisie_dossier(&m, false);
    s.annee = 12;
    assert_eq!(dossiers::creer(&m.c, &s).unwrap_err().code, "saisie_invalide");
}

#[test]
fn nom_de_dossier_suggere() {
    let c = base_exemple();
    let y = aujourd_hui().year() as i64;
    assert_eq!(dossiers::nom_suggere(&c, y - 1).unwrap(), format!("Dossier {}-05", y - 1));
    assert_eq!(dossiers::nom_suggere(&c, y).unwrap(), format!("Dossier {y}-03"));
    assert_eq!(dossiers::nom_suggere(&c, 1999).unwrap(), "Dossier 1999-01");
}

#[test]
fn nom_de_dossier_suggere_jamais_deja_porte() {
    let m = mini();
    // Un dossier de 2025 renommé avec le nom que 2026 suggérerait.
    let mut s = saisie_dossier(&m, false);
    s.nom = "Dossier 2025-01".into();
    s.annee = 2025;
    let id = dossiers::creer(&m.c, &s).unwrap().id;
    assert_eq!(dossiers::nom_suggere(&m.c, 2026).unwrap(), "Dossier 2026-01");
    dossiers::renommer(&m.c, id, "Dossier 2026-01").unwrap();
    assert_eq!(dossiers::nom_suggere(&m.c, 2026).unwrap(), "Dossier 2026-02");
    assert_eq!(dossiers::nom_suggere(&m.c, 2025).unwrap(), "Dossier 2025-02");
}

// ---------- états du dossier ----------

#[test]
fn transitions_d_etat() {
    let m = mini();
    let tmp = DossierTemp::new();
    let modele = modele_simple(&m.c);
    let id = dossiers::creer(&m.c, &saisie_dossier(&m, false)).unwrap().id;

    // cours → piece
    assert_eq!(dossiers::definir_statut(&m.c, id, st(&m.c, Role::Piece)).unwrap().statut.role, Role::Piece);
    // piece → clos refusé (§ 10.1 : piece → cours est désormais libre, voir tests_v13).
    let e = dossiers::definir_statut(&m.c, id, st(&m.c, Role::Clos)).unwrap_err();
    assert_eq!(e.code, "transition_interdite");
    assert!(e.message.contains("Pièce manquante"), "{}", e.message);
    // Un document ordinaire ne change rien…
    documents::creer_depuis_modele(&m.c, &tmp.0, id, None, modele, false).unwrap();
    assert_eq!(dossiers::resume(&m.c, id).unwrap().statut.role, Role::Piece);
    // … la pièce finale remet en cours.
    let doc = documents::creer_depuis_modele(&m.c, &tmp.0, id, None, modele, true).unwrap();
    assert!(doc.piece_finale);
    assert_eq!(dossiers::resume(&m.c, id).unwrap().statut.role, Role::Cours);
    assert_eq!(evenements(&m.c, journal::PIECE_AJOUTEE), 1);
    // cours → clos
    let r = dossiers::definir_statut(&m.c, id, st(&m.c, Role::Clos)).unwrap();
    assert_eq!(r.statut.role, Role::Clos);
    assert!(r.clos_le.is_some());
    // clos → piece refusé
    assert_eq!(dossiers::definir_statut(&m.c, id, st(&m.c, Role::Piece)).unwrap_err().code, "dossier_clos");
    // clos → cours
    let r = dossiers::definir_statut(&m.c, id, st(&m.c, Role::Cours)).unwrap();
    assert_eq!(r.statut.role, Role::Cours);
    assert!(r.clos_le.is_none());
    // Même état : sans effet.
    assert_eq!(dossiers::definir_statut(&m.c, id, st(&m.c, Role::Cours)).unwrap().statut.role, Role::Cours);

    assert_eq!(evenements(&m.c, journal::PIECE_MANQUANTE), 1);
    assert_eq!(evenements(&m.c, journal::DOSSIER_CLOS), 1);
    assert_eq!(evenements(&m.c, journal::DOSSIER_ROUVERT), 1);
}

#[test]
fn piece_finale_par_import() {
    let m = mini();
    let tmp = DossierTemp::new();
    let src = tmp.0.join("source.PDF");
    fs::write(&src, b"%PDF-1.4 test").unwrap();
    let fichiers = tmp.0.join("fichiers");
    let id = dossiers::creer(&m.c, &saisie_dossier(&m, true)).unwrap().id;
    let doc = documents::importer(&m.c, &fichiers, id, None, &src, true).unwrap();
    assert_eq!(doc.source, "Fichier importé");
    assert_eq!(doc.origine, "import");
    assert_eq!(doc.fichier_nom.as_deref(), Some("source.PDF"));
    let chemin = PathBuf::from(doc.fichier_chemin.clone().unwrap());
    assert!(chemin.is_file());
    assert_eq!(chemin.parent(), Some(fichiers.as_path()));
    assert!(chemin.to_string_lossy().ends_with(".pdf"));
    assert_eq!(dossiers::resume(&m.c, id).unwrap().statut.role, Role::Cours);
    assert_eq!(documents::chemin_externe(&m.c, &fichiers, doc.id).unwrap(), chemin);

    // Supprimer le document supprime sa copie.
    documents::supprimer(&m.c, &fichiers, doc.id).unwrap();
    assert!(!chemin.exists());
    // Source introuvable.
    let e = documents::importer(&m.c, &fichiers, id, None, &tmp.0.join("absent.pdf"), false).unwrap_err();
    assert_eq!(e.code, "fichier_introuvable");
}

#[test]
fn dossier_clos_en_lecture_seule() {
    let m = mini();
    let tmp = DossierTemp::new();
    let modele = modele_simple(&m.c);
    let id = dossiers::creer(&m.c, &saisie_dossier(&m, false)).unwrap().id;
    let sd = dossiers::sous_dossier_creer(&m.c, id, None, "Sous-dossier A").unwrap();
    let doc = documents::creer_depuis_modele(&m.c, &tmp.0, id, Some(sd.id), modele, false).unwrap();
    let opt = dossiers::options_lister(&m.c, id).unwrap()[0].clone();
    let src = tmp.0.join("a.txt");
    fs::write(&src, "x").unwrap();
    dossiers::definir_statut(&m.c, id, st(&m.c, Role::Clos)).unwrap();

    let clos = |r: crate::error::AppResult<()>| {
        let e = r.unwrap_err();
        assert_eq!(e.code, "dossier_clos");
        assert!(e.message.contains("Rouvrez le dossier pour le modifier."));
    };
    clos(dossiers::renommer(&m.c, id, "Nouveau"));
    clos(dossiers::sous_dossier_creer(&m.c, id, None, "X").map(|_| ()));
    clos(dossiers::sous_dossier_renommer(&m.c, sd.id, "X"));
    clos(dossiers::sous_dossier_supprimer(&m.c, &tmp.0, sd.id));
    clos(dossiers::option_creer(&m.c, id, "X").map(|_| ()));
    clos(dossiers::option_cocher(&m.c, opt.id, true));
    clos(dossiers::option_supprimer(&m.c, opt.id));
    clos(documents::creer_depuis_modele(&m.c, &tmp.0, id, None, modele, false).map(|_| ()));
    clos(documents::importer(&m.c, &tmp.0, id, None, &src, false).map(|_| ()));
    clos(documents::renommer(&m.c, doc.id, "X"));
    clos(documents::definir_date(&m.c, doc.id, "2026-01-01"));
    clos(documents::enregistrer_blocs(&m.c, doc.id, doc.blocs.as_deref().unwrap()));
    clos(documents::supprimer(&m.c, &tmp.0, doc.id));

    // Rien n'a bougé.
    let det = dossiers::detail(&m.c, &tmp.0, id).unwrap();
    assert_eq!(det.dossier.nom, "Dossier 2026-01");
    assert_eq!(det.documents.len(), 1);
    assert_eq!(det.sous_dossiers.len(), 1);
    assert_eq!(det.options.len(), 2);
    // La lecture reste possible, et rouvrir permet de modifier.
    dossiers::definir_statut(&m.c, id, st(&m.c, Role::Cours)).unwrap();
    dossiers::renommer(&m.c, id, "Nouveau").unwrap();
}

// ---------- sous-dossiers, options ----------

#[test]
fn sous_dossiers_imbriques_et_suppression_recursive() {
    let m = mini();
    let tmp = DossierTemp::new();
    let fichiers = tmp.0.join("fichiers");
    let id = dossiers::creer(&m.c, &saisie_dossier(&m, false)).unwrap().id;
    let n1 = dossiers::sous_dossier_creer(&m.c, id, None, "N1").unwrap();
    let n2 = dossiers::sous_dossier_creer(&m.c, id, Some(n1.id), "N2").unwrap();
    let n3 = dossiers::sous_dossier_creer(&m.c, id, Some(n2.id), "N3").unwrap();
    let autre = dossiers::sous_dossier_creer(&m.c, id, None, "Autre").unwrap();
    assert_eq!(n3.parent_id, Some(n2.id));
    let src = tmp.0.join("scan.png");
    fs::write(&src, [137u8, 80, 78, 71]).unwrap();
    let profond = documents::importer(&m.c, &fichiers, id, Some(n3.id), &src, false).unwrap();
    let garde = documents::importer(&m.c, &fichiers, id, Some(autre.id), &src, false).unwrap();
    assert_eq!(dossiers::resume(&m.c, id).unwrap().nb_sous_dossiers, 2);
    assert_eq!(dossiers::resume(&m.c, id).unwrap().nb_fichiers, 2);

    // Un parent d'un autre dossier est refusé.
    let mut s = saisie_dossier(&m, false);
    s.nom = "Autre dossier".into();
    let id2 = dossiers::creer(&m.c, &s).unwrap().id;
    assert!(dossiers::sous_dossier_creer(&m.c, id2, Some(n1.id), "X").is_err());

    dossiers::sous_dossier_supprimer(&m.c, &fichiers, n1.id).unwrap();
    let det = dossiers::detail(&m.c, &fichiers, id).unwrap();
    assert_eq!(det.sous_dossiers.len(), 1);
    assert_eq!(det.documents.len(), 1);
    assert!(!PathBuf::from(profond.fichier_chemin.unwrap()).exists());
    assert!(PathBuf::from(garde.fichier_chemin.unwrap()).exists());
}

#[test]
fn options_a_cocher() {
    let m = mini();
    let id = dossiers::creer(&m.c, &saisie_dossier(&m, false)).unwrap().id;
    let o = dossiers::option_creer(&m.c, id, "Signé").unwrap();
    dossiers::option_cocher(&m.c, o.id, true).unwrap();
    let r = dossiers::resume(&m.c, id).unwrap();
    assert_eq!((r.nb_options, r.nb_options_cochees), (3, 1));
    let noms: Vec<String> = dossiers::options_lister(&m.c, id).unwrap().into_iter().map(|o| o.nom).collect();
    assert_eq!(noms.last().map(String::as_str), Some("Signé"));
    dossiers::option_supprimer(&m.c, o.id).unwrap();
    assert_eq!(dossiers::resume(&m.c, id).unwrap().nb_options, 2);
    assert_eq!(dossiers::option_creer(&m.c, id, " ").unwrap_err().code, "saisie_invalide");
}

// ---------- documents et modèles ----------

#[test]
fn instantane_des_blocs_a_la_creation_d_un_document() {
    let m = mini();
    let tmp = DossierTemp::new();
    let modele = modele_simple(&m.c);
    let id = dossiers::creer(&m.c, &saisie_dossier(&m, false)).unwrap().id;
    let doc = documents::creer_depuis_modele(&m.c, &tmp.0, id, None, modele, false).unwrap();
    assert_eq!(doc.nom, "Document_01");
    assert_eq!(doc.source, "Modèle test");
    assert_eq!(doc.origine, "modele");
    assert_eq!(doc.date_doc, super::aujourd_hui());
    assert!(doc.fichier_chemin.is_none());
    let blocs = doc.blocs.clone().unwrap();
    assert_eq!(blocs.len(), 6);
    assert_eq!(blocs[2].val.as_deref(), Some(""));
    assert_eq!(blocs[3].ok, Some(false));
    assert_eq!(blocs[4].val.as_deref(), Some(""));
    assert_eq!(blocs[5].cols.as_ref().unwrap(), &vec!["Colonne 1", "Colonne 2", "Colonne 3"]);
    assert_eq!(blocs[5].rows.as_ref().unwrap().len(), 0);
    assert!(blocs[1].val.is_none());

    // Modifier le modèle ensuite ne change pas le document.
    let mm = modeles::lire(&m.c, modele).unwrap();
    modeles::enregistrer(
        &m.c,
        modele,
        &SaisieModele { nom: "Renommé".into(), theme_id: mm.theme_id, blocs: vec![Bloc::nouveau(TypeBloc::Texte, "Autre")] },
    )
    .unwrap();
    let relu = documents::lire(&m.c, &tmp.0, doc.id).unwrap();
    assert_eq!(relu.blocs, doc.blocs);
    assert_eq!(relu.source, "Modèle test");

    // Saisie : valeurs reportées, structure et variables protégées.
    let mut saisis = blocs.clone();
    saisis[0].v = "Piraté".into();
    saisis[1].val = Some("ne doit pas être stocké".into());
    saisis[2].val = Some("Valeur".into());
    saisis[3].ok = Some(true);
    saisis[4].val = Some("RAM".into());
    saisis[5].rows = Some(vec![vec!["a".into()], vec!["1".into(), "2".into(), "3".into(), "4".into()]]);
    documents::enregistrer_blocs(&m.c, doc.id, &saisis).unwrap();
    let relu = documents::lire(&m.c, &tmp.0, doc.id).unwrap().blocs.unwrap();
    assert_eq!(relu[0].v, "Bonjour");
    assert!(relu[1].val.is_none());
    assert_eq!(relu[2].val.as_deref(), Some("Valeur"));
    assert_eq!(relu[3].ok, Some(true));
    assert_eq!(relu[4].val.as_deref(), Some("RAM"));
    assert_eq!(relu[5].rows.as_ref().unwrap(), &vec![vec!["a", "", ""], vec!["1", "2", "3"]]);
    // Structure différente : refus.
    assert_eq!(documents::enregistrer_blocs(&m.c, doc.id, &saisis[..2]).unwrap_err().code, "blocs_incompatibles");

    // Nom par défaut suivant, date modifiable et validée.
    let doc2 = documents::creer_depuis_modele(&m.c, &tmp.0, id, None, modele, false).unwrap();
    assert_eq!(doc2.nom, "Document_02");
    documents::definir_date(&m.c, doc2.id, "2025-02-28").unwrap();
    assert_eq!(documents::lire(&m.c, &tmp.0, doc2.id).unwrap().date_doc, "2025-02-28");
    assert_eq!(documents::definir_date(&m.c, doc2.id, "2025-02-30").unwrap_err().code, "saisie_invalide");
    documents::renommer(&m.c, doc2.id, "Facture").unwrap();
    assert_eq!(documents::lire(&m.c, &tmp.0, doc2.id).unwrap().nom, "Facture");

    // Modèle archivé : refusé.
    modeles::basculer(&m.c, modele).unwrap();
    assert_eq!(
        documents::creer_depuis_modele(&m.c, &tmp.0, id, None, modele, false).unwrap_err().code,
        "modele_archive"
    );
}

#[test]
fn nom_par_defaut_d_un_document_jamais_deja_porte() {
    let m = mini();
    let tmp = DossierTemp::new();
    let fichiers = tmp.0.join("fichiers");
    let modele = modele_simple(&m.c);
    let id = dossiers::creer(&m.c, &saisie_dossier(&m, false)).unwrap().id;
    let sd = dossiers::sous_dossier_creer(&m.c, id, None, "Sous-dossier A").unwrap();
    let src = tmp.0.join("piece.pdf");
    fs::write(&src, b"%PDF-1.4 test").unwrap();
    let noms = |c: &Connection| -> Vec<String> {
        documents::lister_dossier(c, &fichiers, id).unwrap().into_iter().map(|d| d.nom).collect()
    };
    let unique = |c: &Connection, nom: &str| assert_eq!(noms(c).iter().filter(|n| *n == nom).count(), 1, "{nom} en double");

    // Cas courant : 1, 2, 3 (un dans un sous-dossier, un importé).
    let d1 = documents::creer_depuis_modele(&m.c, &fichiers, id, None, modele, false).unwrap();
    let d2 = documents::creer_depuis_modele(&m.c, &fichiers, id, Some(sd.id), modele, false).unwrap();
    let d3 = documents::importer(&m.c, &fichiers, id, None, &src, false).unwrap();
    assert_eq!((d1.nom.as_str(), d2.nom.as_str(), d3.nom.as_str()), ("Document_01", "Document_02", "Document_03"));

    // Suppression du deuxième : le suivant ne reprend pas Document_03.
    documents::supprimer(&m.c, &fichiers, d2.id).unwrap();
    let d4 = documents::creer_depuis_modele(&m.c, &fichiers, id, None, modele, false).unwrap();
    assert_eq!(d4.nom, "Document_04");
    unique(&m.c, &d4.nom);

    // Même règle pour l'import, et après suppression dans un sous-dossier.
    documents::supprimer(&m.c, &fichiers, d1.id).unwrap();
    let d5 = documents::importer(&m.c, &fichiers, id, Some(sd.id), &src, false).unwrap();
    assert_eq!(d5.nom, "Document_05");
    unique(&m.c, &d5.nom);

    // Un document renommé à la main ne casse pas la numérotation.
    documents::renommer(&m.c, d3.id, "Facture").unwrap();
    let d6 = documents::creer_depuis_modele(&m.c, &fichiers, id, None, modele, false).unwrap();
    assert_eq!(d6.nom, "Document_06");
    // Un nom `Document_NN` choisi à la main est simplement sauté.
    documents::renommer(&m.c, d6.id, "Document_08").unwrap();
    let d7 = documents::importer(&m.c, &fichiers, id, None, &src, false).unwrap();
    assert_eq!(d7.nom, "Document_06");
    let d8 = documents::creer_depuis_modele(&m.c, &fichiers, id, None, modele, false).unwrap();
    assert_eq!(d8.nom, "Document_07");
    let d9 = documents::creer_depuis_modele(&m.c, &fichiers, id, None, modele, false).unwrap();
    assert_eq!(d9.nom, "Document_09");
    for nom in noms(&m.c) {
        unique(&m.c, &nom);
    }
}

#[test]
fn nom_d_un_nouveau_modele_jamais_deja_porte() {
    let m = mini();
    let m1 = modeles::creer(&m.c).unwrap();
    let m2 = modeles::creer(&m.c).unwrap();
    assert_eq!((m1.nom.as_str(), m2.nom.as_str()), ("Modèle 01", "Modèle 02"));
    // Le premier renommé avec le nom que le suivant recevrait.
    modeles::enregistrer(&m.c, m1.id, &SaisieModele { nom: "Modèle 03".into(), theme_id: m1.theme_id, blocs: vec![] }).unwrap();
    let m3 = modeles::creer(&m.c).unwrap();
    assert_eq!(m3.nom, "Modèle 04");
    let noms: Vec<String> = modeles::lister(&m.c).unwrap().into_iter().map(|x| x.nom).collect();
    assert_eq!(noms.iter().filter(|n| **n == m3.nom).count(), 1);
}

#[test]
fn modeles_creer_dupliquer_enregistrer() {
    let c = base_exemple();
    let m = modeles::creer(&c).unwrap();
    assert_eq!(m.nom, "Modèle 05");
    assert_eq!(m.theme, "Support informatique");
    assert!(m.blocs.is_empty());
    assert!(m.actif);
    assert!(!m.standard);
    let m1 = id_par_nom(&c, "modeles", super::standards::ETAT_DES_BESOINS);
    let copie = modeles::dupliquer(&c, m1).unwrap();
    assert_eq!(copie.nom, "État des besoins (copie)");
    assert!(copie.actif);
    assert!(!copie.standard, "la copie d'un modèle standard n'est pas standard");
    assert_eq!(copie.blocs, modeles::lire(&c, m1).unwrap().blocs);

    let e = modeles::enregistrer(
        &c,
        m.id,
        &SaisieModele { nom: "X".into(), theme_id: m.theme_id, blocs: vec![Bloc::nouveau(TypeBloc::Variable, "Inconnue")] },
    )
    .unwrap_err();
    assert_eq!(e.code, "saisie_invalide");
    let mut tab = Bloc::nouveau(TypeBloc::Tableau, "");
    tab.cols = Some(vec!["Qté".into(), " ".into()]);
    tab.val = Some("ignoré".into());
    let enr = modeles::enregistrer(&c, m.id, &SaisieModele { nom: " Mon modèle ".into(), theme_id: m.theme_id, blocs: vec![tab] }).unwrap();
    assert_eq!(enr.nom, "Mon modèle");
    assert_eq!(enr.blocs[0].cols.as_ref().unwrap(), &vec!["Qté", "Colonne 2"]);
    assert!(enr.blocs[0].val.is_none());
    // Thème archivé refusé s'il change.
    let x = id_par_nom(&c, "themes", "Ancien parc");
    assert_eq!(
        modeles::enregistrer(&c, m.id, &SaisieModele { nom: "X".into(), theme_id: x, blocs: vec![] }).unwrap_err().code,
        "theme_archive"
    );
    assert!(!modeles::basculer(&c, m.id).unwrap().actif);

    // Sans thème actif : création refusée.
    let vide = base();
    assert_eq!(modeles::creer(&vide).unwrap_err().code, "aucun_theme");
}

// ---------- classement et paramètres ----------

#[test]
fn classement_unicite_et_bascule() {
    let c = base();
    classement::theme_creer(&c, "Thème A").unwrap();
    assert_eq!(classement::theme_creer(&c, " thème a ").unwrap_err().code, "doublon");
    assert_eq!(classement::theme_creer(&c, "").unwrap_err().code, "saisie_invalide");
    let k = classement::magasin_creer(&c, "RAM").unwrap();
    assert_eq!(classement::magasin_creer(&c, "ram").unwrap_err().code, "doublon");
    assert!(!classement::magasin_basculer(&c, k.id).unwrap().actif);
    assert!(classement::magasin_basculer(&c, k.id).unwrap().actif);
    classement::categorie_creer(&c, Kind::A, "Atelier").unwrap();
    // Même nom dans l'autre répertoire : permis.
    classement::categorie_creer(&c, Kind::B, "Atelier").unwrap();
    let e = classement::categorie_creer(&c, Kind::A, "Atelier").unwrap_err();
    assert_eq!((e.code.as_str(), e.message.as_str()), ("doublon", "Cette structure existe déjà."));
    let e = classement::categorie_creer(&c, Kind::B, "atelier").unwrap_err();
    assert_eq!(e.message, "Ce type de machine existe déjà.");
    assert_eq!(classement::categories_lister(&c, Kind::A).unwrap().len(), 1);
    assert_eq!(classement::theme_basculer(&c, 999).unwrap_err().code, "introuvable");
}

#[test]
fn parametres_lecture_et_ecriture() {
    let c = base();
    let p = parametres::lire(&c).unwrap();
    assert_eq!((p.theme.as_str(), p.densite.as_str(), p.donnees_exemple), ("system", "eq", false));
    parametres::definir(&c, "theme", "dark").unwrap();
    parametres::definir(&c, "densite", "compact").unwrap();
    let p = parametres::lire(&c).unwrap();
    assert_eq!((p.theme.as_str(), p.densite.as_str()), ("dark", "compact"));
    assert!(parametres::definir(&c, "theme", "rose").is_err());
    assert!(parametres::definir(&c, "donnees_exemple", "1").is_err());
}

// ---------- journal ----------

#[test]
fn journal_alimente() {
    let m = mini();
    entites::definir_code(&m.c, m.b, "0102").unwrap();
    entites::modifier(&m.c, m.a, &employe(m.cat_a, "Alpha 2", "Anne", Some("1990-01-01"), "Agent")).unwrap();
    entites::associer(&m.c, m.a, m.b).unwrap();
    let id = dossiers::creer(&m.c, &saisie_dossier(&m, false)).unwrap().id;
    // § 11.2 : les événements du dossier entrent dans l'historique des fiches nommées dans ses documents.
    document_nommant(&m.c, id, Some(m.a), Some(m.b));
    dossiers::definir_statut(&m.c, id, st(&m.c, Role::Clos)).unwrap();

    let ev_a = journal::pour_entite(&m.c, Kind::A, m.a).unwrap();
    let types_a: Vec<&str> = ev_a.iter().map(|e| e.r#type.as_str()).collect();
    for t in ["fiche_creee", "fiche_modifiee", "code_saisi", "association", "dossier_ouvert", "dossier_clos"] {
        assert!(types_a.contains(&t), "{t} absent du journal de A : {types_a:?}");
    }
    assert!(!ev_a.iter().any(|e| e.r#type == "code_saisi" && e.detail.contains("0102")), "le code de B ne concerne pas A");
    // Du plus récent au plus ancien.
    assert!(ev_a.windows(2).all(|w| (w[0].date.as_str(), w[0].id) >= (w[1].date.as_str(), w[1].id)));
    // Titre formulé du point de vue de la fiche.
    let assoc = ev_a.iter().find(|e| e.r#type == "association").unwrap();
    assert_eq!(assoc.titre, "Affectation de Bravo");
    assert_eq!(assoc.detail, "Début de l’affectation (identifiant 0102).");
    assert_eq!(assoc.classe, "assoc");
    let clos = ev_a.iter().find(|e| e.r#type == "dossier_clos").unwrap();
    assert_eq!(clos.classe, "clos");
    assert_eq!(clos.titre, "Dossier 2026-01 clôturé");
    assert_eq!(clos.dossier_id, Some(id));

    let ev_b = journal::pour_entite(&m.c, Kind::B, m.b).unwrap();
    let assoc_b = ev_b.iter().find(|e| e.r#type == "association").unwrap();
    assert_eq!(assoc_b.titre, "Affectation d’ALPHA 2 Anne");
    let code_a = entites::lire(&m.c, m.a).unwrap().code.unwrap();
    assert_eq!(assoc_b.detail, format!("Début de l’affectation (identifiant {code_a})."));
    assert!(ev_b.iter().any(|e| e.r#type == "code_saisi"));
    assert!(!ev_b.iter().any(|e| e.r#type == "fiche_modifiee"));
}

// ---------- recherche ----------

#[test]
fn recherche_globale() {
    let c = base_exemple();
    let r = recherche::rechercher(&c, "  ").unwrap();
    assert!(r.a.is_empty() && r.b.is_empty() && r.dossiers.is_empty());

    // Employés par nom ou prénom, sans tenir compte de la casse ni des accents.
    for q in ["sofia", "BENALI", "bénali"] {
        let r = recherche::rechercher(&c, q).unwrap();
        assert_eq!(r.a.iter().map(|e| e.nom.as_str()).collect::<Vec<_>>(), ["Benali"], "{q}");
        assert!(r.b.is_empty(), "{q}");
    }
    for q in ["leila", "LEÏLA"] {
        assert_eq!(recherche::rechercher(&c, q).unwrap().a[0].prenom, "Leïla", "{q}");
    }
    // Machines par nom, marque ou identifiant ; plus de limite à 4 (§ 10.2), totaux renseignés.
    let r = recherche::rechercher(&c, "dell").unwrap();
    assert_eq!((r.b.len(), r.b_total), (2, 2));
    assert!(r.a.is_empty());
    assert_eq!(r.a_total, 0);
    let r = recherche::rechercher(&c, "pc").unwrap();
    assert_eq!((r.b.len(), r.b_total), (4, 4));
    let r = recherche::rechercher(&c, "dossier").unwrap();
    assert_eq!((r.dossiers.len(), r.dossiers_total), (7, 7));

    // Identifiant exact, sous ses formes : la fiche vient en tête.
    for q in ["PC-0103", "pc-0103", "#PC-0103", "code PC-0103"] {
        let r = recherche::rechercher(&c, q).unwrap();
        assert_eq!(r.b.len(), 1, "{q}");
        assert_eq!(r.b[0].nom, "Poste laboratoire 02");
        assert!(r.a.is_empty(), "{q}");
    }
    let code: String = c.query_row("SELECT code FROM entites WHERE nom = 'Benali'", [], |r| r.get(0)).unwrap();
    let r = recherche::rechercher(&c, &code.to_lowercase()).unwrap();
    assert_eq!(r.a.len(), 1);
    assert_eq!(r.a[0].nom, "Benali");
    let r = recherche::rechercher(&c, "PC-0101").unwrap();
    assert_eq!(r.b[0].code.as_deref(), Some("PC-0101"));
    // Rien de tel.
    let r = recherche::rechercher(&c, "x0001").unwrap();
    assert!(r.a.is_empty() && r.b.is_empty());
    let y = aujourd_hui().year();
    let r = recherche::rechercher(&c, &format!("{y}-02")).unwrap();
    assert_eq!(r.dossiers.len(), 1);
}

// ---------- tableau de bord ----------

#[test]
fn tableau_de_bord() {
    let c = base_exemple();
    let y = aujourd_hui().year() as i64;
    let t = tableau::calculer_pour(&c, y).unwrap();
    assert_eq!((t.a_actives, t.a_total, t.b_actives, t.b_total), (7, 8, 7, 8));
    assert_eq!((t.dossiers_total, t.dossiers_ouverts, t.dossiers_piece), (7, 4, 2));
    let repartition: Vec<(Role, i64)> = t.repartition.iter().map(|r| (r.statut.role, r.nb)).collect();
    assert_eq!(repartition, [(Role::Cours, 2), (Role::Piece, 2), (Role::Clos, 3)]);
    let sans_a: Vec<&str> = t.sans_code_a.iter().map(|e| e.libelle.as_str()).collect();
    assert_eq!(sans_a, vec!["CHERIF Amine", "DJEBBAR Samia"]);
    let sans_b: Vec<&str> = t.sans_code_b.iter().map(|e| e.nom.as_str()).collect();
    assert_eq!(sans_b, vec!["PC atelier", "Portable mission 01"]);
    assert_eq!(t.dossiers_en_cours.len(), 4);
    assert!(t.dossiers_en_cours.iter().all(|d| d.statut.role != Role::Clos));
    assert_eq!(t.volume.annee, y);
    assert_eq!(t.volume.mois.len(), 12);
    let attendu = compter(&c, &format!("SELECT COUNT(*) FROM documents WHERE cree_le LIKE '{y}-%'"));
    assert_eq!(t.volume.mois.iter().sum::<i64>(), attendu);
    assert!(attendu > 0, "les données d'exemple doivent alimenter l'année en cours");

    // Un document ajouté aujourd'hui compte dans le mois en cours.
    let tmp = DossierTemp::new();
    let mois = aujourd_hui().month0() as usize;
    let avant = tableau::calculer(&c).unwrap().volume.mois[mois];
    let d1 = id_par_nom(&c, "dossiers", &format!("Dossier {}-01", y - 1));
    let m1 = id_par_nom(&c, "modeles", super::standards::ETAT_DES_BESOINS);
    documents::creer_depuis_modele(&c, &tmp.0, d1, None, m1, false).unwrap();
    assert_eq!(tableau::calculer(&c).unwrap().volume.mois[mois], avant + 1);
}

// ---------- réinitialisation ----------

#[test]
fn reinitialisation_des_donnees() {
    let c = base_exemple();
    let tmp = DossierTemp::new();
    let fichiers = tmp.0.join("fichiers");
    fs::create_dir_all(&fichiers).unwrap();
    fs::write(fichiers.join("copie.pdf"), "x").unwrap();
    parametres::definir(&c, "theme", "dark").unwrap();

    donnees::reinitialiser(&c, &tmp.0, &fichiers, ModeReinit::Vide, aujourd_hui()).unwrap();
    for table in ["entites", "affectations", "categories", "magasin", "dossiers", "sous_dossiers", "documents", "options", "evenements"] {
        assert_eq!(compter(&c, &format!("SELECT COUNT(*) FROM {table}")), 0, "{table}");
    }
    // Seuls restent les modèles standards et leur thème.
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM themes"), 1);
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM modeles WHERE standard IS NOT NULL"), 4);
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM modeles"), 4);
    let p = parametres::lire(&c).unwrap();
    assert!(!p.donnees_exemple);
    assert_eq!(p.theme, "dark", "les préférences d'affichage sont conservées");
    assert!(!db::est_neuve(&c).unwrap(), "une base vidée n'est pas re-remplie au lancement suivant");
    assert!(fichiers.is_dir());
    assert_eq!(fs::read_dir(&fichiers).unwrap().count(), 0);

    donnees::reinitialiser(&c, &tmp.0, &fichiers, ModeReinit::Exemple, aujourd_hui()).unwrap();
    assert!(parametres::lire(&c).unwrap().donnees_exemple);
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM dossiers"), 7);
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM entites"), 16);
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM modeles"), 4, "modèles standards sans doublon");

    assert!(ModeReinit::depuis("tout").is_err());
}

#[test]
fn reinitialisation_precedee_d_une_sauvegarde() {
    let c = base_exemple();
    let tmp = DossierTemp::new();
    let fichiers = tmp.0.join("fichiers");
    fs::create_dir_all(&fichiers).unwrap();
    fs::write(fichiers.join("copie.pdf"), "x").unwrap();
    // Un dossier étranger dans `sauvegardes/` n'est jamais touché.
    fs::create_dir_all(tmp.0.join("sauvegardes").join("mes notes")).unwrap();

    donnees::reinitialiser(&c, &tmp.0, &fichiers, ModeReinit::Vide, aujourd_hui()).unwrap();
    let sauvegardes = || -> Vec<PathBuf> {
        let mut v: Vec<PathBuf> = fs::read_dir(tmp.0.join("sauvegardes"))
            .unwrap()
            .map(|e| e.unwrap().path())
            .filter(|p| p.file_name().unwrap() != "mes notes")
            .collect();
        v.sort();
        v
    };
    let premiere = sauvegardes().pop().unwrap();
    // La base d'avant et les fichiers d'avant sont récupérables.
    let ancienne = Connection::open(premiere.join("donnees.sqlite")).unwrap();
    assert_eq!(compter(&ancienne, "SELECT COUNT(*) FROM entites"), 16);
    assert_eq!(fs::read_to_string(premiere.join("fichiers").join("copie.pdf")).unwrap(), "x");
    drop(ancienne);

    // Deux vieilles sauvegardes (plus de 7 jours) : elles partent dès qu'il y en a plus de trois.
    for vieille in ["2020-01-01_10-00-00", "2020-01-02_10-00-00"] {
        fs::create_dir_all(tmp.0.join("sauvegardes").join(vieille)).unwrap();
    }
    for _ in 0..4 {
        donnees::reinitialiser(&c, &tmp.0, &fichiers, ModeReinit::Exemple, aujourd_hui()).unwrap();
    }
    assert!(premiere.join("donnees.sqlite").is_file(), "4 réinitialisations d'affilée gardent la toute première sauvegarde");
    assert_eq!(sauvegardes().len(), 5, "les sauvegardes de moins de 7 jours ne sont jamais supprimées");
    assert!(!tmp.0.join("sauvegardes").join("2020-01-01_10-00-00").exists());
    assert!(!tmp.0.join("sauvegardes").join("2020-01-02_10-00-00").exists());
    assert!(tmp.0.join("sauvegardes").join("mes notes").is_dir());
}

#[cfg(windows)]
#[test]
fn reinitialisation_refusee_si_un_fichier_est_verrouille() {
    use std::os::windows::fs::OpenOptionsExt;
    let c = base_exemple();
    let tmp = DossierTemp::new();
    let fichiers = tmp.0.join("fichiers");
    fs::create_dir_all(&fichiers).unwrap();
    fs::write(fichiers.join("copie.pdf"), "x").unwrap();
    let verrou = fs::OpenOptions::new().read(true).share_mode(0).open(fichiers.join("copie.pdf")).unwrap();
    let e = donnees::reinitialiser(&c, &tmp.0, &fichiers, ModeReinit::Vide, aujourd_hui()).unwrap_err();
    assert_eq!(e.code, "fichier_ouvert");
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM entites"), 16, "rien n'est effacé");
    drop(verrou);
    assert!(fichiers.join("copie.pdf").is_file());
}

// ---------- sécurité des fichiers importés ----------

/// Insère un document importé dont `fichier_stocke` est choisi librement (base piégée).
fn document_piege(m: &Mini, dossier_id: i64, stocke: &str, nom: &str) -> i64 {
    m.c.execute(
        "INSERT INTO documents (dossier_id, nom, origine, source, date_doc, fichier_stocke, fichier_nom, cree_le)
         VALUES (?1, 'Piège', 'import', 'x', '2026-01-01', ?2, ?3, '2026-01-01 00:00:00')",
        rusqlite::params![dossier_id, stocke, nom],
    )
    .unwrap();
    m.c.last_insert_rowid()
}

#[test]
fn import_d_un_executable_stocke_en_bin_et_jamais_ouvert() {
    let m = mini();
    let tmp = DossierTemp::new();
    let fichiers = tmp.0.join("fichiers");
    let id = dossiers::creer(&m.c, &saisie_dossier(&m, false)).unwrap().id;
    for nom in ["Devis.pdf.exe", "page.hta", "raccourci.lnk", "script.bat", "page.html", "image.svg", "sans_extension"] {
        let src = tmp.0.join(nom);
        fs::write(&src, b"MZ contenu").unwrap();
        let doc = documents::importer(&m.c, &fichiers, id, None, &src, false).unwrap();
        assert_eq!(doc.fichier_nom.as_deref(), Some(nom));
        assert!(doc.fichier_chemin.as_deref().unwrap().ends_with(".bin"), "{nom}");
        assert!(!doc.ouvrable, "{nom}");
        assert_eq!(doc.apercu, Apercu::Aucun);
        assert_eq!(documents::chemin_externe(&m.c, &fichiers, doc.id).unwrap_err().code, "type_interdit", "{nom}");
    }
}

#[test]
fn base_piegee_type_interdit_et_traversee_refusees() {
    let m = mini();
    let tmp = DossierTemp::new();
    let fichiers = tmp.0.join("fichiers");
    fs::create_dir_all(&fichiers).unwrap();
    let id = dossiers::creer(&m.c, &saisie_dossier(&m, false)).unwrap().id;

    // Copie au nom valide mais d'extension exécutable, affichée comme un PDF.
    let hta = "0b1c2d3e-4f50-4617-8899-aabbccddeeff.hta";
    fs::write(fichiers.join(hta), "<script>alert(1)</script>").unwrap();
    let doc = document_piege(&m, id, hta, "Devis.pdf");
    assert_eq!(documents::chemin_externe(&m.c, &fichiers, doc).unwrap_err().code, "type_interdit");
    let lu = documents::lire(&m.c, &fichiers, doc).unwrap();
    assert!(!lu.ouvrable);
    assert_eq!(lu.apercu, Apercu::Aucun);

    // Chemins qui sortent de `fichiers/` : la cible existe, mais rien n'y donne accès.
    let cible = tmp.0.join("secret.pdf");
    fs::write(&cible, b"%PDF-1.4 secret").unwrap();
    for stocke in [
        "..\\secret.pdf".to_string(),
        "../secret.pdf".to_string(),
        cible.to_string_lossy().into_owned(),
        r"\\localhost\c$\Windows\win.ini".to_string(),
        "C:secret.pdf".to_string(),
    ] {
        let doc = document_piege(&m, id, &stocke, "secret.pdf");
        let lu = documents::lire(&m.c, &fichiers, doc).unwrap();
        assert_eq!(lu.fichier_chemin, None, "{stocke}");
        assert!(!lu.ouvrable, "{stocke}");
        assert_eq!(lu.apercu, Apercu::Aucun, "{stocke}");
        assert_eq!(documents::chemin_externe(&m.c, &fichiers, doc).unwrap_err().code, "fichier_invalide", "{stocke}");
        documents::supprimer(&m.c, &fichiers, doc).unwrap();
        assert!(cible.is_file(), "la suppression ne sort pas de fichiers/ : {stocke}");
    }
}

#[cfg(windows)]
#[test]
fn lien_symbolique_dans_fichiers_refuse() {
    let m = mini();
    let tmp = DossierTemp::new();
    let fichiers = tmp.0.join("fichiers");
    fs::create_dir_all(&fichiers).unwrap();
    let id = dossiers::creer(&m.c, &saisie_dossier(&m, false)).unwrap().id;
    let cible = tmp.0.join("secret.pdf");
    fs::write(&cible, b"%PDF-1.4 secret").unwrap();
    let lien = "0b1c2d3e-4f50-4617-8899-aabbccddee99.pdf";
    // Créer un lien symbolique demande le mode développeur ou des droits élevés : sinon, test sans objet.
    if std::os::windows::fs::symlink_file(&cible, fichiers.join(lien)).is_err() {
        return;
    }
    let doc = document_piege(&m, id, lien, "x.pdf");
    assert_eq!(documents::lire(&m.c, &fichiers, doc).unwrap().fichier_chemin, None);
    assert_eq!(documents::chemin_externe(&m.c, &fichiers, doc).unwrap_err().code, "fichier_introuvable");
}

#[test]
fn apercu_et_ouverture_decides_par_le_contenu_stocke() {
    let m = mini();
    let tmp = DossierTemp::new();
    let fichiers = tmp.0.join("fichiers");
    let id = dossiers::creer(&m.c, &saisie_dossier(&m, false)).unwrap().id;
    let importer = |nom: &str, contenu: &[u8]| {
        let src = tmp.0.join(nom);
        fs::write(&src, contenu).unwrap();
        documents::importer(&m.c, &fichiers, id, None, &src, false).unwrap()
    };
    let png = importer("scan.png", b"\x89PNG\r\n\x1a\n0000");
    assert_eq!((png.apercu, png.ouvrable), (Apercu::Image, true));
    let pdf = importer("devis.pdf", b"%PDF-1.7 ...");
    assert_eq!((pdf.apercu, pdf.ouvrable), (Apercu::Pdf, true));
    // Le nom d'origine ne compte pas : un HTML renommé en .png n'a pas d'aperçu.
    let faux = importer("photo.png", b"<html><script>alert(1)</script></html>");
    assert_eq!((faux.apercu, faux.ouvrable), (Apercu::Aucun, true));
    let docx = importer("lettre.docx", b"PK\x03\x04");
    assert_eq!((docx.apercu, docx.ouvrable), (Apercu::Aucun, true));
    let modele = documents::creer_depuis_modele(&m.c, &fichiers, id, None, modele_simple(&m.c), false).unwrap();
    assert_eq!((modele.apercu, modele.ouvrable, modele.fichier_chemin), (Apercu::Aucun, false, None));
    // Copie disparue : plus de chemin, plus d'aperçu, plus d'ouverture.
    fs::remove_file(pdf.fichier_chemin.as_deref().unwrap()).unwrap();
    let pdf = documents::lire(&m.c, &fichiers, pdf.id).unwrap();
    assert_eq!((pdf.apercu, pdf.ouvrable, pdf.fichier_chemin), (Apercu::Aucun, false, None));
}

#[test]
fn source_d_import_refusee() {
    let m = mini();
    let tmp = DossierTemp::new();
    let fichiers = tmp.0.join("fichiers");
    let id = dossiers::creer(&m.c, &saisie_dossier(&m, false)).unwrap().id;
    // Dossier, chemin relatif, tube nommé, chemin \\?\ saisi tel quel, périphérique.
    // (Les partages réseau sont acceptés : voir `copies::tests::chemins_acceptes`.)
    let refus = |p: &std::path::Path| documents::importer(&m.c, &fichiers, id, None, p, false).unwrap_err().code;
    assert_eq!(refus(&tmp.0), "fichier_introuvable");
    for p in ["relatif.pdf", r"\\.\pipe\entites-test", r"\\?\C:\Windows\win.ini", r"C:\NUL"] {
        assert_eq!(refus(std::path::Path::new(p)), "source_refusee", "{p}");
    }
    // Trop volumineux (fichier creux : rien n'est réellement écrit ni copié).
    let gros = tmp.0.join("gros.pdf");
    fs::File::create(&gros).unwrap().set_len(copies::TAILLE_MAX_IMPORT + 1).unwrap();
    assert_eq!(refus(&gros), "fichier_trop_volumineux");
    assert_eq!(fs::read_dir(&fichiers).map(|d| d.count()).unwrap_or(0), 0, "aucune copie laissée");
    assert_eq!(compter(&m.c, "SELECT COUNT(*) FROM documents"), 0);
}

#[cfg(windows)]
fn zone(chemin: &std::path::Path) -> Option<String> {
    let mut flux = chemin.as_os_str().to_owned();
    flux.push(":Zone.Identifier");
    fs::read_to_string(flux).ok()
}

#[cfg(windows)]
#[test]
fn marque_internet_a_l_import_et_avant_ouverture() {
    let m = mini();
    let tmp = DossierTemp::new();
    let fichiers = tmp.0.join("fichiers");
    let id = dossiers::creer(&m.c, &saisie_dossier(&m, false)).unwrap().id;
    let src = tmp.0.join("lettre.docx");
    fs::write(&src, b"PK\x03\x04").unwrap();
    let doc = documents::importer(&m.c, &fichiers, id, None, &src, false).unwrap();
    let chemin = PathBuf::from(doc.fichier_chemin.unwrap());
    assert!(zone(&chemin).is_some_and(|z| z.contains("ZoneId=3")), "marque absente après import");
    // Marque retirée entre-temps : elle est reposée avant l'ouverture externe.
    let mut flux = chemin.as_os_str().to_owned();
    flux.push(":Zone.Identifier");
    fs::remove_file(&flux).unwrap();
    assert_eq!(documents::chemin_externe(&m.c, &fichiers, doc.id).unwrap(), chemin);
    assert!(zone(&chemin).is_some_and(|z| z.contains("ZoneId=3")), "marque absente avant ouverture");
}

#[test]
fn enregistrer_une_copie_meme_d_un_fichier_bin() {
    let m = mini();
    let tmp = DossierTemp::new();
    let fichiers = tmp.0.join("fichiers");
    let id = dossiers::creer(&m.c, &saisie_dossier(&m, false)).unwrap().id;
    let src = tmp.0.join("outil.exe");
    fs::write(&src, b"MZ contenu").unwrap();
    let doc = documents::importer(&m.c, &fichiers, id, None, &src, false).unwrap();
    assert!(!doc.ouvrable);
    let (source, nom) = documents::source_export(&m.c, &fichiers, doc.id).unwrap();
    assert_eq!(nom, "outil.exe");
    let destination = tmp.0.join("export").join(&nom);
    fs::create_dir_all(destination.parent().unwrap()).unwrap();
    copies::exporter_copie(&fichiers, &source, &destination).unwrap();
    assert_eq!(fs::read(&destination).unwrap(), b"MZ contenu");
    #[cfg(windows)]
    assert!(zone(&destination).is_some_and(|z| z.contains("ZoneId=3")), "copie exportée sans marque");
    // Pas d'enregistrement dans `fichiers/` lui-même.
    let e = copies::exporter_copie(&fichiers, &source, &fichiers.join("x.exe")).unwrap_err();
    assert_eq!(e.code, "destination_refusee");
    // Sans copie valide : refus.
    let modele = documents::creer_depuis_modele(&m.c, &fichiers, id, None, modele_simple(&m.c), false).unwrap();
    assert_eq!(documents::source_export(&m.c, &fichiers, modele.id).unwrap_err().code, "sans_fichier");
    let piege = document_piege(&m, id, r"..\outil.exe", "outil.exe");
    assert_eq!(documents::source_export(&m.c, &fichiers, piege).unwrap_err().code, "fichier_invalide");
}

#[test]
fn bornes_non_retroactives() {
    let m = mini();
    let tmp = DossierTemp::new();
    let modele = modele_simple(&m.c);
    let id = dossiers::creer(&m.c, &saisie_dossier(&m, false)).unwrap().id;
    let doc = documents::creer_depuis_modele(&m.c, &tmp.0, id, None, modele, false).unwrap();
    let mut blocs = doc.blocs.clone().unwrap();
    let i_tableau = blocs.iter().position(|b| b.t == TypeBloc::Tableau).unwrap();
    let i_champ = blocs.iter().position(|b| b.t == TypeBloc::Champ).unwrap();
    // Document antérieur aux bornes : 600 lignes, écrit directement en base.
    blocs[i_tableau].rows = Some(vec![vec!["a".into(), "b".into(), "c".into()]; 600]);
    m.c.execute(
        "UPDATE documents SET blocs = ?1 WHERE id = ?2",
        rusqlite::params![serde_json::to_string(&blocs).unwrap(), doc.id],
    )
    .unwrap();
    // Modifier un champ reste possible ; ajouter une ligne ne l'est pas.
    blocs[i_champ].val = Some("modifié".into());
    documents::enregistrer_blocs(&m.c, doc.id, &blocs).unwrap();
    blocs[i_tableau].rows.as_mut().unwrap().push(vec!["d".into()]);
    assert_eq!(documents::enregistrer_blocs(&m.c, doc.id, &blocs).unwrap_err().code, "saisie_invalide");

    // Un modèle aux blocs illisibles n'est ni écrasé ni dupliqué.
    m.c.execute("UPDATE modeles SET blocs = '{abîmé' WHERE id = ?1", [modele]).unwrap();
    let avant = modeles::lire(&m.c, modele).unwrap();
    let saisie = SaisieModele { nom: avant.nom.clone(), theme_id: avant.theme_id, blocs: vec![] };
    assert_eq!(modeles::enregistrer(&m.c, modele, &saisie).unwrap_err().code, "donnees_illisibles");
    assert_eq!(modeles::dupliquer(&m.c, modele).unwrap_err().code, "donnees_illisibles");
    let brut: String = m.c.query_row("SELECT blocs FROM modeles WHERE id = ?1", [modele], |r| r.get(0)).unwrap();
    assert_eq!(brut, "{abîmé");
}

#[cfg(windows)]
#[test]
fn suppression_refusee_si_la_copie_est_verrouillee() {
    use std::os::windows::fs::OpenOptionsExt;
    let m = mini();
    let tmp = DossierTemp::new();
    let fichiers = tmp.0.join("fichiers");
    let id = dossiers::creer(&m.c, &saisie_dossier(&m, false)).unwrap().id;
    let src = tmp.0.join("a.pdf");
    fs::write(&src, b"%PDF-1.4").unwrap();
    let doc = documents::importer(&m.c, &fichiers, id, None, &src, false).unwrap();
    let chemin = PathBuf::from(doc.fichier_chemin.unwrap());
    let verrou = fs::OpenOptions::new().read(true).share_mode(0).open(&chemin).unwrap();
    assert_eq!(documents::supprimer(&m.c, &fichiers, doc.id).unwrap_err().code, "fichier_ouvert");
    assert!(documents::lire(&m.c, &fichiers, doc.id).is_ok(), "le document est conservé");
    drop(verrou);
    assert!(chemin.is_file());
    documents::supprimer(&m.c, &fichiers, doc.id).unwrap();
    assert!(!chemin.exists());
    assert_eq!(fs::read_dir(&fichiers).unwrap().count(), 0, "aucune copie mise de côté ne reste");
}

// ---------- données relues : tolérance et bornes ----------

#[test]
fn blocs_illisibles_n_empechent_pas_l_affichage() {
    let m = mini();
    let tmp = DossierTemp::new();
    let modele = modele_simple(&m.c);
    let id = dossiers::creer(&m.c, &saisie_dossier(&m, false)).unwrap().id;
    let bon = documents::creer_depuis_modele(&m.c, &tmp.0, id, None, modele, false).unwrap();
    let abime = documents::creer_depuis_modele(&m.c, &tmp.0, id, None, modele, false).unwrap();
    m.c.execute("UPDATE documents SET blocs = '{pas du json' WHERE id = ?1", [abime.id]).unwrap();
    m.c.execute("UPDATE modeles SET blocs = '[{\"t\":\"inconnu\"}]' WHERE id = ?1", [modele]).unwrap();

    let det = dossiers::detail(&m.c, &tmp.0, id).unwrap();
    assert_eq!(det.documents.len(), 2);
    let lu = det.documents.iter().find(|d| d.id == abime.id).unwrap();
    assert_eq!(lu.blocs.as_deref(), Some(modeles::blocs_illisibles().as_slice()));
    assert_eq!(det.documents.iter().find(|d| d.id == bon.id).unwrap().blocs, bon.blocs);
    let e = documents::enregistrer_blocs(&m.c, abime.id, &modeles::blocs_illisibles()).unwrap_err();
    assert_eq!(e.code, "donnees_illisibles");

    let liste = modeles::lister(&m.c).unwrap();
    assert_eq!(liste.iter().find(|x| x.id == modele).unwrap().blocs, modeles::blocs_illisibles());
    let e = documents::creer_depuis_modele(&m.c, &tmp.0, id, None, modele, false).unwrap_err();
    assert_eq!(e.code, "modele_illisible");
}

#[test]
fn bornes_des_blocs_saisis() {
    let m = mini();
    let tmp = DossierTemp::new();
    let modele = modele_simple(&m.c);
    let id = dossiers::creer(&m.c, &saisie_dossier(&m, false)).unwrap().id;
    let doc = documents::creer_depuis_modele(&m.c, &tmp.0, id, None, modele, false).unwrap();
    let blocs = doc.blocs.clone().unwrap();
    let avec = |f: &dyn Fn(&mut Vec<Bloc>)| {
        let mut b = blocs.clone();
        f(&mut b);
        documents::enregistrer_blocs(&m.c, doc.id, &b)
    };
    let i_champ = blocs.iter().position(|b| b.t == TypeBloc::Champ).unwrap();
    let i_tableau = blocs.iter().position(|b| b.t == TypeBloc::Tableau).unwrap();
    let long = "x".repeat(modeles::MAX_TEXTE + 1);
    assert_eq!(avec(&|b| b[i_champ].val = Some(long.clone())).unwrap_err().code, "saisie_invalide");
    assert_eq!(
        avec(&|b| b[i_tableau].rows = Some(vec![vec!["a".into()]; modeles::MAX_LIGNES + 1])).unwrap_err().code,
        "saisie_invalide"
    );
    assert_eq!(avec(&|b| b[i_tableau].rows = Some(vec![vec![long.clone()]])).unwrap_err().code, "saisie_invalide");
    // Des colonnes en trop sont ignorées avant contrôle.
    avec(&|b| b[i_tableau].rows = Some(vec![vec!["a".into(), "b".into(), "c".into(), long.clone()]])).unwrap();
    avec(&|b| b[i_champ].val = Some("x".repeat(modeles::MAX_TEXTE))).unwrap();

    let trop = vec![Bloc::nouveau(TypeBloc::Texte, "t"); modeles::MAX_BLOCS + 1];
    let m2 = modeles::lire(&m.c, modele).unwrap();
    let e = modeles::enregistrer(&m.c, modele, &SaisieModele { nom: m2.nom, theme_id: m2.theme_id, blocs: trop }).unwrap_err();
    assert_eq!(e.code, "saisie_invalide");

    // La recherche ne tient compte que des 200 premiers caractères.
    entites::creer(&m.c, &employe(m.cat_a, &"N".repeat(200), "P", Some("1990-01-01"), "Q")).unwrap();
    let r = recherche::rechercher(&m.c, &format!("{}{}", "n".repeat(200), "z".repeat(1_000_000))).unwrap();
    assert_eq!(r.a.len(), 1);
}

#[test]
fn nom_suggere_sans_debordement() {
    let m = mini();
    let id = dossiers::creer(&m.c, &saisie_dossier(&m, false)).unwrap().id;
    dossiers::renommer(&m.c, id, &format!("Dossier 2026-{}", i64::MAX)).unwrap();
    assert_eq!(dossiers::nom_suggere(&m.c, 2026).unwrap(), "Dossier 2026-02");
    dossiers::renommer(&m.c, id, &format!("Dossier 2026-{}", i64::MAX - 1)).unwrap();
    assert_eq!(dossiers::nom_suggere(&m.c, 2026).unwrap(), format!("Dossier 2026-{}", i64::MAX));
}

#[test]
fn suppression_d_un_sous_dossier_en_cycle_se_termine() {
    let m = mini();
    let id = dossiers::creer(&m.c, &saisie_dossier(&m, false)).unwrap().id;
    let a = dossiers::sous_dossier_creer(&m.c, id, None, "A").unwrap();
    let b = dossiers::sous_dossier_creer(&m.c, id, Some(a.id), "B").unwrap();
    // Base piégée : A et B sont parents l'un de l'autre.
    m.c.execute("UPDATE sous_dossiers SET parent_id = ?1 WHERE id = ?2", [b.id, a.id]).unwrap();
    let (tx, rx) = std::sync::mpsc::channel();
    let c = m.c;
    std::thread::spawn(move || {
        let tmp = DossierTemp::new();
        let r = dossiers::sous_dossier_supprimer(&c, &tmp.0, a.id).map(|_| ());
        let _ = tx.send(r);
    });
    rx.recv_timeout(std::time::Duration::from_secs(10)).expect("la suppression boucle sans fin").unwrap();
}
