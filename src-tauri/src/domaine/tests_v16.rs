//! Tests de la version 1.6 (§ 15) : suppression d'un dossier avec tout son contenu (aperçu, effets, journal, numéro
//! réattribué, copies des fichiers importés, transaction, base incohérente).

use super::classement;
use super::documents;
use super::dossiers::{self, DossierSuppressionApercu, SaisieDossier};
use super::entites::{self, SaisieEntite, SaisieMachine};
use super::journal;
use super::modeles::{self, Bloc, SaisieModele, TypeBloc};
use super::recherche;
use super::statuts::{self, Role};
use super::tableau;
use super::tests::{employe, st};
use super::Kind;
use crate::db;
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};

// ---------- outils ----------

struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!("entites-dossiers-v16-{}", uuid::Uuid::new_v4()));
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

/// Toutes les tables de la base, ligne par ligne.
fn photo(c: &Connection) -> Vec<Vec<String>> {
    [
        "SELECT * FROM parametres ORDER BY cle",
        "SELECT * FROM themes ORDER BY id",
        "SELECT * FROM categories ORDER BY id",
        "SELECT * FROM magasin ORDER BY id",
        "SELECT * FROM entites ORDER BY id",
        "SELECT * FROM affectations ORDER BY id",
        "SELECT * FROM modeles ORDER BY id",
        "SELECT * FROM statuts ORDER BY id",
        "SELECT * FROM dossiers ORDER BY id",
        "SELECT * FROM sous_dossiers ORDER BY id",
        "SELECT * FROM documents ORDER BY id",
        "SELECT * FROM options ORDER BY id",
        "SELECT * FROM nominations ORDER BY document_id, entite_id, facon, champ",
        "SELECT * FROM evenements ORDER BY id",
    ]
    .iter()
    .map(|sql| contenu(c, sql))
    .collect()
}

/// Tout ce qui n'appartient pas au dossier `id` : doit rester identique, ligne par ligne, après sa suppression.
/// Le journal est comparé sans les événements `dossier_supprime` (seuls ajoutés).
fn hors_du_dossier(c: &Connection, id: i64) -> Vec<Vec<String>> {
    [
        "SELECT * FROM parametres ORDER BY cle".to_string(),
        "SELECT * FROM themes ORDER BY id".to_string(),
        "SELECT * FROM categories ORDER BY id".to_string(),
        "SELECT * FROM magasin ORDER BY id".to_string(),
        "SELECT * FROM entites ORDER BY id".to_string(),
        "SELECT * FROM affectations ORDER BY id".to_string(),
        "SELECT * FROM modeles ORDER BY id".to_string(),
        "SELECT * FROM statuts ORDER BY id".to_string(),
        format!("SELECT * FROM dossiers WHERE id <> {id} ORDER BY id"),
        format!("SELECT * FROM sous_dossiers WHERE dossier_id <> {id} ORDER BY id"),
        format!("SELECT * FROM documents WHERE dossier_id <> {id} ORDER BY id"),
        format!("SELECT * FROM options WHERE dossier_id <> {id} ORDER BY id"),
        format!(
            "SELECT n.* FROM nominations n JOIN documents x ON x.id = n.document_id WHERE x.dossier_id <> {id}
             ORDER BY n.document_id, n.entite_id, n.facon, n.champ"
        ),
        format!(
            "SELECT * FROM evenements WHERE (dossier_id IS NULL OR dossier_id <> {id}) AND type <> 'dossier_supprime' ORDER BY id"
        ),
    ]
    .iter()
    .map(|sql| contenu(c, sql))
    .collect()
}

fn sans_reference_invalide(c: &Connection) {
    let mut fk = c.prepare("PRAGMA foreign_key_check").unwrap();
    assert!(fk.query([]).unwrap().next().unwrap().is_none(), "aucune ligne orpheline");
    db::verifier_base(c).expect("la base reste conforme");
}

/// Fichiers présents dans `fichiers/` (copies et éventuelles copies mises de côté).
fn fichiers_presents(dossier: &Path) -> Vec<String> {
    let mut v: Vec<String> = fs::read_dir(dossier)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| !n.starts_with("source-"))
        .collect();
    v.sort();
    v
}

struct Mini {
    c: Connection,
    theme: i64,
    cat_a: i64,
    cat_b: i64,
    /// Dossier `fichiers/` des données.
    fichiers: Temp,
    /// Fichiers d'origine des imports (hors des données).
    sources: Temp,
}

