//! Enveloppes `#[tauri::command]` minces : chaque commande porte le nom snake_case de la fonction
//! TypeScript de `src/api` et délègue au domaine.
//!
//! Les commandes sont `async` pour s'exécuter hors du fil principal (la fenêtre reste fluide).

use crate::domaine::classement::{self, Categorie, Classement, MotCle, ThemeCompte};
use crate::domaine::copies;
use crate::domaine::documents::{self, DocumentFichier};
use crate::domaine::donnees::{self, ModeReinit};
use crate::domaine::dossiers::{
    self, DossierDetail, DossierResume, DossierSuppressionApercu, OptionDossier, SaisieDossier, SousDossier,
};
use crate::domaine::entites::{self, Entite, FicheEntite, SaisieEntite, SaisieIdentifiant, SuppressionApercu};
use crate::domaine::modeles::{self, Bloc, Modele, SaisieModele};
use crate::domaine::parametres::{self, Parametres};
use crate::domaine::Kind;
use crate::domaine::recherche::{self, ResultatsRecherche};
use crate::domaine::statuts::{self, SaisieStatut, StatutDossier};
use crate::domaine::tableau::{self, TableauDeBord};
use crate::error::{AppError, AppResult, journaliser};
use crate::etat::Etat;
use crate::fenetre;
use serde::Serialize;
use std::path::Path;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

type Res<T> = AppResult<T>;

fn ouvrir_chemin(app: &AppHandle, chemin: &Path) -> Res<()> {
    app.opener().open_path(chemin.to_string_lossy(), None::<&str>).map_err(|e| {
        journaliser("ouverture", &e);
        AppError::new("ouverture", "Impossible d’ouvrir ce fichier avec l’application par défaut.")
    })
}

// ---------- paramètres et système ----------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InfosSysteme {
    pub version: String,
    pub tauri: String,
    pub webview: String,
    pub dossier_donnees: String,
    pub chemin_base: String,
}

#[tauri::command]
pub async fn parametres_lire(etat: State<'_, Etat>) -> Res<Parametres> {
    parametres::lire(&*etat.conn()?)
}

#[tauri::command]
pub async fn parametre_definir(etat: State<'_, Etat>, cle: String, valeur: String) -> Res<()> {
    parametres::definir(&*etat.conn()?, &cle, &valeur)
}

