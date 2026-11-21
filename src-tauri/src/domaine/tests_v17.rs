//! Tests de la version 1.7 (§ 16) : les thèmes, appelés « catégories » à l'écran, se renomment et se suppriment ;
//! un dossier peut changer de catégorie.

use super::dossiers::{self, SaisieDossier};
use super::modeles::{self, SaisieModele};
use super::statuts::Role;
use super::tests::st;
use super::{classement, recherche, standards};
use crate::db;
use crate::etat::Etat;
use rusqlite::Connection;
use std::fs;
use std::path::PathBuf;

struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        Temp(std::env::temp_dir().join(format!("entites-dossiers-v17-{}", uuid::Uuid::new_v4())))
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

fn dossier(c: &Connection, nom: &str, theme: i64) -> i64 {
    dossiers::creer(c, &SaisieDossier { nom: nom.into(), annee: 2026, theme_id: theme, statut_id: None }).unwrap().id
}

/// Modèle vide rangé dans `theme`.
fn modele(c: &Connection, nom: &str, theme: i64) -> i64 {
    let m = modeles::creer(c).unwrap();
    modeles::enregistrer(c, m.id, &SaisieModele { nom: nom.into(), theme_id: theme, blocs: vec![] }).unwrap().id
}

fn compte(c: &Connection, id: i64) -> (i64, i64) {
    let t = classement::themes_lister(c).unwrap().into_iter().find(|t| t.id == id).expect("thème listé");
    (t.nb_dossiers, t.nb_modeles)
}

fn refus(c: &Connection, id: i64) -> (String, String) {
    let e = classement::theme_supprimer(c, id).unwrap_err();
    (e.code, e.message)
}

#[test]
fn renommer_une_categorie() {
    let c = db::ouvrir_memoire().unwrap();
    let a = classement::theme_creer(&c, "Thème A").unwrap().id;
    let b = classement::theme_creer(&c, "Été").unwrap().id;
    let d = dossier(&c, "Dossier 2026-01", a);
    let m = modele(&c, "Mon modèle", a);

    // Nouveau nom visible partout aussitôt (lu par jointure).
    let t = classement::theme_renommer(&c, a, "  Achats  ").unwrap();
    assert_eq!((t.nom.as_str(), t.actif, t.nb_dossiers, t.nb_modeles), ("Achats", true, 1, 1));
    assert_eq!(dossiers::resume(&c, d).unwrap().theme, "Achats");
    assert_eq!(modeles::lire(&c, m).unwrap().theme, "Achats");
    assert_eq!(dossiers::lister(&c).unwrap()[0].theme, "Achats");
    assert_eq!(recherche::rechercher(&c, "2026-01").unwrap().dossiers[0].theme, "Achats");

    // Doublon refusé, sans tenir compte de la casse ni des espaces, lettres accentuées comprises.
    for nom in ["été", " ÉTÉ ", "Été"] {
        let e = classement::theme_renommer(&c, a, nom).unwrap_err();
        assert_eq!((e.code.as_str(), e.message.as_str()), ("doublon", "Cette catégorie existe déjà."), "{nom}");
    }
    // Même règle à la création.
    assert_eq!(classement::theme_creer(&c, "ÉTÉ").unwrap_err().code, "doublon");
    // Changer seulement la casse de son propre nom est permis ; même nom : sans effet.
    assert_eq!(classement::theme_renommer(&c, b, "été").unwrap().nom, "été");
    assert_eq!(classement::theme_renommer(&c, b, "été").unwrap().nom, "été");

    // Nom vide ou trop long refusé, comme à la création.
    let e = classement::theme_renommer(&c, a, "   ").unwrap_err();
    assert_eq!((e.code.as_str(), e.message.as_str()), ("saisie_invalide", "Le nom de la catégorie est obligatoire."));
    assert_eq!(classement::theme_renommer(&c, a, &"x".repeat(201)).unwrap_err().code, "saisie_invalide");
    assert!(classement::theme_renommer(&c, a, &"x".repeat(200)).is_ok());

    // Identifiant inexistant.
    let e = classement::theme_renommer(&c, 999, "X").unwrap_err();
    assert_eq!((e.code.as_str(), e.message.as_str()), ("introuvable", "Catégorie introuvable."));

    // Une catégorie archivée se renomme et reste archivée.
    classement::theme_basculer(&c, b).unwrap();
    let t = classement::theme_renommer(&c, b, "Hiver").unwrap();
    assert_eq!((t.nom.as_str(), t.actif), ("Hiver", false));
}