fn mini() -> Mini {
    let c = db::ouvrir_memoire().unwrap();
    let theme = classement::theme_creer(&c, "Thème").unwrap().id;
    let cat_a = classement::categorie_creer(&c, Kind::A, "Division informatique").unwrap().id;
    let cat_b = classement::categorie_creer(&c, Kind::B, "PC de bureau").unwrap().id;
    Mini { c, theme, cat_a, cat_b, fichiers: Temp::new(), sources: Temp::new() }
}

impl Mini {
    fn f(&self) -> &Path {
        &self.fichiers.0
    }
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
    fn dossier_etat(&self, nom: &str, statut_id: Option<i64>) -> i64 {
        dossiers::creer(&self.c, &SaisieDossier { nom: nom.into(), annee: 2026, theme_id: self.theme, statut_id }).unwrap().id
    }
    fn dossier(&self, nom: &str) -> i64 {
        self.dossier_etat(nom, None)
    }
    fn clore(&self, dossier: i64) {
        dossiers::definir_statut(&self.c, dossier, st(&self.c, Role::Clos)).unwrap();
    }
    fn sous(&self, dossier: i64, parent: Option<i64>, nom: &str) -> i64 {
        dossiers::sous_dossier_creer(&self.c, dossier, parent, nom).unwrap().id
    }
    /// Modèle « Fiche test » : 0 titre, 1 employé « Utilisateur », 2 machine « Matériel », 3 champ « Intervenant ».
    fn modele(&self, nom: &str) -> i64 {
        if let Ok(id) = self.c.query_row("SELECT id FROM modeles WHERE nom = ?1", [nom], |r| r.get(0)) {
            return id;
        }
        let m = modeles::creer(&self.c).unwrap();
        let blocs = vec![
            Bloc::nouveau(TypeBloc::Titre, nom),
            Bloc::nouveau(TypeBloc::Employe, "Utilisateur"),
            Bloc::nouveau(TypeBloc::Machine, "Matériel"),
            Bloc::nouveau(TypeBloc::Champ, "Intervenant"),
        ];
        modeles::enregistrer(&self.c, m.id, &SaisieModele { nom: nom.into(), theme_id: m.theme_id, blocs }).unwrap().id
    }
    /// Document du modèle « Fiche test » : fiches des blocs 1 et 2, texte du champ « Intervenant ».
    fn document(&self, dossier: i64, sous: Option<i64>, a: Option<i64>, b: Option<i64>, champ: &str) -> i64 {
        self.document_de(dossier, sous, "Fiche test", a, b, champ)
    }
    fn document_de(&self, dossier: i64, sous: Option<i64>, modele: &str, a: Option<i64>, b: Option<i64>, champ: &str) -> i64 {
        let doc = documents::creer_depuis_modele(&self.c, self.f(), dossier, sous, self.modele(modele), false).unwrap().id;
        let mut blocs = documents::lire(&self.c, self.f(), doc).unwrap().blocs.unwrap();
        blocs[1].entite_id = Some(a);
        blocs[2].entite_id = Some(b);
        blocs[3].val = Some(champ.into());
        documents::enregistrer_blocs(&self.c, doc, &blocs).unwrap();
        doc
    }
    /// Importe un fichier PDF ; renvoie le document et le chemin de sa copie dans `fichiers/`.
    fn importer(&self, dossier: i64, sous: Option<i64>, nom: &str) -> (i64, PathBuf) {
        let source = self.sources.0.join(nom);
        fs::write(&source, b"%PDF-1.4\n%%EOF\n").unwrap();
        let d = documents::importer(&self.c, self.f(), dossier, sous, &source, false).unwrap();
        let copie = PathBuf::from(d.fichier_chemin.clone().unwrap());
        assert!(copie.is_file());
        (d.id, copie)
    }
    fn nb_modele(&self, nom: &str) -> i64 {
        modeles::lister(&self.c).unwrap().into_iter().find(|m| m.nom == nom).unwrap().nb_documents
    }
}

fn apercu(nb_sous_dossiers: i64, nb_documents: i64, nb_fichiers_importes: i64, nb_fiches_nommees: i64) -> DossierSuppressionApercu {
    DossierSuppressionApercu { nb_sous_dossiers, nb_documents, nb_fichiers_importes, nb_fiches_nommees }
}

