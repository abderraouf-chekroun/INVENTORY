//! Tests de la version 1.8 (§ 17) : les mots-clés du Magasin se renomment (les documents qui les avaient choisis
//! affichent le nouveau nom) et se suppriment (les documents gardent la valeur écrite).

use super::dossiers::{self, SaisieDossier};
use super::modeles::{Bloc, TypeBloc};
use super::statuts::Role;
use super::tests::st;
use super::{classement, documents};
use crate::db;
use rusqlite::{Connection, params};
use std::path::PathBuf;

fn fichiers() -> PathBuf {
    std::env::temp_dir().join(format!("entites-dossiers-v18-{}", uuid::Uuid::new_v4()))
}

fn dossier(c: &Connection, nom: &str) -> i64 {
    let theme = match classement::themes_lister(c).unwrap().first() {
        Some(t) => t.id,
        None => classement::theme_creer(c, "Achats").unwrap().id,
    };
    dossiers::creer(c, &SaisieDossier { nom: nom.into(), annee: 2026, theme_id: theme, statut_id: None }).unwrap().id
}

/// Document aux blocs donnés (JSON brut), inséré tel quel.
fn document(c: &Connection, dossier: i64, nom: &str, blocs: &str) -> i64 {
    c.execute(
        "INSERT INTO documents (dossier_id, nom, origine, source, date_doc, blocs, piece_finale, cree_le)
         VALUES (?1, ?2, 'modele', 'Modèle', '2026-11-01', ?3, 0, '2026-11-01 10:00:00')",
        params![dossier, nom, blocs],
    )
    .unwrap();
    c.last_insert_rowid()
}

fn blocs_bruts(c: &Connection, doc: i64) -> String {
    c.query_row("SELECT blocs FROM documents WHERE id = ?1", [doc], |r| r.get(0)).unwrap()
}

fn maj_le(c: &Connection, dossier: i64) -> String {
    c.query_row("SELECT maj_le FROM dossiers WHERE id = ?1", [dossier], |r| r.get(0)).unwrap()
}

/// Valeurs des blocs `magasin` du document, lues comme l'application les affiche.
fn valeurs(c: &Connection, doc: i64) -> Vec<String> {
    documents::lire(c, &fichiers(), doc)
        .unwrap()
        .blocs
        .unwrap()
        .into_iter()
        .filter(|b| b.t == TypeBloc::Magasin)
        .map(|b| b.val.unwrap_or_default())
        .collect()
}

fn nb_documents(c: &Connection, id: i64) -> i64 {
    classement::magasin_lister(c).unwrap().into_iter().find(|k| k.id == id).expect("mot-clé listé").nb_documents
}

