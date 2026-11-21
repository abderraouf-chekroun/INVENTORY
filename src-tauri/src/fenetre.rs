//! Fenêtre principale, créée par le code (et non par `tauri.conf.json`) pour lui imposer :
//! - une navigation limitée à l'origine réellement servie par l'application (et à l'URL de développement
//!   en debug) ;
//! - le refus de toute nouvelle fenêtre et de tout téléchargement ;
//! - une fermeture pilotée par Rust, qui aboutit même si le JavaScript est gelé ou si la page a changé.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Emitter, Url, WebviewWindowBuilder, WindowEvent};

pub const ETIQUETTE: &str = "main";

/// Événement émis vers la fenêtre à la première demande de fermeture : le front envoie la saisie
/// en attente, puis appelle `destroy()`.
pub const EVENEMENT_FERMETURE: &str = "fermeture-demandee";

/// Délai au bout duquel la fenêtre est détruite quoi qu'il arrive après une demande de fermeture.
pub const DELAI_FERMETURE: Duration = Duration::from_millis(3500);

/// Origine qui sert l'interface : sous Windows `http://tauri.localhost` (ou `https://` si la fenêtre est
/// configurée avec `useHttpsScheme`), ailleurs `tauri://localhost`.
pub fn origine_application(https: bool) -> Url {
    let texte = if cfg!(windows) {
        if https { "https://tauri.localhost/" } else { "http://tauri.localhost/" }
    } else {
        "tauri://localhost/"
    };
    Url::parse(texte).expect("URL constante valide")
}

/// Navigation de premier niveau autorisée : uniquement les origines données (application, développement).
pub fn navigation_autorisee(url: &Url, origines: &[Url]) -> bool {
    origines.iter().any(|o| o.origin() == url.origin())
}

/// Hôtes servis par l'application elle-même sous WebView2 (interface, IPC, fichiers importés).
const HOTES_APPLICATION: [&str; 3] = ["tauri.localhost", "ipc.localhost", "asset.localhost"];

/// Vrai si une requête de la WebView doit être bloquée avant de sortir : schéma réseau vers un autre hôte
/// que ceux de l'application (ou que l'origine de développement donnée).
///
/// `on_navigation` annule une navigation interdite, mais WebView2 a déjà envoyé la requête à ce moment-là
/// (constaté par la suite de bout en bout : un `GET` arrive au serveur visé). Ce filtre agit avant l'envoi.
pub fn requete_sortante(uri: &str, dev: Option<&Url>) -> bool {
    let Ok(url) = Url::parse(uri) else { return false };
    if !matches!(url.scheme(), "http" | "https" | "ws" | "wss" | "ftp") {
        return false;
    }
    let application = url.port().is_none() && url.host_str().is_some_and(|h| HOTES_APPLICATION.contains(&h));
    !(application || dev.is_some_and(|d| d.origin() == url.origin()))
}

/// Toute requête sortante de la WebView (navigation, cadre, image, fetch…) reçoit une réponse 403 locale :
/// rien ne part sur le réseau.
#[cfg(windows)]
fn bloquer_requetes_sortantes(fenetre: &tauri::WebviewWindow, dev: Option<Url>) -> tauri::Result<()> {
    fenetre.with_webview(move |w| {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL, COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL, ICoreWebView2_22,
        };
        use webview2_com::{WebResourceRequestedEventHandler, take_pwstr};
        use windows::Win32::System::Com::IStream;
        use windows_core::{HSTRING, Interface, PWSTR};

        let env = w.environment();
        let resultat: windows_core::Result<()> = unsafe {
            (|| {
                let core = w.controller().CoreWebView2()?;
                let filtre = HSTRING::from("*");
                match core.cast::<ICoreWebView2_22>() {
                    Ok(c22) => c22.AddWebResourceRequestedFilterWithRequestSourceKinds(
                        &filtre,
                        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                        COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
                    )?,
                    Err(_) => core.AddWebResourceRequestedFilter(&filtre, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL)?,
                }
                let gestionnaire = WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
                    let Some(args) = args else { return Ok(()) };
                    let mut uri = PWSTR::null();
                    args.Request()?.Uri(&mut uri)?;
                    if requete_sortante(&take_pwstr(uri), dev.as_ref()) {
                        let reponse = env.CreateWebResourceResponse(
                            None::<&IStream>,
                            403,
                            &HSTRING::from("Forbidden"),
                            &HSTRING::new(),
                        )?;
                        args.SetResponse(&reponse)?;
                    }
                    Ok(())
                }));
                let mut jeton = 0i64;
                core.add_WebResourceRequested(&gestionnaire, &mut jeton)?;
                Ok(())
            })()
        };
        if let Err(e) = resultat {
            crate::error::journaliser("fenêtre", &e);
        }
    })
}