/// Le dossier n'existe plus nulle part : ni en base, ni dans les listes, ni au journal.
fn plus_aucune_trace(m: &Mini, id: i64) {
    assert_eq!(dossiers::resume(&m.c, id).unwrap_err().code, "introuvable");
    let e = dossiers::detail(&m.c, m.f(), id).unwrap_err();
    assert_eq!((e.code.as_str(), e.message.as_str()), ("introuvable", "Dossier introuvable."));
    assert!(dossiers::lister(&m.c).unwrap().iter().all(|d| d.id != id));
    for table in ["sous_dossiers", "documents", "options"] {
        assert_eq!(compter(&m.c, &format!("SELECT COUNT(*) FROM {table} WHERE dossier_id = {id}")), 0, "{table}");
    }
    assert_eq!(compter(&m.c, &format!("SELECT COUNT(*) FROM evenements WHERE dossier_id = {id}")), 0, "journal");
    sans_reference_invalide(&m.c);
}

// ---------- § 15.1 : dossier vide ----------

#[test]
fn dossier_vide_supprime() {
    let m = mini();
    let garde = m.dossier("Dossier gardé");
    let id = m.dossier("Dossier vide");
    assert_eq!(compter(&m.c, &format!("SELECT COUNT(*) FROM options WHERE dossier_id = {id}")), 2, "options par défaut");
    assert!(compter(&m.c, &format!("SELECT COUNT(*) FROM evenements WHERE dossier_id = {id}")) >= 1, "« ouvert » au journal");
    assert_eq!(dossiers::apercu_suppression(&m.c, m.f(), id).unwrap(), apercu(0, 0, 0, 0));
    let avant = hors_du_dossier(&m.c, id);

    dossiers::supprimer(&m.c, m.f(), id).unwrap();
    plus_aucune_trace(&m, id);
    assert_eq!(hors_du_dossier(&m.c, id), avant, "rien d'autre ne change");
    assert_eq!(compter(&m.c, "SELECT COUNT(*) FROM evenements WHERE type = 'dossier_supprime'"), 0, "personne n'y était nommé");
    assert_eq!(dossiers::lister(&m.c).unwrap().iter().map(|d| d.id).collect::<Vec<_>>(), [garde]);
}

// ---------- § 15.1 : sous-dossiers imbriqués, documents de modèles, fichiers importés ----------

#[test]
fn dossier_rempli_sous_dossiers_imbriques_modeles_et_fichiers_importes() {
    let m = mini();
    let sofia = m.employe("Benali", "Sofia");
    let pc = m.machine("PC accueil", Some("PC-0412"));
    let id = m.dossier("Dossier plein");
    let autre = m.dossier("Autre dossier");
    let s1 = m.sous(id, None, "Niveau 1");
    let s2 = m.sous(id, Some(s1), "Niveau 2");
    let s3 = m.sous(id, Some(s2), "Niveau 3");
    let s_bis = m.sous(id, None, "À côté");
    dossiers::option_creer(&m.c, id, "Option ajoutée").unwrap();
    m.document(id, None, Some(sofia), None, "");
    m.document(id, Some(s1), None, Some(pc), "");
    m.document_de(id, Some(s3), "Autre modèle", None, None, "");
    let (_, copie_racine) = m.importer(id, None, "racine.pdf");
    let (_, copie_profonde) = m.importer(id, Some(s3), "profond.pdf");
    // Une copie qui manque sur le disque : le document est supprimé, la copie n'est pas comptée.
    let (doc_sans_copie, copie_absente) = m.importer(id, Some(s_bis), "absente.pdf");
    fs::remove_file(&copie_absente).unwrap();
    // L'autre dossier garde ses documents, son sous-dossier et sa copie.
    let s_autre = m.sous(autre, None, "Sous-dossier de l'autre");
    m.document(autre, Some(s_autre), Some(sofia), None, "");
    let (_, copie_autre) = m.importer(autre, None, "autre.pdf");
    assert_eq!((m.nb_modele("Fiche test"), m.nb_modele("Autre modèle")), (3, 1));
    assert_eq!(modeles::supprimer(&m.c, m.modele("Autre modèle")).unwrap_err().code, "modele_utilise");

    // Aperçu exact : 4 sous-dossiers, 6 documents (sous-dossiers compris), 2 copies présentes, 2 fiches.
    assert_eq!(dossiers::apercu_suppression(&m.c, m.f(), id).unwrap(), apercu(4, 6, 2, 2));
    let avant = hors_du_dossier(&m.c, id);
    let copie_autre_avant = fs::read(&copie_autre).unwrap();

    dossiers::supprimer(&m.c, m.f(), id).unwrap();
    plus_aucune_trace(&m, id);
    assert_eq!(hors_du_dossier(&m.c, id), avant, "l'autre dossier est intact, ligne par ligne");
    for s in [s1, s2, s3, s_bis] {
        assert_eq!(dossiers::sous_dossier_lire(&m.c, s).unwrap_err().code, "introuvable");
    }
    assert_eq!(documents::lire(&m.c, m.f(), doc_sans_copie).unwrap_err().code, "introuvable");
    // Copies : celles du dossier ont disparu (aucune mise de côté ne reste), celle de l'autre dossier est intacte.
    assert!(!copie_racine.exists() && !copie_profonde.exists());
    assert_eq!(fs::read(&copie_autre).unwrap(), copie_autre_avant);
    assert_eq!(fichiers_presents(m.f()), [copie_autre.file_name().unwrap().to_string_lossy().into_owned()]);
    // Modèles : nombre de documents à jour ; un modèle qui n'a plus de document redevient supprimable (§ 11.4).
    assert_eq!((m.nb_modele("Fiche test"), m.nb_modele("Autre modèle")), (1, 0));
    modeles::supprimer(&m.c, m.modele("Autre modèle")).unwrap();
    // L'autre dossier se lit toujours en entier.
    let d = dossiers::detail(&m.c, m.f(), autre).unwrap();
    assert_eq!((d.documents.len(), d.sous_dossiers.len(), d.options.len()), (2, 1, 2));
    assert!(d.documents.iter().any(|x| x.fichier_chemin.is_some()));
    sans_reference_invalide(&m.c);
}

