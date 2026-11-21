//! Tests de la version 1.8.1 (§ 18) : les modèles standards ne portent aucune information propre à un organisme
//! réel (adresse web, numéro, référence de formulaire…) ; leurs en-têtes sont neutres. Les bases existantes ne
//! changent pas : un modèle standard déjà présent garde son texte, aucune migration n'est ajoutée.

use super::modeles::{self, Bloc, SaisieModele, TypeBloc};
use super::{donnees, standards};
use crate::db;

const EN_TETE: &str = "Nom de l’organisme\nAdresse · Téléphone";
const DIVISION: &str = "Nom de la division ou du service";

/// Tous les textes d'un bloc de modèle : libellé, options, en-têtes de colonnes.
fn textes(b: &Bloc) -> Vec<&str> {
    let mut t = vec![b.v.as_str()];
    t.extend(b.options.iter().flatten().map(String::as_str));
    t.extend(b.cols.iter().flatten().map(String::as_str));
    t
}

/// Plus longue suite de chiffres, séparateurs d'un numéro (espaces, points, tirets, barres) ignorés.
fn plus_longue_suite_de_chiffres(s: &str) -> usize {
    let (mut max, mut n) = (0, 0);
    for c in s.chars() {
        if c.is_ascii_digit() {
            n += 1;
            max = max.max(n);
        } else if !(c.is_whitespace() || matches!(c, '.' | '-' | '/' | '(' | ')' | '+')) {
            n = 0;
        }
    }
    max
}

/// Motifs interdits (formes génériques, qui ne citent aucune valeur réelle) trouvés dans un texte.
fn motifs_interdits(s: &str) -> Vec<&'static str> {
    let bas = s.to_lowercase();
    let mut trouves = Vec::new();
    if bas.contains("http") || bas.contains("www.") {
        trouves.push("adresse web");
    }
    let domaine_dz = bas.match_indices(".dz").any(|(i, _)| {
        !bas[i + 3..].chars().next().is_some_and(|c| c.is_alphanumeric())
    });
    if domaine_dz {
        trouves.push("domaine .dz");
    }
    if plus_longue_suite_de_chiffres(s) > 8 {
        trouves.push("suite de plus de 8 chiffres");
    }
    // « Tél. », « Tél : », « Tel. » : l'abréviation d'un numéro (le mot « Téléphone » d'un en-tête neutre est permis).
    for abr in ["tél.", "tél :", "tél:", "tel.", "tel :", "tel:"] {
        if bas.contains(abr) {
            trouves.push("Tél");
            break;
        }
    }
    if bas.contains("fax") {
        trouves.push("Fax");
    }
    if bas.contains("bp n°") || bas.contains("b.p.") || bas.contains("boîte postale") {
        trouves.push("BP n°");
    }
    if bas.contains("rév.") || bas.contains("rev.") || bas.contains("révision") {
        trouves.push("Rév.");
    }
    if bas.contains('@') {
        trouves.push("adresse électronique");
    }
    // Référence de formulaire : un mot coupé par une barre oblique (« XXX/YYY »).
    if s.split_whitespace().any(|mot| mot.len() > 1 && mot.trim_matches('/').contains('/')) {
        trouves.push("référence de formulaire");
    }
    trouves
}

fn controler(nom: &str, blocs: &[Bloc]) {
    assert!(motifs_interdits(nom).is_empty(), "nom du modèle « {nom} »");
    for b in blocs {
        for t in textes(b) {
            let m = motifs_interdits(t);
            assert!(m.is_empty(), "« {nom} » : motifs interdits {m:?} dans un bloc {:?}", b.t);
        }
    }
}

