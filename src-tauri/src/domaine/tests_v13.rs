//! Tests de la version 1.3 (§ 10) : migration 004 depuis une base en version 3 ou 1, états de dossier, recherche,
//! dossiers sans employé ni machine, citations, identifiant codé, champs obligatoires.

use super::nominations::Facon;
use super::classement;
use super::documents;
use super::donnees::{self, ModeReinit};
use super::dossiers::{self, SaisieDossier};
use super::entites::{self, SaisieIdentifiant};
use super::identifiant::{self, forme_valide};
use super::journal;
use super::modeles::{self, Bloc, SaisieModele, TypeBloc};
use super::recherche;
use super::standards::{self, ETAT_DES_BESOINS, FICHE_FORMATAGE, FICHE_IDENTIFICATION, FICHE_INTERVENTION};
use super::statuts::{self, Role, SaisieStatut};
use super::tableau;
use super::tests::{document_nommant, employe, employe_incomplet, machine, st};
use super::tests_v11::creer_base_v1;
use super::Kind;
use crate::db;
use crate::etat::Etat;
use rusqlite::Connection;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

// ---------- outils ----------

struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!("entites-dossiers-v13-{}", uuid::Uuid::new_v4()));
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

fn sauvegardes(dossier: &Path, prefixe: &str) -> Vec<PathBuf> {
    let Ok(entrees) = fs::read_dir(dossier.join("sauvegardes")) else { return Vec::new() };
    entrees.map(|e| e.unwrap().path()).filter(|p| p.file_name().unwrap().to_string_lossy().starts_with(prefixe)).collect()
}

/// Base minimale : un thème, une structure, un type de machine.
struct Mini {
    c: Connection,
    theme: i64,
    cat_a: i64,
    cat_b: i64,
}

fn mini() -> Mini {
    let c = db::ouvrir_memoire().unwrap();
    let theme = classement::theme_creer(&c, "Thème").unwrap().id;
    let cat_a = classement::categorie_creer(&c, Kind::A, "Division informatique").unwrap().id;
    let cat_b = classement::categorie_creer(&c, Kind::B, "PC de bureau").unwrap().id;
    Mini { c, theme, cat_a, cat_b }
}

