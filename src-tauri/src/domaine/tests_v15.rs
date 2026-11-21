//! Tests de la version 1.5 (§ 13) : suppression directe d'un document depuis une fiche, suppression d'un employé ou
//! d'une machine (aperçu, effets 1 à 5, transaction), migration 006 sans perte.

use super::classement;
use super::documents;
use super::dossiers::{self, SaisieDossier};
use super::entites::{self, AutreFiche, Entite, SaisieEntite, SaisieMachine};
use super::journal;
use super::modeles::{self, Bloc, FicheSupprimee, SaisieModele, TypeBloc};
use super::recherche;
use super::statuts::Role;
use super::tableau;
use super::tests::{employe, st};
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
        let p = std::env::temp_dir().join(format!("entites-dossiers-v15-{}", uuid::Uuid::new_v4()));
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

/// Toutes les tables qui peuvent changer lors d'une suppression de fiche.
fn photo(c: &Connection) -> Vec<Vec<String>> {
    [
        "SELECT * FROM entites ORDER BY id",
        "SELECT * FROM affectations ORDER BY id",
        "SELECT * FROM nominations ORDER BY document_id, entite_id, facon, champ",
        "SELECT * FROM evenements ORDER BY id",
        "SELECT * FROM documents ORDER BY id",
        "SELECT * FROM dossiers ORDER BY id",
    ]
    .iter()
    .map(|sql| contenu(c, sql))
    .collect()
}

fn sauvegardes(dossier: &Path, prefixe: &str) -> Vec<PathBuf> {
    let Ok(entrees) = fs::read_dir(dossier.join("sauvegardes")) else { return Vec::new() };
    entrees.map(|e| e.unwrap().path()).filter(|p| p.file_name().unwrap().to_string_lossy().starts_with(prefixe)).collect()
}

fn sans_reference_invalide(c: &Connection) {
    let mut fk = c.prepare("PRAGMA foreign_key_check").unwrap();
    assert!(fk.query([]).unwrap().next().unwrap().is_none(), "aucune ligne orpheline");
    db::verifier_base(c).expect("la base reste conforme");
}

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

impl Mini {
    fn employe(&self, nom: &str, prenom: &str) -> i64 {
        entites::creer(&self.c, &employe(self.cat_a, nom, prenom, Some("1990-05-14"), "Technicienne")).unwrap().id
    }
    fn machine(&self, nom: &str, code: Option<&str>) -> i64 {
        let s = SaisieMachine {
            nom: nom.into(),
            code: code.map(Into::into),
            marque: "Dell OptiPlex".into(),
            cpu: "i5".into(),
            ram: "16 Go".into(),
            stockage: "SSD 512 Go".into(),
            categorie_id: self.cat_b,
        };
        entites::creer(&self.c, &SaisieEntite::Machine(s)).unwrap().id
    }
    fn dossier(&self, nom: &str) -> i64 {
        dossiers::creer(&self.c, &SaisieDossier { nom: nom.into(), annee: 2026, theme_id: self.theme, statut_id: None }).unwrap().id
    }
    fn clore(&self, dossier: i64) {
        dossiers::definir_statut(&self.c, dossier, st(&self.c, Role::Clos)).unwrap();
    }
    /// Modèle « Fiche test » : 0 titre, 1 employé « Utilisateur », 2 machine « Matériel », 3 champ « Intervenant »,
    /// 4 zone « Observations », 5 variable « Employé · Nom », 6 variable « Machine · Identifiant ».
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
            Bloc::nouveau(TypeBloc::Variable, "Employé · Nom"),
            Bloc::nouveau(TypeBloc::Variable, "Machine · Identifiant"),
        ];
        modeles::enregistrer(&self.c, m.id, &SaisieModele { nom: "Fiche test".into(), theme_id: m.theme_id, blocs }).unwrap().id
    }
    /// Document du dossier : fiches des blocs 1 et 2, champ « Intervenant ».
    fn document(&self, dossier: i64, a: Option<i64>, b: Option<i64>, champ: &str) -> i64 {
        let doc = documents::creer_depuis_modele(&self.c, &self.tmp.0, dossier, None, self.modele(), false).unwrap().id;
        let mut blocs = self.blocs(doc);
        blocs[1].entite_id = Some(a);
        blocs[2].entite_id = Some(b);
        blocs[3].val = Some(champ.into());
        documents::enregistrer_blocs(&self.c, doc, &blocs).unwrap();
        doc
    }
    fn blocs(&self, doc: i64) -> Vec<Bloc> {
        documents::lire(&self.c, &self.tmp.0, doc).unwrap().blocs.unwrap()
    }
    fn json(&self, doc: i64) -> String {
        self.c.query_row("SELECT blocs FROM documents WHERE id = ?1", [doc], |r| r.get(0)).unwrap()
    }
    fn lire(&self, id: i64) -> Entite {
        entites::lire(&self.c, id).unwrap()
    }
    fn nb_evenements(&self) -> i64 {
        compter(&self.c, "SELECT COUNT(*) FROM evenements")
    }
}

fn autre(id: i64, nom: &str) -> AutreFiche {
    AutreFiche { id, nom: nom.into() }
}

// ---------- § 13.1 : suppression d'un document depuis la fiche ----------