/// Suite donnée à une demande de fermeture.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fermeture {
    /// Première demande : différer, prévenir le front, armer le délai.
    Differer,
    /// Demande répétée pendant le délai : ignorée, le front termine l'envoi ou le délai conclut.
    Ignorer,
}

#[derive(Debug, Default)]
pub struct GardeFermeture {
    demandee: AtomicBool,
}

impl GardeFermeture {
    pub fn demande(&self) -> Fermeture {
        if self.demandee.swap(true, Ordering::SeqCst) { Fermeture::Ignorer } else { Fermeture::Differer }
    }
}

/// Crée la fenêtre principale d'après sa configuration (`create: false` dans `tauri.conf.json`).
pub fn creer(app: &AppHandle) -> tauri::Result<()> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == ETIQUETTE)
        .cloned()
        .ok_or(tauri::Error::WindowNotFound)?;
    let mut origines = vec![origine_application(config.use_https_scheme)];
    let dev = if cfg!(debug_assertions) { app.config().build.dev_url.clone() } else { None };
    if let Some(d) = dev.clone() {
        origines.push(d);
    }
    let fenetre = WebviewWindowBuilder::from_config(app, &config)?
        .on_navigation(move |url| navigation_autorisee(url, &origines))
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .on_download(|_, _| false)
        .build()?;
    #[cfg(windows)]
    bloquer_requetes_sortantes(&fenetre, dev)?;
    #[cfg(not(windows))]
    let _ = dev;

    let garde = Arc::new(GardeFermeture::default());
    let cible = fenetre.clone();
    fenetre.on_window_event(move |evenement| {
        if let WindowEvent::CloseRequested { api, .. } = evenement {
            api.prevent_close();
            if garde.demande() == Fermeture::Differer {
                let _ = cible.emit_to(ETIQUETTE, EVENEMENT_FERMETURE, ());
                let a_detruire = cible.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(DELAI_FERMETURE);
                    let _ = a_detruire.destroy();
                });
            }
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[cfg(windows)]
    #[test]
    fn navigation_limitee_a_l_origine_servie() {
        let app = [origine_application(false)];
        for ok in ["http://tauri.localhost/", "http://tauri.localhost/index.html#/dossiers"] {
            assert!(navigation_autorisee(&url(ok), &app), "{ok}");
        }
        for refuse in [
            "https://tauri.localhost/",
            "tauri://localhost/",
            "http://apercu.localhost/1",
            "http://asset.localhost/C%3A%2Fx.html",
            "http://ipc.localhost/",
            "http://tauri.localhost:8080/",
            "https://exemple.com/",
            "file:///C:/Users/x/a.html",
            "data:text/html,<script>1</script>",
            "about:blank",
            "http://localhost:1420/",
        ] {
            assert!(!navigation_autorisee(&url(refuse), &app), "{refuse}");
        }
        assert!(navigation_autorisee(&url("https://tauri.localhost/"), &[origine_application(true)]));
        let dev = [origine_application(false), url("http://localhost:1420")];
        assert!(navigation_autorisee(&url("http://localhost:1420/dossiers"), &dev));
        assert!(!navigation_autorisee(&url("http://localhost:1421/"), &dev));
    }

    #[test]
    fn requetes_sortantes_bloquees() {
        for sortante in [
            "http://127.0.0.1:8080/x",
            "https://exemple.com/",
            "http://localhost:1420/",
            "http://tauri.localhost:8080/",
            "ws://exemple.com/",
            "ftp://exemple.com/x",
            "http://evil.localhost/",
        ] {
            assert!(requete_sortante(sortante, None), "{sortante}");
        }
        for locale in [
            "http://tauri.localhost/index.html",
            "http://ipc.localhost/entites_lister",
            "http://asset.localhost/C%3A%2Fx.pdf",
            "data:text/plain,x",
            "blob:http://tauri.localhost/1",
            "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html",
            "about:blank",
        ] {
            assert!(!requete_sortante(locale, None), "{locale}");
        }
        let dev = url("http://localhost:1420");
        assert!(!requete_sortante("http://localhost:1420/src/main.tsx", Some(&dev)));
        assert!(requete_sortante("http://localhost:1421/", Some(&dev)));
    }

    #[test]
    fn demandes_de_fermeture_repetees_ignorees() {
        let g = GardeFermeture::default();
        assert_eq!(g.demande(), Fermeture::Differer);
        assert_eq!(g.demande(), Fermeture::Ignorer);
        assert_eq!(g.demande(), Fermeture::Ignorer);
    }
}