impl Mini {
    fn employe(&self, nom: &str, prenom: &str) -> i64 {
        entites::creer(&self.c, &employe(self.cat_a, nom, prenom, Some("1990-05-14"), "Technicienne")).unwrap().id
    }
    fn machine(&self, nom: &str, code: Option<&str>) -> i64 {
        entites::creer(&self.c, &machine(self.cat_b, nom, code)).unwrap().id
    }
    /// Dossier ; si des fiches sont données, un document du dossier les nomme (§ 11.1).
    fn dossier(&self, nom: &str, a: Option<i64>, b: Option<i64>) -> i64 {
        let s = SaisieDossier { nom: nom.into(), annee: 2026, theme_id: self.theme, statut_id: None };
        let id = dossiers::creer(&self.c, &s).unwrap().id;
        if a.is_some() || b.is_some() {
            document_nommant(&self.c, id, a, b);
        }
        id
    }
    /// Modèle « Fiche test » : employé, machine, champ, zone, tableau (et blocs qui ne citent personne).
    fn modele(&self) -> i64 {
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
}

// ---------- migration 004 depuis une base en version 3 remplie ----------

/// Document de la version 1.2 : employé désigné, valeurs saisies, tableau, signature cochée et datée.
const DOC_V3: &str = r#"[{"t":"titre","v":"Fiche d’intervention","niveau":1},{"t":"employe","v":"Utilisateur","entiteId":1},{"t":"machine","v":"Matériel","entiteId":4},{"t":"champ","v":"Intervenant","val":"Karim Haddad"},{"t":"zone","v":"Observations","val":"Poste PC-0101 redémarré."},{"t":"tableau","v":"","cols":["N°","Désignation"],"rows":[["1","Clavier"]]},{"t":"signature","v":"Visa","ok":true,"val":"2025-03-05 11:00:00"}]"#;
const DOC_V3_B: &str = r#"[{"t":"employe","v":"Bénéficiaire","entiteId":null},{"t":"champ","v":"Adresse mail","val":"benali.sofia@exemple.org"}]"#;

/// Crée `donnees.sqlite` en version 3 exactement (schémas 001 à 003, modèles standards comme la 1.2, sans
/// marque « obligatoire »), remplie : employés complets et incomplets, machines, affectations en cours et
/// terminées, dossiers dans les trois états, documents aux blocs remplis, options, journal.
fn creer_base_v3(dossier: &Path) -> PathBuf {
    let chemin = dossier.join("donnees.sqlite");
    let c = Connection::open(&chemin).unwrap();
    c.execute_batch(include_str!("../../migrations/001_init.sql")).unwrap();
    c.execute_batch(include_str!("../../migrations/002_employes_machines.sql")).unwrap();
    modeles::assurer_standards(&c).unwrap();
    c.execute_batch("UPDATE modeles SET blocs = replace(blocs, ',\"obligatoire\":true', '');").unwrap();
    c.execute_batch(include_str!("../../migrations/003_affectations.sql")).unwrap();
    c.execute_batch(&format!(
        "INSERT INTO parametres (cle, valeur) VALUES ('donnees_exemple', '0'), ('theme', 'dark'), ('densite', 'eq');
         INSERT INTO themes (id, nom, actif) VALUES (10, 'Maintenance', 1);
         INSERT INTO categories (id, kind, nom, actif) VALUES (1, 'a', 'Division informatique', 1), (2, 'b', 'PC de bureau', 1);
         INSERT INTO magasin (id, nom, actif) VALUES (1, 'RAM', 1);
         INSERT INTO entites (id, kind, nom, code, categorie_id, actif, cree_le, maj_le, libelle, prenom, date_naissance, poste,
                              marque, cpu, ram, stockage) VALUES
           (1, 'a', 'Benali', 'BENSO-140590-TEC', 1, 1, '2025-01-02 10:00:00', '2025-01-02 10:00:00', 'BENALI Sofia', 'Sofia', '1990-05-14', 'Technicienne', '', '', '', ''),
           (2, 'a', 'Haddad', 'HADKA-021185-ING', 1, 0, '2025-01-03 10:00:00', '2025-06-03 10:00:00', 'HADDAD Karim', 'Karim', '1985-11-02', 'Ingénieur', '', '', '', ''),
           (3, 'a', 'Cherif', NULL, 1, 1, '2025-01-04 10:00:00', '2025-01-04 10:00:00', 'CHERIF Amine', 'Amine', NULL, '', '', '', '', ''),
           (4, 'b', 'PC accueil', 'PC-0101', 2, 1, '2025-01-05 10:00:00', '2025-01-05 10:00:00', 'PC accueil', '', NULL, '', 'Dell OptiPlex 7090', 'Intel Core i5', '16 Go', 'SSD 512 Go'),
           (5, 'b', 'Portable 01', NULL, 2, 1, '2025-01-06 10:00:00', '2025-01-06 10:00:00', 'Portable 01', '', NULL, '', 'HP ProBook', 'Intel Core i5', '8 Go', 'SSD 256 Go'),
           (6, 'a', 'Mansouri', 'MANLE-270392-ASS', 1, 1, '2025-01-07 10:00:00', '2025-01-07 10:00:00', 'MANSOURI Leïla', 'Leïla', '1992-03-27', 'Assistante', '', '', '', '');
         INSERT INTO affectations (id, a_id, b_id, debut, fin) VALUES
           (1, 1, 4, '2025-02-01 09:00:00', NULL),
           (2, 2, 5, '2025-02-02 09:00:00', '2025-05-01 09:00:00'),
           (3, 3, 5, '2025-05-02 09:00:00', NULL);
         INSERT INTO dossiers (id, nom, annee, theme_id, statut, a_id, b_id, cree_le, maj_le, clos_le) VALUES
           (1, 'Dossier 2025-01', 2025, 10, 'cours', 1, 4, '2025-03-01 09:00:00', '2025-03-02 09:00:00', NULL),
           (2, 'Dossier 2025-02', 2025, 10, 'piece', 3, 5, '2025-03-03 09:00:00', '2025-03-04 09:00:00', NULL),
           (3, 'Dossier 2025-03', 2025, 10, 'clos', 2, 5, '2025-03-05 09:00:00', '2025-04-01 09:00:00', '2025-04-01 09:00:00');
         INSERT INTO sous_dossiers (id, dossier_id, parent_id, nom, cree_le) VALUES (1, 1, NULL, 'Demandes', '2025-03-01 10:00:00');
         INSERT INTO documents (id, dossier_id, sous_dossier_id, nom, origine, source, date_doc, blocs, fichier_stocke, fichier_nom, piece_finale, cree_le) VALUES
           (1, 1, 1, 'Document_01', 'modele', 'Fiche d’intervention informatique', '2025-03-05', '{DOC_V3}', NULL, NULL, 0, '2025-03-05 10:00:00'),
           (2, 3, NULL, 'Document_01', 'modele', 'Fiche d’identification', '2025-03-06', '{DOC_V3_B}', NULL, NULL, 1, '2025-03-06 10:00:00'),
           (3, 2, NULL, 'Facture', 'import', 'Fichier importé', '2025-03-07', NULL, '0b1c2d3e-4f50-4617-8899-aabbccddee01.pdf', 'facture.pdf', 0, '2025-03-07 10:00:00');
         INSERT INTO options (id, dossier_id, nom, ok, position) VALUES
           (1, 1, 'Dossier numérisé', 1, 0), (2, 1, 'Contenu vérifié', 0, 1), (3, 3, 'Dossier numérisé', 1, 0);
         INSERT INTO evenements (type, titre, detail, a_id, b_id, dossier_id, date) VALUES
           ('fiche_creee', 'Fiche créée', 'Création de la fiche BENALI Sofia.', 1, NULL, NULL, '2025-01-02 10:00:00'),
           ('association', 'Affectation de PC accueil à BENALI Sofia', 'x', 1, 4, NULL, '2025-02-01 09:00:00'),
           ('dissociation', 'Fin de l’affectation de Portable 01 à HADDAD Karim', 'x', 2, 5, NULL, '2025-05-01 09:00:00'),
           ('dossier_ouvert', 'Dossier 2025-01 ouvert', 'Maintenance.', 1, 4, 1, '2025-03-01 09:00:00'),
           ('piece_manquante', 'Pièce finale manquante', 'Dossier 2025-02 en attente de sa pièce finale.', 3, 5, 2, '2025-03-03 09:00:00'),
           ('dossier_clos', 'Dossier 2025-03 clôturé', 'Maintenance.', 2, 5, 3, '2025-04-01 09:00:00');
         PRAGMA user_version = 3;"
    ))
    .unwrap();
    chemin
}

/// Tables dont le contenu ne doit pas changer aux migrations 004 et 005 (les documents, dont la 005 complète les
/// blocs et le modèle d'origine, sont comparés hors de ces deux colonnes).
const TABLES_INCHANGEES: [&str; 10] = [
    "parametres",
    "themes",
    "categories",
    "magasin",
    "modeles",
    "affectations",
    "sous_dossiers",
    "documents",
    "options",
    "evenements",
];

fn photo(c: &Connection) -> Vec<Vec<String>> {
    TABLES_INCHANGEES
        .iter()
        .map(|t| {
            let colonnes = if *t == "documents" {
                "id, dossier_id, sous_dossier_id, nom, origine, source, date_doc, fichier_stocke, fichier_nom, piece_finale, cree_le"
            } else {
                "*"
            };
            contenu(c, &format!("SELECT {colonnes} FROM {t} ORDER BY 1"))
        })
        .collect()
}

#[test]
fn base_v3_remplie_migree_sans_perte_par_l_ouverture_normale() {
    let t = Temp::new();
    let chemin = creer_base_v3(&t.0);
    let fichiers = t.0.join("fichiers");
    let (avant, entites_avant, dossiers_avant) = {
        let c = Connection::open(&chemin).unwrap();
        db::verifier_base(&c).expect("base v3 conforme");
        (
            photo(&c),
            contenu(&c, "SELECT id, kind, nom, categorie_id, actif, cree_le, maj_le, libelle, prenom, date_naissance, poste, marque, cpu, ram, stockage FROM entites ORDER BY id"),
            contenu(&c, "SELECT id, nom, annee, theme_id, statut, cree_le, maj_le, clos_le FROM dossiers ORDER BY id"),
        )
    };

    let etat = Etat::ouvrir_dans(t.0.clone()).expect("une base 1.2 conforme est acceptée et migrée");
    let c = etat.conn().unwrap();
    assert_eq!(compter(&c, "PRAGMA user_version"), 6);
    assert_eq!(compter(&c, "PRAGMA foreign_keys"), 1);
    db::verifier_base(&c).expect("la base migrée passe le contrôle d'ouverture");

    // Sauvegarde préalable : la base 1.2 telle quelle.
    let sv = sauvegardes(&t.0, "avant-version-4_");
    assert_eq!(sv.len(), 1);
    let ancienne = Connection::open(sv[0].join("donnees.sqlite")).unwrap();
    assert_eq!(compter(&ancienne, "PRAGMA user_version"), 3);
    assert_eq!(photo(&ancienne), avant);
    drop(ancienne);

    // Tout est là : fiches (hors identifiant des employés), affectations, sous-dossiers, documents (hors blocs),
    // options, modèles (non modifiés, sans marque « obligatoire »), paramètres.
    let apres = photo(&c);
    for (i, table) in TABLES_INCHANGEES.iter().enumerate() {
        if *table == "evenements" {
            continue;
        }
        assert_eq!(apres[i], avant[i], "{table}");
    }
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM modeles WHERE blocs LIKE '%\"obligatoire\"%'"), 0, "modèles existants retouchés");
    assert_eq!(
        contenu(&c, "SELECT id, kind, nom, categorie_id, actif, cree_le, maj_le, libelle, prenom, date_naissance, poste, marque, cpu, ram, stockage FROM entites ORDER BY id"),
        entites_avant
    );
    // Chaque dossier a gardé son état (et le reste de ses colonnes) ; les états fournis existent.
    assert_eq!(
        contenu(&c, "SELECT d.id, d.nom, d.annee, d.theme_id, s.role, d.cree_le, d.maj_le, d.clos_le FROM dossiers d JOIN statuts s ON s.id = d.statut_id ORDER BY d.id"),
        dossiers_avant
    );
    let roles: Vec<Role> = statuts::lister(&c).unwrap().into_iter().map(|s| s.role).collect();
    assert_eq!(roles, [Role::Cours, Role::Piece, Role::Clos]);
    for (id, role) in [(1, Role::Cours), (2, Role::Piece), (3, Role::Clos)] {
        assert_eq!(dossiers::resume(&c, id).unwrap().statut.role, role, "dossier {id}");
    }
    // Journal d'origine intact ; une ligne par employé qui avait un identifiant.
    let journal_avant = &avant[TABLES_INCHANGEES.len() - 1];
    // § 13.3 : la migration 006 ajoute deux colonnes, NULL pour toutes les lignes existantes.
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM evenements WHERE a_libelle_supprime IS NOT NULL OR b_libelle_supprime IS NOT NULL"), 0);
    let journal_apres = contenu(&c, "SELECT id, type, titre, detail, a_id, b_id, dossier_id, date FROM evenements WHERE type <> 'identifiant_recalcule' ORDER BY 1");
    assert_eq!(&journal_apres, journal_avant);

    // Identifiants : chaque employé complet a reçu un nouvel identifiant, l'ancien est au journal ;
    // l'employé incomplet reste sans identifiant ; les machines gardent le leur.
    let anciens = [(1, "BENSO-140590-TEC"), (2, "HADKA-021185-ING"), (6, "MANLE-270392-ASS")];
    let mut nouveaux = Vec::new();
    for (id, ancien) in anciens {
        let e = entites::lire(&c, id).unwrap();
        let code = e.code.clone().unwrap();
        assert!(forme_valide(&code), "{code}");
        nouveaux.push(code.clone());
        let ev = journal::pour_entite(&c, Kind::A, id).unwrap();
        let ligne = ev.iter().find(|x| x.r#type == journal::IDENTIFIANT_RECALCULE).unwrap_or_else(|| panic!("{id}"));
        assert_eq!(ligne.detail, format!("Ancien identifiant : {ancien}"));
        assert_eq!(ligne.a_id, Some(id));
        // L'identifiant attribué est celui que donnerait l'aperçu pour la fiche.
        let saisie = SaisieIdentifiant { nom: e.nom.clone(), prenom: e.prenom.clone(), date_naissance: e.date_naissance.clone(), poste: e.poste.clone() };
        assert_eq!(entites::apercu_identifiant(&c, &saisie, Some(id)).unwrap(), Some(code));
    }
    nouveaux.sort();
    nouveaux.dedup();
    assert_eq!(nouveaux.len(), 3, "identifiants distincts");
    assert_eq!(entites::lire(&c, 3).unwrap().code, None);
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM evenements WHERE type = 'identifiant_recalcule'"), 3);
    assert_eq!(entites::lire(&c, 4).unwrap().code.as_deref(), Some("PC-0101"));
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM cle_identifiant"), 1);

    // Tout se lit : fiches, dossiers, tableau de bord, recherche.
    for id in 1..=6 {
        entites::fiche(&c, &fichiers, id).unwrap();
    }
    for id in 1..=3 {
        dossiers::detail(&c, &fichiers, id).unwrap();
    }
    let tdb = tableau::calculer(&c).unwrap();
    assert_eq!((tdb.dossiers_total, tdb.dossiers_ouverts, tdb.dossiers_piece), (3, 2, 1));
    assert_eq!(recherche::rechercher(&c, "dossier 2025").unwrap().dossiers_total, 3);
    // Le dossier clôturé reste en lecture seule ; le dossier en « Pièce manquante » ne se clôture pas.
    assert_eq!(dossiers::renommer(&c, 3, "X").unwrap_err().code, "dossier_clos");
    assert_eq!(dossiers::definir_statut(&c, 2, st(&c, Role::Clos)).unwrap_err().code, "transition_interdite");
    // Nominations sur des données reprises : Benali est nommée dans son dossier (bloc) et, par son nom écrit, dans
    // aucun autre ; Haddad est nommé par son nom dans le document 1, et par le bloc vide du document 2 que la 005 a
    // renseigné avec l'employé de son dossier (§ 11.5).
    let f1 = entites::fiche(&c, &fichiers, 1).unwrap();
    assert_eq!(f1.documents.iter().map(|d| (d.document.id, d.facons.clone())).collect::<Vec<_>>(), [(1, vec![Facon::Bloc])]);
    let f2 = entites::fiche(&c, &fichiers, 2).unwrap();
    let mut docs2: Vec<(i64, Vec<Facon>)> = f2.documents.iter().map(|d| (d.document.id, d.facons.clone())).collect();
    docs2.sort();
    assert_eq!(docs2, [(1, vec![Facon::Texte]), (2, vec![Facon::Bloc])]);
    let codes: Vec<Option<String>> = (1..=6).map(|id| entites::lire(&c, id).unwrap().code).collect();
    let nb_evenements = compter(&c, "SELECT COUNT(*) FROM evenements");
    drop(c);
    drop(etat);

    // Relance : la version 5 est acceptée telle quelle, rien n'est refait.
    let etat = Etat::ouvrir_dans(t.0.clone()).expect("la base migrée est acceptée au lancement suivant");
    let c = etat.conn().unwrap();
    assert_eq!(compter(&c, "PRAGMA user_version"), 6);
    assert_eq!(sauvegardes(&t.0, "avant-version-").len(), 1, "aucune nouvelle sauvegarde");
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM evenements"), nb_evenements);
    assert_eq!((1..=6).map(|id| entites::lire(&c, id).unwrap().code).collect::<Vec<_>>(), codes);
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM statuts"), 3);
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM dossiers"), 3);
}

#[test]
fn base_v1_migree_jusqu_a_la_version_courante() {
    let t = Temp::new();
    creer_base_v1(&t.0);
    let fichiers = t.0.join("fichiers");
    let etat = Etat::ouvrir_dans(t.0.clone()).expect("une base 1.0 conforme est acceptée et migrée");
    let c = etat.conn().unwrap();
    assert_eq!(compter(&c, "PRAGMA user_version"), 6);
    db::verifier_base(&c).unwrap();
    // Une seule sauvegarde, celle de la base 1.0.
    let sv = sauvegardes(&t.0, "avant-version-");
    assert_eq!(sv.len(), 1);
    assert_eq!(compter(&Connection::open(sv[0].join("donnees.sqlite")).unwrap(), "PRAGMA user_version"), 1);
    // États repris à l'identique ; employés de la 1.0 toujours à compléter (aucun identifiant, rien au journal).
    assert_eq!(dossiers::resume(&c, 1).unwrap().statut.role, Role::Cours);
    assert_eq!(dossiers::resume(&c, 2).unwrap().statut.role, Role::Clos);
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM entites WHERE kind = 'a' AND code IS NOT NULL"), 0);
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM evenements WHERE type = 'identifiant_recalcule'"), 0);
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM cle_identifiant"), 1);
    for id in 1..=5 {
        entites::fiche(&c, &fichiers, id).unwrap();
    }
    // Une fiche reprise, renvoyée telle quelle, n'est pas refusée ; complétée, elle reçoit un identifiant.
    let a1 = entites::lire(&c, 1).unwrap();
    entites::modifier(&c, 1, &employe(a1.categorie_id, &a1.nom, "", None, "")).unwrap();
    assert_eq!(entites::modifier(&c, 1, &employe(a1.categorie_id, "Durand", "", None, "")).unwrap_err().code, "saisie_invalide");
    let e = entites::modifier(&c, 1, &employe(a1.categorie_id, "Durand", "Martin", Some("1980-06-15"), "Ingénieur")).unwrap();
    assert!(e.code.as_deref().is_some_and(forme_valide));
    drop(c);
    drop(etat);
    let etat = Etat::ouvrir_dans(t.0.clone()).unwrap();
    assert_eq!(compter(&etat.conn().unwrap(), "PRAGMA user_version"), 6);
    assert_eq!(sauvegardes(&t.0, "avant-version-").len(), 1);
}

#[test]
fn base_v4_non_conforme_refusee() {
    for piege in [
        "DROP INDEX statuts_nom;",
        "CREATE TABLE cle_identifiant_2 (x);",
        "DROP INDEX dossiers_statut;",
    ] {
        let t = Temp::new();
        drop(Etat::ouvrir_dans(t.0.clone()).unwrap());
        let chemin = t.0.join("donnees.sqlite");
        Connection::open(&chemin).unwrap().execute_batch(piege).unwrap();
        let avant = fs::read(&chemin).unwrap();
        assert_eq!(Etat::ouvrir_dans(t.0.clone()).err().unwrap().code, "base_refusee", "{piege}");
        assert_eq!(fs::read(&chemin).unwrap(), avant, "{piege}");
    }
}

// ---------- états de dossier (§ 10.1) ----------

#[test]
fn etats_fournis_et_ajoutes() {
    let m = mini();
    let liste = statuts::lister(&m.c).unwrap();
    assert_eq!(
        liste.iter().map(|s| (s.nom.as_str(), s.role, s.nb_dossiers)).collect::<Vec<_>>(),
        [("En cours", Role::Cours, 0), ("Pièce manquante", Role::Piece, 0), ("Clôturé", Role::Clos, 0)]
    );
    assert!(liste.iter().all(|s| statuts::COULEURS.contains(&s.couleur.as_str())));
    let v = serde_json::to_value(&liste[0]).unwrap();
    for k in ["id", "nom", "couleur", "role", "nbDossiers"] {
        assert!(v.get(k).is_some(), "StatutDossier.{k}");
    }
    assert_eq!(v["role"], "cours");

    // Ajouter : nom obligatoire, unique (casse et accents ignorés), couleur de la palette.
    let attente = statuts::creer(&m.c, " Attente fournisseur ", "violet").unwrap();
    assert_eq!((attente.nom.as_str(), attente.couleur.as_str(), attente.role, attente.nb_dossiers), ("Attente fournisseur", "violet", Role::Perso, 0));
    assert_eq!(serde_json::to_value(&attente).unwrap()["role"], "perso");
    for (nom, couleur, code) in [
        ("", "bleu", "saisie_invalide"),
        ("Autre", "magenta", "saisie_invalide"),
        ("Autre", "Bleu", "saisie_invalide"),
        ("Autre", "#ff0000", "saisie_invalide"),
        ("attente FOURNISSEUR", "bleu", "doublon"),
        ("en cours", "bleu", "doublon"),
        ("Piece manquante", "bleu", "doublon"),
        ("CLÔTURÉ", "bleu", "doublon"),
    ] {
        assert_eq!(statuts::creer(&m.c, nom, couleur).unwrap_err().code, code, "{nom} / {couleur}");
    }
    let livraison = statuts::creer(&m.c, "Livraison", "turquoise").unwrap();
    // Ordre : fournis, puis ajoutés par ordre de création.
    let noms: Vec<String> = statuts::lister(&m.c).unwrap().into_iter().map(|s| s.nom).collect();
    assert_eq!(noms, ["En cours", "Pièce manquante", "Clôturé", "Attente fournisseur", "Livraison"]);

    // Modifier un état ajouté : nom et couleur ; doublon et couleur hors palette refusés.
    let s = statuts::modifier(&m.c, attente.id, &SaisieStatut { nom: "Attente fournisseur externe".into(), couleur: "rose".into() }).unwrap();
    assert_eq!((s.nom.as_str(), s.couleur.as_str()), ("Attente fournisseur externe", "rose"));
    let doublon = SaisieStatut { nom: "LIVRAISON".into(), couleur: "rose".into() };
    assert_eq!(statuts::modifier(&m.c, attente.id, &doublon).unwrap_err().code, "doublon");
    let hors = SaisieStatut { nom: "X".into(), couleur: "noir".into() };
    assert_eq!(statuts::modifier(&m.c, attente.id, &hors).unwrap_err().code, "saisie_invalide");
    // Changer seulement la casse de son propre nom : permis.
    statuts::modifier(&m.c, livraison.id, &SaisieStatut { nom: "LIVRAISON".into(), couleur: "turquoise".into() }).unwrap();

    // Les trois états fournis ne se renomment, ne changent de couleur, ni ne se suppriment.
    for role in [Role::Cours, Role::Piece, Role::Clos] {
        let id = st(&m.c, role);
        let e = statuts::modifier(&m.c, id, &SaisieStatut { nom: "Autre nom".into(), couleur: "gris".into() }).unwrap_err();
        assert_eq!(e.code, "statut_fourni");
        assert_eq!(statuts::supprimer(&m.c, id).unwrap_err().code, "statut_fourni");
    }
    assert_eq!(statuts::lister(&m.c).unwrap().len(), 5);
    assert_eq!(statuts::lire(&m.c, 999).unwrap_err().code, "introuvable");

    // Supprimer un état ajouté : refusé tant qu'un dossier le porte, avec le nombre ; nbDossiers exact.
    let d1 = m.dossier("D1", None, None);
    let d2 = m.dossier("D2", None, None);
    let d3 = m.dossier("D3", None, None);
    dossiers::definir_statut(&m.c, d1, attente.id).unwrap();
    dossiers::definir_statut(&m.c, d2, attente.id).unwrap();
    dossiers::definir_statut(&m.c, d3, livraison.id).unwrap();
    let nb = |id: i64| statuts::lire(&m.c, id).unwrap().nb_dossiers;
    assert_eq!((nb(attente.id), nb(livraison.id), nb(st(&m.c, Role::Cours))), (2, 1, 0));
    assert_eq!(dossiers::resume(&m.c, d1).unwrap().statut.nb_dossiers, 2);
    let e = statuts::supprimer(&m.c, attente.id).unwrap_err();
    assert_eq!(e.code, "statut_utilise");
    assert_eq!(e.message, "2 dossiers sont dans cet état. Donnez-leur un autre état avant de le supprimer.");
    let e = statuts::supprimer(&m.c, livraison.id).unwrap_err();
    assert_eq!(e.message, "1 dossier est dans cet état. Donnez-lui un autre état avant de le supprimer.");
    // Un dossier clôturé depuis un état ajouté ne le porte plus.
    dossiers::definir_statut(&m.c, d3, st(&m.c, Role::Clos)).unwrap();
    assert_eq!(nb(livraison.id), 0);
    statuts::supprimer(&m.c, livraison.id).unwrap();
    assert_eq!(statuts::lire(&m.c, livraison.id).unwrap_err().code, "introuvable");
    dossiers::definir_statut(&m.c, d1, st(&m.c, Role::Cours)).unwrap();
    dossiers::definir_statut(&m.c, d2, st(&m.c, Role::Piece)).unwrap();
    statuts::supprimer(&m.c, attente.id).unwrap();
    assert_eq!(statuts::lister(&m.c).unwrap().len(), 3);

    // Réinitialisation : les états ajoutés sont effacés, les trois fournis restent.
    statuts::creer(&m.c, "Archivage", "gris").unwrap();
    let t = Temp::new();
    donnees::reinitialiser(&m.c, &t.0, &t.0.join("fichiers"), ModeReinit::Vide, chrono::Local::now().date_naive()).unwrap();
    assert_eq!(statuts::lister(&m.c).unwrap().len(), 3);
}

#[test]
fn transitions_entre_etats() {
    let m = mini();
    let tmp = Temp::new();
    let a = m.employe("Benali", "Sofia");
    let b = m.machine("PC accueil", Some("PC-0101"));
    let d = m.dossier("Dossier 2026-01", Some(a), Some(b));
    let perso = statuts::creer(&m.c, "Attente fournisseur", "violet").unwrap();
    let role = |id| dossiers::resume(&m.c, id).unwrap().statut.role;

    // Libre entre états ouverts, y compris pour quitter « Pièce manquante » à la main.
    for (vers, attendu) in [
        (perso.id, Role::Perso),
        (st(&m.c, Role::Piece), Role::Piece),
        (perso.id, Role::Perso),
        (st(&m.c, Role::Piece), Role::Piece),
        (st(&m.c, Role::Cours), Role::Cours),
        (st(&m.c, Role::Piece), Role::Piece),
    ] {
        assert_eq!(dossiers::definir_statut(&m.c, d, vers).unwrap().statut.role, attendu);
    }
    // Un dossier dans un état ajouté reste modifiable.
    dossiers::definir_statut(&m.c, d, perso.id).unwrap();
    dossiers::renommer(&m.c, d, "Dossier renommé").unwrap();
    // Clôture refusée depuis « Pièce manquante », avec son explication.
    dossiers::definir_statut(&m.c, d, st(&m.c, Role::Piece)).unwrap();
    let e = dossiers::definir_statut(&m.c, d, st(&m.c, Role::Clos)).unwrap_err();
    assert_eq!(e.code, "transition_interdite");
    assert!(e.message.contains("Pièce manquante"), "{}", e.message);
    assert_eq!(role(d), Role::Piece);
    // « Ajouter la pièce finale » ramène toujours « Pièce manquante » à « En cours ».
    let modele = m.modele();
    documents::creer_depuis_modele(&m.c, &tmp.0, d, None, modele, true).unwrap();
    assert_eq!(role(d), Role::Cours);
    // … mais ne touche pas un autre état.
    dossiers::definir_statut(&m.c, d, perso.id).unwrap();
    documents::creer_depuis_modele(&m.c, &tmp.0, d, None, modele, true).unwrap();
    assert_eq!(role(d), Role::Perso);
    // Clôture depuis un état ajouté : permise ; dossier en lecture seule.
    let r = dossiers::definir_statut(&m.c, d, st(&m.c, Role::Clos)).unwrap();
    assert_eq!(r.statut.role, Role::Clos);
    assert!(r.clos_le.is_some());
    assert_eq!(dossiers::renommer(&m.c, d, "X").unwrap_err().code, "dossier_clos");
    // Depuis un dossier clôturé : seul « En cours » (rouvrir).
    for vers in [perso.id, st(&m.c, Role::Piece)] {
        assert_eq!(dossiers::definir_statut(&m.c, d, vers).unwrap_err().code, "dossier_clos");
    }
    let r = dossiers::definir_statut(&m.c, d, st(&m.c, Role::Cours)).unwrap();
    assert_eq!((r.statut.role, r.clos_le), (Role::Cours, None));
    // Même état : sans effet ; état inconnu : introuvable.
    let n = compter(&m.c, "SELECT COUNT(*) FROM evenements");
    dossiers::definir_statut(&m.c, d, st(&m.c, Role::Cours)).unwrap();
    assert_eq!(compter(&m.c, "SELECT COUNT(*) FROM evenements"), n);
    assert_eq!(dossiers::definir_statut(&m.c, d, 999).unwrap_err().code, "introuvable");

    // Chaque changement est au journal du dossier, et dans l'historique des deux fiches nommées dans ses documents.
    let ev_a = journal::pour_entite(&m.c, Kind::A, a).unwrap();
    let changes: Vec<&journal::Evenement> = ev_a.iter().filter(|e| e.r#type == journal::STATUT_MODIFIE).collect();
    assert!(changes.len() >= 3, "{changes:?}");
    let c0 = changes.iter().find(|e| e.titre.contains("Attente fournisseur")).unwrap();
    assert_eq!((c0.a_id, c0.b_id, c0.dossier_id), (None, None, Some(d)));
    assert!(c0.detail.starts_with("Ancien état : « "), "{}", c0.detail);
    assert!(journal::pour_entite(&m.c, Kind::B, b).unwrap().iter().any(|e| e.r#type == journal::STATUT_MODIFIE));
    assert_eq!(journal::classe(journal::STATUT_MODIFIE), "");

    // Création dans un état choisi : ouvert seulement.
    let saisie = |statut_id| SaisieDossier { nom: "D".into(), annee: 2026, theme_id: m.theme, statut_id };
    assert_eq!(dossiers::creer(&m.c, &saisie(Some(perso.id))).unwrap().statut.role, Role::Perso);
    assert_eq!(dossiers::creer(&m.c, &saisie(Some(st(&m.c, Role::Piece)))).unwrap().statut.role, Role::Piece);
    assert_eq!(dossiers::creer(&m.c, &saisie(None)).unwrap().statut.role, Role::Cours);
    assert_eq!(dossiers::creer(&m.c, &saisie(Some(st(&m.c, Role::Clos)))).unwrap_err().code, "saisie_invalide");
    assert_eq!(dossiers::creer(&m.c, &saisie(Some(999))).unwrap_err().code, "introuvable");

    // Tableau de bord : répartition sur la liste réelle ; « ouverts » = tous les non clôturés.
    let t = tableau::calculer(&m.c).unwrap();
    let rep: BTreeMap<String, i64> = t.repartition.iter().map(|r| (r.statut.nom.clone(), r.nb)).collect();
    assert_eq!(rep["Attente fournisseur"], 1);
    assert_eq!(rep["En cours"], 2);
    assert_eq!(rep["Pièce manquante"], 1);
    assert_eq!(rep["Clôturé"], 0);
    assert_eq!((t.dossiers_total, t.dossiers_ouverts, t.dossiers_piece), (4, 4, 1));
    assert_eq!(t.dossiers_en_cours.len(), 4);
    let v = serde_json::to_value(&t).unwrap();
    assert!(v["repartition"][0]["statut"]["nom"].is_string() && v["repartition"][0]["nb"].is_i64());
}

// ---------- recherche (§ 10.2) ----------

#[test]
fn recherche_jusqu_a_50_par_groupe_avec_totaux() {
    let m = mini();
    for i in 0..60 {
        m.machine(&format!("Poste {i:02}"), Some(&format!("PST-{i:03}")));
        m.dossier(&format!("Dossier poste {i:02}"), None, None);
    }
    for i in 0..3 {
        m.employe("Poste", &format!("Agent{i}"));
    }
    let r = recherche::rechercher(&m.c, "poste").unwrap();
    assert_eq!((r.b.len(), r.b_total), (50, 60));
    assert_eq!((r.dossiers.len(), r.dossiers_total), (50, 60));
    assert_eq!((r.a.len(), r.a_total), (3, 3));
    // L'identifiant exact passe en tête, même au-delà du 50e.
    let r = recherche::rechercher(&m.c, "PST-059").unwrap();
    assert_eq!(r.b[0].code.as_deref(), Some("PST-059"));
    let v = serde_json::to_value(recherche::rechercher(&m.c, "poste").unwrap()).unwrap();
    for k in ["a", "b", "dossiers", "aTotal", "bTotal", "dossiersTotal"] {
        assert!(v.get(k).is_some(), "ResultatsRecherche.{k}");
    }
    let vide = recherche::rechercher(&m.c, " ").unwrap();
    assert_eq!((vide.a_total, vide.b_total, vide.dossiers_total), (0, 0, 0));
}

// ---------- identifiant d'un employé (§ 10.5) ----------

fn saisie(n: &str, p: &str, d: Option<&str>, f: &str) -> SaisieIdentifiant {
    SaisieIdentifiant { nom: n.into(), prenom: p.into(), date_naissance: d.map(Into::into), poste: f.into() }
}

fn apercu(c: &Connection, s: &SaisieIdentifiant) -> Option<String> {
    entites::apercu_identifiant(c, s, None).unwrap()
}

/// Positions où deux identifiants ont le même caractère (hors « EMP- » et tirets).
fn positions_communes(a: &str, b: &str) -> usize {
    a.chars().zip(b.chars()).skip(4).filter(|(x, y)| x == y && *x != '-').count()
}

#[test]
fn identifiant_code_forme_et_stabilite() {
    let m = mini();
    let s = saisie("Benali", "Sofia", Some("1990-05-14"), "Technicienne");
    let prevu = apercu(&m.c, &s).unwrap();
    assert!(forme_valide(&prevu), "{prevu}");
    assert_eq!(prevu.len(), "EMP-XXXXX-XXXXX".len());
    assert!(!prevu[4..].chars().any(|c| "ILOU".contains(c)), "{prevu}");
    // Rien de lisible : ni la date de naissance (le nom, le prénom et le poste sont couverts par les variantes plus bas).
    for morceau in ["140590", "1990", "0514"] {
        assert!(!prevu[4..].replace('-', "").contains(morceau), "{prevu} contient {morceau}");
    }
    // L'aperçu donne exactement l'identifiant attribué à la création.
    let sofia = entites::creer(&m.c, &employe(m.cat_a, "Benali", "Sofia", Some("1990-05-14"), "Technicienne")).unwrap();
    assert_eq!(sofia.code.as_deref(), Some(prevu.as_str()));
    // Mêmes informations (casse, accents, espaces mis à part) : même identifiant.
    assert_eq!(entites::apercu_identifiant(&m.c, &saisie(" BÉNALI ", "sofia", Some("1990-05-14"), "technicienne "), Some(sofia.id)).unwrap(), sofia.code);
    let cat2 = classement::categorie_creer(&m.c, Kind::A, "Atelier").unwrap().id;
    let s2 = entites::modifier(&m.c, sofia.id, &employe(cat2, "BÉNALI", "SOFIA", Some("1990-05-14"), "technicienne")).unwrap();
    assert_eq!(s2.code, sofia.code, "la structure et la casse ne changent pas l'identifiant");
    // Une des quatre informations change : identifiant recalculé et journalisé.
    let s3 = entites::modifier(&m.c, sofia.id, &employe(cat2, "Benali", "Sofia", Some("1990-05-14"), "Ingénieure")).unwrap();
    assert_ne!(s3.code, sofia.code);
    let ev = journal::pour_entite(&m.c, Kind::A, sofia.id).unwrap();
    assert!(ev.iter().any(|e| e.r#type == journal::CODE_SAISI && e.detail.contains(s3.code.as_deref().unwrap())));
    // Revenir aux informations d'origine redonne l'identifiant d'origine.
    let s4 = entites::modifier(&m.c, sofia.id, &employe(cat2, "Benali", "Sofia", Some("1990-05-14"), "Technicienne")).unwrap();
    assert_eq!(s4.code, sofia.code);

    // Une lettre de différence : identifiant sans rapport visible.
    let base_code = prevu.clone();
    let variantes = [
        saisie("Benalo", "Sofia", Some("1990-05-14"), "Technicienne"),
        saisie("Benali", "Sofie", Some("1990-05-14"), "Technicienne"),
        saisie("Benali", "Sofia", Some("1990-05-15"), "Technicienne"),
        saisie("Benali", "Sofia", Some("1991-05-14"), "Technicienne"),
        saisie("Benali", "Sofia", Some("1990-05-14"), "Technicienn"),
        saisie("Benalis", "Sofia", Some("1990-05-14"), "Technicienne"),
        saisie("Benali", "Sofiaa", Some("1990-05-14"), "Technicienne"),
    ];
    let mut tous = vec![base_code.clone()];
    for v in &variantes {
        let code = apercu(&m.c, v).unwrap();
        assert!(forme_valide(&code));
        assert!(positions_communes(&base_code, &code) <= 5, "{base_code} / {code}");
        assert_ne!(base_code[4..9], code[4..9], "{base_code} / {code}");
        assert_ne!(base_code[10..], code[10..], "{base_code} / {code}");
        tous.push(code);
    }
    let n = tous.len();
    tous.sort();
    tous.dedup();
    assert_eq!(tous.len(), n);
    // Sur un grand nombre d'identifiants : tous les caractères de l'alphabet apparaissent, rien d'autre.
    let mut vus = std::collections::BTreeSet::new();
    for i in 0..300 {
        let code = apercu(&m.c, &saisie(&format!("Nom{i}"), "Prénom", Some("1980-01-01"), "Poste")).unwrap();
        assert!(forme_valide(&code), "{code}");
        vus.extend(code[4..].chars().filter(|c| *c != '-'));
    }
    assert_eq!(vus.into_iter().collect::<String>(), String::from_utf8(identifiant::ALPHABET.to_vec()).unwrap());

    // Deux bases différentes : identifiants différents pour les mêmes informations.
    let autre = mini();
    let ailleurs = apercu(&autre.c, &s).unwrap();
    assert_ne!(ailleurs, prevu);
    assert!(forme_valide(&ailleurs));
    // La même base relue : même identifiant (la clé est conservée).
    assert_eq!(apercu(&autre.c, &s).unwrap(), ailleurs);

    // Information manquante : pas d'identifiant (aperçu), et la création est refusée.
    for (incomplete, message) in [
        (saisie("", "Sofia", Some("1990-05-14"), "T"), "Le nom de l’employé est obligatoire."),
        (saisie("Benali", " ", Some("1990-05-14"), "T"), "Le prénom est obligatoire."),
        (saisie("Benali", "Sofia", None, "T"), "La date de naissance est obligatoire."),
        (saisie("Benali", "Sofia", Some("1990-05-14"), "-"), "Le poste est obligatoire."),
    ] {
        assert_eq!(apercu(&m.c, &incomplete), None);
        let e = entites::creer(
            &m.c,
            &employe(m.cat_a, &incomplete.nom, &incomplete.prenom, incomplete.date_naissance.as_deref(), &incomplete.poste),
        )
        .unwrap_err();
        assert_eq!((e.code.as_str(), e.message.as_str()), ("saisie_invalide", message));
    }
    // Date invalide ou incomplète pendant la saisie : aucun identifiant, sans erreur.
    assert_eq!(apercu(&m.c, &saisie("Benali", "Sofia", Some("1990-05"), "T")), None);
    assert_eq!(apercu(&m.c, &saisie("Benali", "Sofia", Some("2999-01-01"), "T")), None);
    // Une machine n'a pas d'identifiant calculé ; fiche inconnue : introuvable.
    let pc = m.machine("PC", None);
    assert_eq!(entites::apercu_identifiant(&m.c, &s, Some(pc)).unwrap_err().code, "saisie_invalide");
    assert_eq!(entites::apercu_identifiant(&m.c, &s, Some(999)).unwrap_err().code, "introuvable");
}

#[test]
fn identifiant_collision_provoquee() {
    let m = mini();
    let infos = identifiant::infos("Benali", "Sofia", Some("1990-05-14"), "Technicienne").unwrap();
    let candidats = identifiant::candidats_pour(&m.c, &infos, 12).unwrap();
    assert!(candidats.iter().all(|c| forme_valide(c)));
    let mut uniques = candidats.clone();
    uniques.sort();
    uniques.dedup();
    assert_eq!(uniques.len(), candidats.len());
    // Un autre employé porte déjà le premier candidat (collision forcée en base) : on prend les bits suivants.
    let x = employe_incomplet(&m.c, m.cat_a, "Autre", "Personne");
    m.c.execute("UPDATE entites SET code = ?1 WHERE id = ?2", rusqlite::params![candidats[0], x]).unwrap();
    let s = saisie("Benali", "Sofia", Some("1990-05-14"), "Technicienne");
    assert_eq!(apercu(&m.c, &s).as_deref(), Some(candidats[1].as_str()), "aperçu");
    let sofia = entites::creer(&m.c, &employe(m.cat_a, "Benali", "Sofia", Some("1990-05-14"), "Technicienne")).unwrap();
    assert_eq!(sofia.code.as_deref(), Some(candidats[1].as_str()), "création");
    // Même informations pour un troisième employé : le candidat suivant, jamais un doublon.
    let jumelle = entites::creer(&m.c, &employe(m.cat_a, "BENALI", "Sofia", Some("1990-05-14"), "Technicienne")).unwrap();
    assert_eq!(jumelle.code.as_deref(), Some(candidats[2].as_str()));
    // Sans changement d'information, chacun garde le sien, même si un candidat antérieur se libère.
    m.c.execute("UPDATE entites SET code = NULL WHERE id = ?1", [x]).unwrap();
    let relue = entites::modifier(&m.c, jumelle.id, &employe(m.cat_a, "Benali", "SOFIA", Some("1990-05-14"), "Technicienne")).unwrap();
    assert_eq!(relue.code, jumelle.code);
    assert_eq!(entites::apercu_identifiant(&m.c, &s, Some(sofia.id)).unwrap().as_deref(), Some(candidats[1].as_str()));
    // Un nouvel employé aux mêmes informations reprend le premier candidat libéré.
    assert_eq!(apercu(&m.c, &s).as_deref(), Some(candidats[0].as_str()));
    // L'unicité est aussi garantie par la base.
    assert!(m.c.execute("UPDATE entites SET code = ?1 WHERE id = ?2", rusqlite::params![candidats[1], jumelle.id]).is_err());
}

/// Octets de la clé en hexadécimal (lecture directe en base, pour le test seulement).
fn cle_hex(c: &Connection) -> String {
    let cle: Vec<u8> = c.query_row("SELECT cle FROM cle_identifiant", [], |r| r.get(0)).unwrap();
    assert_eq!(cle.len(), 32);
    assert!(cle.iter().any(|b| *b != 0));
    cle.iter().map(|b| format!("{b:02x}")).collect()
}

#[test]
fn cle_secrete_jamais_exposee_et_conservee() {
    let c = db::ouvrir_memoire().unwrap();
    db::exemple::initialiser(&c, chrono::Local::now().date_naive()).unwrap();
    let hex = cle_hex(&c);
    let tmp = Temp::new();
    // Rien de ce que renvoient les commandes ne contient la clé (sous quelque forme courante que ce soit).
    let mut sorties = Vec::new();
    for e in entites::lister(&c, Kind::A).unwrap() {
        sorties.push(serde_json::to_string(&entites::fiche(&c, &tmp.0, e.id).unwrap()).unwrap());
    }
    sorties.push(serde_json::to_string(&tableau::calculer(&c).unwrap()).unwrap());
    sorties.push(serde_json::to_string(&recherche::rechercher(&c, "a").unwrap()).unwrap());
    sorties.push(serde_json::to_string(&dossiers::lister(&c).unwrap()).unwrap());
    sorties.push(contenu(&c, "SELECT * FROM evenements").join("\n"));
    sorties.push(contenu(&c, "SELECT * FROM parametres").join("\n"));
    let octets: Vec<u8> = c.query_row("SELECT cle FROM cle_identifiant", [], |r| r.get(0)).unwrap();
    let decimal = format!("{octets:?}");
    for s in &sorties {
        let bas = s.to_lowercase();
        assert!(!bas.contains(&hex), "clé exposée");
        assert!(!s.contains(&decimal[1..decimal.len() - 1]), "clé exposée");
    }
    // Le code source : aucune fonction publique ne renvoie la clé, aucune commande ne lit sa table.
    let commandes = include_str!("../commandes/mod.rs");
    assert!(!commandes.contains("cle_identifiant") && !commandes.contains("identifiant::"));
    let source = include_str!("identifiant.rs");
    assert!(!source.contains("pub fn cle") && !source.contains("pub(crate) fn cle"));

    // La clé survit aux réinitialisations : mêmes informations, même identifiant qu'avant.
    let s = saisie("Benali", "Sofia", Some("1990-05-14"), "Technicienne");
    let avant: String = c.query_row("SELECT code FROM entites WHERE nom = 'Benali'", [], |r| r.get(0)).unwrap();
    donnees::reinitialiser(&c, &tmp.0, &tmp.0.join("fichiers"), ModeReinit::Vide, chrono::Local::now().date_naive()).unwrap();
    assert_eq!(cle_hex(&c), hex);
    assert_eq!(apercu(&c, &s), Some(avant));
    // Table de la clé vidée à la main : une nouvelle clé est tirée, sans erreur.
    c.execute("DELETE FROM cle_identifiant", []).unwrap();
    assert!(apercu(&c, &s).is_some_and(|x| forme_valide(&x)));
    assert_ne!(cle_hex(&c), hex);
}

// ---------- champs obligatoires (§ 10.6) ----------

#[test]
fn champs_obligatoires_des_fiches() {
    let m = mini();
    // Employé : chaque champ manquant est nommé, dans l'ordre du formulaire.
    for (n, p, d, f, cat, message) in [
        ("", "Sofia", Some("1990-05-14"), "T", m.cat_a, "Le nom de l’employé est obligatoire."),
        ("Benali", "", Some("1990-05-14"), "T", m.cat_a, "Le prénom est obligatoire."),
        ("Benali", "Sofia", None, "T", m.cat_a, "La date de naissance est obligatoire."),
        ("Benali", "Sofia", Some(" "), "T", m.cat_a, "La date de naissance est obligatoire."),
        ("Benali", "Sofia", Some("1990-05-14"), "  ", m.cat_a, "Le poste est obligatoire."),
        ("Benali", "Sofia", Some("1990-05-14"), "T", 0, "La structure est obligatoire."),
        ("", "", None, "", 0, "Le nom de l’employé est obligatoire."),
    ] {
        let e = entites::creer(&m.c, &employe(cat, n, p, d, f)).unwrap_err();
        assert_eq!((e.code.as_str(), e.message.as_str()), ("saisie_invalide", message), "{n}/{p}/{d:?}/{f}/{cat}");
    }
    // Les mêmes règles en modification.
    let sofia = m.employe("Benali", "Sofia");
    let e = entites::modifier(&m.c, sofia, &employe(m.cat_a, "Benali", "Sofia", None, "Technicienne")).unwrap_err();
    assert_eq!(e.message, "La date de naissance est obligatoire.");
    assert!(entites::lire(&m.c, sofia).unwrap().code.is_some(), "rien n'est écrit");
    // Machine : nom et type obligatoires, identifiant facultatif.
    assert_eq!(entites::creer(&m.c, &machine(m.cat_b, " ", None)).unwrap_err().message, "Le nom de la machine est obligatoire.");
    assert_eq!(entites::creer(&m.c, &machine(0, "PC", None)).unwrap_err().message, "Le type de machine est obligatoire.");
    assert!(entites::creer(&m.c, &machine(m.cat_b, "PC", None)).unwrap().code.is_none());

    // Fiche incomplète d'une version précédente : elle reste « à compléter », s'archive, se réactive, s'affecte,
    // se renvoie telle quelle ; toute modification réelle exige les champs obligatoires.
    let ancien = employe_incomplet(&m.c, m.cat_a, "Cherif", "Amine");
    let pc = m.machine("PC", Some("PC-01"));
    entites::basculer(&m.c, ancien).unwrap();
    entites::basculer(&m.c, ancien).unwrap();
    entites::associer(&m.c, ancien, pc).unwrap();
    let n = compter(&m.c, "SELECT COUNT(*) FROM evenements");
    let meme = entites::modifier(&m.c, ancien, &employe(m.cat_a, " Cherif ", "Amine", Some(""), "")).unwrap();
    assert_eq!((meme.code, meme.prenom.as_str()), (None, "Amine"));
    assert_eq!(compter(&m.c, "SELECT COUNT(*) FROM evenements"), n, "rien n'est écrit");
    assert!(tableau::calculer(&m.c).unwrap().sans_code_a.iter().any(|e| e.id == ancien));
    let e = entites::modifier(&m.c, ancien, &employe(m.cat_a, "Cherif", "Amin", None, "")).unwrap_err();
    assert_eq!(e.message, "La date de naissance est obligatoire.");
    let cat2 = classement::categorie_creer(&m.c, Kind::A, "Atelier").unwrap().id;
    assert_eq!(entites::modifier(&m.c, ancien, &employe(cat2, "Cherif", "Amine", None, "")).unwrap_err().code, "saisie_invalide");
    let complet = entites::modifier(&m.c, ancien, &employe(m.cat_a, "Cherif", "Amine", Some("1991-02-03"), "Agent")).unwrap();
    assert!(complet.code.as_deref().is_some_and(forme_valide));
    // Une fiche incomplète peut encore être nommée dans un bloc de document.
    let d = SaisieDossier { nom: "D".into(), annee: 2026, theme_id: m.theme, statut_id: None };
    let d = dossiers::creer(&m.c, &d).unwrap().id;
    document_nommant(&m.c, d, Some(employe_incomplet(&m.c, m.cat_a, "Djebbar", "")), None);
}

#[test]
fn champ_obligatoire_dans_les_modeles_et_documents() {
    let m = mini();
    let oblig = |t: TypeBloc| Bloc { obligatoire: Some(true), ..Bloc::nouveau(t, "Libellé") };
    let mut blocs: Vec<Bloc> = [
        TypeBloc::Champ,
        TypeBloc::Zone,
        TypeBloc::Date,
        TypeBloc::Case,
        TypeBloc::Tableau,
        TypeBloc::Magasin,
        TypeBloc::Employe,
        TypeBloc::Machine,
        TypeBloc::Signature,
    ]
    .into_iter()
    .map(oblig)
    .collect();
    blocs.push(Bloc { options: Some(vec!["Oui".into(), "Non".into()]), ..oblig(TypeBloc::Choix) });
    // Refusé sans effet sur titre, texte et variable.
    blocs.push(oblig(TypeBloc::Titre));
    blocs.push(oblig(TypeBloc::Texte));
    blocs.push(Bloc { v: "Date du jour".into(), ..oblig(TypeBloc::Variable) });
    // `false` n'est pas conservé.
    blocs.push(Bloc { obligatoire: Some(false), ..Bloc::nouveau(TypeBloc::Champ, "Facultatif") });
    let modele = modeles::creer(&m.c).unwrap();
    let enr = modeles::enregistrer(&m.c, modele.id, &SaisieModele { nom: "Obligatoires".into(), theme_id: modele.theme_id, blocs }).unwrap();
    // Blocs 0 à 9 : de saisie, marqués ; 10 à 12 : titre, texte, variable ; 13 : `false`, non conservé.
    let marques: Vec<Option<bool>> = enr.blocs.iter().map(|b| b.obligatoire).collect();
    assert_eq!(marques[..10], [Some(true); 10]);
    assert_eq!(marques[10..], [None; 4]);
    assert!(enr.blocs[..10].iter().all(|b| b.t.est_saisie()));
    assert!(enr.blocs[10..13].iter().all(|b| !b.t.est_saisie()));
    let json = serde_json::to_value(&enr.blocs).unwrap();
    assert_eq!(json[0]["obligatoire"], true);
    assert!(json[10].get("obligatoire").is_none(), "titre");
    assert!(json[11].get("obligatoire").is_none(), "texte");
    assert!(json[12].get("obligatoire").is_none(), "variable");
    assert!(json[13].get("obligatoire").is_none(), "false non conservé");
    // Relu tel quel.
    assert_eq!(modeles::lire(&m.c, modele.id).unwrap().blocs, enr.blocs);

    // Le document reprend la marque ; la saisie ne peut pas la changer ; elle n'empêche ni l'enregistrement
    // ni la clôture.
    let tmp = Temp::new();
    let d = SaisieDossier { nom: "D".into(), annee: 2026, theme_id: m.theme, statut_id: None };
    let d = dossiers::creer(&m.c, &d).unwrap().id;
    let doc = documents::creer_depuis_modele(&m.c, &tmp.0, d, None, enr.id, false).unwrap();
    let b = doc.blocs.unwrap();
    assert_eq!(b.iter().map(|x| x.obligatoire).collect::<Vec<_>>(), enr.blocs.iter().map(|x| x.obligatoire).collect::<Vec<_>>());
    let mut saisis = b.clone();
    for x in &mut saisis {
        x.obligatoire = Some(false);
    }
    saisis[13].obligatoire = Some(true);
    documents::enregistrer_blocs(&m.c, doc.id, &saisis).unwrap();
    let relu = documents::lire(&m.c, &tmp.0, doc.id).unwrap().blocs.unwrap();
    assert_eq!(relu.iter().map(|x| x.obligatoire).collect::<Vec<_>>(), b.iter().map(|x| x.obligatoire).collect::<Vec<_>>());
    dossiers::definir_statut(&m.c, d, st(&m.c, Role::Clos)).unwrap();
}

/// Blocs marqués obligatoires d'un modèle : (type, libellé).
fn obligatoires(m: &modeles::Modele) -> Vec<(TypeBloc, String)> {
    m.blocs.iter().filter(|b| b.obligatoire == Some(true)).map(|b| (b.t, b.v.clone())).collect()
}

#[test]
fn modeles_standards_avec_champs_obligatoires() {
    // Base neuve.
    let c = db::ouvrir_memoire().unwrap();
    db::exemple::initialiser(&c, chrono::Local::now().date_naive()).unwrap();
    let liste = modeles::lister(&c).unwrap();
    let modele = |nom: &str| liste.iter().find(|m| m.nom == nom).unwrap().clone();
    assert_eq!(obligatoires(&modele(ETAT_DES_BESOINS)), [(TypeBloc::Tableau, String::new())]);
    assert_eq!(
        obligatoires(&modele(FICHE_INTERVENTION)),
        [(TypeBloc::Employe, "Utilisateur".to_string()), (TypeBloc::Machine, "Matériel".to_string())]
    );
    assert_eq!(obligatoires(&modele(FICHE_IDENTIFICATION)), [(TypeBloc::Employe, "Bénéficiaire".to_string())]);
    assert_eq!(
        obligatoires(&modele(FICHE_FORMATAGE)),
        [(TypeBloc::Employe, "Utilisateur".to_string()), (TypeBloc::Machine, "PC".to_string())]
    );
    // Les documents d'exemple reprennent la marque.
    let tmp = Temp::new();
    let d = dossiers::lister(&c).unwrap()[0].id;
    let det = dossiers::detail(&c, &tmp.0, d).unwrap();
    assert!(det.documents.iter().flat_map(|x| x.blocs.iter().flatten()).any(|b| b.obligatoire == Some(true)));

    // Restauration : le modèle recréé porte les marques ; les modèles existants ne sont pas touchés.
    let fi = modele(FICHE_INTERVENTION);
    modeles::basculer(&c, fi.id).unwrap();
    let id_fid = modele(FICHE_IDENTIFICATION).id;
    c.execute("UPDATE modeles SET blocs = replace(blocs, ',\"obligatoire\":true', '') WHERE id = ?1", [id_fid]).unwrap();
    let crees = modeles::restaurer_standards(&c).unwrap();
    assert_eq!(crees.len(), 1);
    assert_eq!(obligatoires(&crees[0]).len(), 2);
    assert!(obligatoires(&modeles::lire(&c, fi.id).unwrap()).len() == 2, "l'ancien garde ses blocs");
    assert!(obligatoires(&modeles::lire(&c, id_fid).unwrap()).is_empty(), "modèle existant non modifié");
    // « Effacer toutes les données » recrée les quatre avec leurs marques.
    donnees::reinitialiser(&c, &tmp.0, &tmp.0.join("fichiers"), ModeReinit::Vide, chrono::Local::now().date_naive()).unwrap();
    for m in modeles::lister(&c).unwrap() {
        assert!(!obligatoires(&m).is_empty(), "{}", m.nom);
    }
    // Les définitions passent la validation du Studio telles quelles.
    for s in standards::definitions() {
        assert_eq!(modeles::normaliser_blocs_modele(&s.blocs, &modeles::Bornes::default()).unwrap(), s.blocs, "{}", s.nom);
    }
}