// ---------- § 15.1 : quel que soit l'état ----------

#[test]
fn dossier_cloture_en_piece_manquante_et_en_etat_personnalise() {
    let m = mini();
    let sofia = m.employe("Benali", "Sofia");
    // Clôturé : lecture seule pour tout le reste, mais il se supprime.
    let clos = m.dossier("Dossier clôturé");
    let s = m.sous(clos, None, "Pièces");
    m.document(clos, Some(s), Some(sofia), None, "");
    let (_, copie) = m.importer(clos, None, "scan.pdf");
    m.clore(clos);
    assert_eq!(dossiers::renommer(&m.c, clos, "x").unwrap_err().code, "dossier_clos");
    assert_eq!(dossiers::apercu_suppression(&m.c, m.f(), clos).unwrap(), apercu(1, 2, 1, 1));
    dossiers::supprimer(&m.c, m.f(), clos).unwrap();
    plus_aucune_trace(&m, clos);
    assert!(!copie.exists());

    // Pièce manquante.
    let piece = m.dossier_etat("Dossier en attente", Some(st(&m.c, Role::Piece)));
    m.document(piece, None, None, None, "");
    let t = tableau::calculer(&m.c).unwrap();
    assert_eq!((t.dossiers_total, t.dossiers_piece), (1, 1));
    dossiers::supprimer(&m.c, m.f(), piece).unwrap();
    plus_aucune_trace(&m, piece);
    assert_eq!(tableau::calculer(&m.c).unwrap().dossiers_piece, 0);

    // État personnalisé : sa suppression est refusée tant qu'un dossier le porte, puis redevient possible (§ 10.1).
    let attente = statuts::creer(&m.c, "Attente fournisseur", "ambre").unwrap().id;
    let perso = m.dossier_etat("Dossier fournisseur", Some(attente));
    m.document(perso, None, Some(sofia), None, "");
    assert_eq!(statuts::lire(&m.c, attente).unwrap().nb_dossiers, 1);
    assert_eq!(statuts::supprimer(&m.c, attente).unwrap_err().code, "statut_utilise");
    dossiers::supprimer(&m.c, m.f(), perso).unwrap();
    plus_aucune_trace(&m, perso);
    assert_eq!(statuts::lire(&m.c, attente).unwrap().nb_dossiers, 0);
    statuts::supprimer(&m.c, attente).unwrap();
    // Les états fournis restent.
    assert_eq!(statuts::lister(&m.c).unwrap().len(), 3);
    sans_reference_invalide(&m.c);
}

// ---------- § 15.1 : nominations, profils, trace dans l'historique des fiches ----------