fn doc_magasin(val: &str) -> String {
    format!(r#"[{{"t":"titre","v":"Demande"}},{{"t":"magasin","v":"Matériel","val":"{val}"}},{{"t":"champ","v":"Note","val":"Baterie"}}]"#)
}

#[test]
fn renommer_un_mot_cle() {
    let c = db::ouvrir_memoire().unwrap();
    let baterie = classement::magasin_creer(&c, "Baterie").unwrap().id;
    let ram = classement::magasin_creer(&c, "RAM").unwrap().id;
    let ram_ddr4 = classement::magasin_creer(&c, "RAM DDR4").unwrap().id;
    let ouvert = dossier(&c, "Dossier ouvert");
    let clos = dossier(&c, "Dossier clôturé");
    let d1 = document(&c, ouvert, "D1", &doc_magasin("Baterie"));
    let d2 = document(&c, clos, "D2", &doc_magasin("Baterie"));
    // Deux blocs « Choix du Magasin » dans le même document : compté une fois.
    let d3 = document(
        &c,
        ouvert,
        "D3",
        r#"[{"t":"magasin","v":"A","val":"Baterie"},{"t":"magasin","v":"B","val":"Baterie"},{"t":"magasin","v":"C","val":"RAM DDR4"}]"#,
    );
    // Contenu qui ne se relit pas à l'identique (ordre des clés, champ inconnu) : rien ne doit en être perdu.
    let d4 = document(&c, clos, "D4", r#"[{"val":"Baterie","t":"magasin","v":"Pièce","inconnu":1}]"#);
    // Même texte, mais dans un bloc d'un autre type ou avec une autre casse : non touché.
    let d5 = document(
        &c,
        ouvert,
        "D5",
        r#"[{"t":"champ","v":"Note","val":"Baterie"},{"t":"zone","v":"Z","val":"Baterie"},{"t":"magasin","v":"M","val":"baterie"},{"t":"magasin","v":"N","val":"RAM"}]"#,
    );
    // Préfixe : « RAM » n'est pas « RAM DDR4 ».
    let d6 = document(&c, ouvert, "D6", &doc_magasin("RAM DDR4"));
    dossiers::definir_statut(&c, clos, st(&c, Role::Clos)).unwrap();
    c.execute("UPDATE dossiers SET maj_le = '2026-01-02 03:04:05'", []).unwrap();
    assert_eq!((nb_documents(&c, baterie), nb_documents(&c, ram), nb_documents(&c, ram_ddr4)), (4, 1, 2));
    let d5_avant = blocs_bruts(&c, d5);
    let d6_avant = blocs_bruts(&c, d6);

    let k = classement::magasin_renommer(&c, baterie, "  Batterie  ").unwrap();
    assert_eq!((k.nom.as_str(), k.actif, k.nb_documents), ("Batterie", true, 4));
    assert_eq!(valeurs(&c, d1), ["Batterie"]);
    assert_eq!(valeurs(&c, d2), ["Batterie"], "dossier clôturé compris");
    assert_eq!(valeurs(&c, d3), ["Batterie", "Batterie", "RAM DDR4"]);
    assert_eq!(valeurs(&c, d4), ["Batterie"]);
    let d4_json: serde_json::Value = serde_json::from_str(&blocs_bruts(&c, d4)).unwrap();
    assert_eq!(d4_json[0]["inconnu"], 1, "contenu inconnu conservé");
    // Le bloc « Note » (champ) de D1 garde « Baterie ».
    assert!(blocs_bruts(&c, d1).contains(r#"{"t":"champ","v":"Note","val":"Baterie"}"#));
    assert_eq!(blocs_bruts(&c, d1), doc_magasin("Batterie"), "réécrit comme l'application l'enregistre");
    assert_eq!(blocs_bruts(&c, d5), d5_avant, "autres types et autre casse non touchés");
    // Correction de libellé : la date de modification des dossiers ne change pas.
    assert_eq!(maj_le(&c, ouvert), "2026-01-02 03:04:05");
    assert_eq!(maj_le(&c, clos), "2026-01-02 03:04:05");

    // Préfixe : renommer « RAM » ne touche pas « RAM DDR4 ».
    classement::magasin_renommer(&c, ram, "Mémoire").unwrap();
    assert_eq!(blocs_bruts(&c, d6), d6_avant);
    assert_eq!(valeurs(&c, d5), ["baterie", "Mémoire"]);
    assert_eq!(valeurs(&c, d3)[2], "RAM DDR4");
    assert_eq!(nb_documents(&c, ram_ddr4), 2);

    // Doublon refusé, sans tenir compte de la casse ni des espaces, lettres accentuées comprises.
    classement::magasin_creer(&c, "Écran").unwrap();
    for nom in ["écran", " ÉCRAN ", "RAM ddr4"] {
        let e = classement::magasin_renommer(&c, baterie, nom).unwrap_err();
        assert_eq!((e.code.as_str(), e.message.as_str()), ("doublon", "Ce mot-clé existe déjà dans le Magasin."), "{nom}");
    }
    assert_eq!(classement::magasin_creer(&c, "ÉCRAN").unwrap_err().code, "doublon");
    // Changer seulement la casse est permis ; même nom : sans effet.
    assert_eq!(classement::magasin_renommer(&c, baterie, "BATTERIE").unwrap().nom, "BATTERIE");
    assert_eq!(valeurs(&c, d1), ["BATTERIE"]);
    assert_eq!(classement::magasin_renommer(&c, baterie, "BATTERIE").unwrap().nom, "BATTERIE");

    // Nom vide ou trop long refusé, comme à la création.
    let e = classement::magasin_renommer(&c, baterie, "   ").unwrap_err();
    assert_eq!((e.code.as_str(), e.message.as_str()), ("saisie_invalide", "Le mot-clé est obligatoire."));
    assert_eq!(classement::magasin_renommer(&c, baterie, &"x".repeat(201)).unwrap_err().code, "saisie_invalide");
    assert_eq!(valeurs(&c, d1), ["BATTERIE"], "refus : rien de changé");

    // Identifiant inexistant.
    let e = classement::magasin_renommer(&c, 999, "X").unwrap_err();
    assert_eq!((e.code.as_str(), e.message.as_str()), ("introuvable", "Mot-clé introuvable."));

    // Un mot-clé archivé se renomme et reste archivé.
    classement::magasin_basculer(&c, baterie).unwrap();
    let k = classement::magasin_renommer(&c, baterie, "Batterie").unwrap();
    assert_eq!((k.nom.as_str(), k.actif), ("Batterie", false));
    assert_eq!(valeurs(&c, d2), ["Batterie"]);
}

#[test]
fn supprimer_un_mot_cle() {
    let c = db::ouvrir_memoire().unwrap();
    let ram = classement::magasin_creer(&c, "RAM").unwrap().id;
    let stockage = classement::magasin_creer(&c, "Stockage").unwrap().id;
    let libre = classement::magasin_creer(&c, "Libre").unwrap().id;
    let ouvert = dossier(&c, "Ouvert");
    let clos = dossier(&c, "Clos");
    let d1 = document(&c, ouvert, "D1", &doc_magasin("RAM"));
    let d2 = document(&c, clos, "D2", &doc_magasin("RAM"));
    let d3 = document(&c, ouvert, "D3", &doc_magasin("Stockage"));
    dossiers::definir_statut(&c, clos, st(&c, Role::Clos)).unwrap();
    assert_eq!((nb_documents(&c, ram), nb_documents(&c, stockage), nb_documents(&c, libre)), (2, 1, 0));
    let avant: Vec<String> = [d1, d2, d3].iter().map(|d| blocs_bruts(&c, *d)).collect();
    let maj_avant = (maj_le(&c, ouvert), maj_le(&c, clos));

    // Toujours possible, même choisi dans des documents ; aucun document modifié.
    classement::magasin_supprimer(&c, ram).unwrap();
    classement::magasin_supprimer(&c, libre).unwrap();
    let apres: Vec<String> = [d1, d2, d3].iter().map(|d| blocs_bruts(&c, *d)).collect();
    assert_eq!(apres, avant);
    assert_eq!((maj_le(&c, ouvert), maj_le(&c, clos)), maj_avant);
    // Plus proposé : absent de la liste.
    let noms: Vec<String> = classement::magasin_lister(&c).unwrap().into_iter().map(|k| k.nom).collect();
    assert_eq!(noms, ["Stockage"]);
    // La valeur reste lisible.
    assert_eq!(valeurs(&c, d1), ["RAM"]);
    assert_eq!(valeurs(&c, d2), ["RAM"]);

    // Un document dont la valeur ne correspond plus à aucun mot-clé s'enregistre sans erreur, et l'on peut y choisir
    // une autre valeur (dossier non clôturé).
    let mut blocs: Vec<Bloc> = documents::lire(&c, &fichiers(), d1).unwrap().blocs.unwrap();
    documents::enregistrer_blocs(&c, d1, &blocs).unwrap();
    assert_eq!(valeurs(&c, d1), ["RAM"]);
    blocs[1].val = Some("Stockage".into());
    documents::enregistrer_blocs(&c, d1, &blocs).unwrap();
    assert_eq!(valeurs(&c, d1), ["Stockage"]);
    assert_eq!(nb_documents(&c, stockage), 2);
    // Dossier clôturé : toujours en lecture seule.
    let blocs2: Vec<Bloc> = documents::lire(&c, &fichiers(), d2).unwrap().blocs.unwrap();
    assert!(documents::enregistrer_blocs(&c, d2, &blocs2).is_err());

    // Recréer le même nom : de nouveau proposé, et les documents qui portaient ce texte le retrouvent.
    let k = classement::magasin_creer(&c, "RAM").unwrap();
    assert!(k.actif);
    assert_eq!(nb_documents(&c, k.id), 1, "D2 porte toujours « RAM »");
    classement::magasin_renommer(&c, k.id, "Mémoire vive").unwrap();
    assert_eq!(valeurs(&c, d2), ["Mémoire vive"]);

    // Identifiant inexistant (ou déjà supprimé).
    let e = classement::magasin_supprimer(&c, ram).unwrap_err();
    assert_eq!((e.code.as_str(), e.message.as_str()), ("introuvable", "Mot-clé introuvable."));
}

#[test]
fn compteur_et_documents_illisibles() {
    let c = db::ouvrir_memoire().unwrap();
    let ram = classement::magasin_creer(&c, "RAM").unwrap().id;
    let d = dossier(&c, "D");
    // JSON illisible : ne compte pour rien, n'empêche ni la liste ni le renommage, et reste tel quel.
    let illisible = document(&c, d, "Illisible", r#"[{"t":"magasin","val":"RAM""#);
    // Sans bloc Magasin, ou valeur vide : non compté.
    document(&c, d, "Vide", r#"[{"t":"magasin","v":"M","val":""}]"#);
    document(&c, d, "Texte", r#"[{"t":"texte","v":"RAM"}]"#);
    document(&c, d, "Choisi", &doc_magasin("RAM"));
    assert_eq!(nb_documents(&c, ram), 1);
    classement::magasin_renommer(&c, ram, "Mémoire").unwrap();
    assert_eq!(blocs_bruts(&c, illisible), r#"[{"t":"magasin","val":"RAM""#);
    assert_eq!(nb_documents(&c, ram), 1);
    // Créer et basculer : inchangés.
    let k = classement::magasin_creer(&c, "  SSD ").unwrap();
    assert_eq!((k.nom.as_str(), k.actif), ("SSD", true));
    assert!(!classement::magasin_basculer(&c, k.id).unwrap().actif);
    assert_eq!(classement::magasin_lister(&c).unwrap().len(), 2);
}