#[tauri::command]
pub async fn infos_systeme(app: AppHandle, etat: State<'_, Etat>) -> Res<InfosSysteme> {
    Ok(InfosSysteme {
        version: app.package_info().version.to_string(),
        tauri: tauri::VERSION.to_string(),
        webview: tauri::webview_version().unwrap_or_else(|_| "inconnue".to_string()),
        dossier_donnees: etat.dossier_donnees.to_string_lossy().into_owned(),
        chemin_base: etat.chemin_base.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub async fn dossier_donnees_ouvrir(app: AppHandle, etat: State<'_, Etat>) -> Res<()> {
    ouvrir_chemin(&app, &etat.dossier_donnees)
}

#[tauri::command]
pub async fn donnees_reinitialiser(etat: State<'_, Etat>, mode: String) -> Res<()> {
    let mode = ModeReinit::depuis(&mode)?;
    donnees::reinitialiser(&*etat.conn()?, &etat.dossier_donnees, &etat.fichiers, mode, chrono::Local::now().date_naive())
}

// ---------- classement ----------

#[tauri::command]
pub async fn themes_lister(etat: State<'_, Etat>) -> Res<Vec<ThemeCompte>> {
    classement::themes_lister(&*etat.conn()?)
}

#[tauri::command]
pub async fn theme_creer(etat: State<'_, Etat>, nom: String) -> Res<Classement> {
    classement::theme_creer(&*etat.conn()?, &nom)
}

#[tauri::command]
pub async fn theme_basculer(etat: State<'_, Etat>, id: i64) -> Res<Classement> {
    classement::theme_basculer(&*etat.conn()?, id)
}

#[tauri::command]
pub async fn theme_renommer(etat: State<'_, Etat>, id: i64, nom: String) -> Res<ThemeCompte> {
    classement::theme_renommer(&*etat.conn()?, id, &nom)
}

#[tauri::command]
pub async fn theme_supprimer(etat: State<'_, Etat>, id: i64) -> Res<()> {
    classement::theme_supprimer(&*etat.conn()?, id)
}

#[tauri::command]
pub async fn categories_lister(etat: State<'_, Etat>, kind: Kind) -> Res<Vec<Categorie>> {
    classement::categories_lister(&*etat.conn()?, kind)
}

#[tauri::command]
pub async fn categorie_creer(etat: State<'_, Etat>, kind: Kind, nom: String) -> Res<Categorie> {
    classement::categorie_creer(&*etat.conn()?, kind, &nom)
}

#[tauri::command]
pub async fn categorie_basculer(etat: State<'_, Etat>, id: i64) -> Res<Categorie> {
    classement::categorie_basculer(&*etat.conn()?, id)
}

#[tauri::command]
pub async fn categorie_renommer(etat: State<'_, Etat>, id: i64, nom: String) -> Res<Categorie> {
    classement::categorie_renommer(&*etat.conn()?, id, &nom)
}

#[tauri::command]
pub async fn categorie_supprimer(etat: State<'_, Etat>, id: i64) -> Res<()> {
    classement::categorie_supprimer(&*etat.conn()?, id)
}

#[tauri::command]
pub async fn magasin_lister(etat: State<'_, Etat>) -> Res<Vec<MotCle>> {
    classement::magasin_lister(&*etat.conn()?)
}

#[tauri::command]
pub async fn magasin_renommer(etat: State<'_, Etat>, id: i64, nom: String) -> Res<MotCle> {
    classement::magasin_renommer(&*etat.conn()?, id, &nom)
}

#[tauri::command]
pub async fn magasin_supprimer(etat: State<'_, Etat>, id: i64) -> Res<()> {
    classement::magasin_supprimer(&*etat.conn()?, id)
}

#[tauri::command]
pub async fn magasin_creer(etat: State<'_, Etat>, nom: String) -> Res<Classement> {
    classement::magasin_creer(&*etat.conn()?, &nom)
}

#[tauri::command]
pub async fn magasin_basculer(etat: State<'_, Etat>, id: i64) -> Res<Classement> {
    classement::magasin_basculer(&*etat.conn()?, id)
}

// ---------- fiches ----------

#[tauri::command]
pub async fn entites_lister(etat: State<'_, Etat>, kind: Kind) -> Res<Vec<Entite>> {
    entites::lister(&*etat.conn()?, kind)
}

#[tauri::command]
pub async fn entite_fiche(etat: State<'_, Etat>, id: i64) -> Res<FicheEntite> {
    entites::fiche(&*etat.conn()?, &etat.fichiers, id)
}

#[tauri::command]
pub async fn entite_creer(etat: State<'_, Etat>, saisie: SaisieEntite) -> Res<Entite> {
    entites::creer(&*etat.conn()?, &saisie)
}

#[tauri::command]
pub async fn entite_modifier(etat: State<'_, Etat>, id: i64, saisie: SaisieEntite) -> Res<Entite> {
    entites::modifier(&*etat.conn()?, id, &saisie)
}

#[tauri::command]
pub async fn entite_definir_code(etat: State<'_, Etat>, id: i64, code: String) -> Res<Entite> {
    entites::definir_code(&*etat.conn()?, id, &code)
}

#[tauri::command]
pub async fn identifiant_employe_apercu(
    etat: State<'_, Etat>,
    saisie: SaisieIdentifiant,
    id_existant: Option<i64>,
) -> Res<Option<String>> {
    entites::apercu_identifiant(&*etat.conn()?, &saisie, id_existant)
}

#[tauri::command]
pub async fn entites_suggerer(etat: State<'_, Etat>, kind: Kind, q: String) -> Res<Vec<Entite>> {
    entites::suggerer(&*etat.conn()?, kind, &q)
}

#[tauri::command]
pub async fn entite_basculer(etat: State<'_, Etat>, id: i64) -> Res<Entite> {
    entites::basculer(&*etat.conn()?, id)
}

#[tauri::command]
pub async fn entite_suppression_apercu(etat: State<'_, Etat>, id: i64) -> Res<SuppressionApercu> {
    entites::apercu_suppression(&*etat.conn()?, id)
}

#[tauri::command]
pub async fn entite_supprimer(etat: State<'_, Etat>, id: i64) -> Res<()> {
    entites::supprimer(&*etat.conn()?, id)
}

#[tauri::command]
pub async fn association_creer(etat: State<'_, Etat>, a_id: i64, b_id: i64) -> Res<()> {
    entites::associer(&*etat.conn()?, a_id, b_id)
}

#[tauri::command]
pub async fn association_retirer(etat: State<'_, Etat>, a_id: i64, b_id: i64) -> Res<()> {
    entites::dissocier(&*etat.conn()?, a_id, b_id)
}

// ---------- dossiers ----------

#[tauri::command]
pub async fn dossiers_lister(etat: State<'_, Etat>) -> Res<Vec<DossierResume>> {
    dossiers::lister(&*etat.conn()?)
}

#[tauri::command]
pub async fn dossier_detail(etat: State<'_, Etat>, id: i64) -> Res<DossierDetail> {
    dossiers::detail(&*etat.conn()?, &etat.fichiers, id)
}

#[tauri::command]
pub async fn dossier_nom_suggere(etat: State<'_, Etat>, annee: i64) -> Res<String> {
    dossiers::nom_suggere(&*etat.conn()?, annee)
}

#[tauri::command]
pub async fn dossier_creer(etat: State<'_, Etat>, saisie: SaisieDossier) -> Res<DossierResume> {
    dossiers::creer(&*etat.conn()?, &saisie)
}

#[tauri::command]
pub async fn dossier_renommer(etat: State<'_, Etat>, id: i64, nom: String) -> Res<()> {
    dossiers::renommer(&*etat.conn()?, id, &nom)
}

#[tauri::command]
pub async fn dossier_suppression_apercu(etat: State<'_, Etat>, id: i64) -> Res<DossierSuppressionApercu> {
    dossiers::apercu_suppression(&*etat.conn()?, &etat.fichiers, id)
}

#[tauri::command]
pub async fn dossier_supprimer(etat: State<'_, Etat>, id: i64) -> Res<()> {
    dossiers::supprimer(&*etat.conn()?, &etat.fichiers, id)
}

#[tauri::command]
pub async fn dossier_definir_statut(etat: State<'_, Etat>, id: i64, statut_id: i64) -> Res<DossierResume> {
    dossiers::definir_statut(&*etat.conn()?, id, statut_id)
}

#[tauri::command]
pub async fn dossier_definir_theme(etat: State<'_, Etat>, id: i64, theme_id: i64) -> Res<DossierResume> {
    dossiers::definir_theme(&*etat.conn()?, id, theme_id)
}

// ---------- états de dossier (§ 10.1) ----------

#[tauri::command]
pub async fn statuts_lister(etat: State<'_, Etat>) -> Res<Vec<StatutDossier>> {
    statuts::lister(&*etat.conn()?)
}

#[tauri::command]
pub async fn statut_creer(etat: State<'_, Etat>, nom: String, couleur: String) -> Res<StatutDossier> {
    statuts::creer(&*etat.conn()?, &nom, &couleur)
}

#[tauri::command]
pub async fn statut_modifier(etat: State<'_, Etat>, id: i64, saisie: SaisieStatut) -> Res<StatutDossier> {
    statuts::modifier(&*etat.conn()?, id, &saisie)
}

#[tauri::command]
pub async fn statut_supprimer(etat: State<'_, Etat>, id: i64) -> Res<()> {
    statuts::supprimer(&*etat.conn()?, id)
}

#[tauri::command]
pub async fn sous_dossier_creer(
    etat: State<'_, Etat>,
    dossier_id: i64,
    parent_id: Option<i64>,
    nom: String,
) -> Res<SousDossier> {
    dossiers::sous_dossier_creer(&*etat.conn()?, dossier_id, parent_id, &nom)
}

#[tauri::command]
pub async fn sous_dossier_renommer(etat: State<'_, Etat>, id: i64, nom: String) -> Res<()> {
    dossiers::sous_dossier_renommer(&*etat.conn()?, id, &nom)
}

#[tauri::command]
pub async fn sous_dossier_supprimer(etat: State<'_, Etat>, id: i64) -> Res<()> {
    dossiers::sous_dossier_supprimer(&*etat.conn()?, &etat.fichiers, id)
}

#[tauri::command]
pub async fn option_creer(etat: State<'_, Etat>, dossier_id: i64, nom: String) -> Res<OptionDossier> {
    dossiers::option_creer(&*etat.conn()?, dossier_id, &nom)
}

#[tauri::command]
pub async fn option_cocher(etat: State<'_, Etat>, id: i64, ok: bool) -> Res<()> {
    dossiers::option_cocher(&*etat.conn()?, id, ok)
}

#[tauri::command]
pub async fn option_supprimer(etat: State<'_, Etat>, id: i64) -> Res<()> {
    dossiers::option_supprimer(&*etat.conn()?, id)
}

// ---------- documents ----------

#[tauri::command]
pub async fn document_creer_depuis_modele(
    etat: State<'_, Etat>,
    dossier_id: i64,
    sous_dossier_id: Option<i64>,
    modele_id: i64,
    piece_finale: bool,
) -> Res<DocumentFichier> {
    documents::creer_depuis_modele(&*etat.conn()?, &etat.fichiers, dossier_id, sous_dossier_id, modele_id, piece_finale)
}

/// Le sélecteur de fichier s'ouvre ici, côté Rust : aucun chemin ne vient de la WebView.
/// `None` si l'utilisateur annule. La copie se fait hors du verrou de la base.
#[tauri::command]
pub async fn document_importer(
    app: AppHandle,
    etat: State<'_, Etat>,
    dossier_id: i64,
    sous_dossier_id: Option<i64>,
    piece_finale: bool,
) -> Res<Option<DocumentFichier>> {
    {
        let conn = etat.conn()?;
        documents::verifier_destination(&conn, dossier_id, sous_dossier_id)?;
    }
    let parent = app.get_webview_window(fenetre::ETIQUETTE);
    let choix = tauri::async_runtime::spawn_blocking(move || {
        let mut dialogue = app.dialog().file().set_title("Importer un fichier");
        if let Some(fenetre) = &parent {
            dialogue = dialogue.set_parent(fenetre);
        }
        dialogue.blocking_pick_file()
    })
    .await?;
    let Some(choix) = choix else { return Ok(None) };
    let source = choix.into_path().map_err(|e| {
        journaliser("import", &e);
        AppError::refus("source_refusee", "Seul un fichier d’un disque local peut être importé.")
    })?;
    let fichiers = etat.fichiers.clone();
    let copie = tauri::async_runtime::spawn_blocking(move || copies::preparer_copie(&fichiers, &source)).await??;
    let conn = etat.conn()?;
    documents::enregistrer_import(&conn, &etat.fichiers, dossier_id, sous_dossier_id, copie, piece_finale).map(Some)
}

#[tauri::command]
pub async fn document_renommer(etat: State<'_, Etat>, id: i64, nom: String) -> Res<()> {
    documents::renommer(&*etat.conn()?, id, &nom)
}

#[tauri::command]
pub async fn document_definir_date(etat: State<'_, Etat>, id: i64, date: String) -> Res<()> {
    documents::definir_date(&*etat.conn()?, id, &date)
}

#[tauri::command]
pub async fn document_enregistrer_blocs(etat: State<'_, Etat>, id: i64, blocs: Vec<Bloc>) -> Res<()> {
    documents::enregistrer_blocs(&*etat.conn()?, id, &blocs)
}

#[tauri::command]
pub async fn document_supprimer(etat: State<'_, Etat>, id: i64) -> Res<()> {
    documents::supprimer(&*etat.conn()?, &etat.fichiers, id)
}

#[tauri::command]
pub async fn document_ouvrir_externe(app: AppHandle, etat: State<'_, Etat>, id: i64) -> Res<()> {
    let chemin = documents::chemin_externe(&*etat.conn()?, &etat.fichiers, id)?;
    ouvrir_chemin(&app, &chemin)
}

/// « Enregistrer une copie… » : le sélecteur d'enregistrement s'ouvre côté Rust avec le nom d'origine ;
/// la copie exportée porte la marque « venu d'Internet ». `false` si l'utilisateur annule.
#[tauri::command]
pub async fn document_exporter(app: AppHandle, etat: State<'_, Etat>, id: i64) -> Res<bool> {
    let (source, nom) = documents::source_export(&*etat.conn()?, &etat.fichiers, id)?;
    let parent = app.get_webview_window(fenetre::ETIQUETTE);
    let choix = tauri::async_runtime::spawn_blocking(move || {
        let mut dialogue = app.dialog().file().set_title("Enregistrer une copie").set_file_name(nom);
        if let Some(fenetre) = &parent {
            dialogue = dialogue.set_parent(fenetre);
        }
        dialogue.blocking_save_file()
    })
    .await?;
    let Some(choix) = choix else { return Ok(false) };
    let destination = choix.into_path().map_err(|e| {
        journaliser("exportation", &e);
        AppError::refus("destination_refusee", "Choisissez un autre emplacement pour enregistrer la copie.")
    })?;
    let fichiers = etat.fichiers.clone();
    tauri::async_runtime::spawn_blocking(move || copies::exporter_copie(&fichiers, &source, &destination)).await??;
    Ok(true)
}

// ---------- modèles ----------

#[tauri::command]
pub async fn modeles_lister(etat: State<'_, Etat>) -> Res<Vec<Modele>> {
    modeles::lister(&*etat.conn()?)
}

#[tauri::command]
pub async fn modele_creer(etat: State<'_, Etat>) -> Res<Modele> {
    modeles::creer(&*etat.conn()?)
}

#[tauri::command]
pub async fn modele_dupliquer(etat: State<'_, Etat>, id: i64) -> Res<Modele> {
    modeles::dupliquer(&*etat.conn()?, id)
}

#[tauri::command]
pub async fn modele_enregistrer(etat: State<'_, Etat>, id: i64, saisie: SaisieModele) -> Res<Modele> {
    modeles::enregistrer(&*etat.conn()?, id, &saisie)
}

#[tauri::command]
pub async fn modele_basculer(etat: State<'_, Etat>, id: i64) -> Res<Modele> {
    modeles::basculer(&*etat.conn()?, id)
}

#[tauri::command]
pub async fn modele_supprimer(etat: State<'_, Etat>, id: i64) -> Res<()> {
    modeles::supprimer(&*etat.conn()?, id)
}

#[tauri::command]
pub async fn modeles_standards_restaurer(etat: State<'_, Etat>) -> Res<Vec<Modele>> {
    modeles::restaurer_standards(&*etat.conn()?)
}

// ---------- transverses ----------

#[tauri::command]
pub async fn recherche(etat: State<'_, Etat>, q: String) -> Res<ResultatsRecherche> {
    recherche::rechercher(&*etat.conn()?, &q)
}

#[tauri::command]
pub async fn tableau_de_bord(etat: State<'_, Etat>) -> Res<TableauDeBord> {
    tableau::calculer(&*etat.conn()?)
}