#[test]
fn les_motifs_interdits_sont_detectes() {
    // Formes fabriquées, sans lien avec un organisme réel.
    for (texte, motif) in [
        ("Tapez https://exemple.test", "adresse web"),
        ("courrier.exemple.dz", "domaine .dz"),
        ("Appelez le 01 23 45 67 89", "suite de plus de 8 chiffres"),
        ("Tél. : 01", "Tél"),
        ("Fax : 02", "Fax"),
        ("BP n° 1, Ville", "BP n°"),
        ("Rév. : 01", "Rév."),
        ("REF/FORM/V1", "référence de formulaire"),
    ] {
        assert!(motifs_interdits(texte).contains(&motif), "{texte} → {motif}");
    }
    for permis in [EN_TETE, DIVISION, "Cachet de la structure / division", "quinze (15) jours", "N° de poste", "exemple.org"] {
        assert!(motifs_interdits(permis).is_empty(), "{permis}");
    }
}

#[test]
fn definitions_sans_information_sensible() {
    let definitions = standards::definitions();
    assert_eq!(definitions.len(), 4);
    for s in &definitions {
        controler(s.nom, &s.blocs);
    }
}

#[test]
fn en_tetes_neutres() {
    for s in standards::definitions() {
        let titre = s.blocs.iter().position(|b| b.t == TypeBloc::Titre && b.niveau == Some(1)).expect("titre");
        let en_tete: Vec<&str> =
            s.blocs[..titre].iter().filter(|b| b.t == TypeBloc::Texte).map(|b| b.v.as_str()).collect();
        assert_eq!(en_tete.first(), Some(&EN_TETE), "{}", s.nom);
        assert!(en_tete.iter().all(|t| !t.trim().is_empty()), "{} : pas de bloc vide", s.nom);
        if s.cle != "etat-des-besoins" {
            assert_eq!(en_tete, [EN_TETE, DIVISION], "{}", s.nom);
        }
    }
    let ident = standards::definitions().into_iter().find(|s| s.cle == "fiche-identification").unwrap();
    let tous: Vec<&str> = ident.blocs.iter().map(|b| b.v.as_str()).collect();
    assert!(tous.iter().any(|t| t.contains("Tapez l’adresse web de la messagerie de votre organisme.")));
    assert!(tous.iter().any(|t| t.contains("relation professionnelle avec l’organisme")));
}

#[test]
fn base_neuve_et_restauration_texte_neutre() {
    let c = db::ouvrir_memoire().unwrap();
    donnees::initialiser(&c).unwrap();
    let standards_crees: Vec<_> = modeles::lister(&c).unwrap().into_iter().filter(|m| m.standard).collect();
    assert_eq!(standards_crees.len(), 4);
    for m in &standards_crees {
        controler(&m.nom, &m.blocs);
    }
    // « Restaurer les modèles standards » après archivage : le modèle recréé porte le texte neutre.
    let fi = standards_crees.iter().find(|m| m.nom == standards::FICHE_INTERVENTION).unwrap();
    modeles::basculer(&c, fi.id).unwrap();
    let recrees = modeles::restaurer_standards(&c).unwrap();
    assert_eq!(recrees.len(), 1);
    controler(&recrees[0].nom, &recrees[0].blocs);
    assert_eq!(recrees[0].blocs[0].v, EN_TETE);
}

#[test]
fn base_existante_inchangee() {
    let c = db::ouvrir_memoire().unwrap();
    donnees::initialiser(&c).unwrap();
    let version: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(version, 6, "aucune migration nouvelle");
    // Un modèle standard dont l'en-tête a été adapté par l'utilisateur garde son texte : la détection des
    // modèles présents ne dépend que du nom.
    let fid = modeles::lister(&c).unwrap().into_iter().find(|m| m.nom == standards::FICHE_IDENTIFICATION).unwrap();
    let mut blocs = fid.blocs.clone();
    blocs[0].v = "En-tête propre à l’utilisateur".into();
    modeles::enregistrer(&c, fid.id, &SaisieModele { nom: fid.nom.clone(), theme_id: fid.theme_id, blocs }).unwrap();
    assert!(modeles::restaurer_standards(&c).unwrap().is_empty());
    db::migrer(&c).unwrap();
    let relu = modeles::lire(&c, fid.id).unwrap();
    assert_eq!(relu.blocs[0].v, "En-tête propre à l’utilisateur");
    assert!(relu.standard);
}