#[test]
fn supprimer_une_categorie() {
    let c = db::ouvrir_memoire().unwrap();
    let a = classement::theme_creer(&c, "A").unwrap().id;
    let vide = classement::theme_creer(&c, "Vide").unwrap().id;
    let d1 = dossier(&c, "D1", a);
    let d2 = dossier(&c, "D2", a);
    let d3 = dossier(&c, "D3", a);
    assert_eq!(compte(&c, a), (3, 0));
    assert_eq!(compte(&c, vide), (0, 0));

    // Dossiers seuls.
    assert_eq!(
        refus(&c, a),
        (
            "categorie_utilisee".into(),
            "Cette catégorie contient encore 3 dossiers. Déplacez-les ou supprimez-les avant de la supprimer.".into()
        )
    );
    // Dossiers et modèles (un modèle archivé compte).
    let m1 = modele(&c, "M1", a);
    let m2 = modele(&c, "M2", a);
    modeles::basculer(&c, m2).unwrap();
    assert_eq!(compte(&c, a), (3, 2));
    assert_eq!(
        refus(&c, a).1,
        "Cette catégorie contient encore 3 dossiers et 2 modèles de document. Déplacez-les ou supprimez-les avant de la supprimer."
    );
    // Un dossier et un modèle.
    dossiers::definir_theme(&c, d2, vide).unwrap();
    dossiers::definir_theme(&c, d3, vide).unwrap();
    modeles::supprimer(&c, m1).unwrap();
    assert_eq!(compte(&c, a), (1, 1));
    assert_eq!(
        refus(&c, a).1,
        "Cette catégorie contient encore 1 dossier et 1 modèle de document. Déplacez-les ou supprimez-les avant de la supprimer."
    );
    // Modèle seul (archivé).
    dossiers::definir_theme(&c, d1, vide).unwrap();
    assert_eq!(compte(&c, a), (0, 1));
    assert_eq!(
        refus(&c, a).1,
        "Cette catégorie contient encore 1 modèle de document. Déplacez-le ou supprimez-le avant de la supprimer."
    );
    // Deux modèles seuls.
    let m3 = modele(&c, "M3", a);
    assert_eq!(
        refus(&c, a).1,
        "Cette catégorie contient encore 2 modèles de document. Déplacez-les ou supprimez-les avant de la supprimer."
    );
    // Un dossier seul.
    assert_eq!(
        refus(&c, vide).1.as_str(),
        "Cette catégorie contient encore 3 dossiers. Déplacez-les ou supprimez-les avant de la supprimer."
    );
    dossiers::definir_theme(&c, d2, a).unwrap();
    dossiers::definir_theme(&c, d3, a).unwrap();
    assert_eq!(
        refus(&c, vide).1.as_str(),
        "Cette catégorie contient encore 1 dossier. Déplacez-le ou supprimez-le avant de la supprimer."
    );

    // Rien n'a été supprimé par les refus.
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM themes"), 2);

    // Vider la catégorie (modèles déplacés dans le Studio, dossier déplacé) puis la supprimer.
    for m in [m2, m3] {
        let x = modeles::lire(&c, m).unwrap();
        modeles::enregistrer(&c, m, &SaisieModele { nom: x.nom, theme_id: vide, blocs: vec![] }).unwrap();
    }
    dossiers::definir_theme(&c, d2, vide).unwrap();
    dossiers::definir_theme(&c, d3, vide).unwrap();
    assert_eq!(compte(&c, a), (0, 0));
    classement::theme_supprimer(&c, a).unwrap();
    assert!(classement::themes_lister(&c).unwrap().iter().all(|t| t.id != a));
    assert_eq!(compte(&c, vide), (3, 2));

    // Identifiant inexistant (ou déjà supprimé).
    let e = classement::theme_supprimer(&c, a).unwrap_err();
    assert_eq!((e.code.as_str(), e.message.as_str()), ("introuvable", "Catégorie introuvable."));

    // Une catégorie vide archivée se supprime aussi.
    let x = classement::theme_creer(&c, "Archivée").unwrap().id;
    classement::theme_basculer(&c, x).unwrap();
    classement::theme_supprimer(&c, x).unwrap();
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM themes"), 1);

    let mut fk = c.prepare("PRAGMA foreign_key_check").unwrap();
    assert!(fk.query([]).unwrap().next().unwrap().is_none(), "aucune ligne orpheline");
}

#[test]
fn plus_aucune_categorie() {
    let c = db::ouvrir_memoire().unwrap();
    let a = classement::theme_creer(&c, "Seule").unwrap().id;
    classement::theme_supprimer(&c, a).unwrap();
    assert!(classement::themes_lister(&c).unwrap().is_empty());
    let e = modeles::creer(&c).unwrap_err();
    assert_eq!(
        (e.code.as_str(), e.message.as_str()),
        ("aucun_theme", "Aucune catégorie active : créez ou réactivez d’abord une catégorie dans les Paramètres.")
    );
    let e = dossiers::creer(&c, &SaisieDossier { nom: "D".into(), annee: 2026, theme_id: a, statut_id: None }).unwrap_err();
    assert_eq!(e.code, "introuvable");
    // Une catégorie créée sur place débloque les deux créations.
    let b = classement::theme_creer(&c, "Nouvelle").unwrap().id;
    assert_eq!(modeles::creer(&c).unwrap().theme_id, b);
    dossier(&c, "D", b);
}

