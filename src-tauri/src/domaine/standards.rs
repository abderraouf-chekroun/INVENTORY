//! Les quatre modèles standards (§ 8.6) : formulaires génériques d'un service informatique, dans l'ordre du
//! formulaire. Les en-têtes sont neutres (« Nom de l'organisme »…) : l'utilisateur les adapte dans le Studio.
//!
//! Les informations que porte déjà la fiche d'un employé (nom, prénom, poste, structure) ou d'une machine
//! (marque et modèle, processeur, RAM, disque) sont fournies par un bloc `employe` ou `machine`.
//! La date du formulaire (« Fait le … ») correspond à la date du document, affichée en haut à droite : pas de bloc.

use super::modeles::{Bloc, TypeBloc};

/// Thème où sont rangés les modèles standards.
pub const THEME: &str = "Support informatique";

pub const ETAT_DES_BESOINS: &str = "État des besoins";
pub const FICHE_INTERVENTION: &str = "Fiche d’intervention informatique";
pub const FICHE_IDENTIFICATION: &str = "Fiche d’identification";
pub const FICHE_FORMATAGE: &str = "Fiche pour formatage PC";

// Deux lignes, comme un cartouche de formulaire (le texte d'un bloc garde ses retours à la ligne), à adapter dans le
// Studio.
const EN_TETE: &str = "Nom de l’organisme\nAdresse · Téléphone";
const DIVISION: &str = "Nom de la division ou du service";

pub struct Standard {
    /// Clé stable enregistrée dans `modeles.standard`.
    pub cle: &'static str,
    pub nom: &'static str,
    pub blocs: Vec<Bloc>,
}

fn bloc(t: TypeBloc, v: &str) -> Bloc {
    Bloc::nouveau(t, v)
}
fn titre(v: &str) -> Bloc {
    Bloc { niveau: Some(1), ..bloc(TypeBloc::Titre, v) }
}
fn intertitre(v: &str) -> Bloc {
    Bloc { niveau: Some(2), ..bloc(TypeBloc::Titre, v) }
}
fn texte(v: &str) -> Bloc {
    bloc(TypeBloc::Texte, v)
}
fn champ(v: &str) -> Bloc {
    bloc(TypeBloc::Champ, v)
}
fn zone(v: &str) -> Bloc {
    bloc(TypeBloc::Zone, v)
}
fn date(v: &str, heure: bool) -> Bloc {
    Bloc { heure: Some(heure), ..bloc(TypeBloc::Date, v) }
}
fn case(v: &str) -> Bloc {
    bloc(TypeBloc::Case, v)
}
fn choix(v: &str, options: &[&str], multiple: bool) -> Bloc {
    Bloc {
        options: Some(options.iter().map(|o| o.to_string()).collect()),
        multiple: Some(multiple),
        ..bloc(TypeBloc::Choix, v)
    }
}
/// § 10.6 : bloc de saisie marqué « Champ obligatoire ».
fn obligatoire(b: Bloc) -> Bloc {
    Bloc { obligatoire: Some(true), ..b }
}
fn tableau(cols: &[&str]) -> Bloc {
    Bloc { cols: Some(cols.iter().map(|c| c.to_string()).collect()), ..bloc(TypeBloc::Tableau, "") }
}
/// Les blocs `employe` et `machine` des modèles standards sont obligatoires (§ 10.6).
fn employe(v: &str) -> Bloc {
    obligatoire(bloc(TypeBloc::Employe, v))
}
fn machine(v: &str) -> Bloc {
    obligatoire(bloc(TypeBloc::Machine, v))
}
fn signature(v: &str) -> Bloc {
    bloc(TypeBloc::Signature, v)
}

