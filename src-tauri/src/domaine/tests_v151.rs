//! Version 1.5.1 (§ 14) : premier lancement sur une base vide.
//!
//! Une base neuve ne contient que les quatre modèles standards (et leur thème), les trois états fournis, la clé des
//! identifiants et `donnees_exemple = 0` : le même état qu'après « Effacer toutes les données ». Une base déjà
//! initialisée n'est ni vidée ni remplie à la réouverture.

use super::donnees::{self, ModeReinit};
use super::dossiers::{self, SaisieDossier};
use super::entites::{self, SaisieEmploye, SaisieEntite, SaisieMachine};
use super::statuts::{self, Role};
use super::{Kind, classement, documents, modeles, parametres, recherche, standards, tableau};
use crate::db;
use crate::etat::Etat;
use rusqlite::types::Value;
use rusqlite::{Connection, OpenFlags};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        Temp(std::env::temp_dir().join(format!("entites-dossiers-v151-{}", uuid::Uuid::new_v4())))
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn aujourd_hui() -> chrono::NaiveDate {
    chrono::Local::now().date_naive()
}

fn compter(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).expect(sql)
}

/// Toutes les tables de la base (hors tables internes de SQLite).
fn tables(c: &Connection) -> Vec<String> {
    let mut s = c
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name")
        .unwrap();
    s.query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect()
}

/// Nombre de lignes de chaque table.
fn comptes(c: &Connection) -> BTreeMap<String, i64> {
    tables(c).into_iter().map(|t| (t.clone(), compter(c, &format!("SELECT COUNT(*) FROM {t}")))).collect()
}

/// Contenu complet de chaque table, ligne par ligne (dans l'ordre des identifiants). Avec `masquer`, les valeurs
/// qui dépendent de l'instant ou du hasard (horodatages `cree_le` / `maj_le`, clé secrète des identifiants) sont
/// remplacées par `*` ; tout le reste est comparé tel quel.
fn contenu(c: &Connection, masquer: bool) -> BTreeMap<String, Vec<Vec<String>>> {
    tables(c)
        .into_iter()
        .map(|t| {
            let mut s = c.prepare(&format!("SELECT * FROM {t} ORDER BY rowid")).unwrap();
            let colonnes: Vec<String> = s.column_names().into_iter().map(String::from).collect();
            let lignes = s
                .query_map([], |r| {
                    Ok(colonnes
                        .iter()
                        .enumerate()
                        .map(|(i, col)| {
                            let v: Value = r.get(i).unwrap();
                            if masquer && (col == "cree_le" || col == "maj_le" || (t == "cle_identifiant" && col == "cle")) {
                                "*".to_string()
                            } else {
                                format!("{v:?}")
                            }
                        })
                        .collect::<Vec<_>>())
                })
                .unwrap()
                .map(|l| l.unwrap())
                .collect();
            (t, lignes)
        })
        .collect()
}