#[test]
fn changer_la_categorie_d_un_dossier() {
    let c = db::ouvrir_memoire().unwrap();
    let a = classement::theme_creer(&c, "A").unwrap().id;
    let b = classement::theme_creer(&c, "B").unwrap().id;
    let archivee = classement::theme_creer(&c, "Archivée").unwrap().id;
    classement::theme_basculer(&c, archivee).unwrap();
    let d = dossier(&c, "D1", a);
    let evenements = compter(&c, "SELECT COUNT(*) FROM evenements");

    let r = dossiers::definir_theme(&c, d, b).unwrap();
    assert_eq!((r.theme_id, r.theme.as_str()), (b, "B"));
    assert_eq!(compte(&c, a), (0, 0));
    assert_eq!(compte(&c, b), (1, 0));
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM evenements"), evenements, "aucun événement ajouté");
    // Même catégorie : sans effet.
    assert_eq!(dossiers::definir_theme(&c, d, b).unwrap().theme_id, b);
    // Catégorie archivée refusée.
    let e = dossiers::definir_theme(&c, d, archivee).unwrap_err();
    assert_eq!((e.code.as_str(), e.message.as_str()), ("theme_archive", "La catégorie Archivée est archivée."));
    // Catégorie ou dossier inexistant.
    assert_eq!(dossiers::definir_theme(&c, d, 999).unwrap_err().code, "introuvable");
    assert_eq!(dossiers::definir_theme(&c, 999, a).unwrap_err().code, "introuvable");
    // Dossier clôturé : refusé ; rouvert : permis.
    dossiers::definir_statut(&c, d, st(&c, Role::Clos)).unwrap();
    assert_eq!(dossiers::definir_theme(&c, d, a).unwrap_err().code, "dossier_clos");
    assert_eq!(dossiers::resume(&c, d).unwrap().theme_id, b);
    dossiers::definir_statut(&c, d, st(&c, Role::Cours)).unwrap();
    assert_eq!(dossiers::definir_theme(&c, d, a).unwrap().theme, "A");
    // Un dossier resté dans une catégorie archivée y reste tant qu'on ne le déplace pas.
    classement::theme_basculer(&c, a).unwrap();
    assert_eq!(dossiers::definir_theme(&c, d, a).unwrap().theme_id, a);
}

/// « Support informatique » renommé : ni le redémarrage ni « Restaurer les modèles standards » ne dupliquent les
/// modèles standards ; la restauration d'un modèle manquant recrée une catégorie « Support informatique ».
#[test]
fn support_informatique_renomme() {
    let t = Temp::new();
    let support = {
        let etat = Etat::ouvrir_dans(t.0.clone()).unwrap();
        let c = etat.conn().unwrap();
        let support = classement::themes_lister(&c).unwrap()[0].clone();
        assert_eq!((support.nom.as_str(), support.nb_dossiers, support.nb_modeles), (standards::THEME, 0, 4));
        assert_eq!(
            classement::theme_supprimer(&c, support.id).unwrap_err().message,
            "Cette catégorie contient encore 4 modèles de document. Déplacez-les ou supprimez-les avant de la supprimer."
        );
        classement::theme_renommer(&c, support.id, "Informatique").unwrap();
        support.id
    };
    // Redémarrage : rien n'est recréé.
    {
        let etat = Etat::ouvrir_dans(t.0.clone()).unwrap();
        let c = etat.conn().unwrap();
        assert_eq!(compter(&c, "SELECT COUNT(*) FROM modeles"), 4);
        assert_eq!(compter(&c, "SELECT COUNT(*) FROM themes"), 1);
        assert!(modeles::assurer_standards(&c).unwrap().is_empty());
        assert!(modeles::restaurer_standards(&c).unwrap().is_empty());
        assert_eq!(compter(&c, "SELECT COUNT(*) FROM modeles"), 4);
        let themes: Vec<String> = modeles::lister(&c).unwrap().into_iter().map(|m| m.theme).collect();
        assert_eq!(themes, ["Informatique"; 4]);

        // Un modèle standard supprimé : la restauration le recrée dans une catégorie « Support informatique » recréée.
        let id: i64 = c
            .query_row("SELECT id FROM modeles WHERE nom = ?1", [standards::FICHE_FORMATAGE], |r| r.get(0))
            .unwrap();
        modeles::supprimer(&c, id).unwrap();
        let recrees = modeles::restaurer_standards(&c).unwrap();
        assert_eq!(recrees.len(), 1);
        assert_eq!(recrees[0].theme, standards::THEME);
        assert_eq!(compter(&c, "SELECT COUNT(*) FROM modeles"), 4);
        let noms: Vec<String> = classement::themes_lister(&c).unwrap().into_iter().map(|t| t.nom).collect();
        assert_eq!(noms, ["Informatique", standards::THEME]);
        assert_eq!(compte(&c, support), (0, 3));
        let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 6, "aucune migration nouvelle");
    }
}