/// Les quatre modèles standards, dans l'ordre de création.
pub fn definitions() -> Vec<Standard> {
    vec![
        Standard {
            cle: "etat-des-besoins",
            nom: ETAT_DES_BESOINS,
            blocs: vec![
                texte(EN_TETE),
                champ("Division"),
                // Annotation manuscrite : « départ » encadré en haut à gauche, « ou arrivée » à côté du titre.
                // Placée sous l'en-tête, juste avant le titre (au-dessus, elle repoussait l'en-tête).
                choix("Départ ou arrivée", &["Départ", "Arrivée"], false),
                titre(ETAT_DES_BESOINS),
                obligatoire(tableau(&["N°", "Désignation", "Qté", "Observations"])),
                zone("Motif de l’acquisition"),
                choix("Nature de la demande", &["Achat", "Magasin", "Prestation", "Travaux"], true),
                signature("Visa du demandeur"),
                signature("Visa du responsable hiérarchique"),
                signature("Visa du directeur général"),
            ],
        },
        Standard {
            cle: "fiche-intervention",
            nom: FICHE_INTERVENTION,
            blocs: vec![
                texte(EN_TETE),
                texte(DIVISION),
                titre(FICHE_INTERVENTION),
                case("Intervention urgente"),
                champ("Signalée par"),
                case("Intervention après état des besoins"),
                choix(
                    "Type de matériel",
                    &["Unité centrale", "Ordinateur portable", "Imprimante", "Moniteur", "Logiciel", "Autres"],
                    true,
                ),
                employe("Utilisateur"),
                champ("N° de poste"),
                machine("Matériel"),
                champ("N° de série"),
                zone("Défauts signalés"),
                zone("Défauts constatés"),
                zone("Tâches effectuées"),
                champ("Noms des intervenants"),
                date("Début d’intervention", true),
                date("Fin d’intervention", true),
                case("Matériel testé en état de marche"),
                case("Matériel envoyé pour suite de maintenance"),
                // Annotation manuscrite au bas de la fiche : « + Ouverture de la session (Domaine) ».
                champ("Ouverture de la session (domaine)"),
                intertitre("Signatures"),
                signature("Chef du département maintenance"),
                signature("Intervenant"),
                signature("Utilisateur"),
            ],
        },
        Standard {
            cle: "fiche-identification",
            nom: FICHE_IDENTIFICATION,
            blocs: vec![
                texte(EN_TETE),
                texte(DIVISION),
                titre(FICHE_IDENTIFICATION),
                intertitre("Attribution d’une boîte de messagerie professionnelle"),
                employe("Bénéficiaire"),
                champ("Adresse mail"),
                // Une étape par ligne, comme les puces du papier (le texte d'un bloc garde ses retours à la ligne).
                texte(
                    "Comment accéder à ma boîte de messagerie ?\n\
                     – Tapez l’adresse web de la messagerie de votre organisme.",
                ),
                texte(
                    "Il est obligatoire de changer le mot de passe à la première utilisation (pour les nouveaux \
                     personnels bénéficiaires des boîtes de messagerie), en suivant les étapes suivantes :\n\
                     – allez en haut à droite, dans « Paramètres » ;\n\
                     – allez à la première colonne, « Réglages de base » ;\n\
                     – entrez l’ancien mot de passe et continuez les changements.",
                ),
                texte(
                    "Remarque : il est à noter qu’à la fin de toute relation professionnelle avec l’organisme (retraite, \
                     démission, licenciement ou autre), la boîte de messagerie de la personne concernée sera \
                     supprimée automatiquement quinze (15) jours après son départ.",
                ),
                date("Date d’ouverture", false),
                signature("Signature"),
                signature("Cachet de la structure / division"),
                texte("Responsable de la sécurité des systèmes d’information (RSSI)"),
            ],
        },
        Standard {
            cle: "fiche-formatage",
            nom: FICHE_FORMATAGE,
            blocs: vec![
                texte(EN_TETE),
                texte(DIVISION),
                titre(FICHE_FORMATAGE),
                intertitre("Informations générales"),
                employe("Utilisateur"),
                champ("N° de poste"),
                choix("Demandeur", &["Intervenant informatique", "Utilisateur"], false),
                choix(
                    "Formatage nécessaire (cause, réservé à l’intervenant)",
                    &[
                        "Panne crash (matériel)",
                        "Mauvaise manipulation",
                        "Dysfonctionnement d’une application",
                        "Dysfonctionnement de l’OS",
                        "Autre",
                    ],
                    true,
                ),
                champ("Autre cause"),
                zone("Motifs"),
                intertitre("Informations du PC avant formatage"),
                intertitre("Configuration matérielle"),
                machine("PC"),
                champ("N° de série"),
                champ("Partition de l’OS"),
                champ("OS installé"),
                // « Licence : » de la configuration matérielle (celle de l'OS), distincte du choix « Licence »
                // de l'application plus bas : deux champs du même nom seraient ambigus à l'écran.
                champ("Licence de l’OS"),
                champ("Antivirus installé"),
                choix("PC connecté au réseau", &["Oui", "Non"], false),
                choix("Mode de connexion", &["Utilisateur", "Local"], false),
                intertitre("Autre application"),
                champ("Nom de l’application"),
                choix("Licence", &["Open source", "Sans licence", "Avec licence"], false),
                choix(
                    "Données sauvegardées",
                    &["Documents utilisateur", "Fichiers bureautiques", "Autres données spécifiques"],
                    true,
                ),
                zone("Autres données spécifiques (précisions)"),
                champ("Nom de l’intervenant"),
                date("Date d’entrée", false),
                date("Date de sortie", false),
                intertitre("Signature"),
                signature("RSSI"),
                signature("Intervenant"),
                signature("Utilisateur"),
            ],
        },
    ]
}
