//! INVENTORY : construction de l'application, état partagé, enregistrement des commandes.

mod commandes;
mod db;
mod domaine;
mod error;
mod etat;
mod fenetre;

use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

/// Démarrage impossible (base refusée, dossier de données invalide…) : la fenêtre principale n'est pas
/// créée ; un message natif explique pourquoi, donne l'emplacement des données et la marche à suivre,
/// et propose d'ouvrir ce dossier (ouverture faite côté Rust). L'application se ferme ensuite.
fn signaler_echec_demarrage(app: &AppHandle, e: &error::AppError, dossier: Option<PathBuf>) {
    error::journaliser("démarrage", e);
    let app = app.clone();
    let message = etat::message_echec_demarrage(e, dossier.as_deref());
    std::thread::spawn(move || {
        let dialogue = app
            .dialog()
            .message(message)
            .title("INVENTORY ne peut pas démarrer")
            .kind(MessageDialogKind::Error);
        match &dossier {
            Some(d) => {
                let ouvrir = dialogue
                    .buttons(MessageDialogButtons::OkCancelCustom("Ouvrir le dossier".into(), "Fermer".into()))
                    .blocking_show();
                if ouvrir && let Err(err) = app.opener().open_path(d.to_string_lossy(), None::<&str>) {
                    error::journaliser("démarrage", &err);
                }
            }
            None => {
                dialogue.blocking_show();
            }
        }
        app.exit(1);
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let resultat = tauri::Builder::default()
        // Doit être le premier greffon : relancer l'application ramène la fenêtre existante.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(fenetre) = app.get_webview_window(fenetre::ETIQUETTE) {
                let _ = fenetre.unminimize();
                let _ = fenetre.show();
                let _ = fenetre.set_focus();
            }
        }))
        // Greffons utilisés depuis Rust uniquement : aucune permission n'est accordée au front.
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dossier = match etat::dossier_donnees(app.handle()) {
                Ok(d) => d,
                Err(e) => {
                    signaler_echec_demarrage(app.handle(), &e, None);
                    return Ok(());
                }
            };
            match etat::Etat::ouvrir_dans(dossier.clone()) {
                Ok(etat) => {
                    // Le protocole asset ne sert que les copies de fichiers importés.
                    app.asset_protocol_scope().allow_directory(&etat.fichiers, true)?;
                    app.manage(etat);
                    fenetre::creer(app.handle())?;
                }
                Err(e) => signaler_echec_demarrage(app.handle(), &e, Some(dossier)),
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // paramètres et système
            commandes::parametres_lire,
            commandes::parametre_definir,
            commandes::infos_systeme,
            commandes::dossier_donnees_ouvrir,
            commandes::donnees_reinitialiser,
            // classement
            commandes::themes_lister,
            commandes::theme_creer,
            commandes::theme_basculer,
            commandes::theme_renommer,
            commandes::theme_supprimer,
            commandes::categories_lister,
            commandes::categorie_creer,
            commandes::categorie_basculer,
            commandes::categorie_renommer,
            commandes::categorie_supprimer,
            commandes::magasin_lister,
            commandes::magasin_creer,
            commandes::magasin_basculer,
            commandes::magasin_renommer,
            commandes::magasin_supprimer,
            // fiches
            commandes::entites_lister,
            commandes::entite_fiche,
            commandes::entite_creer,
            commandes::entite_modifier,
            commandes::entite_definir_code,
            commandes::identifiant_employe_apercu,
            commandes::entites_suggerer,
            commandes::entite_basculer,
            commandes::entite_suppression_apercu,
            commandes::entite_supprimer,
            commandes::association_creer,
            commandes::association_retirer,
            // dossiers
            commandes::dossiers_lister,
            commandes::dossier_detail,
            commandes::dossier_nom_suggere,
            commandes::dossier_creer,
            commandes::dossier_renommer,
            commandes::dossier_definir_statut,
            commandes::dossier_definir_theme,
            commandes::dossier_suppression_apercu,
            commandes::dossier_supprimer,
            commandes::statuts_lister,
            commandes::statut_creer,
            commandes::statut_modifier,
            commandes::statut_supprimer,
            commandes::sous_dossier_creer,
            commandes::sous_dossier_renommer,
            commandes::sous_dossier_supprimer,
            commandes::option_creer,
            commandes::option_cocher,
            commandes::option_supprimer,
            // documents
            commandes::document_creer_depuis_modele,
            commandes::document_importer,
            commandes::document_renommer,
            commandes::document_definir_date,
            commandes::document_enregistrer_blocs,
            commandes::document_supprimer,
            commandes::document_ouvrir_externe,
            commandes::document_exporter,
            // modèles
            commandes::modeles_lister,
            commandes::modele_creer,
            commandes::modele_dupliquer,
            commandes::modele_enregistrer,
            commandes::modele_basculer,
            commandes::modele_supprimer,
            commandes::modeles_standards_restaurer,
            // transverses
            commandes::recherche,
            commandes::tableau_de_bord,
        ])
        .run(tauri::generate_context!());

    if let Err(e) = resultat {
        eprintln!("Erreur au lancement d’INVENTORY : {e}");
        std::process::exit(1);
    }
}