/// Lecture seule d'une base sur disque, après fermeture de l'application.
fn lire_disque(chemin: &Path) -> Connection {
    Connection::open_with_flags(chemin, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap()
}

/// Les quatre modèles standards, dans l'ordre de création (§ 8.6).
const MODELES: [&str; 4] =
    [standards::ETAT_DES_BESOINS, standards::FICHE_INTERVENTION, standards::FICHE_IDENTIFICATION, standards::FICHE_FORMATAGE];

/// Vérifie l'état exact d'une base vide.
fn verifier_base_vide(c: &Connection) {
    let attendu: BTreeMap<String, i64> = [
        ("affectations", 0),
        ("categories", 0),
        ("cle_identifiant", 1),
        ("documents", 0),
        ("dossiers", 0),
        ("entites", 0),
        ("evenements", 0),
        ("magasin", 0),
        ("modeles", 4),
        ("nominations", 0),
        ("options", 0),
        ("parametres", 1),
        ("sous_dossiers", 0),
        ("statuts", 3),
        ("themes", 1),
    ]
    .into_iter()
    .map(|(t, n)| (t.to_string(), n))
    .collect();
    assert_eq!(comptes(c), attendu, "nombre de lignes de chaque table d'une base vide");

    let modeles: Vec<(String, bool, bool, String)> =
        modeles::lister(c).unwrap().into_iter().map(|m| (m.nom, m.standard, m.actif, m.theme)).collect();
    assert_eq!(
        modeles,
        MODELES.map(|n| (n.to_string(), true, true, standards::THEME.to_string())).to_vec(),
        "les quatre modèles standards, actifs, dans le thème « Support informatique »"
    );
    let themes: Vec<(String, bool)> = classement::themes_lister(c).unwrap().into_iter().map(|t| (t.nom, t.actif)).collect();
    assert_eq!(themes, [(standards::THEME.to_string(), true)], "un seul thème");
    let roles: Vec<Role> = statuts::lister(c).unwrap().into_iter().map(|s| s.role).collect();
    assert_eq!(roles, [Role::Cours, Role::Piece, Role::Clos], "les trois états fournis");
    let p = parametres::lire(c).unwrap();
    assert!(!p.donnees_exemple, "donnees_exemple = 0 : pas de badge « Données d’exemple »");
    assert_eq!((p.theme.as_str(), p.densite.as_str()), ("system", "eq"), "préférences par défaut");
    assert_eq!(parametres::lire_valeur(c, parametres::DONNEES_EXEMPLE).unwrap().as_deref(), Some("0"));
    assert!(!db::est_neuve(c).unwrap(), "une base vide est initialisée : elle n’est pas re-remplie au lancement suivant");
    let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(v, 6, "aucune migration nouvelle");
}

#[test]
fn premier_lancement_base_vide() {
    let t = Temp::new();
    let etat = Etat::ouvrir_dans(t.0.clone()).unwrap();
    {
        let c = etat.conn().unwrap();
        verifier_base_vide(&c);

        // Chaque écran se lit sans erreur sur la base vide.
        let td = tableau::calculer(&c).unwrap();
        assert_eq!((td.a_actives, td.a_total, td.b_actives, td.b_total), (0, 0, 0, 0));
        assert_eq!((td.dossiers_total, td.dossiers_ouverts, td.dossiers_piece), (0, 0, 0));
        assert!(td.sans_code_a.is_empty() && td.sans_code_b.is_empty() && td.dossiers_en_cours.is_empty());
        assert_eq!(td.repartition.iter().map(|r| r.nb).collect::<Vec<_>>(), [0, 0, 0]);
        assert_eq!(td.volume.mois, vec![0; 12]);
        assert!(entites::lister(&c, Kind::A).unwrap().is_empty());
        assert!(entites::lister(&c, Kind::B).unwrap().is_empty());
        assert!(dossiers::lister(&c).unwrap().is_empty());
        assert!(classement::categories_lister(&c, Kind::A).unwrap().is_empty(), "aucune structure");
        assert!(classement::categories_lister(&c, Kind::B).unwrap().is_empty(), "aucun type de machine");
        assert!(classement::magasin_lister(&c).unwrap().is_empty(), "aucun mot-clé du Magasin");
        let r = serde_json::to_value(recherche::rechercher(&c, "Benali").unwrap()).unwrap();
        assert_eq!(r.to_string().matches("Benali").count(), 0, "aucune donnée d’exemple trouvée : {r}");
    }
    assert!(t.0.join("fichiers").is_dir());
    assert_eq!(fs::read_dir(t.0.join("fichiers")).unwrap().count(), 0, "aucun fichier importé");
    assert!(!t.0.join("sauvegardes").exists(), "une base neuve n’a rien à sauvegarder");
}

#[test]
fn base_neuve_identique_a_effacer_toutes_les_donnees() {
    // Premier lancement.
    let neuve = db::ouvrir_memoire().unwrap();
    donnees::initialiser(&neuve).unwrap();
    // Données d'exemple, puis « Effacer toutes les données ».
    let videe = db::ouvrir_memoire().unwrap();
    db::exemple::initialiser(&videe, aujourd_hui()).unwrap();
    let tmp = Temp::new();
    let fichiers = tmp.0.join("fichiers");
    fs::create_dir_all(&fichiers).unwrap();
    donnees::reinitialiser(&videe, &tmp.0, &fichiers, ModeReinit::Vide, aujourd_hui()).unwrap();

    verifier_base_vide(&neuve);
    verifier_base_vide(&videe);
    assert_eq!(contenu(&neuve, true), contenu(&videe, true), "base neuve = base après « Effacer toutes les données »");

    // Et la base créée sur disque par l'application.
    let t = Temp::new();
    let etat = Etat::ouvrir_dans(t.0.clone()).unwrap();
    assert_eq!(contenu(&etat.conn().unwrap(), true), contenu(&neuve, true), "base créée au premier lancement");
}

/// Ouvre l'application sur `dossier`, applique `modifier`, ferme ; puis rouvre et vérifie que rien n'a changé.
fn reouverture_sans_changement(modifier: impl FnOnce(&Etat)) -> BTreeMap<String, Vec<Vec<String>>> {
    let t = Temp::new();
    {
        let etat = Etat::ouvrir_dans(t.0.clone()).unwrap();
        modifier(&etat);
    }
    let chemin = t.0.join("donnees.sqlite");
    let avant = contenu(&lire_disque(&chemin), false);
    drop(Etat::ouvrir_dans(t.0.clone()).unwrap());
    let apres = contenu(&lire_disque(&chemin), false);
    assert_eq!(avant, apres, "la réouverture a modifié la base");
    apres
}

#[test]
fn base_existante_ni_videe_ni_remplie() {
    // Base avec les données d'exemple (donnees_exemple = 1) : rien n'est effacé.
    let exemple = reouverture_sans_changement(|etat| {
        let c = etat.conn().unwrap();
        donnees::reinitialiser(&c, &etat.dossier_donnees, &etat.fichiers, ModeReinit::Exemple, aujourd_hui()).unwrap();
    });
    assert_eq!(exemple["entites"].len(), 16);
    assert_eq!(exemple["dossiers"].len(), 7);
    assert!(exemple["parametres"].iter().any(|l| l.join("|").contains("donnees_exemple") && l.join("|").contains("\"1\"")));

    // Base vide (donnees_exemple = 0) où l'utilisateur a saisi un employé et archivé un modèle standard : la
    // réouverture ne remplit rien et ne recrée pas le modèle archivé.
    let saisie = reouverture_sans_changement(|etat| {
        let c = etat.conn().unwrap();
        let s = classement::categorie_creer(&c, Kind::A, "Ma structure").unwrap();
        entites::creer(&c, &employe(s.id)).unwrap();
        let formatage: i64 =
            c.query_row("SELECT id FROM modeles WHERE nom = ?1", [standards::FICHE_FORMATAGE], |r| r.get(0)).unwrap();
        modeles::basculer(&c, formatage).unwrap();
    });
    assert_eq!(saisie["entites"].len(), 1);
    assert_eq!(saisie["modeles"].len(), 4, "le modèle archivé n’est pas recréé");
    assert_eq!(saisie["themes"].len(), 1);

    // Base vide jamais modifiée : rouverte telle quelle.
    let vide = reouverture_sans_changement(|_| {});
    assert_eq!(vide["modeles"].len(), 4);
    assert_eq!(vide["entites"].len(), 0);
}

fn employe(structure: i64) -> SaisieEntite {
    SaisieEntite::Employe(SaisieEmploye {
        nom: "Saidi".into(),
        prenom: "Meriem".into(),
        date_naissance: Some("1991-04-12".into()),
        poste: "Technicienne".into(),
        categorie_id: structure,
    })
}

/// § 14 : en partant de la base vide, l'utilisateur crée sa première structure et son premier employé, son premier
/// type de machine et sa première machine, son premier dossier, puis un document depuis chacun des quatre modèles.
#[test]
fn de_zero_premieres_fiches_dossier_et_documents() {
    let t = Temp::new();
    let etat = Etat::ouvrir_dans(t.0.clone()).unwrap();
    let c = etat.conn().unwrap();

    let structure = classement::categorie_creer(&c, Kind::A, "Division informatique").unwrap();
    let a = entites::creer(&c, &employe(structure.id)).unwrap();
    assert!(a.code.is_some(), "fiche complète : identifiant attribué");
    let type_machine = classement::categorie_creer(&c, Kind::B, "PC de bureau").unwrap();
    let b = entites::creer(
        &c,
        &SaisieEntite::Machine(SaisieMachine {
            nom: "PC accueil".into(),
            code: Some("PC-0001".into()),
            categorie_id: type_machine.id,
            ..Default::default()
        }),
    )
    .unwrap();

    // Le thème du dossier : le seul existant, celui des modèles standards ; état par défaut « En cours ».
    let theme = classement::themes_lister(&c).unwrap()[0].id;
    let annee = super::annee_en_cours() as i64;
    let nom = dossiers::nom_suggere(&c, annee).unwrap();
    let d = dossiers::creer(&c, &SaisieDossier { nom, annee, theme_id: theme, statut_id: None }).unwrap();
    assert_eq!(d.statut.role, Role::Cours);

    for m in modeles::lister(&c).unwrap() {
        let doc = documents::creer_depuis_modele(&c, &etat.fichiers, d.id, None, m.id, false).unwrap();
        // Les blocs « Employé » et « Machine » des modèles standards se remplissent avec les fiches créées.
        let mut blocs = doc.blocs.clone().unwrap();
        for bl in blocs.iter_mut() {
            match bl.t {
                modeles::TypeBloc::Employe => bl.entite_id = Some(Some(a.id)),
                modeles::TypeBloc::Machine => bl.entite_id = Some(Some(b.id)),
                _ => {}
            }
        }
        documents::enregistrer_blocs(&c, doc.id, &blocs).unwrap();
    }
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM documents"), 4);
    assert_eq!(compter(&c, "SELECT COUNT(DISTINCT modele_id) FROM documents"), 4);
    let fiche = entites::fiche(&c, &etat.fichiers, a.id).unwrap();
    // L'état des besoins n'a pas de bloc « Employé » : les trois autres nomment l'employé.
    assert_eq!(fiche.documents.len(), 3, "documents qui nomment l’employé");
    let td = tableau::calculer(&c).unwrap();
    assert_eq!((td.a_total, td.b_total, td.dossiers_ouverts), (1, 1, 1));
}