#[test]
fn document_supprime_depuis_une_fiche_listes_a_jour_et_refus_si_clos() {
    let m = mini();
    let sofia = m.employe("Benali", "Sofia");
    let d1 = m.dossier("Dossier 1");
    let d2 = m.dossier("Dossier 2");
    let doc1 = m.document(d1, Some(sofia), None, "");
    let doc2 = m.document(d1, None, None, "Sofia Benali");
    let doc3 = m.document(d2, Some(sofia), None, "");
    m.clore(d2);
    let fiche = entites::fiche(&m.c, &m.tmp.0, sofia).unwrap();
    assert_eq!(fiche.documents.len(), 3);
    assert_eq!(fiche.evenements.iter().filter(|e| e.r#type == journal::NOMINATION).count(), 3);

    // Depuis la fiche, sans ouvrir le document : ses nominations partent avec lui.
    documents::supprimer(&m.c, &m.tmp.0, doc1).unwrap();
    let fiche = entites::fiche(&m.c, &m.tmp.0, sofia).unwrap();
    let ids: Vec<i64> = fiche.documents.iter().map(|d| d.document.id).collect();
    assert_eq!(ids.len(), 2);
    assert!(ids.contains(&doc2) && ids.contains(&doc3));
    assert!(fiche.evenements.iter().all(|e| e.document_id != Some(doc1)));
    assert_eq!(compter(&m.c, &format!("SELECT COUNT(*) FROM nominations WHERE document_id = {doc1}")), 0);
    assert_eq!(fiche.dossiers.len(), 2, "Dossier 1 reste lié par doc2");

    // Dossier clôturé : refus, rien ne change.
    assert_eq!(documents::supprimer(&m.c, &m.tmp.0, doc3).unwrap_err().code, "dossier_clos");
    assert_eq!(entites::fiche(&m.c, &m.tmp.0, sofia).unwrap().documents.len(), 2);

    // Fichier importé : sa copie est supprimée.
    let ailleurs = Temp::new();
    let source = ailleurs.0.join("scan.pdf");
    fs::write(&source, b"%PDF-1.4\n%%EOF\n").unwrap();
    let import = documents::importer(&m.c, &m.tmp.0, d1, None, &source, false).unwrap();
    let copie = PathBuf::from(import.fichier_chemin.clone().unwrap());
    assert!(copie.exists());
    documents::supprimer(&m.c, &m.tmp.0, import.id).unwrap();
    assert!(!copie.exists());
}

// ---------- § 13.2 : suppression d'une fiche ----------

#[test]
fn fiche_sans_lien_supprimee_et_evenement_fiche_supprimee() {
    let m = mini();
    let sofia = m.employe("Benali", "Sofia");
    entites::modifier(&m.c, sofia, &employe(m.cat_a, "Benali", "Sofia", Some("1990-05-14"), "Ingénieure")).unwrap();
    entites::basculer(&m.c, sofia).unwrap();
    entites::basculer(&m.c, sofia).unwrap();
    let e = m.lire(sofia);
    assert!(compter(&m.c, &format!("SELECT COUNT(*) FROM evenements WHERE a_id = {sofia}")) >= 4);
    assert_eq!(
        entites::apercu_suppression(&m.c, sofia).unwrap(),
        entites::SuppressionApercu {
            affectation_en_cours: None,
            affectations_en_cours: vec![],
            nb_affectations_passees: 0,
            nb_documents: 0,
            nb_dossiers: 0
        }
    );

    entites::supprimer(&m.c, sofia).unwrap();
    assert_eq!(entites::lire(&m.c, sofia).unwrap_err().code, "introuvable");
    let err = entites::fiche(&m.c, &m.tmp.0, sofia).unwrap_err();
    assert_eq!((err.code.as_str(), err.message.as_str()), ("introuvable", "Fiche introuvable."));
    // Effet 3 : ses événements propres (création, modification, archivage, réactivation) sont supprimés.
    assert_eq!(compter(&m.c, &format!("SELECT COUNT(*) FROM evenements WHERE a_id = {sofia}")), 0);
    // Effet 4 : « Employé « … » supprimé », rattaché à rien.
    type Ligne = (String, String, Option<i64>, Option<i64>, Option<i64>, Option<String>, Option<String>);
    let (titre, detail, a, b, d, nom_a, nom_b): Ligne = m
        .c
        .query_row(
            "SELECT titre, detail, a_id, b_id, dossier_id, a_libelle_supprime, b_libelle_supprime FROM evenements WHERE type = 'fiche_supprimee'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
        )
        .unwrap();
    assert_eq!(titre, "Employé « BENALI Sofia » supprimé");
    assert_eq!(detail, format!("Identifiant {}. Fiche supprimée définitivement.", e.code.unwrap()));
    assert_eq!((a, b, d), (None, None, None));
    assert_eq!((nom_a.as_deref(), nom_b), (Some("BENALI Sofia"), None));
    assert_eq!(compter(&m.c, "SELECT COUNT(*) FROM evenements"), 1);
    sans_reference_invalide(&m.c);

    // Machine sans identifiant.
    let pc = m.machine("PC accueil", None);
    entites::supprimer(&m.c, pc).unwrap();
    let (titre, detail): (String, String) = m
        .c
        .query_row("SELECT titre, detail FROM evenements WHERE type = 'fiche_supprimee' AND b_libelle_supprime = 'PC accueil'", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .unwrap();
    assert_eq!(titre, "Machine « PC accueil » supprimée");
    assert_eq!(detail, "Sans identifiant. Fiche supprimée définitivement.");
}

#[test]
fn employe_avec_affectation_en_cours_la_machine_redevient_libre() {
    let m = mini();
    let sofia = m.employe("Benali", "Sofia");
    let karim = m.employe("Haddad", "Karim");
    let pc = m.machine("PC accueil", Some("PC-0412"));
    let ancien = m.machine("Portable 01", Some("LT-0105"));
    entites::associer(&m.c, sofia, ancien).unwrap();
    entites::dissocier(&m.c, sofia, ancien).unwrap();
    entites::associer(&m.c, sofia, pc).unwrap();
    entites::associer(&m.c, karim, ancien).unwrap();

    let apercu = entites::apercu_suppression(&m.c, sofia).unwrap();
    assert_eq!(apercu.affectation_en_cours, Some(autre(pc, "PC accueil")));
    assert_eq!(apercu.affectations_en_cours, [autre(pc, "PC accueil")]);
    assert_eq!(apercu.nb_affectations_passees, 1);
    let v = serde_json::to_value(&apercu).unwrap();
    assert_eq!(v["affectationEnCours"], serde_json::json!({ "id": pc, "nom": "PC accueil" }));
    assert_eq!(v["nbAffectationsPassees"], 1);
    assert!(v["nbDocuments"].is_i64() && v["nbDossiers"].is_i64() && v["affectationsEnCours"].is_array());

    entites::supprimer(&m.c, sofia).unwrap();
    // Effet 1 : plus aucune affectation de la fiche ; la machine est libre et se réaffecte.
    assert_eq!(compter(&m.c, &format!("SELECT COUNT(*) FROM affectations WHERE a_id = {sofia} OR b_id = {sofia}")), 0);
    let fiche_pc = entites::fiche(&m.c, &m.tmp.0, pc).unwrap();
    assert!(fiche_pc.associees.is_empty() && fiche_pc.affectations.is_empty());
    // L'autre affectation (Karim ↔ Portable 01) n'est pas touchée ; l'ancienne de Sofia a disparu.
    let fiche_ancien = entites::fiche(&m.c, &m.tmp.0, ancien).unwrap();
    assert_eq!(fiche_ancien.affectations.len(), 1);
    assert_eq!(fiche_ancien.affectations[0].entite.id, karim);

    // Effet 3 : l'historique de la machine garde les lignes, avec le nom en texte et la mention.
    let ev = &fiche_pc.evenements;
    let debut = ev.iter().find(|e| e.r#type == journal::ASSOCIATION).unwrap();
    assert_eq!(debut.titre, "Affectation de BENALI Sofia (supprimé)");
    assert_eq!((debut.a_id, debut.a_libelle.as_deref(), debut.a_supprime), (None, Some("BENALI Sofia"), true));
    assert_eq!((debut.b_id, debut.b_supprime), (Some(pc), false));
    let fin = ev.iter().find(|e| e.r#type == journal::DISSOCIATION).unwrap();
    assert_eq!(fin.titre, "Fin de l’affectation de BENALI Sofia (supprimé)");
    assert!(fin.detail.contains("BENALI Sofia (supprimé)"), "{}", fin.detail);
    assert_eq!((fin.a_id, fin.a_supprime, fin.b_id), (None, true, Some(pc)));
    let json = serde_json::to_value(debut).unwrap();
    assert_eq!((json["aSupprime"].as_bool(), json["bSupprime"].as_bool()), (Some(true), Some(false)));
    assert!(json["aId"].is_null());
    // Portable 01 : la période passée avec Sofia reste aussi dans son historique.
    let lignes_ancien: Vec<&str> =
        fiche_ancien.evenements.iter().filter(|e| e.a_supprime).map(|e| e.titre.as_str()).collect();
    assert_eq!(lignes_ancien.len(), 2, "{lignes_ancien:?}");
    // Les événements d'une fiche encore existante ne portent jamais la mention.
    assert!(entites::fiche(&m.c, &m.tmp.0, karim).unwrap().evenements.iter().all(|e| !e.a_supprime && !e.b_supprime));

    entites::associer(&m.c, karim, pc).unwrap();
    sans_reference_invalide(&m.c);
}

#[test]
fn machine_affectee_a_deux_employes_supprimee() {
    let m = mini();
    let sofia = m.employe("Benali", "Sofia");
    let karim = m.employe("Haddad", "Karim");
    let pc = m.machine("PC accueil", Some("PC-0412"));
    entites::associer(&m.c, sofia, pc).unwrap();
    entites::associer(&m.c, karim, pc).unwrap();
    let apercu = entites::apercu_suppression(&m.c, pc).unwrap();
    assert_eq!(apercu.affectations_en_cours.len(), 2);
    assert_eq!(apercu.affectation_en_cours.as_ref(), apercu.affectations_en_cours.first());
    assert_eq!(apercu.nb_affectations_passees, 0);

    entites::supprimer(&m.c, pc).unwrap();
    for employe in [sofia, karim] {
        let f = entites::fiche(&m.c, &m.tmp.0, employe).unwrap();
        assert!(f.associees.is_empty() && f.affectations.is_empty());
        let titres: Vec<&str> = f.evenements.iter().filter(|e| e.b_supprime).map(|e| e.titre.as_str()).collect();
        assert_eq!(titres.len(), 2);
        assert!(titres.contains(&"Affectation de PC accueil (supprimée)"));
        assert!(titres.contains(&"Fin de l’affectation de PC accueil (supprimée)"));
        assert!(f.evenements.iter().filter(|e| e.b_supprime).all(|e| e.b_id.is_none() && e.b_libelle.as_deref() == Some("PC accueil")));
    }
    sans_reference_invalide(&m.c);
}

#[test]
fn fiche_nommee_par_bloc_dans_plusieurs_documents_dont_un_dossier_clos() {
    let m = mini();
    let sofia = m.employe("Benali", "Sofia");
    let karim = m.employe("Haddad", "Karim");
    let pc = m.machine("PC accueil", Some("PC-0412"));
    let d_ouvert = m.dossier("Dossier ouvert");
    let d_clos = m.dossier("Dossier clos");
    let doc1 = m.document(d_ouvert, Some(sofia), Some(pc), "Karim Haddad");
    let doc2 = m.document(d_clos, Some(sofia), None, "Sofia Benali");
    let doc3 = m.document(d_clos, None, Some(pc), "");
    // Ancien événement de dossier qui citait la fiche (versions 1.0 à 1.3).
    m.c.execute(
        "INSERT INTO evenements (type, titre, detail, a_id, b_id, dossier_id, date)
         VALUES ('dossier_ouvert', 'Ouverture (version 1.3)', 'x', ?1, NULL, ?2, '2025-01-01 09:00:00')",
        [sofia, d_ouvert],
    )
    .unwrap();
    m.clore(d_clos);
    let clos_avant = dossiers::resume(&m.c, d_clos).unwrap();
    let ouvert_avant = dossiers::resume(&m.c, d_ouvert).unwrap();
    let e = m.lire(sofia);

    let apercu = entites::apercu_suppression(&m.c, sofia).unwrap();
    assert_eq!((apercu.nb_documents, apercu.nb_dossiers), (2, 2));

    entites::supprimer(&m.c, sofia).unwrap();

    // Effet 2 : le bloc garde le nom et l'identifiant, ne désigne plus rien ; dossier clôturé compris.
    for doc in [doc1, doc2] {
        let blocs = m.blocs(doc);
        assert_eq!(blocs[1].entite_id, Some(None), "document {doc}");
        let copie = blocs[1].fiche_supprimee.as_ref().unwrap();
        assert_eq!(copie, &FicheSupprimee { supprimee_le: copie.supprimee_le.clone(), ..FicheSupprimee::de(&e, "") });
        assert_eq!((copie.libelle.as_str(), copie.code.as_deref()), ("BENALI Sofia", e.code.as_deref()));
        let json: serde_json::Value = serde_json::from_str(&m.json(doc)).unwrap();
        assert_eq!(json[1]["entiteId"], serde_json::Value::Null);
        assert_eq!(json[1]["ficheSupprimee"]["libelle"], "BENALI Sofia");
        assert_eq!(json[1]["ficheSupprimee"]["kind"], "a");
        assert!(json[1]["ficheSupprimee"]["supprimeeLe"].is_string());
    }
    // La machine des documents n'est pas touchée ; le texte non plus.
    assert_eq!(m.blocs(doc1)[2].entite_id, Some(Some(pc)));
    assert_eq!(m.blocs(doc1)[3].val.as_deref(), Some("Karim Haddad"));
    assert_eq!(m.blocs(doc2)[3].val.as_deref(), Some("Sofia Benali"));
    assert!(m.blocs(doc3)[1].fiche_supprimee.is_none());
    // Plus aucune nomination ; documents et dossiers existent toujours, inchangés (état, date de modification).
    assert_eq!(compter(&m.c, &format!("SELECT COUNT(*) FROM nominations WHERE entite_id = {sofia}")), 0);
    assert_eq!(compter(&m.c, "SELECT COUNT(*) FROM documents"), 3);
    assert_eq!(dossiers::resume(&m.c, d_clos).unwrap(), clos_avant);
    assert_eq!(dossiers::resume(&m.c, d_ouvert).unwrap(), ouvert_avant);
    let detail = dossiers::detail(&m.c, &m.tmp.0, d_clos).unwrap();
    assert_eq!(detail.entites_citees.iter().map(|x| x.id).collect::<Vec<_>>(), [pc]);
    // Les autres fiches gardent leurs nominations.
    assert_eq!(entites::fiche(&m.c, &m.tmp.0, karim).unwrap().documents.len(), 1);
    assert_eq!(entites::fiche(&m.c, &m.tmp.0, pc).unwrap().documents.len(), 2);

    // L'ancien événement du dossier reste, avec le nom en texte (historique des fiches nommées dans le dossier).
    let ev = entites::fiche(&m.c, &m.tmp.0, karim).unwrap().evenements;
    let ouvert = ev.iter().find(|x| x.r#type == journal::DOSSIER_OUVERT && x.titre == "Ouverture (version 1.3)").unwrap();
    assert_eq!((ouvert.a_id, ouvert.a_libelle.as_deref(), ouvert.a_supprime), (None, Some("BENALI Sofia"), true));
    assert_eq!(ouvert.dossier_id, Some(d_ouvert));

    // Dossier ouvert : on peut choisir une autre fiche ; une copie envoyée par le front est ignorée.
    let mut blocs = m.blocs(doc1);
    blocs[1].fiche_supprimee.as_mut().unwrap().libelle = "Falsifié".into();
    blocs[3].val = Some("Karim Haddad, intervenant".into());
    documents::enregistrer_blocs(&m.c, doc1, &blocs).unwrap();
    assert_eq!(m.blocs(doc1)[1].fiche_supprimee.as_ref().unwrap().libelle, "BENALI Sofia");
    let mut sans_copie = m.blocs(doc1);
    sans_copie[1].fiche_supprimee = None;
    sans_copie[3].val = Some("Karim Haddad".into());
    documents::enregistrer_blocs(&m.c, doc1, &sans_copie).unwrap();
    assert_eq!(m.blocs(doc1)[1].fiche_supprimee.as_ref().unwrap().libelle, "BENALI Sofia", "toujours tirée du contenu enregistré");
    let mut choix = m.blocs(doc1);
    choix[1].entite_id = Some(Some(karim));
    documents::enregistrer_blocs(&m.c, doc1, &choix).unwrap();
    assert_eq!(m.blocs(doc1)[1].entite_id, Some(Some(karim)));
    assert!(m.blocs(doc1)[1].fiche_supprimee.is_none());
    assert!(!m.json(doc1).contains("ficheSupprimee"));
    // Dossier clôturé : refus, comme toute modification.
    assert_eq!(documents::enregistrer_blocs(&m.c, doc2, &m.blocs(doc2)).unwrap_err().code, "dossier_clos");
    sans_reference_invalide(&m.c);
}

#[test]
fn fiche_nommee_seulement_par_le_texte() {
    let m = mini();
    let sofia = m.employe("Benali", "Sofia");
    let pc = m.machine("PC accueil", Some("PC-0412"));
    let d = m.dossier("Dossier");
    let doc = m.document(d, None, None, "Sofia Benali sur PC-0412");
    assert_eq!(entites::apercu_suppression(&m.c, pc).unwrap().nb_documents, 1);
    let json_avant = m.json(doc);

    entites::supprimer(&m.c, pc).unwrap();
    // Le document n'est pas réécrit : son texte reste tel quel.
    assert_eq!(m.json(doc), json_avant);
    assert_eq!(compter(&m.c, &format!("SELECT COUNT(*) FROM nominations WHERE entite_id = {pc}")), 0);
    assert_eq!(entites::fiche(&m.c, &m.tmp.0, sofia).unwrap().documents.len(), 1);
    sans_reference_invalide(&m.c);
}

#[test]
fn variables_du_document_gardent_leurs_valeurs() {
    let m = mini();
    let sofia = m.employe("Benali", "Sofia");
    let pc = m.machine("PC accueil", Some("PC-0412"));
    let d = m.dossier("Dossier");
    let doc = m.document(d, Some(sofia), Some(pc), "");
    let (e_sofia, e_pc) = (m.lire(sofia), m.lire(pc));
    entites::supprimer(&m.c, sofia).unwrap();
    entites::supprimer(&m.c, pc).unwrap();

    let blocs = m.blocs(doc);
    let a = blocs[1].fiche_supprimee.clone().unwrap();
    let b = blocs[2].fiche_supprimee.clone().unwrap();
    // Tout ce que lisent les variables « Employé · … » et « Machine · … ».
    assert_eq!((a.kind, a.nom.as_str(), a.prenom.as_str(), a.poste.as_str()), (Kind::A, "Benali", "Sofia", "Technicienne"));
    assert_eq!((a.categorie.as_str(), a.code.clone()), ("Division informatique", e_sofia.code.clone()));
    assert_eq!(a.date_naissance.as_deref(), Some("1990-05-14"));
    assert_eq!((b.kind, b.nom.as_str(), b.code.as_deref()), (Kind::B, "PC accueil", Some("PC-0412")));
    assert_eq!((b.marque.as_str(), b.cpu.as_str(), b.ram.as_str(), b.stockage.as_str()), ("Dell OptiPlex", "i5", "16 Go", "SSD 512 Go"));
    assert_eq!(b, FicheSupprimee { supprimee_le: b.supprimee_le.clone(), ..FicheSupprimee::de(&e_pc, "") });
    // Les blocs variables ne stockent rien et restent en place.
    assert_eq!((blocs[5].t, blocs[5].v.as_str(), blocs[5].val.as_deref()), (TypeBloc::Variable, "Employé · Nom", None));
    let json: serde_json::Value = serde_json::from_str(&m.json(doc)).unwrap();
    for cle in ["kind", "nom", "code", "libelle", "categorie", "prenom", "dateNaissance", "poste", "marque", "cpu", "ram", "stockage", "supprimeeLe"] {
        assert!(json[2]["ficheSupprimee"].get(cle).is_some(), "{cle}");
    }
}

#[test]
fn compteurs_recherche_suggestions_et_structure() {
    let m = mini();
    let sofia = m.employe("Benali", "Sofia");
    let pc = m.machine("PC accueil", None);
    let nb = |kind| classement::categories_lister(&m.c, kind).unwrap()[0].nb_fiches;
    assert_eq!((nb(Kind::A), nb(Kind::B)), (1, 1));
    assert_eq!(recherche::rechercher(&m.c, "benali").unwrap().a_total, 1);
    assert_eq!(entites::suggerer(&m.c, Kind::A, "ben").unwrap().len(), 1);
    let t = tableau::calculer(&m.c).unwrap();
    assert_eq!((t.a_total, t.a_actives, t.b_total, t.sans_code_b.len()), (1, 1, 1, 1));
    // Une structure qui contient une fiche ne se supprime pas.
    assert_eq!(classement::categorie_supprimer(&m.c, m.cat_a).unwrap_err().code, "categorie_utilisee");

    entites::supprimer(&m.c, sofia).unwrap();
    entites::supprimer(&m.c, pc).unwrap();
    assert_eq!((nb(Kind::A), nb(Kind::B)), (0, 0));
    let r = recherche::rechercher(&m.c, "benali").unwrap();
    assert_eq!((r.a.len(), r.a_total), (0, 0));
    assert_eq!(recherche::rechercher(&m.c, "PC accueil").unwrap().b_total, 0);
    assert!(entites::suggerer(&m.c, Kind::A, "ben").unwrap().is_empty());
    assert!(entites::suggerer(&m.c, Kind::B, "pc").unwrap().is_empty());
    assert!(entites::lister(&m.c, Kind::A).unwrap().is_empty());
    let t = tableau::calculer(&m.c).unwrap();
    assert_eq!((t.a_total, t.a_actives, t.b_total, t.b_actives, t.sans_code_b.len()), (0, 0, 0, 0, 0));
    // La structure et le type deviennent supprimables.
    classement::categorie_supprimer(&m.c, m.cat_a).unwrap();
    classement::categorie_supprimer(&m.c, m.cat_b).unwrap();
}

#[test]
fn fiche_archivee_supprimee() {
    let m = mini();
    let pc = m.machine("PC accueil", Some("PC-0412"));
    let sofia = m.employe("Benali", "Sofia");
    entites::associer(&m.c, sofia, pc).unwrap();
    entites::basculer(&m.c, pc).unwrap();
    assert!(!m.lire(pc).actif);
    assert_eq!(entites::apercu_suppression(&m.c, pc).unwrap().affectation_en_cours, Some(autre(sofia, "BENALI Sofia")));
    entites::supprimer(&m.c, pc).unwrap();
    assert_eq!(entites::lire(&m.c, pc).unwrap_err().code, "introuvable");
    assert!(entites::fiche(&m.c, &m.tmp.0, sofia).unwrap().associees.is_empty());
    sans_reference_invalide(&m.c);
}

#[test]
fn identifiant_inexistant_erreur_propre_sans_ecriture() {
    let m = mini();
    let sofia = m.employe("Benali", "Sofia");
    let avant = photo(&m.c);
    for id in [0, -1, 9999] {
        let e = entites::supprimer(&m.c, id).unwrap_err();
        assert_eq!((e.code.as_str(), e.message.as_str()), ("introuvable", "Fiche introuvable."));
        assert_eq!(entites::apercu_suppression(&m.c, id).unwrap_err().code, "introuvable");
    }
    assert_eq!(photo(&m.c), avant);
    // Deuxième suppression de la même fiche.
    entites::supprimer(&m.c, sofia).unwrap();
    let apres = photo(&m.c);
    assert_eq!(entites::supprimer(&m.c, sofia).unwrap_err().code, "introuvable");
    assert_eq!(photo(&m.c), apres);
}

#[test]
fn employe_recree_meme_identifiant_nouvelle_fiche_sans_lien_sauf_le_texte() {
    let m = mini();
    let karim = m.employe("Haddad", "Karim");
    let pc = m.machine("PC accueil", Some("PC-0412"));
    let sofia = m.employe("Benali", "Sofia");
    entites::associer(&m.c, sofia, pc).unwrap();
    let d = m.dossier("Dossier");
    let doc_bloc = m.document(d, Some(sofia), None, "");
    let doc_texte = m.document(d, Some(karim), None, "Sofia Benali");
    let code = m.lire(sofia).code.unwrap();

    entites::supprimer(&m.c, sofia).unwrap();
    // L'identifiant numérique le plus haut est réattribué par SQLite : c'est le cas le plus piégeux.
    let nouvelle = m.employe("Benali", "Sofia");
    assert_eq!(nouvelle, sofia, "même numéro réattribué");
    let e = m.lire(nouvelle);
    assert_eq!(e.code.as_deref(), Some(code.as_str()), "mêmes informations, même identifiant");

    // Nouvelle fiche : nommée seulement par le texte (recalculé à la création), pas par l'ancien bloc.
    let f = entites::fiche(&m.c, &m.tmp.0, nouvelle).unwrap();
    assert_eq!(f.documents.len(), 1);
    assert_eq!(f.documents[0].document.id, doc_texte);
    assert_eq!(f.documents[0].facons, [super::nominations::Facon::Texte]);
    assert_eq!(m.blocs(doc_bloc)[1].entite_id, Some(None));
    assert!(m.blocs(doc_bloc)[1].fiche_supprimee.is_some());
    // Aucune affectation, et rien de l'historique de l'ancienne fiche.
    assert!(f.affectations.is_empty());
    let types: Vec<&str> = f.evenements.iter().map(|x| x.r#type.as_str()).collect();
    assert_eq!(types.iter().filter(|t| **t == journal::FICHE_CREEE).count(), 1);
    assert!(!types.contains(&journal::ASSOCIATION) && !types.contains(&journal::DISSOCIATION), "{types:?}");
    // La machine garde l'ancienne affectation au nom de la fiche supprimée, sans lien vers la nouvelle.
    let ev_pc = entites::fiche(&m.c, &m.tmp.0, pc).unwrap().evenements;
    assert!(ev_pc.iter().filter(|x| x.r#type == journal::ASSOCIATION).all(|x| x.a_id.is_none() && x.a_supprime));
    sans_reference_invalide(&m.c);
}

#[test]
fn transaction_rien_n_est_modifie_si_une_etape_echoue() {
    let m = mini();
    let sofia = m.employe("Benali", "Sofia");
    let pc = m.machine("PC accueil", Some("PC-0412"));
    entites::associer(&m.c, sofia, pc).unwrap();
    let d = m.dossier("Dossier");
    m.document(d, Some(sofia), Some(pc), "Sofia Benali");
    let d_clos = m.dossier("Dossier clos");
    m.document(d_clos, Some(sofia), None, "");
    m.clore(d_clos);
    let avant = photo(&m.c);
    let nb = m.nb_evenements();

    // La dernière étape (suppression de la ligne) échoue : toutes les précédentes doivent être annulées.
    m.c.execute_batch(
        "CREATE TEMP TRIGGER refus BEFORE DELETE ON entites BEGIN SELECT RAISE(ABORT, 'refus simulé'); END;",
    )
    .unwrap();
    assert!(entites::supprimer(&m.c, sofia).is_err());
    assert_eq!(photo(&m.c), avant);
    assert_eq!(m.nb_evenements(), nb);
    assert!(m.c.is_autocommit(), "aucune transaction laissée ouverte");
    m.c.execute_batch("DROP TRIGGER temp.refus;").unwrap();

    // Sans l'obstacle, la même suppression passe.
    entites::supprimer(&m.c, sofia).unwrap();
    sans_reference_invalide(&m.c);
}

// ---------- § 13.3 : migration 006 ----------

/// Base de la version 1.4 (schéma 5) remplie, sur disque.
fn creer_base_v5(dossier: &Path) -> PathBuf {
    let chemin = dossier.join("donnees.sqlite");
    let c = Connection::open(&chemin).unwrap();
    for sql in [
        include_str!("../../migrations/001_init.sql"),
        include_str!("../../migrations/002_employes_machines.sql"),
        include_str!("../../migrations/003_affectations.sql"),
        include_str!("../../migrations/004_etats_citations_identifiants.sql"),
        include_str!("../../migrations/005_nominations.sql"),
    ] {
        c.execute_batch(sql).unwrap();
    }
    modeles::assurer_standards(&c).unwrap();
    super::identifiant::assurer_cle(&c).unwrap();
    c.execute_batch(
        "INSERT INTO parametres (cle, valeur) VALUES ('donnees_exemple', '0'), ('theme', 'dark'), ('densite', 'eq');
         INSERT INTO themes (id, nom, actif) VALUES (10, 'Maintenance', 1);
         INSERT INTO categories (id, kind, nom, actif) VALUES (100, 'a', 'Division informatique', 1), (101, 'b', 'PC de bureau', 1);
         INSERT INTO entites (id, kind, nom, code, categorie_id, actif, cree_le, maj_le, libelle, prenom, date_naissance, poste,
                              marque, cpu, ram, stockage) VALUES
           (1, 'a', 'Benali', 'EMP-AAAAA-AAAAA', 100, 1, '2025-01-02 10:00:00', '2025-01-02 10:00:00', 'BENALI Sofia', 'Sofia', '1990-05-14', 'Technicienne', '', '', '', ''),
           (10, 'b', 'PC accueil', 'PC-0101', 101, 1, '2025-01-06 10:00:00', '2025-01-06 10:00:00', 'PC accueil', '', NULL, '', 'Dell', 'i5', '16 Go', 'SSD');
         INSERT INTO affectations (a_id, b_id, debut, fin) VALUES (1, 10, '2025-02-01 09:00:00', NULL);
         INSERT INTO dossiers (id, nom, annee, theme_id, statut_id, cree_le, maj_le, clos_le) VALUES
           (1, 'Dossier complet', 2025, 10, 1, '2025-03-01 09:00:00', '2025-03-02 09:00:00', NULL),
           (2, 'Dossier clôturé', 2025, 10, 3, '2025-03-05 09:00:00', '2025-04-01 09:00:00', '2025-04-01 09:00:00');
         INSERT INTO documents (id, dossier_id, nom, origine, source, date_doc, blocs, piece_finale, cree_le) VALUES
           (1, 1, 'Document_01', 'modele', 'Fiche maison', '2025-03-05',
            '[{\"t\":\"employe\",\"v\":\"Utilisateur\",\"entiteId\":1},{\"t\":\"champ\",\"v\":\"Poste\",\"val\":\"PC-0101\"}]', 0, '2025-03-05 10:00:00'),
           (2, 2, 'Document_01', 'modele', 'Fiche maison', '2025-03-06',
            '[{\"t\":\"machine\",\"v\":\"Matériel\",\"entiteId\":10}]', 0, '2025-03-06 10:00:00');
         INSERT INTO nominations (document_id, entite_id, facon, champ, depuis) VALUES
           (1, 1, 'bloc', 'Utilisateur', '2025-03-05 10:00:00'),
           (1, 10, 'texte', 'Poste', '2025-03-05 10:00:00'),
           (2, 10, 'bloc', 'Matériel', '2025-03-06 10:00:00');
         INSERT INTO evenements (type, titre, detail, a_id, b_id, dossier_id, date) VALUES
           ('fiche_creee', 'Fiche créée', 'Création de la fiche BENALI Sofia.', 1, NULL, NULL, '2025-01-02 10:00:00'),
           ('association', 'Affectation de PC accueil à BENALI Sofia', 'x', 1, 10, NULL, '2025-02-01 09:00:00'),
           ('dossier_ouvert', 'Dossier complet ouvert', 'Maintenance.', NULL, NULL, 1, '2025-03-01 09:00:00'),
           ('dossier_clos', 'Dossier clôturé clôturé', 'Maintenance.', NULL, NULL, 2, '2025-04-01 09:00:00');
         PRAGMA user_version = 5;",
    )
    .unwrap();
    chemin
}

const TABLES: [&str; 13] = [
    "SELECT * FROM parametres ORDER BY cle",
    "SELECT * FROM themes ORDER BY id",
    "SELECT * FROM categories ORDER BY id",
    "SELECT * FROM magasin ORDER BY id",
    "SELECT * FROM entites ORDER BY id",
    "SELECT * FROM affectations ORDER BY id",
    "SELECT * FROM modeles ORDER BY id",
    "SELECT * FROM dossiers ORDER BY id",
    "SELECT * FROM sous_dossiers ORDER BY id",
    "SELECT * FROM documents ORDER BY id",
    "SELECT * FROM options ORDER BY id",
    "SELECT * FROM nominations ORDER BY document_id, entite_id, facon, champ",
    "SELECT * FROM statuts ORDER BY id",
];

#[test]
fn base_v5_migree_en_version_6_sans_perte_avec_sauvegarde() {
    let t = Temp::new();
    let chemin = creer_base_v5(&t.0);
    let (tables_avant, journal_avant, cle_avant) = {
        let c = Connection::open(&chemin).unwrap();
        db::verifier_base(&c).expect("base v5 conforme");
        (
            TABLES.iter().map(|sql| contenu(&c, sql)).collect::<Vec<_>>(),
            contenu(&c, "SELECT * FROM evenements ORDER BY id"),
            contenu(&c, "SELECT * FROM cle_identifiant"),
        )
    };

    let etat = Etat::ouvrir_dans(t.0.clone()).expect("une base 1.4 conforme est acceptée et migrée");
    let c = etat.conn().unwrap();
    assert_eq!(compter(&c, "PRAGMA user_version"), 6);
    assert_eq!(compter(&c, "PRAGMA foreign_keys"), 1);
    db::verifier_base(&c).expect("la base migrée passe le contrôle d'ouverture");
    // Aucune donnée modifiée ni perdue ; deux colonnes ajoutées au journal, vides.
    assert_eq!(TABLES.iter().map(|sql| contenu(&c, sql)).collect::<Vec<_>>(), tables_avant);
    assert_eq!(contenu(&c, "SELECT * FROM cle_identifiant"), cle_avant);
    assert_eq!(contenu(&c, "SELECT id, type, titre, detail, a_id, b_id, dossier_id, date FROM evenements ORDER BY id"), journal_avant);
    assert_eq!(compter(&c, "SELECT COUNT(*) FROM evenements WHERE a_libelle_supprime IS NOT NULL OR b_libelle_supprime IS NOT NULL"), 0);
    // Sauvegarde préalable : la base 1.4 telle quelle.
    let sv = sauvegardes(&t.0, "avant-version-6_");
    assert_eq!(sv.len(), 1);
    let ancienne = Connection::open(sv[0].join("donnees.sqlite")).unwrap();
    assert_eq!(compter(&ancienne, "PRAGMA user_version"), 5);
    assert_eq!(contenu(&ancienne, "SELECT * FROM evenements ORDER BY id"), journal_avant);

    // La base migrée accepte la suppression.
    let fichiers = t.0.join("fichiers");
    entites::supprimer(&c, 10).unwrap();
    assert_eq!(entites::fiche(&c, &fichiers, 1).unwrap().evenements.iter().filter(|e| e.b_supprime).count(), 2);
    sans_reference_invalide(&c);
    drop(c);
    drop(etat);
    // Réouverture : plus de migration, plus de sauvegarde.
    let etat = Etat::ouvrir_dans(t.0.clone()).unwrap();
    assert_eq!(compter(&etat.conn().unwrap(), "PRAGMA user_version"), 6);
    assert_eq!(sauvegardes(&t.0, "avant-version-").len(), 1);
}

#[test]
fn base_v6_modifiee_refusee() {
    // Le contrôle du schéma couvre la version 6 : une colonne retirée ou ajoutée au journal est refusée.
    let t = Temp::new();
    let chemin = t.0.join("donnees.sqlite");
    {
        let c = Connection::open(&chemin).unwrap();
        db::migrer(&c).unwrap();
        assert_eq!(compter(&c, "PRAGMA user_version"), 6);
        c.execute_batch("ALTER TABLE evenements ADD COLUMN intruse TEXT NULL;").unwrap();
    }
    let e = Etat::ouvrir_dans(t.0.clone()).err().expect("base refusée");
    assert_eq!(e.code, "base_refusee");
}