/// Garde-fous sur la configuration de sécurité (capacités, CSP, fenêtre, installateur, profil release).
#[cfg(test)]
mod tests_configuration {
    use serde_json::Value;

    fn conf() -> Value {
        serde_json::from_str(include_str!("../tauri.conf.json")).unwrap()
    }

    #[test]
    fn capacites_minimales_du_front() {
        let cap: Value = serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let mut permissions: Vec<&str> =
            cap["permissions"].as_array().unwrap().iter().map(|p| p.as_str().expect("permission simple")).collect();
        permissions.sort();
        assert_eq!(
            permissions,
            [
                "core:event:allow-listen",
                "core:event:allow-unlisten",
                "core:window:allow-close",
                "core:window:allow-destroy",
                "core:window:allow-internal-toggle-maximize",
                "core:window:allow-is-maximized",
                "core:window:allow-minimize",
                "core:window:allow-start-dragging",
                "core:window:allow-toggle-maximize",
            ]
        );
    }

    #[test]
    fn csp_de_production() {
        let c = conf();
        let csp = &c["app"]["security"]["csp"];
        assert_eq!(csp["object-src"], "'none'");
        assert_eq!(csp["frame-src"], "http://asset.localhost");
        assert_eq!(csp["script-src"], "'self'");
        assert!(!csp["style-src"].as_str().unwrap().contains("unsafe-inline"));
        assert_eq!(c["app"]["withGlobalTauri"], false);
        assert_eq!(c["app"]["security"]["assetProtocol"]["scope"], serde_json::json!(["$APPDATA/fichiers/**"]));
    }

    #[test]
    fn fenetre_creee_par_le_code() {
        let c = conf();
        let fenetre = &c["app"]["windows"][0];
        assert_eq!(fenetre["label"], super::fenetre::ETIQUETTE);
        assert_eq!(fenetre["create"], false, "la fenêtre doit être créée par fenetre::creer (navigation filtrée)");
        assert_eq!(fenetre["dragDropEnabled"], false);
    }

    #[test]
    fn installateur_et_profil_release() {
        let c = conf();
        let windows = &c["bundle"]["windows"];
        assert_eq!(windows["webviewInstallMode"]["type"], "skip");
        let crochets = windows["nsis"]["installerHooks"].as_str().unwrap();
        assert_eq!(crochets, "./windows/hooks.nsh");
        let nsh = include_str!("../windows/hooks.nsh");
        assert!(nsh.contains("!macro NSIS_HOOK_POSTINSTALL"));
        for sid in ["*S-1-5-18:", "*S-1-5-32-544:", "/inheritance:r"] {
            assert!(nsh.contains(sid), "{sid}");
        }
        // 1.8.2 : le dossier lu dans le registre est contrôlé avant toute suppression (essai complet :
        // tests/installateur/crochet-preinstall.mjs).
        let preinstall = nsh.split("!macro NSIS_HOOK_PREINSTALL").nth(1).unwrap().split("!macroend").next().unwrap();
        let controle = preinstall.find("dossier enregistré refusé").expect("contrôle du dossier enregistré");
        let exe_requis = preinstall.find("${AndIfNot} ${FileExists} \"$R4\\${ANCIEN_EXE}\"").expect("ancien exécutable exigé");
        let premiere_suppression = preinstall.find("Delete \"$R4\\").expect("suppression des fichiers nommés");
        assert!(controle < premiere_suppression && exe_requis < premiere_suppression);
        for garde in ["\"\\..\\\"", "\"\\.\\\"", "\":\\\"", "${If} $0 == \":\""] {
            assert!(preinstall.contains(garde), "{garde}");
        }
        assert!(!preinstall.contains("RMDir /r"), "aucune suppression récursive");
        let cargo = include_str!("../Cargo.toml");
        let release = cargo.split("[profile.release]").nth(1).unwrap();
        assert!(release.lines().any(|l| l.trim() == "overflow-checks = true"));
    }
}