#[test]
fn nominations_profils_et_trace_dans_l_historique_des_seules_fiches_nommees() {
    let m = mini();
    let sofia = m.employe("Benali", "Sofia");
    let karim = m.employe("Haddad", "Karim");
    let nadia = m.employe("Larbi", "Nadia");
    let pc = m.machine("PC accueil", Some("PC-0412"));
    let ecran = m.machine("Écran 27", Some("EC-0001"));
    entites::associer(&m.c, sofia, pc).unwrap();
    let id = m.dossier("Dossier 2026-07");
    let autre = m.dossier("Dossier gardé");
    let s1 = m.sous(id, None, "Sous");
    // Sofia : 2 documents par bloc (dont un dans un sous-dossier) ; PC : 1 document ; Karim : nommé par le texte.
    m.document(id, None, Some(sofia), Some(pc), "");
    m.document(id, Some(s1), Some(sofia), None, "Karim Haddad");
    // Nadia et l'écran ne sont nommés que dans l'autre dossier ; Sofia aussi.
    let doc_garde = m.document(autre, None, Some(nadia), Some(ecran), "Sofia Benali");
    dossiers::definir_statut(&m.c, id, st(&m.c, Role::Piece)).unwrap();
    assert_eq!(dossiers::apercu_suppression(&m.c, m.f(), id).unwrap(), apercu(1, 2, 0, 3));
    let fiche = |e: i64| entites::fiche(&m.c, m.f(), e).unwrap();
    assert_eq!(fiche(sofia).documents.len(), 3);
    assert_eq!(fiche(sofia).dossiers.len(), 2);
    let historique = |e: i64| contenu(&m.c, &format!("SELECT * FROM evenements WHERE a_id = {e} OR b_id = {e} ORDER BY id"));
    let (h_nadia, h_ecran) = (historique(nadia), historique(ecran));
    let nb_nominations_garde = compter(&m.c, &format!("SELECT COUNT(*) FROM nominations WHERE document_id = {doc_garde}"));
    assert_eq!(nb_nominations_garde, 3);

    dossiers::supprimer(&m.c, m.f(), id).unwrap();
    plus_aucune_trace(&m, id);

    // Nominations des documents supprimés : parties ; celles de l'autre dossier : intactes.
    assert_eq!(compter(&m.c, "SELECT COUNT(*) FROM nominations"), nb_nominations_garde);
    // Profils à jour.
    let f = fiche(sofia);
    assert_eq!(f.documents.iter().map(|d| d.document.id).collect::<Vec<_>>(), [doc_garde]);
    assert_eq!(f.dossiers.iter().map(|d| d.id).collect::<Vec<_>>(), [autre]);
    assert!(fiche(pc).documents.is_empty() && fiche(pc).dossiers.is_empty());
    assert!(fiche(karim).documents.is_empty() && fiche(karim).dossiers.is_empty());
    // Les fiches et les affectations ne sont pas touchées.
    assert_eq!(entites::lister(&m.c, Kind::A).unwrap().len(), 3);
    assert_eq!(entites::lister(&m.c, Kind::B).unwrap().len(), 2);
    assert_eq!(fiche(sofia).associees.iter().map(|e| e.id).collect::<Vec<_>>(), [pc]);

    // Trace : un événement par fiche nommée, rattaché à elle seule, avec le nombre de documents où elle l'était.
    type Trace = (String, String, Option<i64>, Option<i64>, Option<i64>);
    let traces: Vec<Trace> = {
        let mut s = m.c.prepare("SELECT titre, detail, a_id, b_id, dossier_id FROM evenements WHERE type = 'dossier_supprime' ORDER BY id").unwrap();
        s.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))).unwrap().map(Result::unwrap).collect()
    };
    let titre = "Dossier « Dossier 2026-07 » supprimé".to_string();
    let mut attendu: Vec<Trace> = vec![
        (titre.clone(), "Il contenait 2 documents où cet employé était nommé.".into(), Some(sofia), None, None),
        (titre.clone(), "Il contenait 1 document où cet employé était nommé.".into(), Some(karim), None, None),
        (titre.clone(), "Il contenait 1 document où cette machine était nommée.".into(), None, Some(pc), None),
    ];
    let cle = |t: &Trace| t.2.or(t.3);
    attendu.sort_by_key(cle);
    let mut obtenu = traces.clone();
    obtenu.sort_by_key(cle);
    assert_eq!(obtenu, attendu);
    // Dans l'historique de la fiche, non cliquable : ni dossier, ni document.
    for e in [sofia, karim, pc] {
        let ev: Vec<_> = fiche(e).evenements.into_iter().filter(|x| x.r#type == journal::DOSSIER_SUPPRIME).collect();
        assert_eq!(ev.len(), 1, "fiche {e}");
        assert_eq!((ev[0].dossier_id, ev[0].dossier_nom.as_deref(), ev[0].document_id), (None, None, None));
        assert_eq!(ev[0].titre, titre);
        assert_eq!(ev[0].classe, "");
    }
    // Les fiches nommées seulement ailleurs n'ont rien reçu.
    assert_eq!((historique(nadia), historique(ecran)), (h_nadia, h_ecran));
    // Plus aucun événement des dossiers supprimés dans l'historique des fiches (ouverture, pièce manquante…).
    assert!(fiche(sofia).evenements.iter().all(|x| !x.titre.contains("Dossier 2026-07") || x.r#type == journal::DOSSIER_SUPPRIME));
    sans_reference_invalide(&m.c);
}

// ---------- § 15.1 : journal et numéro réattribué ----------

#[test]
fn aucun_evenement_ne_garde_le_numero_et_un_nouveau_dossier_n_herite_de_rien() {
    let m = mini();
    let sofia = m.employe("Benali", "Sofia");
    let d1 = m.dossier("Premier");
    let ancien = m.dossier("Ancien dossier");
    m.document(ancien, None, Some(sofia), None, "");
    dossiers::definir_statut(&m.c, ancien, st(&m.c, Role::Piece)).unwrap();
    dossiers::definir_statut(&m.c, ancien, st(&m.c, Role::Cours)).unwrap();
    m.clore(ancien);
    let journal_ancien = compter(&m.c, &format!("SELECT COUNT(*) FROM evenements WHERE dossier_id = {ancien}"));
    assert!(journal_ancien >= 4, "ouverture, pièce manquante, état, clôture");
    // Événement de la version 1.3 rattaché au dossier ET à la fiche (journal d'une base migrée) : supprimé aussi.
    m.c.execute(
        "INSERT INTO evenements (type, titre, detail, a_id, b_id, dossier_id, date) VALUES ('dossier_fiches', 'Ancien rattachement', '', ?1, NULL, ?2, '2024-01-01 10:00:00')",
        [sofia, ancien],
    )
    .unwrap();
    assert!(entites::fiche(&m.c, m.f(), sofia).unwrap().evenements.iter().any(|e| e.dossier_id == Some(ancien)));

    dossiers::supprimer(&m.c, m.f(), ancien).unwrap();
    assert_eq!(compter(&m.c, &format!("SELECT COUNT(*) FROM evenements WHERE dossier_id = {ancien}")), 0, "plus aucun événement avec son numéro");
    assert!(entites::fiche(&m.c, m.f(), sofia).unwrap().evenements.iter().all(|e| e.dossier_id != Some(ancien)));

    // SQLite redonne le numéro le plus haut libéré : c'est le cas piégeux.
    let nouveau = m.dossier("Nouveau dossier");
    assert_eq!(nouveau, ancien, "même numéro réattribué");
    m.document(nouveau, None, Some(sofia), None, "");
    // Le nouveau dossier n'a que son propre journal (« ouvert »), ni document, ni option, ni sous-dossier de l'ancien.
    let titres: Vec<String> = contenu(&m.c, &format!("SELECT titre FROM evenements WHERE dossier_id = {nouveau} ORDER BY id"));
    assert_eq!(titres, ["Text(\"Nouveau dossier ouvert\")"]);
    let d = dossiers::detail(&m.c, m.f(), nouveau).unwrap();
    assert_eq!(d.dossier.nom, "Nouveau dossier");
    assert_eq!(d.dossier.statut.role, Role::Cours, "pas l'état clôturé de l'ancien");
    assert_eq!((d.documents.len(), d.sous_dossiers.len(), d.options.len()), (1, 0, 2));
    // L'historique de la fiche : l'ancien dossier n'y figure que par la trace, sans lien ; rien n'est attribué au nouveau.
    let ev = entites::fiche(&m.c, m.f(), sofia).unwrap().evenements;
    // Événements du journal rattachés au numéro (les nominations, calculées, citent le document du nouveau dossier).
    let du_nouveau: Vec<&str> = ev
        .iter()
        .filter(|e| e.dossier_id == Some(nouveau) && e.r#type != journal::NOMINATION)
        .map(|e| e.titre.as_str())
        .collect();
    assert!(du_nouveau.iter().all(|t| t.contains("Nouveau dossier")), "{du_nouveau:?}");
    assert!(!du_nouveau.is_empty());
    assert!(ev.iter().all(|e| !e.titre.contains("Ancien dossier") || e.r#type == journal::DOSSIER_SUPPRIME), "{ev:?}");
    assert!(ev.iter().all(|e| e.titre != "Ancien rattachement"));
    assert_eq!(ev.iter().filter(|e| e.r#type == journal::DOSSIER_SUPPRIME).count(), 1);
    assert!(dossiers::resume(&m.c, d1).is_ok());
    sans_reference_invalide(&m.c);
}

// ---------- § 15.1 : tableau de bord, recherche ----------

#[test]
fn tableau_de_bord_et_recherche_a_jour() {
    let m = mini();
    let garde = m.dossier("Dossier gardé");
    m.document(garde, None, None, None, "");
    let id = m.dossier("Dossier à supprimer");
    m.document(id, None, None, None, "");
    m.document(id, None, None, None, "");
    let avant = tableau::calculer(&m.c).unwrap();
    assert_eq!((avant.dossiers_total, avant.dossiers_ouverts, avant.dossiers_en_cours.len()), (2, 2, 2));
    assert_eq!(avant.volume.mois.iter().sum::<i64>(), 3);
    assert_eq!(recherche::rechercher(&m.c, "supprimer").unwrap().dossiers_total, 1);

    dossiers::supprimer(&m.c, m.f(), id).unwrap();
    let t = tableau::calculer(&m.c).unwrap();
    assert_eq!((t.dossiers_total, t.dossiers_ouverts, t.dossiers_en_cours.len()), (1, 1, 1));
    assert_eq!(t.dossiers_en_cours[0].id, garde);
    assert_eq!(t.volume.mois.iter().sum::<i64>(), 1, "volume par période");
    assert_eq!(t.repartition.iter().map(|r| r.nb).sum::<i64>(), 1, "répartition");
    let r = recherche::rechercher(&m.c, "supprimer").unwrap();
    assert_eq!((r.dossiers.len(), r.dossiers_total), (0, 0));
    assert_eq!(recherche::rechercher(&m.c, "Dossier").unwrap().dossiers_total, 1);
}

// ---------- erreurs propres ----------

#[test]
fn identifiant_inexistant_et_double_suppression_erreur_introuvable_sans_ecriture() {
    let m = mini();
    let id = m.dossier("Dossier");
    m.document(id, None, None, None, "");
    let avant = photo(&m.c);
    for x in [0, -1, 9999] {
        let e = dossiers::supprimer(&m.c, m.f(), x).unwrap_err();
        assert_eq!((e.code.as_str(), e.message.as_str()), ("introuvable", "Dossier introuvable."));
        assert_eq!(dossiers::apercu_suppression(&m.c, m.f(), x).unwrap_err().code, "introuvable");
    }
    assert_eq!(photo(&m.c), avant);
    dossiers::supprimer(&m.c, m.f(), id).unwrap();
    let apres = photo(&m.c);
    let e = dossiers::supprimer(&m.c, m.f(), id).unwrap_err();
    assert_eq!((e.code.as_str(), e.message.as_str()), ("introuvable", "Dossier introuvable."));
    assert_eq!(dossiers::apercu_suppression(&m.c, m.f(), id).unwrap_err().code, "introuvable");
    assert_eq!(photo(&m.c), apres);
}

// ---------- transaction ----------

#[test]
fn transaction_rien_ne_change_si_une_etape_echoue() {
    let m = mini();
    let sofia = m.employe("Benali", "Sofia");
    let id = m.dossier("Dossier");
    let s = m.sous(id, None, "Sous");
    m.document(id, Some(s), Some(sofia), None, "");
    let (_, copie) = m.importer(id, None, "scan.pdf");
    let contenu_copie = fs::read(&copie).unwrap();
    let avant = photo(&m.c);
    let fichiers_avant = fichiers_presents(m.f());

    // La dernière étape (suppression de la ligne du dossier) échoue : tout ce qui précède est annulé, la copie
    // revient à sa place.
    m.c.execute_batch("CREATE TEMP TRIGGER refus BEFORE DELETE ON dossiers BEGIN SELECT RAISE(ABORT, 'refus simulé'); END;")
        .unwrap();
    assert!(dossiers::supprimer(&m.c, m.f(), id).is_err());
    assert_eq!(photo(&m.c), avant);
    assert!(m.c.is_autocommit(), "aucune transaction laissée ouverte");
    assert_eq!(fichiers_presents(m.f()), fichiers_avant);
    assert_eq!(fs::read(&copie).unwrap(), contenu_copie);
    m.c.execute_batch("DROP TRIGGER temp.refus;").unwrap();

    // Sans l'obstacle, la même suppression passe.
    dossiers::supprimer(&m.c, m.f(), id).unwrap();
    plus_aucune_trace(&m, id);
    assert!(!copie.exists());
}

#[cfg(windows)]
#[test]
fn copie_verrouillee_refus_propre_rien_n_est_supprime() {
    use std::os::windows::fs::OpenOptionsExt;
    let m = mini();
    let id = m.dossier("Dossier");
    let (_, libre) = m.importer(id, None, "a.pdf");
    let (_, verrouillee) = m.importer(id, None, "b.pdf");
    let avant = photo(&m.c);
    let fichiers_avant = fichiers_presents(m.f());
    let verrou = fs::OpenOptions::new().read(true).share_mode(0).open(&verrouillee).unwrap();
    let e = dossiers::supprimer(&m.c, m.f(), id).unwrap_err();
    assert_eq!(
        (e.code.as_str(), e.message.as_str()),
        ("fichier_ouvert", "Un fichier importé de ce dossier est utilisé par une autre application. Fermez-le, puis réessayez.")
    );
    drop(verrou);
    assert_eq!(photo(&m.c), avant, "rien n'est supprimé en base");
    assert_eq!(fichiers_presents(m.f()), fichiers_avant, "rien n'est supprimé sur le disque");
    assert!(libre.is_file() && verrouillee.is_file());
    dossiers::supprimer(&m.c, m.f(), id).unwrap();
    assert!(fichiers_presents(m.f()).is_empty(), "aucune copie mise de côté ne reste");
}

// ---------- base incohérente : jamais au-delà du dossier ----------

#[test]
fn contenu_partage_avec_un_autre_dossier_refuse_sans_rien_toucher() {
    let m = mini();
    let id = m.dossier("Dossier");
    let autre = m.dossier("Autre");
    let s = m.sous(id, None, "Sous");
    // Base modifiée à la main : un sous-dossier de l'autre dossier pend sous un sous-dossier de celui-ci, avec un document.
    m.c.execute(
        "INSERT INTO sous_dossiers (dossier_id, parent_id, nom, cree_le) VALUES (?1, ?2, 'Égaré', '2026-01-01 10:00:00')",
        [autre, s],
    )
    .unwrap();
    let egare = m.c.last_insert_rowid();
    m.document(autre, Some(egare), None, None, "");
    let (_, copie) = m.importer(id, None, "a.pdf");
    // Une copie référencée aussi par un document de l'autre dossier n'est jamais comptée ni supprimée.
    let stocke: String = m.c.query_row("SELECT fichier_stocke FROM documents WHERE fichier_stocke IS NOT NULL", [], |r| r.get(0)).unwrap();
    m.c.execute(
        "INSERT INTO documents (dossier_id, nom, origine, source, date_doc, fichier_stocke, fichier_nom, piece_finale, cree_le)
         VALUES (?1, 'Double', 'import', 'Fichier importé', '2026-01-01', ?2, 'a.pdf', 0, '2026-01-01 10:00:00')",
        rusqlite::params![autre, stocke],
    )
    .unwrap();
    assert_eq!(dossiers::apercu_suppression(&m.c, m.f(), id).unwrap().nb_fichiers_importes, 0);
    let avant = photo(&m.c);

    let e = dossiers::supprimer(&m.c, m.f(), id).unwrap_err();
    assert_eq!(e.code, "donnees_incoherentes");
    assert_eq!(photo(&m.c), avant);
    assert!(copie.is_file());

    // Le sous-dossier égaré rattaché ailleurs : la suppression passe, l'autre dossier garde tout, la copie partagée aussi.
    m.c.execute("UPDATE sous_dossiers SET parent_id = NULL WHERE id = ?1", [egare]).unwrap();
    let hors = hors_du_dossier(&m.c, id);
    dossiers::supprimer(&m.c, m.f(), id).unwrap();
    assert_eq!(hors_du_dossier(&m.c, id), hors);
    assert!(copie.is_file(), "la copie partagée reste pour l'autre dossier");
    sans_reference_invalide(&m.c);
}

#[test]
fn serialisation_de_l_apercu_en_camel_case() {
    let v = serde_json::to_value(apercu(2, 7, 3, 4)).unwrap();
    assert_eq!(v, serde_json::json!({ "nbSousDossiers": 2, "nbDocuments": 7, "nbFichiersImportes": 3, "nbFichesNommees": 4 }));
}
